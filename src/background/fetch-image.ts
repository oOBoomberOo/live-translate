/**
 * Fetch image bytes from the extension service worker.
 * Host permissions bypass page CORS; optional Referer satisfies CDNs like Pixiv.
 * Re-encodes to PNG so OCR always receives a consistent format.
 */

const IMAGE_MAGIC: Array<{ name: string; bytes: number[] }> = [
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'gif', bytes: [0x47, 0x49, 0x46] },
  { name: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
  { name: 'bmp', bytes: [0x42, 0x4d] },
];

export async function fetchImageBytes(
  url: string,
  referer?: string,
): Promise<{
  type: 'FETCH_IMAGE_RESULT';
  buffer?: ArrayBuffer;
  width?: number;
  height?: number;
  error?: string;
}> {
  try {
    const result = await downloadAndDecode(url, referer);
    return { type: 'FETCH_IMAGE_RESULT', ...result };
  } catch (err) {
    return {
      type: 'FETCH_IMAGE_RESULT',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function downloadAndDecode(
  url: string,
  referer?: string,
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Unsupported image URL: ${url}`);
  }

  await ensureRefererRule(url, referer);

  const headers = new Headers({
    // Prefer widely-supported formats; AVIF often fails createImageBitmap in SW.
    Accept: 'image/webp,image/jpeg,image/png,image/gif,*/*;q=0.5',
  });
  if (referer) {
    headers.set('Referer', normalizeReferer(referer));
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'omit',
    cache: 'no-cache',
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error(`CDN returned non-image content-type: ${contentType || 'unknown'}`);
  }

  const raw = await response.arrayBuffer();
  if (raw.byteLength < 24) {
    throw new Error(`Image response too small (${raw.byteLength} bytes)`);
  }

  if (!looksLikeImage(raw)) {
    const preview = new TextDecoder().decode(raw.slice(0, 80)).replace(/\s+/g, ' ');
    throw new Error(`Response is not an image (starts with: ${preview.slice(0, 60)})`);
  }

  return decodeToPng(raw);
}

export async function decodeBase64ToPng(
  base64: string,
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  if (!base64 || base64.length < 32) {
    throw new Error('Empty or invalid imageBase64');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeToPng(bytes.buffer);
}

async function decodeToPng(
  raw: ArrayBuffer,
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([raw]));
  } catch {
    throw new Error('The source image could not be decoded');
  }

  const width = bitmap.width;
  const height = bitmap.height;
  if (width < 1 || height < 1) {
    bitmap.close();
    throw new Error('Decoded image has zero dimensions');
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('OffscreenCanvas 2d unavailable');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await pngBlob.arrayBuffer();
  return { buffer, width, height };
}

function looksLikeImage(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  for (const magic of IMAGE_MAGIC) {
    if (magic.bytes.every((b, i) => bytes[i] === b)) {
      if (magic.name === 'webp') {
        // RIFF....WEBP
        return (
          bytes[8] === 0x57 &&
          bytes[9] === 0x45 &&
          bytes[10] === 0x42 &&
          bytes[11] === 0x50
        );
      }
      return true;
    }
  }
  return false;
}

function normalizeReferer(referer: string): string {
  try {
    const u = new URL(referer);
    return `${u.origin}/`;
  } catch {
    return referer.endsWith('/') ? referer : `${referer}/`;
  }
}

const REFERER_RULE_ID = 991001;

async function ensureRefererRule(url: string, referer?: string): Promise<void> {
  if (!referer || !chrome.declarativeNetRequest?.updateSessionRules) return;

  try {
    const target = new URL(url);
    const refererValue = normalizeReferer(referer);

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REFERER_RULE_ID],
      addRules: [
        {
          id: REFERER_RULE_ID,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'Referer',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: refererValue,
              },
            ],
          },
          condition: {
            urlFilter: `|${target.origin}/`,
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
              chrome.declarativeNetRequest.ResourceType.IMAGE,
            ],
          },
        },
      ],
    });
  } catch {
    // Header injection is best-effort; fetch() Referer may still work.
  }
}

import type { OcrBox, OcrResult } from '../../shared/types';
import type { Settings } from '../../shared/messages';
import { groupOcrBoxes, mergeVerticalBubbleColumns } from '../../shared/ocr-group';

type VisionVertex = { x?: number; y?: number };

export async function runGoogleVisionOcr(
  imageData: ArrayBuffer,
  settings: Settings,
): Promise<OcrResult> {
  const key = settings.apiKeys.google;
  if (!key) throw new Error('Google Cloud API key not configured');

  if (!imageData || imageData.byteLength < 32) {
    throw new Error('Google Vision: empty image buffer');
  }

  const base64 = arrayBufferToBase64(imageData);
  if (!base64) {
    throw new Error('Google Vision: failed to encode image as base64');
  }

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            // Document text gives paragraph/block structure — better for manga bubbles
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: {
              languageHints: inferLanguageHints(settings),
            },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Vision error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    responses: Array<{
      fullTextAnnotation?: {
        pages?: Array<{
          width?: number;
          height?: number;
          blocks?: Array<{
            paragraphs?: Array<{
              boundingBox?: { vertices?: VisionVertex[] };
              confidence?: number;
              words?: Array<{
                symbols?: Array<{ text: string; confidence?: number }>;
                boundingBox?: { vertices?: VisionVertex[] };
              }>;
            }>;
          }>;
        }>;
      };
      textAnnotations?: Array<{
        description: string;
        boundingPoly?: { vertices: VisionVertex[] };
      }>;
    }>;
  };

  const annotation = data.responses[0];
  const page = annotation?.fullTextAnnotation?.pages?.[0];
  let imageWidth = page?.width ?? 0;
  let imageHeight = page?.height ?? 0;
  let boxes: OcrBox[] = [];

  // Prefer Vision's paragraph-level boxes. Regrouping horizontal paragraphs can
  // bridge separate speech bubbles, but vertical JP columns inside one bubble
  // must be merged or English overlays become letter-thin strips.
  if (page?.blocks) {
    for (const block of page.blocks) {
      for (const paragraph of block.paragraphs ?? []) {
        const text = paragraphToText(paragraph);
        if (!text.trim()) continue;
        const bounds = verticesToBox(paragraph.boundingBox?.vertices);
        if (!bounds) continue;
        boxes.push({
          text,
          ...bounds,
          confidence: Math.round((paragraph.confidence ?? 0.9) * 100),
        });
      }
    }
    boxes = mergeVerticalBubbleColumns(boxes);
  }

  // Fallback: first annotation is full text; remaining are words, so only this
  // path needs spatial grouping.
  if (boxes.length === 0 && annotation?.textAnnotations && annotation.textAnnotations.length > 1) {
    for (const item of annotation.textAnnotations.slice(1)) {
      const bounds = verticesToBox(item.boundingPoly?.vertices);
      if (!bounds) continue;
      boxes.push({
        text: item.description,
        ...bounds,
        confidence: 90,
      });
    }
    boxes = mergeVerticalBubbleColumns(groupOcrBoxes(boxes));
  }

  // Infer page size from boxes if Vision omitted it
  if ((!imageWidth || !imageHeight) && boxes.length > 0) {
    imageWidth = Math.max(...boxes.map((b) => b.x + b.width), imageWidth);
    imageHeight = Math.max(...boxes.map((b) => b.y + b.height), imageHeight);
  }

  return { boxes, imageWidth, imageHeight, source: 'google-vision' };
}

function paragraphToText(paragraph: {
  words?: Array<{ symbols?: Array<{ text: string }> }>;
}): string {
  const parts: string[] = [];
  for (const word of paragraph.words ?? []) {
    let w = '';
    for (const sym of word.symbols ?? []) {
      w += sym.text ?? '';
    }
    if (w) parts.push(w);
  }
  // CJK often has no spaces between "words"
  const joined = parts.join('');
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(joined)) {
    return parts.join('');
  }
  return parts.join(' ');
}

function verticesToBox(
  vertices: VisionVertex[] | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (!vertices || vertices.length < 2) return null;
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function inferLanguageHints(settings: Settings): string[] {
  const hints = new Set<string>();
  if (settings.sourceLang && settings.sourceLang !== 'auto') {
    hints.add(settings.sourceLang);
  }
  // Common for manga / East Asian comics
  hints.add('zh');
  hints.add('ja');
  hints.add('en');
  return [...hints];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

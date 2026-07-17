import {
  MIN_OCR_DISPLAY_AREA_PX,
  MIN_OCR_DISPLAY_EDGE_PX,
} from '../shared/settings';

/**
 * On-screen size of an image for OCR deferral.
 *
 * Uses the *visible* box: getBoundingClientRect intersected with clipping
 * ancestors (overflow hidden/auto/scroll). Gallery thumbs often keep a large
 * intrinsic/layout box while only a small clipped region is shown — measuring
 * the full element would incorrectly trigger OCR.
 *
 * For absolutely positioned media that briefly reports 0×0 (Twitter/X), fall
 * back to the nearest sized ancestor only when the image is clearly meant to
 * fill that box (inset/100% sizing).
 */
export function getImageDisplaySize(img: HTMLImageElement): { width: number; height: number } {
  const rect = img.getBoundingClientRect();
  let width = Math.round(rect.width) || img.clientWidth || 0;
  let height = Math.round(rect.height) || img.clientHeight || 0;

  if (width > 0 && height > 0) {
    return clampToClippingAncestors(img, rect, width, height);
  }

  const computed = getComputedStyle(img);
  const isOutOfFlow =
    computed.position === 'absolute' ||
    computed.position === 'fixed' ||
    computed.position === 'sticky';

  if (!isOutOfFlow || !isFillSized(computed)) {
    return { width, height };
  }

  let el: HTMLElement | null = img.parentElement;
  for (let i = 0; i < 5 && el; i++) {
    const pr = el.getBoundingClientRect();
    const pw = Math.round(pr.width);
    const ph = Math.round(pr.height);
    if (pw >= 32 && ph >= 32) {
      return { width: pw, height: ph };
    }
    el = el.parentElement;
  }

  return { width, height };
}

function clampToClippingAncestors(
  img: HTMLImageElement,
  imgRect: DOMRect,
  width: number,
  height: number,
): { width: number; height: number } {
  let visibleW = width;
  let visibleH = height;
  let el: HTMLElement | null = img.parentElement;

  for (let i = 0; i < 8 && el; i++) {
    const style = getComputedStyle(el);
    if (clipsOverflow(style)) {
      const pr = el.getBoundingClientRect();
      const x1 = Math.max(imgRect.left, pr.left);
      const y1 = Math.max(imgRect.top, pr.top);
      const x2 = Math.min(imgRect.right, pr.right);
      const y2 = Math.min(imgRect.bottom, pr.bottom);
      const iw = Math.max(0, Math.round(x2 - x1));
      const ih = Math.max(0, Math.round(y2 - y1));
      if (iw > 0 && ih > 0) {
        visibleW = Math.min(visibleW, iw);
        visibleH = Math.min(visibleH, ih);
      }
    }
    el = el.parentElement;
  }

  return { width: visibleW, height: visibleH };
}

function clipsOverflow(style: CSSStyleDeclaration): boolean {
  const values = [style.overflow, style.overflowX, style.overflowY];
  return values.some((v) => v === 'hidden' || v === 'auto' || v === 'scroll' || v === 'clip');
}

/** True when CSS indicates the image stretches to its containing block. */
function isFillSized(computed: CSSStyleDeclaration): boolean {
  const widthFill =
    computed.width === '100%' ||
    computed.width.endsWith('%') ||
    (computed.left !== 'auto' && computed.right !== 'auto');
  const heightFill =
    computed.height === '100%' ||
    computed.height.endsWith('%') ||
    (computed.top !== 'auto' && computed.bottom !== 'auto');
  const insetFill =
    computed.inset !== 'auto' &&
    computed.inset !== '' &&
    !computed.inset.includes('auto');
  return insetFill || (widthFill && heightFill);
}

/**
 * True when the image is shown too small on screen to justify OCR/translation.
 *
 * Uses the *larger* edge (not both) so landscape timeline photos (e.g. Twitter
 * ~506×285) still qualify, while square thumbs (Pixiv 250×250) stay deferred.
 */
export function isDisplayedAsThumbnail(img: HTMLImageElement): boolean {
  const { width, height } = getImageDisplaySize(img);
  if (width === 0 || height === 0) return true;
  if (Math.max(width, height) < MIN_OCR_DISPLAY_EDGE_PX) return true;
  if (width * height < MIN_OCR_DISPLAY_AREA_PX) return true;
  return false;
}

/**
 * Extra heuristic for CDN thumbnail URLs (Pixiv `/c/250x250`, paths with `thumb`,
 * Twitter `name=small`, etc.). Only applies when display size is still borderline.
 */
export function looksLikeThumbnailUrl(src: string): boolean {
  if (!src) return false;
  const url = src.toLowerCase();
  return (
    /\/(?:thumb(?:nail)?|small|preview)s?\//.test(url) ||
    /\/c\/\d+x\d+/.test(url) ||
    /(?:^|[?&])(?:w|h|width|height)=\d{1,3}(?:&|$)/.test(url) ||
    /(?:^|[?&])name=(?:small|thumb|240x240|360x360)(?:&|$)/.test(url) ||
    /:(?:small|thumb|n(?:ormal)?)(?:$|\?)/.test(url)
  );
}

/** Primary display-size gate plus optional URL heuristic for borderline sizes. */
export function shouldDeferImageOcr(img: HTMLImageElement): boolean {
  if (isDisplayedAsThumbnail(img)) return true;
  const src = img.currentSrc || img.src;
  if (looksLikeThumbnailUrl(src)) {
    const { width, height } = getImageDisplaySize(img);
    const maxEdge = Math.max(width, height);
    // CDN thumb URLs: require a clearer enlargement past the soft threshold.
    if (maxEdge < MIN_OCR_DISPLAY_EDGE_PX + 40) return true;
  }
  return false;
}

/**
 * Prefer a higher-resolution variant when fetching for OCR (Twitter/X `name=`
 * and legacy `:small` suffixes). Display URL is left unchanged.
 */
export function preferOcrSourceUrl(src: string): string {
  if (!src) return src;
  try {
    const u = new URL(src, location.href);
    const host = u.hostname.toLowerCase();
    const isTwitterCdn =
      host === 'pbs.twimg.com' ||
      host.endsWith('.twimg.com') ||
      host === 'ton.twitter.com';

    if (isTwitterCdn) {
      if (u.searchParams.has('name')) {
        const name = (u.searchParams.get('name') || '').toLowerCase();
        if (name && name !== 'orig' && name !== 'large') {
          u.searchParams.set('name', 'large');
        }
      }
      u.pathname = u.pathname.replace(/:(?:small|thumb|medium|large|orig)$/i, ':large');
      return u.href;
    }
  } catch {
    // keep original
  }
  return src;
}

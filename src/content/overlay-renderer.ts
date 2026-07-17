import type { TranslatedImageUnit } from '../shared/types';
import { injectStyles } from './dom-utils';

/** Tall/narrow speech bubbles (manga vertical text). */
const VERTICAL_ASPECT_RATIO = 1.4;
const MIN_FONT_HORIZONTAL = 10;
const MIN_FONT_VERTICAL = 9;
const MAX_FONT_HORIZONTAL = 40;

export function renderOverlays(
  img: HTMLImageElement,
  result: TranslatedImageUnit,
): void {
  injectStyles();

  const container = ensureOverlayContainer(img);
  container.querySelectorAll('.lt-overlay').forEach((el) => removeOverlayElement(el));

  // Use the rendered image box only — never fall back to naturalWidth (that
  // blows up the layout when the comic is shown smaller than its pixel size).
  const display = measureDisplaySize(img);
  if (
    !display.width ||
    !display.height ||
    !result.ocr.imageWidth ||
    !result.ocr.imageHeight
  ) {
    img.classList.remove('lt-image-loading');
    img.setAttribute('data-lt-done', 'true');
    return;
  }

  const { width: displayWidth, height: displayHeight } = display;
  const scaleX = displayWidth / result.ocr.imageWidth;
  const scaleY = displayHeight / result.ocr.imageHeight;

  result.ocr.boxes.forEach((box, i) => {
    const translated = result.translations[i];
    if (!translated?.trim()) return;

    const ocrLeft = box.x * scaleX;
    const ocrTop = box.y * scaleY;
    const ocrWidth = box.width * scaleX;
    const ocrHeight = box.height * scaleY;
    const vertical = isVerticalBox(ocrWidth, ocrHeight);

    const overlay = document.createElement('span');
    overlay.className = vertical ? 'lt-overlay lt-overlay--vertical' : 'lt-overlay';
    overlay.setAttribute('data-lt-skip', 'true');
    if (vertical) overlay.setAttribute('data-lt-vertical', 'true');

    const textEl = document.createElement('span');
    textEl.className = 'lt-overlay-text';
    textEl.textContent = formatOverlayText(translated, vertical);
    overlay.appendChild(textEl);

    const handles = (['top', 'right', 'bottom', 'left'] as const).map((edge) => {
      const handle = document.createElement('span');
      handle.className = `lt-overlay-resize-handle lt-overlay-resize-handle--${edge}`;
      handle.setAttribute('data-lt-skip', 'true');
      handle.dataset.edge = edge;
      handle.title = `Drag ${edge} edge to resize`;
      overlay.appendChild(handle);
      return handle;
    });

    container.appendChild(overlay);
    layoutFixedBoxOverlay(overlay, textEl, {
      ocrLeft,
      ocrTop,
      ocrWidth,
      ocrHeight,
      displayWidth,
      displayHeight,
      vertical,
    });
    attachOverlayResize(overlay, textEl, handles, container);
  });

  img.classList.remove('lt-image-loading');
  img.setAttribute('data-lt-done', 'true');
}

/** Rendered on-screen size of the image (CSS pixels). */
function measureDisplaySize(img: HTMLImageElement): { width: number; height: number } {
  const rect = img.getBoundingClientRect();
  const width = rect.width || img.clientWidth;
  const height = rect.height || img.clientHeight;
  return { width, height };
}

function isVerticalBox(width: number, height: number): boolean {
  if (width <= 0) return true;
  return height / width > VERTICAL_ASPECT_RATIO;
}

/**
 * Flatten newlines for horizontal bubbles; for narrow vertical boxes keep
 * soft opportunities to wrap English (CJK→EN) inside the OCR width.
 */
function formatOverlayText(translated: string, vertical: boolean): string {
  const flat = translated.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!vertical) return flat;
  return flat.replace(/(\S{8,})/g, (token) => insertSoftBreaks(token, 6));
}

function insertSoftBreaks(token: string, chunk: number): string {
  if (token.length <= chunk) return token;
  const parts: string[] = [];
  for (let i = 0; i < token.length; i += chunk) {
    parts.push(token.slice(i, i + chunk));
  }
  return parts.join('\u200B');
}

/**
 * Place the overlay exactly over the OCR bounding box.
 * Font size tracks the original glyph scale (OCR box height/width).
 */
function layoutFixedBoxOverlay(
  el: HTMLElement,
  textEl: HTMLElement,
  opts: {
    ocrLeft: number;
    ocrTop: number;
    ocrWidth: number;
    ocrHeight: number;
    displayWidth: number;
    displayHeight: number;
    vertical: boolean;
  },
): void {
  const { ocrLeft, ocrTop, ocrWidth, ocrHeight, displayWidth, displayHeight, vertical } =
    opts;

  const left = clamp(ocrLeft, 0, displayWidth);
  const top = clamp(ocrTop, 0, displayHeight);
  const width = Math.max(1, Math.min(ocrWidth, displayWidth - left));
  const height = Math.max(1, Math.min(ocrHeight, displayHeight - top));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.maxWidth = `${width}px`;
  el.style.height = `${height}px`;
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'normal';

  if (vertical) {
    textEl.style.width = '100%';
    textEl.style.maxWidth = '100%';
    textEl.style.overflowWrap = 'anywhere';
    textEl.style.wordBreak = 'break-word';
    textEl.style.hyphens = 'auto';
  }

  fitFontToBox(el, textEl, vertical, width, height);
  applyPercentBox(el, left, top, width, height, displayWidth, displayHeight);
}

/**
 * Prefer the original OCR glyph scale. Only shrink slightly if English still
 * overflows — never collapse to tiny unreadable sizes.
 */
function preferredFontSize(vertical: boolean, boxWidth: number, boxHeight: number): number {
  if (vertical) {
    // Vertical manga glyphs roughly match column width; keep room for EN wrap.
    return Math.max(MIN_FONT_VERTICAL, Math.round(Math.min(boxWidth * 0.72, boxHeight * 0.18)));
  }
  // Horizontal speech: line height ≈ OCR box height for single-line bubbles;
  // for multi-line boxes use a typical line (~28–40% of block height, capped).
  const singleLine = boxHeight <= boxWidth * 0.55;
  const size = singleLine ? boxHeight * 0.72 : Math.min(boxHeight * 0.28, boxWidth * 0.18);
  return Math.max(
    MIN_FONT_HORIZONTAL,
    Math.min(MAX_FONT_HORIZONTAL, Math.round(size)),
  );
}

function fitFontToBox(
  el: HTMLElement,
  textEl: HTMLElement,
  vertical: boolean,
  boxWidth = el.clientWidth,
  boxHeight = el.clientHeight,
): void {
  const width = boxWidth || el.clientWidth || parseFloat(el.style.width) || 0;
  const height = boxHeight || el.clientHeight || parseFloat(el.style.height) || 0;
  const preferred = preferredFontSize(vertical, width, height);
  // Vertical columns often hold longer EN replacements — allow shrinking to the
  // readable floor rather than stopping at ~82% of the preferred size.
  const minSize = vertical ? MIN_FONT_VERTICAL : MIN_FONT_HORIZONTAL;

  el.style.fontSize = `${preferred}px`;
  void el.offsetHeight;
  const fitsPreferred =
    el.scrollWidth <= el.clientWidth + 1 &&
    el.scrollHeight <= el.clientHeight + 1 &&
    textEl.scrollWidth <= textEl.clientWidth + 1 &&
    textEl.scrollHeight <= el.clientHeight + 1;
  if (fitsPreferred || preferred <= minSize) {
    return;
  }

  // Fit all the way to a readable floor. A translated paragraph can be much
  // longer than its source, and stopping near the preferred size clips it.
  let best = minSize;
  let lo = minSize;
  let hi = preferred;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    void el.offsetHeight;
    const fits =
      el.scrollWidth <= el.clientWidth + 1 &&
      el.scrollHeight <= el.clientHeight + 1 &&
      textEl.scrollWidth <= textEl.clientWidth + 1 &&
      textEl.scrollHeight <= el.clientHeight + 1;
    if (fits) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
}

function applyPercentBox(
  el: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
  displayWidth: number,
  displayHeight: number,
): void {
  // Percentages keep overlays aligned if the image scales with the layout.
  el.style.left = `${(left / displayWidth) * 100}%`;
  el.style.top = `${(top / displayHeight) * 100}%`;
  el.style.width = `${(width / displayWidth) * 100}%`;
  el.style.maxWidth = `${(width / displayWidth) * 100}%`;
  el.style.height = `${(height / displayHeight) * 100}%`;
}

const MIN_RESIZE_PX = 24;

/** Active document-level resize listeners — cleared on restore / disable. */
const overlayResizeCleanups = new Set<() => void>();
const overlayResizeByEl = new WeakMap<HTMLElement, () => void>();

export function disposeOverlayInteractions(): void {
  for (const cleanup of [...overlayResizeCleanups]) cleanup();
  overlayResizeCleanups.clear();
}

function removeOverlayElement(el: Element): void {
  if (el instanceof HTMLElement) {
    overlayResizeByEl.get(el)?.();
  }
  el.remove();
}

type ResizeEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Four edge grips behave like editor splitters. Only the thin handles receive
 * pointer events, so clicks elsewhere still reach the underlying image.
 */
function attachOverlayResize(
  overlay: HTMLElement,
  textEl: HTMLElement,
  handles: HTMLElement[],
  container: HTMLElement,
): void {
  const vertical = overlay.hasAttribute('data-lt-vertical');
  let active: {
    pointerId: number;
    handle: HTMLElement;
    edge: ResizeEdge;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
  } | null = null;

  const detachDocumentListeners = () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', endResize);
    document.removeEventListener('pointercancel', endResize);
  };

  const stopActiveDrag = () => {
    if (!active) return;
    const { pointerId } = active;
    const activeHandle = active.handle;
    active = null;
    overlay.classList.remove('is-resizing');
    try {
      activeHandle.releasePointerCapture(pointerId);
    } catch {
      // Already released or never captured.
    }
    detachDocumentListeners();
  };

  const detach = () => {
    stopActiveDrag();
    overlayResizeCleanups.delete(detach);
    overlayResizeByEl.delete(overlay);
  };

  overlayResizeCleanups.add(detach);
  overlayResizeByEl.set(overlay, detach);

  const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();

    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    let left = active.startLeft;
    let top = active.startTop;
    let width = active.startWidth;
    let height = active.startHeight;

    if (active.edge === 'right') {
      width = clamp(active.startWidth + dx, MIN_RESIZE_PX, bounds.width - left);
    } else if (active.edge === 'left') {
      const right = active.startLeft + active.startWidth;
      left = clamp(active.startLeft + dx, 0, right - MIN_RESIZE_PX);
      width = right - left;
    } else if (active.edge === 'bottom') {
      height = clamp(active.startHeight + dy, MIN_RESIZE_PX, bounds.height - top);
    } else {
      const bottom = active.startTop + active.startHeight;
      top = clamp(active.startTop + dy, 0, bottom - MIN_RESIZE_PX);
      height = bottom - top;
    }

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.maxWidth = `${width}px`;
    overlay.style.height = `${height}px`;
  };

  const endResize = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;

    const { pointerId, handle: activeHandle } = active;
    active = null;
    overlay.classList.remove('is-resizing');

    try {
      activeHandle.releasePointerCapture(pointerId);
    } catch {
      // Already released or never captured.
    }

    detachDocumentListeners();

    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const width = Math.max(MIN_RESIZE_PX, overlay.offsetWidth);
    const height = Math.max(MIN_RESIZE_PX, overlay.offsetHeight);
    const box = overlay.getBoundingClientRect();
    const left = clamp(box.left - bounds.left, 0, bounds.width - width);
    const top = clamp(box.top - bounds.top, 0, bounds.height - height);
    fitFontToBox(overlay, textEl, vertical, width, height);
    applyPercentBox(
      overlay,
      left,
      top,
      width,
      height,
      bounds.width,
      bounds.height,
    );
  };

  for (const handle of handles) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const edge = handle.dataset.edge as ResizeEdge | undefined;
      if (!edge) return;
      event.preventDefault();
      event.stopPropagation();

      const bounds = container.getBoundingClientRect();
      const box = overlay.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      stopActiveDrag();

      active = {
        pointerId: event.pointerId,
        handle,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: box.left - bounds.left,
        startTop: box.top - bounds.top,
        startWidth: box.width,
        startHeight: box.height,
      };

      overlay.classList.add('is-resizing');
      // Work in pixels while dragging for stable math.
      overlay.style.left = `${active.startLeft}px`;
      overlay.style.top = `${active.startTop}px`;
      overlay.style.width = `${active.startWidth}px`;
      overlay.style.maxWidth = `${active.startWidth}px`;
      overlay.style.height = `${active.startHeight}px`;

      handle.setPointerCapture(event.pointerId);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', endResize);
      document.addEventListener('pointercancel', endResize);
    });
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Wrap the image without changing its on-page size.
 * Never assign fixed px from naturalWidth — that blows up responsive viewers
 * (holoearth, manga readers, etc.). Preserve max-width / percentage sizing.
 * Absolutely positioned fill media (Twitter/X) uses --fill; other abs images
 * keep their own box without inset:0 stretching.
 */
function ensureOverlayContainer(img: HTMLImageElement): HTMLElement {
  const parent = img.parentElement;
  if (parent?.classList.contains('lt-overlay-container')) {
    return parent;
  }

  const before = img.getBoundingClientRect();
  const computed = getComputedStyle(img);

  const container = document.createElement('span');
  container.className = 'lt-overlay-container';
  container.setAttribute('data-lt-skip', 'true');

  const position = computed.position;
  if (position === 'absolute' || position === 'fixed') {
    container.style.position = position;
    container.style.zIndex = computed.zIndex === 'auto' ? '' : computed.zIndex;

    const fillsParent = fillsContainingBlock(img, before);
    if (fillsParent) {
      // Twitter-like: wrapper replaces the img as the fill-sized abs child.
      container.classList.add('lt-overlay-container--fill');
      container.style.inset = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.maxWidth = 'none';
      container.style.top = '';
      container.style.left = '';
      container.style.right = '';
      container.style.bottom = '';
    } else {
      // Do NOT add --fill (its inset:0 would stretch the layout box).
      copyOutOfFlowBox(computed, container, before);
    }

    const objectFit = computed.objectFit;
    if (objectFit && objectFit !== 'fill') {
      img.style.objectFit = objectFit;
    }

    img.style.position = 'absolute';
    img.style.inset = '0';
    img.style.top = '0';
    img.style.left = '0';
    img.style.right = '0';
    img.style.bottom = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.maxWidth = 'none';
    img.style.margin = '0';
    img.style.display = 'block';
  } else {
    // Transfer percentage / fill sizing to the wrapper so the parent still
    // constrains layout the same way the bare <img> did.
    // Never copy resolved px from natural/intrinsic width onto the wrapper.
    const inlineWidth = img.style.width;
    const inlineMaxWidth = img.style.maxWidth;
    const inlineHeight = img.style.height;

    if (inlineWidth && !isResolvedPixelLength(inlineWidth)) {
      container.style.width = inlineWidth;
      img.style.width = '100%';
    } else if (fillsParentWidth(img, before)) {
      container.style.width = '100%';
      img.style.width = '100%';
    }

    if (inlineMaxWidth) {
      container.style.maxWidth = inlineMaxWidth;
    } else if (computed.maxWidth !== 'none' && !isResolvedPixelLength(computed.maxWidth)) {
      container.style.maxWidth = computed.maxWidth;
    } else {
      container.style.maxWidth = '100%';
    }

    if (inlineHeight && inlineHeight !== 'auto' && !isResolvedPixelLength(inlineHeight)) {
      container.style.height = inlineHeight;
      img.style.height = '100%';
    }

    // Keep the pre-wrap painted size if the wrapper would otherwise expand
    // to intrinsic/natural dimensions (common with max-width:100% comics).
    if (before.width > 0) {
      const maxW = container.style.maxWidth || '100%';
      container.style.maxWidth = maxW;
    }
  }

  if (parent) {
    parent.insertBefore(container, img);
    container.appendChild(img);
  }

  // If wrapping still grew the painted box, clamp with max dimensions that
  // match the pre-wrap display size (responsive: use max-*, not forced width
  // alone, so shrinking viewports still work).
  const after = img.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (before.width > 0 && containerRect.width > before.width + 2) {
    container.style.maxWidth = `${Math.round(before.width)}px`;
    if (!container.classList.contains('lt-overlay-container--fill')) {
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
    }
  }
  if (
    before.height > 0 &&
    !container.classList.contains('lt-overlay-container--fill') &&
    (containerRect.height > before.height + 2 || after.height > before.height + 2)
  ) {
    container.style.maxHeight = `${Math.round(before.height)}px`;
  }

  return container;
}

function isResolvedPixelLength(value: string): boolean {
  return /^-?\d+(\.\d+)?px$/i.test(value.trim());
}

/**
 * Copy out-of-flow placement without enabling conflicting inset:0 + width.
 * Prefer inset edges when both sides are set; otherwise use top/left + size
 * from the pre-wrap bounding box (not naturalWidth).
 */
function copyOutOfFlowBox(
  computed: CSSStyleDeclaration,
  target: HTMLElement,
  before: DOMRect,
): void {
  const hasLeft = computed.left !== 'auto';
  const hasRight = computed.right !== 'auto';
  const hasTop = computed.top !== 'auto';
  const hasBottom = computed.bottom !== 'auto';

  if (hasLeft) target.style.left = computed.left;
  if (hasTop) target.style.top = computed.top;

  // Avoid left+right+width (or top+bottom+height) which stretches the box.
  if (hasLeft && hasRight) {
    target.style.right = computed.right;
    target.style.width = 'auto';
  } else if (before.width > 0) {
    target.style.width = `${Math.round(before.width)}px`;
  }

  if (hasTop && hasBottom) {
    target.style.bottom = computed.bottom;
    target.style.height = 'auto';
  } else if (before.height > 0) {
    target.style.height = `${Math.round(before.height)}px`;
  }

  if (computed.maxWidth !== 'none' && !isResolvedPixelLength(computed.maxWidth)) {
    target.style.maxWidth = computed.maxWidth;
  }
}

/** True when the image already spans (nearly) its containing block. */
function fillsParentWidth(img: HTMLImageElement, rect: DOMRect): boolean {
  const parent = img.parentElement;
  if (!parent) return false;
  const parentWidth = parent.getBoundingClientRect().width;
  if (parentWidth <= 0) return false;
  return rect.width >= parentWidth * 0.92;
}

function fillsContainingBlock(img: HTMLImageElement, rect: DOMRect): boolean {
  const parent = img.offsetParent instanceof HTMLElement ? img.offsetParent : img.parentElement;
  if (!parent) return false;
  const pr = parent.getBoundingClientRect();
  if (pr.width <= 0 || pr.height <= 0) return false;
  return (
    Math.abs(rect.left - pr.left) <= 2 &&
    Math.abs(rect.top - pr.top) <= 2 &&
    rect.width >= pr.width * 0.92 &&
    rect.height >= pr.height * 0.92
  );
}

export function removeImageOverlays(): void {
  disposeOverlayInteractions();
  document.querySelectorAll('.lt-overlay').forEach((el) => el.remove());
}

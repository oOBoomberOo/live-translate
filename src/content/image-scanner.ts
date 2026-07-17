import type { Settings } from '../shared/messages';
import { isTranslatableImage } from './dom-utils';
import { preferOcrSourceUrl, shouldDeferImageOcr } from './image-display';
import {
  hideAllImageProcessingStatuses,
  hideImageProcessingStatus,
  showImageProcessingStatus,
} from './image-status';
import { renderOverlays } from './overlay-renderer';

export class ImageScanner {
  /** In-flight work keyed by element (not URL — Twitter reuses CDN URLs). */
  private processingEls = new WeakSet<HTMLImageElement>();
  private resizeObserved = new WeakSet<HTMLImageElement>();
  private loadHooked = new WeakSet<HTMLImageElement>();
  private resizeObserver: ResizeObserver | null = null;
  private settings: Settings;
  private onImageFinished?: (img: HTMLImageElement) => void;

  constructor(settings: Settings, onImageFinished?: (img: HTMLImageElement) => void) {
    this.settings = settings;
    this.onImageFinished = onImageFinished;
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const img = entry.target as HTMLImageElement;
        if (shouldDeferImageOcr(img)) continue;
        if (img.hasAttribute('data-lt-done') || this.processingEls.has(img)) continue;
        void this.processImage(img);
      }
    });
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    hideAllImageProcessingStatuses();
  }

  unobserveResize(img: HTMLImageElement): void {
    this.resizeObserver?.unobserve(img);
  }

  /**
   * Scan an element for images. Returns true when at least one image was deferred
   * as a thumbnail (caller should keep IntersectionObserver watching so a later
   * enlarge / lightbox still triggers OCR).
   */
  scanElement(el: Element): boolean {
    if (!this.settings.translateImages) return false;

    if (el.tagName === 'IMG') {
      return this.scanImage(el as HTMLImageElement);
    }

    if (isTranslatableImage(el)) {
      const style = getComputedStyle(el);
      const match = style.backgroundImage.match(/url\(["']?(.+?)["']?\)/);
      if (match?.[1] && !match[1].startsWith('data:')) {
        // CSS background OCR overlays are not rendered yet; skip to avoid noise.
        return false;
      }
    }

    let deferred = false;
    el.querySelectorAll('img').forEach((img) => {
      if (this.scanImage(img)) deferred = true;
    });
    return deferred;
  }

  private scanImage(img: HTMLImageElement): boolean {
    this.hookImageLoad(img);

    if (shouldDeferImageOcr(img)) {
      this.watchForResize(img);
      return true;
    }
    void this.processImage(img);
    return false;
  }

  private watchForResize(img: HTMLImageElement): void {
    if (!this.resizeObserver || this.resizeObserved.has(img)) return;
    this.resizeObserved.add(img);
    this.resizeObserver.observe(img);
  }

  /** Re-check when lazy-loaded / src-swapped images finish loading (Twitter media). */
  private hookImageLoad(img: HTMLImageElement): void {
    if (this.loadHooked.has(img)) return;
    this.loadHooked.add(img);
    img.addEventListener('load', () => {
      if (img.hasAttribute('data-lt-done') || this.processingEls.has(img)) return;
      if (shouldDeferImageOcr(img)) {
        this.watchForResize(img);
        return;
      }
      void this.processImage(img);
    });
  }

  async processImage(img: HTMLImageElement): Promise<void> {
    if (!this.settings.translateImages) return;
    if (img.hasAttribute('data-lt-done') || this.processingEls.has(img)) return;
    if (img.hasAttribute('data-lt-processing')) return;

    const key = img.currentSrc || img.src;
    if (!key) return;
    if (key.startsWith('data:') && key.length < 100) return;

    if (!img.complete || img.naturalWidth === 0) {
      this.hookImageLoad(img);
      return;
    }

    if (img.naturalWidth < 48 || img.naturalHeight < 48) return;

    if (shouldDeferImageOcr(img)) {
      this.watchForResize(img);
      return;
    }

    this.processingEls.add(img);
    img.setAttribute('data-lt-processing', 'true');
    img.classList.add('lt-image-loading');
    showImageProcessingStatus(img);

    try {
      const payload = await buildOcrPayload(img, key);
      const response = (await chrome.runtime.sendMessage({
        type: 'OCR_IMAGE',
        id: key,
        ...payload,
        from: this.settings.sourceLang,
        to: this.settings.targetLang,
      })) as { type: string; result?: import('../shared/types').TranslatedImageUnit; error?: string };

      if (response.error) throw new Error(response.error);
      if (response.result && response.result.ocr.boxes.length > 0) {
        renderOverlays(img, response.result);
        this.finishImage(img);
      } else {
        img.classList.remove('lt-image-loading');
        img.setAttribute('data-lt-done', 'true');
        this.finishImage(img);
      }
    } catch (err) {
      img.classList.remove('lt-image-loading');
      console.warn('[Live Translate] Image OCR failed:', err);
      // Keep watching so a later src/size change can retry.
      this.watchForResize(img);
    } finally {
      this.processingEls.delete(img);
      img.removeAttribute('data-lt-processing');
      hideImageProcessingStatus(img);
    }
  }

  private finishImage(img: HTMLImageElement): void {
    this.unobserveResize(img);
    hideImageProcessingStatus(img);
    this.onImageFinished?.(img);
  }
}

async function buildOcrPayload(
  img: HTMLImageElement,
  src: string,
): Promise<{
  url: string;
  referer?: string;
  imageBase64?: string;
  width?: number;
  height?: number;
}> {
  const fetchSrc = preferOcrSourceUrl(src);
  const absolute = new URL(fetchSrc, location.href).href;
  const referer = `${location.origin}/`;

  // Same-origin / data / blob: send base64 so the SW does not need another fetch.
  // Prefer the displayed element's pixels when the URL was not upgraded.
  if (canUseCanvasCapture(src) && fetchSrc === src) {
    try {
      const fromCanvas = await captureViaCanvas(img);
      if (fromCanvas) {
        return {
          url: absolute,
          imageBase64: arrayBufferToBase64(fromCanvas.buffer),
          width: fromCanvas.width,
          height: fromCanvas.height,
        };
      }
    } catch {
      // Fall through to URL fetch in the service worker.
    }
  }

  // Cross-origin (Pixiv, Twitter, etc.): SW fetches with host permissions + Referer.
  return { url: absolute, referer, width: img.naturalWidth, height: img.naturalHeight };
}

function canUseCanvasCapture(src: string): boolean {
  if (src.startsWith('data:') || src.startsWith('blob:')) return true;
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

async function captureViaCanvas(
  img: HTMLImageElement,
): Promise<{ buffer: ArrayBuffer; width: number; height: number } | null> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob || blob.size < 32) return null;
  const buffer = await blob.arrayBuffer();
  return { buffer, width: canvas.width, height: canvas.height };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

import type { Settings } from '../shared/messages';
import { BATCH_DEBOUNCE_MS, INTERSECTION_ROOT_MARGIN } from '../shared/settings';
import {
  collectTranslatableElements,
  hasDirectText,
  isTranslatableImage,
  showToast,
} from './dom-utils';
import { applyTranslations, buildTextUnits } from './text-replacer';
import { ImageScanner } from './image-scanner';

export class ScrollObserver {
  private observer: IntersectionObserver | null = null;
  private pendingElements = new Set<Element>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private settings: Settings;
  private imageScanner: ImageScanner;
  private idToNode = new Map<string, Text>();
  private active = false;

  constructor(settings: Settings) {
    this.settings = settings;
    this.imageScanner = new ImageScanner(settings, (img) => {
      this.observer?.unobserve(img);
    });
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    this.observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      { rootMargin: INTERSECTION_ROOT_MARGIN, threshold: 0.01 },
    );

    this.observeAll();
  }

  stop(): void {
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    this.imageScanner.destroy();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pendingElements.clear();
    this.idToNode.clear();
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.imageScanner.updateSettings(settings);
  }

  observeElement(el: Element): void {
    if (!this.observer || !this.active) return;
    if (el.hasAttribute('data-lt-done')) return;
    this.observer.observe(el);
  }

  observeAll(): void {
    const elements = collectTranslatableElements();
    for (const el of elements) {
      this.observeElement(el);
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as Element;
      if (el.hasAttribute('data-lt-done')) {
        this.observer?.unobserve(el);
        continue;
      }

      if (isTranslatableImage(el)) {
        // Deferred thumbnails return true — keep IntersectionObserver so a
        // later enlarge (or src swap) can still be picked up on re-intersect.
        const keepObserving = this.imageScanner.scanElement(el);
        if (!keepObserving) {
          this.observer?.unobserve(el);
        }
        continue;
      }

      if (hasDirectText(el)) {
        this.pendingElements.add(el);
      }
    }

    this.scheduleBatch();
  }

  private scheduleBatch(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushBatch(), BATCH_DEBOUNCE_MS);
  }

  private async flushBatch(): Promise<void> {
    if (this.pendingElements.size === 0) return;

    const elements = [...this.pendingElements];
    this.pendingElements.clear();

    const { units, idToNode } = buildTextUnits(elements);
    for (const [id, node] of idToNode) {
      this.idToNode.set(id, node);
    }

    if (units.length === 0) return;

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        units,
        from: this.settings.sourceLang,
        to: this.settings.targetLang,
      })) as { results?: Array<{ id: string; original: string; translated: string }>; error?: string };

      if (response.error) throw new Error(response.error);
      if (response.results) {
        applyTranslations(response.results, this.idToNode, this.settings.targetLang);
      }

      for (const el of elements) {
        if (el.hasAttribute('data-lt-done')) {
          this.observer?.unobserve(el);
        }
      }
    } catch (err) {
      showToast(
        `Translation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        true,
      );
    }
  }
}

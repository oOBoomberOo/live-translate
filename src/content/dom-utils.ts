const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'SVG',
]);

const SKIP_ATTRIBUTES = new Set(['data-lt-done', 'data-lt-original', 'data-lt-id']);

let idCounter = 0;

export function nextId(): string {
  return `lt-${++idCounter}`;
}

export function shouldSkipElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.closest('[data-lt-skip]')) return true;
  if (el.closest('.lt-overlay-container')) return true;
  if (el.classList.contains('lt-overlay')) return true;
  if (el.hasAttribute('data-lt-done')) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

export function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
      const text = node.textContent?.trim();
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
      if (parent.hasAttribute('data-lt-done')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  return nodes;
}

export function collectTranslatableElements(root: Node | Document = document): Element[] {
  const elements: Element[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (!shouldSkipElement(el) && isVisible(el)) {
        if (hasDirectText(el) || isTranslatableImage(el)) {
          elements.push(el);
        }
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
    for (const child of node.childNodes) {
      walk(child);
    }
  }

  walk(root);
  return elements;
}

export function hasDirectText(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text && text.length >= 2) return true;
    }
  }
  return false;
}

export function isTranslatableImage(el: Element): boolean {
  if (el.closest('.lt-overlay-container')) return false;
  if (el.tagName === 'IMG' && (el as HTMLImageElement).src) return true;
  if (el.tagName === 'image' && el.getAttribute('href')) return true;
  const style = getComputedStyle(el);
  // Only treat real CSS background images as candidates (not gradients).
  if (style.backgroundImage && /url\(/i.test(style.backgroundImage)) return true;
  return false;
}

export function getElementText(el: Element): string | null {
  const texts: string[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent?.trim();
      if (t) texts.push(t);
    }
  }
  return texts.length > 0 ? texts.join(' ') : null;
}

const STYLE_VERSION = '2';

export function injectStyles(): void {
  const existing = document.getElementById('lt-styles');
  if (existing?.dataset.ltStyleVersion === STYLE_VERSION) return;
  existing?.remove();
  const style = document.createElement('style');
  style.id = 'lt-styles';
  style.dataset.ltStyleVersion = STYLE_VERSION;
  style.textContent = `
    [data-lt-done] { word-break: break-word; }
    .lt-overlay-container {
      position: relative;
      display: inline-block;
      max-width: 100%;
      width: auto;
      height: auto;
      line-height: 0;
      overflow: hidden;
      box-sizing: border-box;
      vertical-align: top;
    }
    .lt-overlay-container--fill {
      /* Only for abs/fixed media that already filled its containing block.
         inset:0 sizes against the parent — must not invent a larger layout box. */
      position: absolute;
      display: block;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      vertical-align: top;
      overflow: hidden;
    }
    .lt-overlay-container > img {
      display: block;
      max-width: 100%;
      height: auto;
      box-sizing: border-box;
    }
    .lt-overlay-container--fill > img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      object-fit: inherit;
    }
    .lt-overlay {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      overflow: hidden;
      line-height: 1.05;
      color: #111;
      background: rgba(255, 255, 255, 0.28);
      -webkit-backdrop-filter: blur(10px) saturate(1.05);
      backdrop-filter: blur(10px) saturate(1.05);
      border: none;
      border-radius: 0;
      box-sizing: border-box;
      padding: 1px 2px;
      pointer-events: none;
      z-index: 2;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-weight: 600;
      letter-spacing: 0.01em;
      word-break: break-word;
      overflow-wrap: break-word;
      hyphens: auto;
      box-shadow: none;
      text-shadow:
        0 0 3px rgba(255, 255, 255, 0.95),
        0 1px 2px rgba(255, 255, 255, 0.8);
    }
    .lt-overlay-text {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-wrap: break-word;
      word-break: break-word;
      pointer-events: none;
      position: relative;
      z-index: 1;
    }
    .lt-overlay--vertical {
      align-items: flex-start;
      padding: 1px;
      line-height: 1.12;
    }
    .lt-overlay--vertical .lt-overlay-text {
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.12;
    }
    .lt-overlay-resize-handle {
      position: absolute;
      pointer-events: auto;
      z-index: 3;
      touch-action: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .lt-overlay-resize-handle--top,
    .lt-overlay-resize-handle--bottom {
      left: 6px;
      right: 6px;
      height: 8px;
      cursor: ns-resize;
    }
    .lt-overlay-resize-handle--top { top: -4px; }
    .lt-overlay-resize-handle--bottom { bottom: -4px; }
    .lt-overlay-resize-handle--left,
    .lt-overlay-resize-handle--right {
      top: 6px;
      bottom: 6px;
      width: 8px;
      cursor: ew-resize;
    }
    .lt-overlay-resize-handle--left { left: -4px; }
    .lt-overlay-resize-handle--right { right: -4px; }
    .lt-overlay-resize-handle::after {
      content: "";
      position: absolute;
      background: rgba(26, 115, 232, 0.75);
      border-radius: 2px;
    }
    .lt-overlay-resize-handle--top::after,
    .lt-overlay-resize-handle--bottom::after {
      left: 35%;
      right: 35%;
      height: 2px;
      top: 3px;
    }
    .lt-overlay-resize-handle--left::after,
    .lt-overlay-resize-handle--right::after {
      top: 35%;
      bottom: 35%;
      width: 2px;
      left: 3px;
    }
    .lt-overlay:hover .lt-overlay-resize-handle,
    .lt-overlay-resize-handle:hover,
    .lt-overlay-resize-handle:active {
      opacity: 1;
    }
    .lt-overlay.is-resizing {
      pointer-events: auto;
      user-select: none;
    }
    .lt-image-loading { opacity: 0.92; }
    .lt-image-status {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      border-radius: 4px;
      font: 600 11px/1.2 "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      color: #fff;
      background: rgba(22, 24, 28, 0.78);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
      white-space: nowrap;
      letter-spacing: 0.01em;
    }
    .lt-image-status-spinner {
      width: 10px;
      height: 10px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: lt-spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes lt-spin {
      to { transform: rotate(360deg); }
    }
    .lt-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #323232;
      color: #fff;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 2147483647;
      max-width: 320px;
    }
  `;
  document.documentElement.appendChild(style);
}

export function removeStyles(): void {
  document.getElementById('lt-styles')?.remove();
}

const TOAST_DEBOUNCE_MS = 5000;
const recentToasts = new Map<string, number>();

export function showToast(message: string, isError = false): void {
  const key = `${isError ? 'e' : 'i'}:${message}`;
  const now = Date.now();
  const lastShown = recentToasts.get(key) ?? 0;
  if (now - lastShown < TOAST_DEBOUNCE_MS) return;
  recentToasts.set(key, now);

  const existing = document.querySelector('.lt-toast');
  existing?.remove();
  const toast = document.createElement('div');
  toast.className = 'lt-toast';
  toast.textContent = message;
  if (isError) toast.style.background = '#d93025';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export { SKIP_TAGS, SKIP_ATTRIBUTES };

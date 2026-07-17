import { RTL_LANGUAGES } from '../shared/settings';
import { collectTextNodes, injectStyles } from './dom-utils';
import { disposeOverlayInteractions } from './overlay-renderer';

export function applyTranslations(
  results: Array<{ id: string; original: string; translated: string }>,
  idToNode: Map<string, Text>,
  targetLang: string,
): void {
  injectStyles();

  for (const result of results) {
    const node = idToNode.get(result.id);
    if (!node || !node.parentElement) continue;
    if (node.parentElement.hasAttribute('data-lt-done')) continue;

    const parent = node.parentElement;
    if (!parent.hasAttribute('data-lt-original')) {
      parent.setAttribute('data-lt-original', result.original);
    }
    node.textContent = result.translated;
    parent.setAttribute('data-lt-done', 'true');

    if (RTL_LANGUAGES.has(targetLang)) {
      parent.setAttribute('dir', 'rtl');
    }

    adjustOverflow(parent);
  }
}

function adjustOverflow(el: HTMLElement): void {
  const style = getComputedStyle(el);
  if (style.overflow === 'visible') {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      const scrollW = el.scrollWidth;
      if (scrollW > rect.width * 1.1) {
        const ratio = Math.max(0.85, rect.width / scrollW);
        const currentSize = parseFloat(style.fontSize) || 16;
        el.style.fontSize = `${Math.floor(currentSize * ratio)}px`;
      }
    }
  }
}

export function restorePage(): void {
  document.querySelectorAll('[data-lt-done]').forEach((el) => {
    const original = el.getAttribute('data-lt-original');
    if (original !== null) {
      if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
        el.childNodes[0].textContent = original;
      } else {
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            child.textContent = original;
            break;
          }
        }
      }
    }
    el.removeAttribute('data-lt-done');
    el.removeAttribute('data-lt-original');
    el.removeAttribute('dir');
    if (el instanceof HTMLElement) {
      el.style.fontSize = '';
    }
  });

  disposeOverlayInteractions();
  document.querySelectorAll('.lt-overlay-container').forEach((wrapper) => {
    const img = wrapper.querySelector('img');
    if (img && wrapper.parentElement) {
      wrapper.parentElement.insertBefore(img, wrapper);
      wrapper.remove();
    }
  });

  document.querySelectorAll('.lt-overlay').forEach((el) => el.remove());
  document.querySelectorAll('.lt-image-status').forEach((el) => el.remove());
  document.querySelectorAll('.lt-image-loading').forEach((el) => {
    el.classList.remove('lt-image-loading');
  });
  document.querySelectorAll('[data-lt-processing]').forEach((el) => {
    el.removeAttribute('data-lt-processing');
  });
}

export function buildTextUnits(
  elements: Element[],
): { units: Array<{ id: string; text: string }>; idToNode: Map<string, Text> } {
  const units: Array<{ id: string; text: string }> = [];
  const idToNode = new Map<string, Text>();

  for (const el of elements) {
    const textNodes = collectTextNodes(el);
    for (const node of textNodes) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const id = `text-${units.length}`;
      if (!el.hasAttribute('data-lt-id')) {
        el.setAttribute('data-lt-id', id);
      }
      units.push({ id, text });
      idToNode.set(id, node);
    }
  }

  return { units, idToNode };
}

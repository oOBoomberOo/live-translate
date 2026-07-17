import { ScrollObserver } from './scroll-observer';

export class MutationWatcher {
  private observer: MutationObserver | null = null;
  private scrollObserver: ScrollObserver;

  constructor(scrollObserver: ScrollObserver) {
    this.scrollObserver = scrollObserver;
  }

  start(): void {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => this.scanNode(node));
        }
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent && !parent.hasAttribute('data-lt-done')) {
            this.scrollObserver.observeElement(parent);
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private scanNode(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      this.scrollObserver.observeElement(node as Element);
      (node as Element).querySelectorAll('*').forEach((el) => {
        this.scrollObserver.observeElement(el);
      });
      if ((node as Element).shadowRoot) {
        this.scanNode((node as Element).shadowRoot!);
      }
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      node.childNodes.forEach((child) => this.scanNode(child));
    }
  }
}

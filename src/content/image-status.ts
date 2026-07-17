import { injectStyles } from './dom-utils';

type StatusHandle = {
  badge: HTMLElement;
  cleanup: () => void;
};

/** Strong refs only while processing; cleared in hide*. */
const active = new Map<HTMLImageElement, StatusHandle>();

/** Fixed-position badge so we never wrap/reparent the image (Twitter-safe). */
export function showImageProcessingStatus(img: HTMLImageElement): void {
  injectStyles();
  hideImageProcessingStatus(img);

  const badge = document.createElement('div');
  badge.className = 'lt-image-status';
  badge.setAttribute('data-lt-skip', 'true');
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'lt-image-status-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'lt-image-status-label';
  label.textContent = 'Translating image…';

  badge.append(spinner, label);
  document.documentElement.appendChild(badge);

  const sync = () => {
    if (!img.isConnected) {
      hideImageProcessingStatus(img);
      return;
    }
    const r = img.getBoundingClientRect();
    if (r.width < 48 || r.height < 48) {
      badge.style.visibility = 'hidden';
      return;
    }
    badge.style.visibility = 'visible';
    badge.style.top = `${Math.max(4, r.top + 8)}px`;
    badge.style.left = `${Math.max(4, r.left + 8)}px`;
  };

  sync();
  window.addEventListener('scroll', sync, true);
  window.addEventListener('resize', sync);

  let raf = 0;
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(sync);
        })
      : null;
  ro?.observe(img);

  active.set(img, {
    badge,
    cleanup: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      ro?.disconnect();
      badge.remove();
    },
  });
}

export function hideImageProcessingStatus(img: HTMLImageElement): void {
  const handle = active.get(img);
  if (!handle) return;
  handle.cleanup();
  active.delete(img);
}

export function hideAllImageProcessingStatuses(): void {
  for (const img of [...active.keys()]) {
    hideImageProcessingStatus(img);
  }
  document.querySelectorAll('.lt-image-status').forEach((el) => el.remove());
}

import type { Settings } from './messages';

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  sourceLang: 'auto',
  targetLang: 'en',
  provider: 'google',
  apiKeys: {
    google: '',
  },
  ocrMode: 'cloud',
  translateImages: true,
  siteBlocklist: [],
};

export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
];

export const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export const PROVIDERS = [
  { id: 'google', name: 'Google Cloud Translation', requiresKey: true },
] as const;

export const OCR_MODES = [
  { id: 'cloud', name: 'Google Cloud Vision' },
] as const;

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 500;
export const BATCH_DEBOUNCE_MS = 150;
export const MAX_BATCH_SIZE = 50;
export const MAX_REQUESTS_PER_SEC = 10;
export const INTERSECTION_ROOT_MARGIN = '200px';

/**
 * Images whose *larger* displayed edge is below this (CSS px) are treated as
 * thumbnails and deferred until enlarged.
 */
export const MIN_OCR_DISPLAY_EDGE_PX = 300;

/** Minimum on-screen area (px²) — defers very thin strips even if one edge is long. */
export const MIN_OCR_DISPLAY_AREA_PX = 70_000;

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get('settings');
  const raw = (result.settings ?? {}) as Partial<Settings> & {
    apiKeys?: Partial<Settings['apiKeys']> & {
      googleVision?: string;
      deepl?: string;
      libretranslate?: string;
    };
  };

  // Migrate older multi-key / multi-provider settings.
  const legacyGoogle =
    raw.apiKeys?.google ||
    (raw.apiKeys as { googleVision?: string } | undefined)?.googleVision ||
    '';

  const provider =
    raw.provider === 'mock' || raw.provider === 'google' ? raw.provider : 'google';
  const ocrMode = raw.ocrMode === 'mock' || raw.ocrMode === 'cloud' ? raw.ocrMode : 'cloud';

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    provider,
    ocrMode,
    apiKeys: {
      google: legacyGoogle,
    },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export async function getTabState(tabId: number): Promise<boolean> {
  const key = `tab_${tabId}`;
  const result = await chrome.storage.session.get(key);
  const state = result[key] as { enabled?: boolean } | undefined;
  if (state?.enabled !== undefined) return state.enabled;
  const settings = await getSettings();
  return settings.enabled;
}

export async function setTabState(tabId: number, enabled: boolean): Promise<void> {
  const key = `tab_${tabId}`;
  await chrome.storage.session.set({ [key]: { enabled } });
}

export function isSiteBlocked(hostname: string, blocklist: string[]): boolean {
  return blocklist.some(
    (site) => hostname === site || hostname.endsWith(`.${site}`),
  );
}

export async function hashString(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

import type { ExtensionMessage, Settings } from '../shared/messages';
import { getSettings, isSiteBlocked } from '../shared/settings';
import { restorePage } from './text-replacer';
import { ScrollObserver } from './scroll-observer';
import { MutationWatcher } from './mutation-observer';

let scrollObserver: ScrollObserver | null = null;
let mutationWatcher: MutationWatcher | null = null;
let currentSettings: Settings | null = null;
let enabled = false;

async function init(): Promise<void> {
  currentSettings = await getSettings();
  const hostname = window.location.hostname;
  if (isSiteBlocked(hostname, currentSettings.siteBlocklist)) return;

  const tabState = (await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' })) as {
    enabled?: boolean;
  };
  enabled = tabState.enabled ?? currentSettings.enabled;
  if (!enabled) return;

  startTranslating(currentSettings);
}

function startTranslating(settings: Settings): void {
  scrollObserver = new ScrollObserver(settings);
  mutationWatcher = new MutationWatcher(scrollObserver);
  scrollObserver.start();
  mutationWatcher.start();
}

function stopTranslating(): void {
  scrollObserver?.stop();
  mutationWatcher?.stop();
  scrollObserver = null;
  mutationWatcher = null;
  restorePage();
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'TOGGLE_TAB') {
    enabled = message.enabled;
    if (enabled) {
      void (async () => {
        currentSettings = currentSettings ?? (await getSettings());
        if (isSiteBlocked(window.location.hostname, currentSettings.siteBlocklist)) {
          return;
        }
        // Restart cleanly if already running (e.g. re-toggle).
        stopTranslating();
        startTranslating(currentSettings);
      })();
    } else {
      stopTranslating();
    }
  }

  if (message.type === 'RESTORE_PAGE') {
    stopTranslating();
  }

  if (message.type === 'SETTINGS_UPDATED') {
    void getSettings().then((settings) => {
      currentSettings = settings;
      if (enabled) {
        stopTranslating();
        if (!isSiteBlocked(window.location.hostname, settings.siteBlocklist)) {
          startTranslating(settings);
        }
      }
    });
  }
});

void init();

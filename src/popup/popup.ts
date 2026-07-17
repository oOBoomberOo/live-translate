import { LANGUAGES, getSettings, saveSettings, getTabState, setTabState } from '../shared/settings';
import type { Settings } from '../shared/messages';

const enabledEl = document.getElementById('enabled') as HTMLInputElement;
const sourceLangEl = document.getElementById('sourceLang') as HTMLSelectElement;
const targetLangEl = document.getElementById('targetLang') as HTMLSelectElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const optionsLink = document.getElementById('optionsLink') as HTMLAnchorElement;

function populateLanguages(): void {
  for (const lang of LANGUAGES) {
    const optFrom = document.createElement('option');
    optFrom.value = lang.code;
    optFrom.textContent = lang.name;
    sourceLangEl.appendChild(optFrom);

    if (lang.code !== 'auto') {
      const optTo = document.createElement('option');
      optTo.value = lang.code;
      optTo.textContent = lang.name;
      targetLangEl.appendChild(optTo);
    }
  }
}

async function loadState(): Promise<void> {
  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabEnabled = tab?.id ? await getTabState(tab.id) : settings.enabled;

  enabledEl.checked = tabEnabled;
  sourceLangEl.value = settings.sourceLang;
  targetLangEl.value = settings.targetLang;
  statusEl.textContent = tabEnabled ? 'Translating this page' : 'Disabled';
}

async function saveLanguageSettings(): Promise<void> {
  const settings = await getSettings();
  settings.sourceLang = sourceLangEl.value;
  settings.targetLang = targetLangEl.value;
  await saveSettings(settings);
}

enabledEl.addEventListener('change', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await setTabState(tab.id, enabledEl.checked);
  await chrome.runtime.sendMessage({
    type: 'TOGGLE_TAB',
    enabled: enabledEl.checked,
  });

  statusEl.textContent = enabledEl.checked ? 'Translating this page' : 'Disabled';

  if (tab.id && enabledEl.checked) {
    await chrome.tabs.reload(tab.id);
  }
});

sourceLangEl.addEventListener('change', () => void saveLanguageSettings());
targetLangEl.addEventListener('change', () => void saveLanguageSettings());

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

populateLanguages();
void loadState();

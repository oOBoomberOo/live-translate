import { getSettings, saveSettings } from '../shared/settings';
import type { Settings } from '../shared/messages';

const googleKeyEl = document.getElementById('googleKey') as HTMLInputElement;
const translateImagesEl = document.getElementById('translateImages') as HTMLInputElement;
const blocklistEl = document.getElementById('blocklist') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  googleKeyEl.value = settings.apiKeys.google;
  translateImagesEl.checked = settings.translateImages;
  blocklistEl.value = settings.siteBlocklist.join('\n');
}

function collectSettings(base: Settings): Settings {
  return {
    ...base,
    provider: 'google',
    ocrMode: 'cloud',
    apiKeys: {
      google: googleKeyEl.value.trim(),
    },
    translateImages: translateImagesEl.checked,
    siteBlocklist: blocklistEl.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

saveBtn.addEventListener('click', async () => {
  try {
    const current = await getSettings();
    await saveSettings(collectSettings(current));
    statusEl.textContent = 'Settings saved.';
    statusEl.classList.remove('error');
  } catch (err) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : 'Save failed'}`;
    statusEl.classList.add('error');
  }
});

void loadSettings();

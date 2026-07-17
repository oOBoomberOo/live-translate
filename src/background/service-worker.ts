import type {
  ExtensionMessage,
  FetchImageMessage,
  OcrImageMessage,
  TranslateTextMessage,
} from '../shared/messages';
import { isExtensionMessage } from '../shared/messages';
import { getSettings, getTabState, setTabState } from '../shared/settings';
import { translationManager } from './translation/manager';
import { ocrManager } from './ocr/manager';
import { fetchImageBytes } from './fetch-image';

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!isExtensionMessage(message)) return;

    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ error: err.message }));

    return true;
  },
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'PING':
      return { ok: true };

    case 'GET_SETTINGS':
      return getSettings();

    case 'GET_TAB_STATE': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return { enabled: false };
      return { enabled: await getTabState(tabId) };
    }

    case 'TRANSLATE_TEXT': {
      const msg = message as TranslateTextMessage;
      const settings = await getSettings();
      const results = await translationManager.translate(
        msg.units,
        msg.from,
        msg.to,
        settings,
      );
      return { type: 'TRANSLATE_TEXT_RESULT', results };
    }

    case 'OCR_IMAGE': {
      const msg = message as OcrImageMessage;
      const settings = await getSettings();
      const result = await ocrManager.processImage(
        {
          url: msg.url,
          referer: msg.referer,
          imageBase64: msg.imageBase64,
          width: msg.width,
          height: msg.height,
          from: msg.from,
          to: msg.to,
        },
        settings,
      );
      result.id = msg.id;
      return { type: 'OCR_IMAGE_RESULT', result };
    }

    case 'FETCH_IMAGE': {
      const msg = message as FetchImageMessage;
      return fetchImageBytes(msg.url, msg.referer);
    }

    case 'TOGGLE_TAB': {
      let tabId = sender.tab?.id;
      if (tabId === undefined) {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = active?.id;
      }
      if (tabId !== undefined) {
        await setTabState(tabId, message.enabled);
        await updateBadge(tabId, message.enabled);
        await chrome.tabs.sendMessage(tabId, message).catch(() => {});
      }
      return { ok: true };
    }

    default:
      return { ok: true };
  }
}

async function updateBadge(tabId: number, enabled: boolean): Promise<void> {
  await chrome.action.setBadgeText({
    tabId,
    text: enabled ? 'ON' : '',
  });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: '#1a73e8',
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
        }
      }
    });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    const settings = await getSettings();
    await updateBadge(tabId, settings.enabled);
  }
});

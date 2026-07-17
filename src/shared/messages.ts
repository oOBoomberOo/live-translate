import type { OcrMode, TranslationProviderId } from './types';

export type MessageType =
  | 'TRANSLATE_TEXT'
  | 'TRANSLATE_TEXT_RESULT'
  | 'OCR_IMAGE'
  | 'OCR_IMAGE_RESULT'
  | 'FETCH_IMAGE'
  | 'GET_SETTINGS'
  | 'GET_TAB_STATE'
  | 'SETTINGS_UPDATED'
  | 'TOGGLE_TAB'
  | 'RESTORE_PAGE'
  | 'PING';

export interface BaseMessage {
  type: MessageType;
}

export interface TranslateTextMessage extends BaseMessage {
  type: 'TRANSLATE_TEXT';
  tabId?: number;
  units: Array<{ id: string; text: string }>;
  from: string;
  to: string;
}

export interface TranslateTextResultMessage extends BaseMessage {
  type: 'TRANSLATE_TEXT_RESULT';
  results: import('./types').TranslatedTextUnit[];
  error?: string;
}

export interface OcrImageMessage extends BaseMessage {
  type: 'OCR_IMAGE';
  id: string;
  url: string;
  referer?: string;
  imageBase64?: string;
  width?: number;
  height?: number;
  from: string;
  to: string;
}

export interface OcrImageResultMessage extends BaseMessage {
  type: 'OCR_IMAGE_RESULT';
  result?: import('./types').TranslatedImageUnit;
  error?: string;
}

export interface FetchImageMessage extends BaseMessage {
  type: 'FETCH_IMAGE';
  url: string;
  referer?: string;
}

export interface FetchImageResultMessage {
  type: 'FETCH_IMAGE_RESULT';
  buffer?: ArrayBuffer;
  width?: number;
  height?: number;
  error?: string;
}

export interface GetSettingsMessage extends BaseMessage {
  type: 'GET_SETTINGS';
}

export interface GetTabStateMessage extends BaseMessage {
  type: 'GET_TAB_STATE';
}

export interface SettingsUpdatedMessage extends BaseMessage {
  type: 'SETTINGS_UPDATED';
}

export interface ToggleTabMessage extends BaseMessage {
  type: 'TOGGLE_TAB';
  enabled: boolean;
}

export interface RestorePageMessage extends BaseMessage {
  type: 'RESTORE_PAGE';
}

export interface PingMessage extends BaseMessage {
  type: 'PING';
}

export type ExtensionMessage =
  | TranslateTextMessage
  | TranslateTextResultMessage
  | OcrImageMessage
  | OcrImageResultMessage
  | FetchImageMessage
  | GetSettingsMessage
  | GetTabStateMessage
  | SettingsUpdatedMessage
  | ToggleTabMessage
  | RestorePageMessage
  | PingMessage;

export interface Settings {
  enabled: boolean;
  sourceLang: string;
  targetLang: string;
  provider: TranslationProviderId;
  /** Single Google Cloud API key used for Translation + Vision. */
  apiKeys: {
    google: string;
  };
  ocrMode: OcrMode;
  translateImages: boolean;
  siteBlocklist: string[];
}

export interface TabState {
  enabled: boolean;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function isExtensionMessage(msg: unknown): msg is ExtensionMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as BaseMessage).type === 'string'
  );
}

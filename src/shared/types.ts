export type TranslationProviderId = 'google' | 'mock';

export type OcrMode = 'cloud' | 'mock';

export interface OcrBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OcrResult {
  boxes: OcrBox[];
  imageWidth: number;
  imageHeight: number;
  source: 'google-vision' | 'mock';
}

export interface TranslationRequest {
  texts: string[];
  from: string;
  to: string;
}

export interface TranslationResponse {
  translations: string[];
  from: string;
}

export interface TextUnit {
  id: string;
  text: string;
  type: 'text-node' | 'attribute';
  attributeName?: string;
}

export interface ImageUnit {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface TranslatedTextUnit {
  id: string;
  original: string;
  translated: string;
}

export interface TranslatedImageUnit {
  id: string;
  ocr: OcrResult;
  translations: string[];
}

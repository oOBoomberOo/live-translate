import type { Settings } from '../../shared/messages';
import type { OcrResult, TranslatedImageUnit } from '../../shared/types';
import { runGoogleVisionOcr } from './google-vision';
import { runMockOcr } from './mock';
import { translationManager } from '../translation/manager';
import { LruCache } from '../cache';
import { hashString } from '../../shared/settings';
import { decodeBase64ToPng, downloadAndDecode } from '../fetch-image';
import { isLikelyTargetLanguage } from '../translation/language-match';

export class OcrManager {
  private cache = new LruCache<OcrResult>('ocr');

  async processImage(
    options: {
      url: string;
      referer?: string;
      imageBase64?: string;
      width?: number;
      height?: number;
      from: string;
      to: string;
    },
    settings: Settings,
  ): Promise<TranslatedImageUnit> {
    const { buffer, width, height } = await this.resolvePixels(options);
    if (buffer.byteLength < 32) {
      throw new Error('Resolved image buffer is empty');
    }

    const cacheKey = await hashString(
      `${options.url}:${width}x${height}:${settings.ocrMode}:${settings.sourceLang || options.from}:v8`,
    );
    let ocrResult = await this.cache.get(cacheKey);

    if (!ocrResult) {
      ocrResult = await this.runOcr(buffer, width, height, options.url, settings);
      await this.cache.set(cacheKey, ocrResult);
    }

    const texts = ocrResult.boxes.map((b) => b.text).filter(Boolean);
    if (texts.length === 0) {
      return { id: '', ocr: ocrResult, translations: [] };
    }

    const units = texts.map((text, i) => ({ id: String(i), text }));
    const translated = await translationManager.translate(
      units,
      options.from,
      options.to,
      settings,
    );

    return {
      id: '',
      ocr: ocrResult,
      translations: translated.map((t) =>
        isLikelyTargetLanguage(t.original, options.to) ? '' : t.translated,
      ),
    };
  }

  private async resolvePixels(options: {
    url: string;
    referer?: string;
    imageBase64?: string;
  }): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
    if (options.imageBase64) {
      return decodeBase64ToPng(options.imageBase64);
    }
    if (/^https?:\/\//i.test(options.url)) {
      return downloadAndDecode(options.url, options.referer);
    }
    throw new Error('No usable image source (need https URL or imageBase64)');
  }

  private async runOcr(
    imageData: ArrayBuffer,
    width: number,
    height: number,
    url: string,
    settings: Settings,
  ): Promise<OcrResult> {
    if (settings.ocrMode === 'mock') {
      return runMockOcr(url, width, height);
    }
    return runGoogleVisionOcr(imageData, settings);
  }
}

export const ocrManager = new OcrManager();

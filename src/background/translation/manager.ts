import type { Settings } from '../../shared/messages';
import type { TranslationProvider } from './providers/base';
import { GoogleProvider } from './providers/google';
import { MockProvider } from './providers/mock';
import { LruCache, RateLimiter } from '../cache';
import { hashString, MAX_BATCH_SIZE, MAX_REQUESTS_PER_SEC } from '../../shared/settings';
import { isLikelyTargetLanguage } from './language-match';

const providers: TranslationProvider[] = [new GoogleProvider(), new MockProvider()];

export class TranslationManager {
  private cache = new LruCache<string>('translation');
  private rateLimiter = new RateLimiter(MAX_REQUESTS_PER_SEC);

  private getProvider(id: string): TranslationProvider {
    const provider = providers.find((p) => p.id === id);
    if (!provider) throw new Error(`Unknown translation provider: ${id}`);
    return provider;
  }

  async translate(
    units: Array<{ id: string; text: string }>,
    from: string,
    to: string,
    settings: Settings,
  ): Promise<Array<{ id: string; original: string; translated: string }>> {
    const sameConfiguredLanguage =
      from !== 'auto' && from.toLowerCase().split('-')[0] === to.toLowerCase().split('-')[0];

    const skippedTexts = new Set(
      units
        .map((unit) => unit.text)
        .filter((text) => sameConfiguredLanguage || isLikelyTargetLanguage(text, to)),
    );
    const translatableUnits = units.filter((unit) => !skippedTexts.has(unit.text));

    if (translatableUnits.length === 0) {
      return units.map((unit) => ({
        id: unit.id,
        original: unit.text,
        translated: unit.text,
      }));
    }

    if (!this.rateLimiter.canProceed()) {
      throw new Error('Rate limit exceeded. Please slow down.');
    }

    const provider = this.getProvider(settings.provider);
    const uniqueTexts = [...new Set(translatableUnits.map((u) => u.text))];
    const translationMap = new Map<string, string>();

    const uncached: string[] = [];
    for (const text of uniqueTexts) {
      const cacheKey = await hashString(`${from}:${to}:${text}`);
      const cached = await this.cache.get(cacheKey);
      if (cached !== undefined) {
        translationMap.set(text, cached);
      } else {
        uncached.push(text);
      }
    }

    for (let i = 0; i < uncached.length; i += MAX_BATCH_SIZE) {
      const batch = uncached.slice(i, i + MAX_BATCH_SIZE);
      try {
        const translated = await provider.translate(batch, from, to, settings);
        for (let j = 0; j < batch.length; j++) {
          translationMap.set(batch[j], translated[j]);
          const cacheKey = await hashString(`${from}:${to}:${batch[j]}`);
          await this.cache.set(cacheKey, translated[j]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b429\b|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) {
          throw new Error(`Translation rate limited: ${msg}`);
        }
        throw err;
      }
    }

    return units.map((u) => ({
      id: u.id,
      original: u.text,
      translated: skippedTexts.has(u.text) ? u.text : (translationMap.get(u.text) ?? u.text),
    }));
  }
}

export const translationManager = new TranslationManager();

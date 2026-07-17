import { BaseProvider } from './base';
import type { Settings } from '../../../shared/messages';

export class GoogleProvider extends BaseProvider {
  id = 'google';
  name = 'Google Cloud Translation';
  requiresApiKey = true;

  async translate(
    texts: string[],
    from: string,
    to: string,
    settings: Settings,
  ): Promise<string[]> {
    const key = settings.apiKeys.google;
    if (!key) throw new Error('Google Cloud Translation API key not configured');

    const source = from === 'auto' ? undefined : from;
    const results: string[] = [];

    for (let i = 0; i < texts.length; i += 128) {
      const batch = texts.slice(i, i + 128);
      const params = new URLSearchParams({ key, target: to, format: 'text' });
      if (source) params.set('source', source);

      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?${params}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: batch }),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Google Translate error: ${response.status} ${err}`);
      }

      const data = (await response.json()) as {
        data: { translations: Array<{ translatedText: string }> };
      };
      results.push(...data.data.translations.map((t) => t.translatedText));
    }

    return results;
  }
}

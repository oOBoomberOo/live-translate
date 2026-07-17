import type { Settings } from '../../../shared/messages';

export interface TranslationProvider {
  id: string;
  name: string;
  requiresApiKey: boolean;
  translate(texts: string[], from: string, to: string, settings: Settings): Promise<string[]>;
  detectLanguage?(text: string, settings: Settings): Promise<string>;
}

export abstract class BaseProvider implements TranslationProvider {
  abstract id: string;
  abstract name: string;
  abstract requiresApiKey: boolean;

  abstract translate(
    texts: string[],
    from: string,
    to: string,
    settings: Settings,
  ): Promise<string[]>;
}

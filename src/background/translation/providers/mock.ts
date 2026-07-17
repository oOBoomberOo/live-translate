/**
 * Deterministic translations for automated e2e (no network).
 */
import { BaseProvider } from './base';
import type { Settings } from '../../../shared/messages';

const DICT: Record<string, string> = {
  'Bonjour le monde': '[EN] Hello world',
  'Ceci est une page de test pour la traduction en direct pendant le défilement.':
    '[EN] This is a test page for live translation while scrolling.',
  'Le renard brun rapide saute par-dessus le chien paresseux.':
    '[EN] The quick brown fox jumps over the lazy dog.',
  'Faites défiler vers le bas': '[EN] Scroll down',
  'Contenu hors écran': '[EN] Below-the-fold content',
  "Ce paragraphe n'est visible qu'après le défilement et doit être traduit à la demande.":
    '[EN] This paragraph is only visible after scrolling and should be translated on demand.',
  Bonjour: '[EN] Hello',
  Renard: '[EN] Fox',
  'Texte dans une image': '[EN] Text in an image',
  'Image cross-origin': '[EN] Cross-origin image',
  'Image hors écran': '[EN] Below-the-fold image',
  Images: '[EN] Images',
  '(same-origin)': '[EN] (same-origin)',
  '(cross-origin CDN)': '[EN] (cross-origin CDN)',
  Hello: '[EN] Hello',
  'vertical line one': '[EN] vertical line one',
  'vertical line two': '[EN] vertical line two',
  'vertical line three': '[EN] vertical line three',
};

export class MockProvider extends BaseProvider {
  id = 'mock';
  name = 'Mock (e2e)';
  requiresApiKey = false;

  async translate(
    texts: string[],
    _from: string,
    to: string,
    _settings: Settings,
  ): Promise<string[]> {
    const tag = `[${String(to).toUpperCase()}]`;
    return texts.map((q) => DICT[q] ?? `${tag} ${q}`);
  }
}

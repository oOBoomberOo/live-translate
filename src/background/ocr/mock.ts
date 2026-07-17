import type { OcrResult } from '../../shared/types';

/**
 * Deterministic OCR for e2e tests.
 * Maps known fixture image URL paths → text boxes for e2e tests.
 */
const FIXTURE_TEXT: Record<string, string> = {
  'bonjour.png': 'Bonjour',
  'cors-bonjour.png': 'Bonjour',
  'fox.png': 'Renard',
  'hello.png': 'Hello world',
  'vertical.png': 'こんにちは',
};

export function runMockOcr(
  url: string,
  width: number,
  height: number,
): OcrResult {
  const path = url.split('?')[0].split('/').pop() ?? '';
  const text = FIXTURE_TEXT[path] ?? 'Bonjour';

  if (path === 'vertical.png') {
    // Tall narrow speech-bubble column (manga vertical text).
    const boxWidth = Math.max(40, Math.floor(width * 0.2));
    const boxHeight = Math.max(140, Math.floor(height * 0.65));
    return {
      boxes: [
        {
          text,
          x: Math.floor((width - boxWidth) / 2),
          y: Math.floor((height - boxHeight) / 2),
          width: boxWidth,
          height: boxHeight,
          confidence: 99,
        },
      ],
      imageWidth: width,
      imageHeight: height,
      source: 'mock',
    };
  }

  const boxWidth = Math.max(80, Math.floor(width * 0.5));
  const boxHeight = Math.max(28, Math.floor(height * 0.25));
  const x = Math.floor((width - boxWidth) / 2);
  const y = Math.floor((height - boxHeight) / 2);

  return {
    boxes: [
      {
        text,
        x,
        y,
        width: boxWidth,
        height: boxHeight,
        confidence: 99,
      },
    ],
    imageWidth: width,
    imageHeight: height,
    source: 'mock',
  };
}

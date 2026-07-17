import type { OcrBox } from '../shared/types';

/**
 * Merge word-level OCR boxes into line/block regions.
 * Keep merges tight so overlays stay close to original bubble size.
 */
export function groupOcrBoxes(boxes: OcrBox[]): OcrBox[] {
  if (boxes.length === 0) return [];
  if (boxes.length === 1) return [normalizeBox(boxes[0])];

  const cleaned = boxes
    .map(normalizeBox)
    .filter((b) => b.text.trim().length > 0 && b.width > 0 && b.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  if (cleaned.length === 0) return [];

  const lines = mergeIntoLines(cleaned);
  const blocks = mergeLinesIntoBlocks(lines);
  return blocks.map((b) => normalizeBox(b));
}

function normalizeBox(box: OcrBox): OcrBox {
  return {
    text: box.text.replace(/\s+/g, ' ').trim(),
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height)),
    confidence: box.confidence,
  };
}

function mergeIntoLines(boxes: OcrBox[]): OcrBox[] {
  const lines: OcrBox[] = [];
  let current: OcrBox | null = null;

  for (const box of boxes) {
    if (!current) {
      current = { ...box };
      continue;
    }

    const avgH = (current.height + box.height) / 2;
    const sameLine =
      Math.abs(box.y + box.height / 2 - (current.y + current.height / 2)) < avgH * 0.5 &&
      box.x <= current.x + current.width + avgH * 1.0;

    if (sameLine) {
      current = unionBoxes(current, box, ' ');
    } else {
      lines.push(current);
      current = { ...box };
    }
  }
  if (current) lines.push(current);
  return lines;
}

function mergeLinesIntoBlocks(lines: OcrBox[]): OcrBox[] {
  if (lines.length === 0) return [];

  const blocks: OcrBox[] = [];
  let current: OcrBox | null = null;

  for (const line of lines) {
    if (!current) {
      current = { ...line };
      continue;
    }

    const gap = line.y - (current.y + current.height);
    const avgH = (current.height + line.height) / 2;
    const overlap = horizontalOverlapRatio(current, line);
    const similarWidth =
      Math.min(current.width, line.width) / Math.max(current.width, line.width) > 0.5;

    if (gap >= 0 && gap < avgH * 0.45 && overlap > 0.4 && similarWidth) {
      current = unionBoxes(current, line, '\n');
    } else {
      blocks.push(current);
      current = { ...line };
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function unionBoxes(a: OcrBox, b: OcrBox, joiner: string): OcrBox {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return {
    text: `${a.text}${joiner}${b.text}`.replace(/\s+\n/g, '\n').trim(),
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    confidence: Math.min(a.confidence, b.confidence),
  };
}

function horizontalOverlapRatio(a: OcrBox, b: OcrBox): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = Math.max(0, right - left);
  const smaller = Math.min(a.width, b.width) || 1;
  return overlap / smaller;
}

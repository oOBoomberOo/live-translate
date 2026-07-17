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

/**
 * Manga speech bubbles often arrive from Vision as several tall, narrow
 * vertical columns. Merge neighboring columns that clearly belong to the same
 * bubble so translation/overlays are one unit instead of letter-thin strips.
 *
 * Pairwise clustering on original columns (not union boxes) avoids rejecting
 * neighbors after the first merge widens the group.
 */
export function mergeVerticalBubbleColumns(boxes: OcrBox[]): OcrBox[] {
  if (boxes.length <= 1) return boxes.map(normalizeBox);

  const normalized = boxes.map(normalizeBox);
  const verticalIdx: number[] = [];
  const other: OcrBox[] = [];

  normalized.forEach((box, i) => {
    if (isVerticalColumn(box)) verticalIdx.push(i);
    else other.push(box);
  });

  if (verticalIdx.length <= 1) {
    return [...other, ...verticalIdx.map((i) => normalized[i])].sort(
      (a, b) => a.y - b.y || a.x - b.x,
    );
  }

  const parent = verticalIdx.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const unite = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  for (let i = 0; i < verticalIdx.length; i++) {
    for (let j = i + 1; j < verticalIdx.length; j++) {
      if (
        shouldMergeVerticalColumns(
          normalized[verticalIdx[i]],
          normalized[verticalIdx[j]],
        )
      ) {
        unite(i, j);
      }
    }
  }

  const groups = new Map<number, OcrBox[]>();
  for (let i = 0; i < verticalIdx.length; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(normalized[verticalIdx[i]]);
    groups.set(root, list);
  }

  const merged: OcrBox[] = [];
  for (const cols of groups.values()) {
    // Japanese: right column first, then leftward.
    cols.sort((a, b) => b.x + b.width / 2 - (a.x + a.width / 2) || a.y - b.y);
    let group = { ...cols[0] };
    for (let i = 1; i < cols.length; i++) {
      group = unionVerticalColumns(group, cols[i]);
    }
    merged.push(normalizeBox(group));
  }

  return [...other, ...merged].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function isVerticalColumn(box: OcrBox): boolean {
  return box.height / Math.max(1, box.width) > 1.4;
}

function shouldMergeVerticalColumns(a: OcrBox, b: OcrBox): boolean {
  const avgW = (a.width + b.width) / 2;
  const gap = horizontalGap(a, b);
  const vOverlap = verticalOverlapRatio(a, b);
  const widthRatio = Math.min(a.width, b.width) / Math.max(a.width, b.width);
  const heightRatio =
    Math.min(a.height, b.height) / Math.max(a.height, b.height);

  // Same bubble: columns sit close, share vertical span, similar stroke width.
  // Reject distant / barely-overlapping columns from different bubbles.
  return (
    gap <= avgW * 2.2 &&
    vOverlap > 0.4 &&
    widthRatio > 0.4 &&
    heightRatio > 0.45
  );
}

function unionVerticalColumns(a: OcrBox, b: OcrBox): OcrBox {
  const right = a.x + a.width / 2 >= b.x + b.width / 2 ? a : b;
  const left = right === a ? b : a;
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(
    `${right.text}${left.text}`,
  );
  return unionBoxes(right, left, cjk ? '' : ' ');
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
      Math.abs(box.y + box.height / 2 - (current.y + current.height / 2)) <
        avgH * 0.5 && box.x <= current.x + current.width + avgH * 1.0;

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
      Math.min(current.width, line.width) / Math.max(current.width, line.width) >
      0.5;

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

function verticalOverlapRatio(a: OcrBox, b: OcrBox): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, bottom - top);
  const smaller = Math.min(a.height, b.height) || 1;
  return overlap / smaller;
}

function horizontalGap(a: OcrBox, b: OcrBox): number {
  if (a.x + a.width < b.x) return b.x - (a.x + a.width);
  if (b.x + b.width < a.x) return a.x - (b.x + b.width);
  return 0;
}

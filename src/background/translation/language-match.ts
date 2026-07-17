/**
 * Conservative local language matching used to avoid needless API calls.
 * It intentionally returns false when uncertain so non-target text still
 * reaches the configured translation provider.
 */
export function isLikelyTargetLanguage(text: string, target: string): boolean {
  const normalizedTarget = target.toLowerCase().split('-')[0];
  const sample = text.trim();
  if (!sample) return true;

  switch (normalizedTarget) {
    case 'zh':
      return countMatches(sample, /[\u3400-\u9fff]/g) >= 2;
    case 'ja':
      return countMatches(sample, /[\u3040-\u30ff]/g) >= 1;
    case 'ko':
      return countMatches(sample, /[\uac00-\ud7af]/g) >= 1;
    case 'ar':
      return countMatches(sample, /[\u0600-\u06ff]/g) >= 2;
    case 'ru':
      return countMatches(sample, /[\u0400-\u04ff]/g) >= 2;
    case 'th':
      return countMatches(sample, /[\u0e00-\u0e7f]/g) >= 2;
    case 'hi':
      return countMatches(sample, /[\u0900-\u097f]/g) >= 2;
    case 'en':
      return isLikelyEnglish(sample);
    default:
      return false;
  }
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function isLikelyEnglish(text: string): boolean {
  // Presence of another distinctive script means it is not English.
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(text)) {
    return false;
  }

  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  if (words.length === 0) return false;

  const common = new Set([
    'a', 'about', 'all', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'been',
    'but', 'by', 'can', 'come', 'could', 'do', 'does', 'for', 'from', 'get',
    'go', 'good', 'had', 'has', 'have', 'he', 'hello', 'her', 'here', 'him',
    'his', 'how', 'i', 'if', 'in', 'is', 'it', 'just', 'know', 'like', 'me',
    'more', 'my', 'no', 'not', 'now', 'of', 'oh', 'on', 'one', 'or', 'our',
    'out', 'please', 'she', 'so', 'some', 'that', 'the', 'their', 'them',
    'there', 'they', 'this', 'to', 'up', 'us', 'want', 'was', 'we', 'well',
    'were', 'what', 'when', 'where', 'who', 'why', 'will', 'with', 'would',
    'yes', 'you', 'your',
  ]);
  const commonCount = words.filter((word) => common.has(word)).length;

  // Require real evidence for short OCR fragments to avoid misclassifying
  // other Latin-script languages as English.
  if (words.length <= 2) {
    return commonCount >= 1;
  }
  return commonCount / words.length >= 0.2;
}

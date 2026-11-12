// PDFの文字から、DOI とタイトルの候補を取り出す（画面に依存しない純粋な関数）

import { normalizeCjk, compactForMatch } from '../utils/japanese.js';

// 参考文献欄の見出し（これより後ろの DOI は、引用している別の論文の DOI なので使わない）
const REFERENCES_HEADING = /(参考文献|引用文献|文\s*献|References|REFERENCES|Bibliography|Literature Cited)\s*[\r\n]/;

/** DOI をそろえる（URL の形・「doi:」を取り除き、末尾の句読点やかっこを除く） */
export function normalizeDoi(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;:)\]}>」』】〕）。、]+$/u, '');
}

/** DOI として正しい形か（10. で始まり、/ のあとに文字がある） */
export function isValidDoi(doi) {
  return /^10\.\d{4,9}\/\S+$/.test(doi);
}

/**
 * 文字列から DOI の候補を、出てきた順に取り出す（重複は除く。大文字・小文字は区別しない）。
 * 参考文献欄の見出しが見つかれば、それより前だけを探す。
 * @param {string} text PDF の1〜2ページ目の文字
 * @returns {string[]}
 */
export function extractDoiCandidates(text) {
  const normalized = normalizeCjk(text);
  const headingMatch = normalized.match(REFERENCES_HEADING);
  const searchArea = headingMatch ? normalized.slice(0, headingMatch.index) : normalized;

  const found = [];
  const seen = new Set();
  for (const match of searchArea.matchAll(/10\.\d{4,9}\/[^\s"'<>]+/g)) {
    const doi = normalizeDoi(match[0]);
    const key = doi.toLowerCase();
    if (isValidDoi(doi) && !seen.has(key)) {
      seen.add(key);
      found.push(doi);
    }
  }
  return found;
}

/**
 * 1ページ目の「いちばん大きな文字」をつなげて、タイトルの候補にする。
 * 論文のタイトルは、ふつう1ページ目で最も大きな文字で書かれているため。
 * @param {Array<{str: string, height: number}>} items PDF.js の getTextContent().items（1ページ目）
 * @returns {string|null}
 */
export function extractTitleCandidate(items) {
  const textItems = items.filter((item) => item.str && item.str.trim() && item.height > 0);
  if (textItems.length === 0) return null;

  const maxHeight = Math.max(...textItems.map((item) => item.height));
  // いちばん大きな文字と、ほぼ同じ大きさ（9割以上）の文字を、出てきた順につなげる
  const titleParts = textItems.filter((item) => item.height >= maxHeight * 0.9).map((item) => item.str);
  const title = titleParts.join('').replace(/\s+/g, ' ').trim();

  // 短すぎるもの（雑誌のロゴなど）や長すぎるもの（本文全体が同じ大きさの場合）はタイトルとみなさない
  if (title.length < 6 || title.length > 300) return null;
  return title;
}

/**
 * 取得したタイトルが、PDF の文字の中に含まれているか確かめる（自動で採用してよいかの判断）。
 * 空白・記号・全角半角・部首の文字の違いは無視する。長いタイトルは先頭30文字で確かめる。
 */
export function titleAppearsInText(title, text) {
  const compactTitle = compactForMatch(title);
  if (compactTitle.length < 4) return false;
  const compactText = compactForMatch(text);
  return compactText.includes(compactTitle.slice(0, 30));
}

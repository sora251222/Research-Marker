// 書誌情報の自動取得の流れ
//   1. PDF の文書情報と1〜2ページ目の文字から DOI を探す
//   2. DOI があれば JaLC／Crossref（＋PubMed）から取得し、PDF のタイトルと一致するか確かめる
//   3. DOI がなければ、1ページ目の大きな文字（タイトルの候補）で J-STAGE／Crossref を検索し、候補を返す
// 自動で反映してよいのは「DOI から取得し、タイトルが PDF と一致した」場合だけ（CLAUDE.md 第9章）。

import { getPaperBundle, getFileBlob, updatePaperBibliography, recordLookupResult } from '../storage/paperRepository.js';
import { loadPdfDocument, destroyPdfDocument } from '../pdf/pdfjs.js';
import { extractDoiCandidates, extractTitleCandidate, titleAppearsInText, normalizeDoi, isValidDoi } from './extract.js';
import { lookupByDoi, searchJstage, searchCrossref, hasValue } from './lookup.js';
import { japaneseRatio } from '../utils/japanese.js';

const PAGES_TO_READ = 2;

/**
 * PDF から、書誌情報を探すための文字を読み取る。
 * @returns {Promise<{available: boolean, reason?: string, text?: string, firstPageItems?: object[], metadataText?: string, isJapanese?: boolean}>}
 */
export async function readPdfForMetadata(paperId) {
  const bundle = await getPaperBundle(paperId);
  if (!bundle) return { available: false, reason: '論文が見つかりません。' };
  if (bundle.paper.sourceKind !== 'pdf') {
    return {
      available: false,
      reason: '画像から文字を読み取るには OCR（開発予定）が必要です。下の欄に DOI かタイトルを入力すると検索できます。',
    };
  }

  const blob = await getFileBlob(bundle.files[0].id);
  const pdfDocument = await loadPdfDocument(new Uint8Array(await blob.arrayBuffer()));
  try {
    // 文書情報（PDF の中に記録されたタイトル・DOI など）
    let metadataText = '';
    try {
      const { info, metadata } = await pdfDocument.getMetadata();
      const metadataValues = metadata?.getAll ? metadata.getAll() : {};
      metadataText = [JSON.stringify(info ?? {}), JSON.stringify(metadataValues ?? {})].join(' ');
    } catch {
      // 文書情報がなくても続ける
    }

    let text = '';
    let firstPageItems = [];
    for (let pageNumber = 1; pageNumber <= Math.min(PAGES_TO_READ, pdfDocument.numPages); pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      if (pageNumber === 1) firstPageItems = content.items;
      text += content.items.map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('') + '\n';
      page.cleanup();
    }

    const hasText = text.replace(/\s/g, '').length >= 20;
    return {
      available: hasText || /10\.\d{4,9}\//.test(metadataText),
      reason: hasText ? undefined : 'この PDF には文字情報がないため、DOI やタイトルを読み取れません（OCR は開発予定）。下の欄に DOI かタイトルを入力すると検索できます。',
      text,
      firstPageItems,
      metadataText,
      isJapanese: japaneseRatio(text) > 0.2,
    };
  } finally {
    await destroyPdfDocument(pdfDocument);
  }
}

/**
 * PDF から書誌情報を探す。
 * @returns {Promise<
 *   {kind: 'proposal', proposal: object} |
 *   {kind: 'candidates', candidates: object[], searchedTitle: string} |
 *   {kind: 'none'|'unavailable', message: string}
 * >}
 */
export async function findBibliographyFromPdf(paperId, onProgress = () => {}) {
  onProgress('PDF から DOI とタイトルを読み取っています…');
  const pdf = await readPdfForMetadata(paperId);
  if (!pdf.available) return { kind: 'unavailable', message: pdf.reason };

  const dois = [...extractDoiCandidates(pdf.metadataText), ...extractDoiCandidates(pdf.text)].filter(
    (doi, index, list) => list.findIndex((other) => other.toLowerCase() === doi.toLowerCase()) === index
  );

  // DOI が見つかれば、最初の2つまで問い合わせる
  for (const doi of dois.slice(0, 2)) {
    onProgress(`DOI（${doi}）で書誌情報を問い合わせています…`);
    const result = await lookupByDoi(doi, { japaneseFirst: pdf.isJapanese });
    if (result) {
      const verified =
        titleAppearsInText(result.fields.title, pdf.text) || titleAppearsInText(result.fields.titleEn, pdf.text);
      return { kind: 'proposal', proposal: { ...result, doi, verified, origin: 'pdf-doi' } };
    }
  }

  // DOI がなければ、タイトルの候補で検索する
  const title = extractTitleCandidate(pdf.firstPageItems);
  if (!title) {
    return {
      kind: 'none',
      message: dois.length > 0
        ? 'PDF にあった DOI では書誌情報が見つかりませんでした。DOI かタイトルを入力して検索してください。'
        : 'PDF から DOI もタイトルも読み取れませんでした。DOI かタイトルを入力して検索してください。',
    };
  }
  onProgress(`タイトル「${title.slice(0, 30)}${title.length > 30 ? '…' : ''}」で検索しています…`);
  const candidates = await searchByTitle(title, pdf.isJapanese);
  if (candidates.length === 0) {
    return { kind: 'none', message: `「${title.slice(0, 40)}」に当てはまる論文が見つかりませんでした。DOI かタイトルを入力して検索してください。` };
  }
  return { kind: 'candidates', candidates, searchedTitle: title };
}

/** 入力された DOI またはタイトルで探す */
export async function findBibliographyFromQuery(query, onProgress = () => {}) {
  const trimmed = query.trim();
  const doi = normalizeDoi(extractDoiCandidates(trimmed)[0] ?? trimmed);
  if (isValidDoi(doi)) {
    onProgress(`DOI（${doi}）で書誌情報を問い合わせています…`);
    const result = await lookupByDoi(doi, { japaneseFirst: true });
    if (!result) return { kind: 'none', message: `DOI「${doi}」の書誌情報が見つかりませんでした。DOI が正しいか確認してください。` };
    // 利用者が入力した DOI なので、PDF との照合はしない（反映前に内容を確認してもらう）
    return { kind: 'proposal', proposal: { ...result, doi, verified: false, origin: 'query-doi' } };
  }
  if (trimmed.length < 4) return { kind: 'none', message: 'DOI、またはタイトルの一部（4文字以上）を入力してください。' };
  onProgress(`「${trimmed.slice(0, 30)}」で検索しています…`);
  const candidates = await searchByTitle(trimmed, japaneseRatio(trimmed) > 0.2);
  return candidates.length > 0
    ? { kind: 'candidates', candidates, searchedTitle: trimmed }
    : { kind: 'none', message: `「${trimmed.slice(0, 40)}」に当てはまる論文が見つかりませんでした。` };
}

/** 日本語は J-STAGE（見つからなければ Crossref）、英語は Crossref で探す */
async function searchByTitle(title, isJapanese) {
  if (isJapanese) {
    const jstage = await searchJstage(title);
    if (jstage.length > 0) return jstage;
  }
  return searchCrossref(title);
}

// ---------- 反映する項目の決め方 ----------

/** 画面に表示する項目の順番と名前 */
export const PROPOSAL_FIELDS = [
  ['title', 'タイトル'],
  ['authors', '著者'],
  ['journal', '雑誌名'],
  ['journalAbbr', '略誌名'],
  ['year', '発行年'],
  ['volume', '巻'],
  ['issue', '号'],
  ['pageStart', '開始ページ'],
  ['pageEnd', '終了ページ'],
  ['articleNumber', '論文番号'],
  ['doi', 'DOI'],
  ['pmid', 'PMID'],
  ['language', '言語'],
  ['titleEn', 'タイトル（英語）'],
  ['authorsEn', '著者（英語表記）'],
  ['journalAbbrNlm', 'NLM略誌名'],
];

/**
 * 取得した値と今の値を比べ、どの項目を反映候補にするかを決める。
 *   ・今の値が空 → 反映する（チェックを入れておく）
 *   ・今の値と同じ → 表示しない
 *   ・今の値と違う → 表示するが、チェックは外しておく（手入力した値を勝手に上書きしない）
 */
export function compareWithCurrent(paper, fields) {
  return PROPOSAL_FIELDS.filter(([key]) => hasValue(fields[key]))
    .map(([key, label]) => {
      const current = paper[key];
      const same = JSON.stringify(normalizeValue(current)) === JSON.stringify(normalizeValue(fields[key]));
      return { key, label, value: fields[key], current, same, selected: !hasValue(current) };
    })
    .filter((row) => !row.same);
}

/**
 * 選んだ項目を論文に反映する（取得元を項目ごとに記録する）。
 * @param {object} paper 今の論文
 * @param {Array<{key: string, value: any}>} rows 反映する項目
 * @param {Record<string, string>} fieldSources 項目名 → 取得元
 * @returns {Promise<object>} 更新後の論文
 */
export async function applyRows(paper, rows, fieldSources) {
  const changes = {};
  const sources = {};
  for (const row of rows) {
    changes[row.key] = row.value;
    sources[row.key] = fieldSources[row.key] ?? 'manual';
  }
  return updatePaperBibliography(paper.id, changes, paper.updatedAt, sources);
}

/**
 * 取り込み直後などに、自動で書誌情報を探す。
 * 「DOI から取得し、タイトルが PDF と一致した」ときだけ、空いている項目に自動で反映する。
 * それ以外（候補が見つかった・一致を確認できない）は「要確認」として記録し、利用者に選んでもらう。
 * @returns {Promise<{status: string, paper: object, appliedCount?: number, sources?: string[], result?: object}>}
 */
export function autoFillBibliography(paper, onProgress = () => {}) {
  // 同じ論文の自動取得がすでに動いていれば、その結果を待つ（取り込み直後に論文を開いた場合など）
  if (!runningAutoFills.has(paper.id)) {
    const task = runAutoFill(paper, onProgress).finally(() => runningAutoFills.delete(paper.id));
    runningAutoFills.set(paper.id, task);
  }
  return runningAutoFills.get(paper.id);
}

const runningAutoFills = new Map(); // 論文ID → 実行中の自動取得

async function runAutoFill(paper, onProgress) {
  const result = await findBibliographyFromPdf(paper.id, onProgress);

  if (result.kind === 'proposal' && result.proposal.verified) {
    const rows = compareWithCurrent(paper, result.proposal.fields).filter((row) => row.selected);
    let updated = paper;
    if (rows.length > 0) {
      updated = await applyRows(paper, rows, result.proposal.fieldSources);
    }
    updated = await recordLookupResult(paper.id, { status: 'applied', sources: result.proposal.sources });
    return { status: 'applied', paper: updated, appliedCount: rows.length, sources: result.proposal.sources, result };
  }

  const status = result.kind === 'proposal' || result.kind === 'candidates' ? 'needs-review' : result.kind === 'unavailable' ? 'unavailable' : 'not-found';
  const updated = await recordLookupResult(paper.id, { status });
  return { status, paper: updated, result };
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim());
  return hasValue(value) ? String(value).trim() : null;
}

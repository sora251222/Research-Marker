// バンクーバー方式の参考文献を作る（画面に依存しない純粋な関数）
//
// 基本の形（区切りはすべて半角）：
//   著者. タイトル. 略誌名. 発行年;巻(号):ページ.
// 例（NLM形式）：Halpern SD, Ubel PA, Caplan AL. Solid-organ transplantation in HIV-infected patients. N Engl J Med. 2002;347(4):284-287.
// 例（国内形式）：清水由規. 糖尿病性眼疾患 糖尿病性網膜症. 日医大医会誌. 1984;51(6):758-761.
//
// 大切なルール：
//   ・書誌情報を推測で作らない（ない項目は「不足」として知らせる）
//   ・入力された著者名・タイトル・略誌名の表記は変えない（ローマ字化・翻訳・略称化をしない）

/** 参考文献の設定の既定値（CLAUDE.md 第10章） */
export const DEFAULT_CITATION_SETTINGS = {
  style: 'auto', // 'auto'：日本語論文は国内形式、英語論文はNLM形式 ／ 'domestic' ／ 'nlm'
  etAl: 'et al.', // 著者が7名以上のときの表記：'et al.'／'ほか'／'他'
  abbreviatePages: false, // ページを省略形にするか（false：758-761、true：758-61）
  includeDoi: false, // 末尾に DOI を付けるか
};

export const ET_AL_OPTIONS = ['et al.', 'ほか', '他'];
const MAX_LISTED_AUTHORS = 6;

/** 実際に使う書式（'auto' を論文の言語で決める） */
export function resolveStyle(paper, settings) {
  if (settings.style === 'domestic' || settings.style === 'nlm') {
    return settings.style;
  }
  return paper.language === 'en' ? 'nlm' : 'domestic';
}

/**
 * 参考文献を作る。
 * @param {object} paper 論文の書誌情報
 * @param {object} [settings] 参考文献の設定
 * @returns {{text: string, style: 'domestic'|'nlm', missing: string[], warnings: string[], canCopy: boolean}}
 *   missing：必須項目の不足（あるとコピーできない）／warnings：あったほうがよい項目の不足
 */
export function formatVancouver(paper, settings = DEFAULT_CITATION_SETTINGS) {
  const options = { ...DEFAULT_CITATION_SETTINGS, ...settings };
  const style = resolveStyle(paper, options);
  const isJapaneseInNlm = style === 'nlm' && paper.language !== 'en';
  const missing = [];
  const warnings = [];

  // 著者
  const authors = cleanList(isJapaneseInNlm ? paper.authorsEn : paper.authors);
  if (authors.length === 0) {
    missing.push(isJapaneseInNlm ? '著者（英語表記）' : '著者');
  }
  const authorsPart = formatAuthors(authors, options.etAl);

  // タイトル（日本語論文をNLM形式で書くときは、英訳タイトルを [ ] で囲む）
  let titlePart = '';
  if (isJapaneseInNlm) {
    const titleEn = clean(paper.titleEn);
    if (titleEn) {
      titlePart = `[${titleEn.replace(/\.$/, '')}]`;
    } else {
      missing.push('タイトル（英語）');
    }
  } else {
    titlePart = clean(paper.title);
    if (!titlePart) missing.push('タイトル');
  }

  // 略誌名（正式な誌名で勝手に代用しない）
  const journalAbbr = clean(isJapaneseInNlm ? paper.journalAbbrNlm : paper.journalAbbr);
  if (!journalAbbr) {
    missing.push(isJapaneseInNlm ? 'NLM略誌名' : '略誌名');
  }

  // 発行年・巻・号・ページ
  const year = clean(paper.year);
  if (!year) missing.push('発行年');
  const volume = clean(paper.volume);
  const issue = clean(paper.issue);
  if (!volume) warnings.push('巻');
  const pages = formatPages(paper, options.abbreviatePages);
  if (!pages) warnings.push('ページ（または論文番号）');

  // 組み立て（空の項目は飛ばす）
  const parts = [];
  if (authorsPart) parts.push(endWithPeriod(authorsPart));
  if (titlePart) parts.push(endWithPeriod(titlePart));
  if (journalAbbr) parts.push(endWithPeriod(journalAbbr));

  let source = year;
  if (volume || issue) source += `;${volume}${issue ? `(${issue})` : ''}`;
  if (pages) source += `:${pages}`;
  if (source) parts.push(endWithPeriod(source));

  if (isJapaneseInNlm) parts.push('Japanese.');

  const doi = clean(paper.doi);
  if (options.includeDoi && doi) parts.push(`doi:${doi}`);

  return { text: parts.join(' '), style, missing, warnings, canCopy: missing.length === 0 };
}

/** 著者を並べる。6名までは全員、7名以上は最初の6名＋「et al.」など */
export function formatAuthors(authors, etAl = 'et al.') {
  if (authors.length === 0) return '';
  if (authors.length <= MAX_LISTED_AUTHORS) return authors.join(', ');
  return `${authors.slice(0, MAX_LISTED_AUTHORS).join(', ')}, ${etAl}`;
}

/**
 * ページの表記を作る。
 * 論文番号（例：e012345）があればそれを使う。
 * 省略形にする設定のときは、終了ページの先頭の同じ数字を省く（284-287 → 284-7、1234-1245 → 1234-45）。
 */
export function formatPages(paper, abbreviate = false) {
  const articleNumber = clean(paper.articleNumber);
  const start = clean(paper.pageStart);
  const end = clean(paper.pageEnd);
  if (!start) return articleNumber;
  if (!end || end === start) return start;
  return `${start}-${abbreviate ? abbreviateEndPage(start, end) : end}`;
}

/** 終了ページの省略（数字だけで、桁数が同じ場合に限る。それ以外はそのまま） */
export function abbreviateEndPage(start, end) {
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end) || start.length !== end.length || Number(end) <= Number(start)) {
    return end;
  }
  let index = 0;
  while (index < start.length - 1 && start[index] === end[index]) {
    index += 1;
  }
  return end.slice(index);
}

/** 末尾にピリオドを付ける（すでに . ? ! 。？！ で終わっていれば付けない） */
function endWithPeriod(text) {
  return /[.?!。？！]$/.test(text) ? text : `${text}.`;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function cleanList(values) {
  return (values ?? []).map(clean).filter(Boolean);
}

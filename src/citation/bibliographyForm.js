// 書誌情報の入力内容を、保存できる形にそろえて確認する（画面に依存しない純粋な関数）

/** 1行の文字で入力する項目 */
export const BIB_TEXT_FIELDS = [
  'title', 'journal', 'journalAbbr', 'year', 'volume', 'issue',
  'pageStart', 'pageEnd', 'articleNumber', 'doi', 'titleEn', 'journalAbbrNlm',
];
/** 1行に1つずつ入力する項目（著者） */
export const BIB_LIST_FIELDS = ['authors', 'authorsEn'];

/**
 * 入力内容を読み取り、確認する。
 * ・前後の空白を除き、空欄は null（未入力）にする
 * ・著者は1行ずつに分け、空の行は除く（名前の表記そのものは変えない）
 * ・発行年は4桁の数字か、DOI は「10.」で始まる形かを確認する
 * @param {Record<string, string>} values 項目名 → 入力された文字
 * @param {number} [thisYear] 今年（テスト用に指定できる）
 * @returns {{changes?: object, error?: string}}
 */
export function readBibliographyForm(values, thisYear = new Date().getFullYear()) {
  const changes = { language: values.language === 'en' ? 'en' : 'ja' };

  for (const field of BIB_TEXT_FIELDS) {
    const text = String(values[field] ?? '').trim();
    changes[field] = text === '' ? null : text;
  }
  for (const field of BIB_LIST_FIELDS) {
    changes[field] = String(values[field] ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (changes.year) {
    const year = Number(changes.year);
    if (!/^\d{4}$/.test(changes.year) || year < 1800 || year > thisYear + 1) {
      return { error: `発行年は 4 桁の数字で入力してください（1800〜${thisYear + 1}）。` };
    }
  }

  // DOI：「https://doi.org/」や「doi:」が付いていれば取り除く（DOI そのものは変えない）
  if (changes.doi) {
    changes.doi = changes.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
    if (!/^10\.\d{4,9}\/\S+$/.test(changes.doi)) {
      return { error: 'DOI は「10.」で始まる形で入力してください（例：10.1056/NEJMsa021052）。' };
    }
  }
  return { changes };
}

// 論文の一覧に関する純粋な関数（並べ替えなど）

/** 論文の表示名（タイトルが未設定ならファイル名） */
export function paperDisplayTitle(paper) {
  return paper.title ?? paper.displayName ?? '';
}

/**
 * 論文を並べ替えた新しい配列を返す（元の配列は変更しない）。
 * @param {object[]} papers
 * @param {'title'|'createdAt'} key
 * @param {'ascending'|'descending'} direction
 */
export function sortPapers(papers, key, direction) {
  const sign = direction === 'ascending' ? 1 : -1;
  // 日本語の読みの順に近い並び（Intl.Collator：言語に合わせた文字の比較）
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

  return [...papers].sort((a, b) => {
    const result =
      key === 'title'
        ? collator.compare(paperDisplayTitle(a), paperDisplayTitle(b))
        : String(a.createdAt).localeCompare(String(b.createdAt));
    return result * sign;
  });
}

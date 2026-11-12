// 論文検索に使う文字列処理
// 画面（DOM）に関係しない「純粋な関数」だけを置くので、自動テストしやすい。

/**
 * 検索用に文字列をそろえる。
 * - NFKC 正規化：全角英数字「ＡＢＣ１２３」を半角「ABC123」に、半角カナを全角にそろえる
 * - 小文字化：英語の大文字・小文字の違いを無視する
 * - 連続する空白（全角スペースを含む）を1つにまとめる
 * 元のデータは変更せず、比較用の新しい文字列を返す。
 */
export function normalizeForSearch(text) {
  if (text === null || text === undefined) {
    return '';
  }
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1件の論文が検索語に一致するか判定する。
 * 検索語を空白で区切り、すべての語が「タイトル・著者・雑誌名・発行年・DOI」の
 * どこかに含まれていれば一致とする（AND検索）。タイトル未設定の論文は、ファイル名でも探せる。
 */
export function paperMatchesQuery(paper, query) {
  const keywords = normalizeForSearch(query).split(' ').filter(Boolean);
  if (keywords.length === 0) {
    return true; // 検索語が空なら全件表示
  }

  const searchableText = normalizeForSearch(
    [
      paper.title,
      paper.displayName,
      (paper.authors ?? []).join(' '),
      paper.journal,
      paper.year,
      paper.doi,
    ].join(' ')
  );

  return keywords.every((keyword) => searchableText.includes(keyword));
}

/** 論文の配列から、検索語に一致するものだけを返す（元の配列は変更しない） */
export function filterPapers(papers, query) {
  return papers.filter((paper) => paperMatchesQuery(paper, query));
}

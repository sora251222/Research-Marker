// アプリ全体の状態（今どの画面か、どんな論文があるか等）を1か所で持つ。
// フェーズ1では、画面操作に必要な最低限の情報だけを扱う。

import { samplePapers } from './data/samplePapers.js';

export const appState = {
  // 論文の一覧（今はサンプルだけ。フェーズ2以降で実際の論文に置き換える）
  papers: [...samplePapers],
  // 論文検索欄に入力されている文字
  searchQuery: '',
  // 現在の画面（router.js の parseRoute が返す形）
  route: { view: 'library' },
};

/** IDから論文を探す。見つからなければ null を返す */
export function findPaperById(paperId) {
  return appState.papers.find((paper) => paper.id === paperId) ?? null;
}

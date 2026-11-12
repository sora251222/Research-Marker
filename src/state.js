// アプリ全体の状態（今どの画面か、どんな論文があるか等）を1か所で持つ。

export const appState = {
  // 論文の一覧（IndexedDB から読み込む。src/ui/library.js の refreshLibrary）
  papers: [],
  // 論文検索欄に入力されている文字
  searchQuery: '',
  // 現在の画面（router.js の parseRoute が返す形）
  route: { view: 'library' },
};

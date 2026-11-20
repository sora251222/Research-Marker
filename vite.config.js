// Vite（開発用サーバー）の設定
//
// 【外部の書誌情報APIの中継】
// ブラウザから外部のAPIを直接呼ぶと、相手のサーバーの設定（CORS）で断られることがあるため、
// 開発用サーバーが代わりに問い合わせて結果を返す（中継＝プロキシ）。
// アプリからは /api/jalc/... のように自分のサーバーの住所として呼び出す。
// 将来クラウド（Vercel）に置くときは、同じ住所でサーバー処理（api/ フォルダ）に置き換える。
//
// 送るのは DOI やタイトルなどの検索語だけで、PDF・画像は送らない。
// 個人を特定する情報（メールアドレスなど）は送らない。

import { defineConfig } from 'vite';

// 各APIの利用条件（CLAUDE.md 第9章）：大量取得をしない、1件ずつ問い合わせる
const USER_AGENT = 'ResearchMarker/0.1 (personal non-commercial research tool)';

function relay(prefix, target) {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(prefix, ''),
    headers: { 'User-Agent': USER_AGENT },
  };
}

const proxy = {
  '/api/jalc': relay(/^\/api\/jalc/, 'https://api.japanlinkcenter.org'), // JaLC：日本語論文の書誌情報
  '/api/crossref': relay(/^\/api\/crossref/, 'https://api.crossref.org'), // Crossref：英語論文の書誌情報・検索
  '/api/jstage': relay(/^\/api\/jstage/, 'https://api.jstage.jst.go.jp'), // J-STAGE：DOIを探す（検索専用・保存しない）
  '/api/ncbi': relay(/^\/api\/ncbi/, 'https://eutils.ncbi.nlm.nih.gov'), // PubMed：NLM略誌名・英語表記
};

export default defineConfig({
  // 公開用ファイル（npm run build）の CSS・JavaScript を「./」から読み込む書き方にする。
  // 「/」から始める書き方だと、サイトのいちばん上以外の場所（例：GitHub Pages の /Research-Marker/）に
  // 置いたときに見つからなくなるため。
  base: './',
  server: { proxy },
  preview: { proxy },
});

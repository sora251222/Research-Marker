// PDF.js が実行中に読み込む補助ファイルを、Vite が配信できる public/pdfjs/ にコピーする。
//   cmaps/          … 日本語などのフォントの文字対応表（これがないと日本語PDFが文字化けすることがある）
//   standard_fonts/ … PDFに埋め込まれていない標準フォント
//   wasm/           … 一部の画像形式（JPEG2000・JBIG2 など）の復号処理
//   iccs/           … 色の変換に使うプロファイル
// npm run dev / npm run build の直前に自動で実行される（package.json の predev / prebuild）。
// コピー先は node_modules から再作成できるので、Git には記録しない（.gitignore）。

import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoot = path.join(projectRoot, 'node_modules', 'pdfjs-dist');
const targetRoot = path.join(projectRoot, 'public', 'pdfjs');

for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const source = path.join(sourceRoot, folder);
  if (!existsSync(source)) {
    console.error(`PDF.js のフォルダが見つかりません: ${source}（npm install を実行してください）`);
    process.exit(1);
  }
  cpSync(source, path.join(targetRoot, folder), { recursive: true });
}

console.log('PDF.js の補助ファイルを public/pdfjs/ にコピーしました。');

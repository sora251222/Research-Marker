// Research Marker の入り口（最初に読み込まれる JavaScript。index.html の body の最後で読み込む）
// 各機能の準備をして、画面の切り替え（ルーター）を開始する。

import { appState } from './src/state.js';
import { startRouter } from './src/router.js';
import { applyViewToPage, moveFocusAfterNavigation } from './src/ui/navigation.js';
import { initSidebar } from './src/ui/sidebar.js';
import { initLibrary, loadPapers, renderPaperList } from './src/ui/library.js';
import { initUploadView, renderStoredTable, updateStorageUsage } from './src/ui/uploadView.js';
import { initImportPanel } from './src/ui/importPanel.js';
import { initViewer, showPaperInViewer, closeViewer } from './src/ui/viewer.js';
import { initMarkerPanel } from './src/ui/markerPanel.js';
import { initBibliographyPanel } from './src/ui/bibliographyPanel.js';

// JavaScript が正しく動き出したので、起動の案内（index.html の #boot-message）を消す
document.getElementById('boot-message')?.remove();

// 公開版（npm run build で作ったもの。GitHub Pages など）のときだけ、お試し版のお知らせを出す
// import.meta.env.DEV：開発用サーバーで動いているときだけ true になる（Vite が用意する値）
if (!import.meta.env.DEV) {
  document.getElementById('demo-banner').hidden = false;
}

/** 保存されている論文を読み込み直し、ライブラリと格納画面の表示をそろえて更新する */
async function refreshPapers() {
  await loadPapers();
  renderPaperList();
  renderStoredTable();
  await updateStorageUsage();
}

initSidebar();
initLibrary();
initUploadView({ onChanged: refreshPapers });
initImportPanel({ onSaved: refreshPapers });
initViewer();
initMarkerPanel();
initBibliographyPanel({ onChanged: refreshPapers });
refreshPapers();

startRouter((route, { isInitial }) => {
  appState.route = route;

  if (route.view === 'viewer') {
    showPaperInViewer(route.paperId);
  } else {
    closeViewer(); // 閲覧画面を離れたら、PDF・画像のメモリを解放する
  }

  applyViewToPage(route);
  moveFocusAfterNavigation(route, { isInitial });
});

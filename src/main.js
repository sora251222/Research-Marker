// Research Marker の入り口（最初に読み込まれる JavaScript）
// 各機能の準備をして、画面の切り替え（ルーター）を開始する。

import { appState } from './state.js';
import { startRouter } from './router.js';
import { applyViewToPage, moveFocusAfterNavigation } from './ui/navigation.js';
import { initSidebar } from './ui/sidebar.js';
import { initLibrary, loadPapers, renderPaperList } from './ui/library.js';
import { initUploadView, renderStoredTable, updateStorageUsage } from './ui/uploadView.js';
import { initImportPanel } from './ui/importPanel.js';
import { initViewer, showPaperInViewer, closeViewer } from './ui/viewer.js';
import { initMarkerPanel } from './ui/markerPanel.js';
import { initBibliographyPanel } from './ui/bibliographyPanel.js';

// JavaScript が正しく動き出したので、起動の案内（index.html の #boot-message）を消す
document.getElementById('boot-message')?.remove();

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

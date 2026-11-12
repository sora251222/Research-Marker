// Research Marker の入り口（最初に読み込まれる JavaScript）
// 各機能の準備をして、画面の切り替え（ルーター）を開始する。

import { appState } from './state.js';
import { startRouter } from './router.js';
import { applyViewToPage, moveFocusAfterNavigation } from './ui/navigation.js';
import { initSidebar } from './ui/sidebar.js';
import { initLibrary, refreshLibrary } from './ui/library.js';
import { initImportPanel } from './ui/importPanel.js';
import { initViewer, showPaperInViewer, closeViewer } from './ui/viewer.js';

initSidebar();
initLibrary();
initImportPanel({ onSaved: refreshLibrary });
initViewer();
refreshLibrary();

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

// Research Marker の入り口（最初に読み込まれる JavaScript）
// 各機能の準備をして、画面の切り替え（ルーター）を開始する。

import { appState } from './state.js';
import { startRouter } from './router.js';
import { applyViewToPage, moveFocusAfterNavigation } from './ui/navigation.js';
import { initSidebar } from './ui/sidebar.js';
import { initLibrary } from './ui/library.js';
import { showPaperInViewer } from './ui/viewer.js';

initSidebar();
initLibrary();

startRouter((route, { isInitial }) => {
  appState.route = route;

  if (route.view === 'viewer') {
    showPaperInViewer(route.paperId);
  }

  applyViewToPage(route);
  moveFocusAfterNavigation(route, { isInitial });
});

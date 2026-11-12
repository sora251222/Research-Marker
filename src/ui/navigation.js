// メニューの「選択中」表示と、画面の表示・非表示を切り替える

/**
 * 画面の情報（route）に合わせて、表示する画面とメニューの選択状態を更新する。
 * 表示の切り替えは CSS 側で行い、ここでは <body data-view="…"> を書き換えるだけ。
 */
export function applyViewToPage(route) {
  document.body.dataset.view = route.view;

  // どのメニューを「選択中」にするか
  // 論文閲覧中は「論文ライブラリ」を選択中として扱う（閲覧画面はライブラリの中にあるため）
  let activeNav = route.view;
  if (route.view === 'viewer') {
    activeNav = 'library';
  }
  if (route.focusUpload) {
    activeNav = 'upload';
  }

  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === activeNav) {
      // aria-current="page"：読み上げソフトに「今いるページ」だと伝える
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

/**
 * 画面を切り替えたあと、ページの先頭に戻り、キーボード操作の位置（フォーカス）を移す。
 * 最初の表示のときはフォーカスを動かさない（勝手にフォーカスが移ると使いにくいため）。
 */
export function moveFocusAfterNavigation(route, { isInitial }) {
  window.scrollTo(0, 0);
  if (isInitial && !route.focusUpload) {
    return;
  }

  if (route.focusUpload) {
    // 「論文を追加」を選んだときは、ファイル選択の部品にフォーカスを移す
    document.getElementById('file-input')?.focus();
    return;
  }

  const headingIds = {
    library: 'library-heading',
    viewer: 'viewer-heading',
    settings: 'settings-heading',
  };
  document.getElementById(headingIds[route.view])?.focus();
}

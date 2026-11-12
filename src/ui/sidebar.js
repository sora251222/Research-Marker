// サイドバーの開閉
// - PC（1024px以上）：開閉ボタンで切り替え、状態をこの端末に記憶する
// - タブレット（768〜1023px）：最初は閉じた状態（アイコンだけ）。ボタンで一時的に開ける
// - スマートフォン（767px以下）：上部メニューになるため、開閉ボタンは使わない

import { readPreference, writePreference } from '../utils/preferences.js';

const PREFERENCE_NAME = 'sidebarCollapsed';
const desktopQuery = window.matchMedia('(min-width: 1024px)');
const mobileQuery = window.matchMedia('(max-width: 767px)');

let toggleButton;
let isExpandedOnTablet = false; // タブレットで一時的に開いているか

export function initSidebar() {
  toggleButton = document.getElementById('sidebar-toggle');
  if (!toggleButton) {
    return;
  }

  toggleButton.addEventListener('click', handleToggleClick);
  // 画面幅が変わったら（ウィンドウのサイズ変更、タブレットの回転など）表示を更新する
  desktopQuery.addEventListener('change', updateSidebar);
  mobileQuery.addEventListener('change', updateSidebar);

  updateSidebar();
}

function handleToggleClick() {
  if (desktopQuery.matches) {
    const collapsed = readPreference(PREFERENCE_NAME, false);
    writePreference(PREFERENCE_NAME, !collapsed);
  } else {
    isExpandedOnTablet = !isExpandedOnTablet;
  }
  updateSidebar();
}

/** 現在の画面幅と設定から、サイドバーを開くか閉じるかを決めて反映する */
function updateSidebar() {
  let collapsed;
  if (mobileQuery.matches) {
    collapsed = true; // 上部メニュー（CSS側でアイコン表示にする）
    isExpandedOnTablet = false;
  } else if (desktopQuery.matches) {
    collapsed = readPreference(PREFERENCE_NAME, false);
  } else {
    collapsed = !isExpandedOnTablet;
  }

  document.body.dataset.sidebar = collapsed ? 'compact' : 'expanded';

  // ボタンの状態と読み上げ用の名前も合わせて変える（見た目だけで状態を伝えないため）
  toggleButton.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'サイドバーを開く' : 'サイドバーを折りたたむ';
  toggleButton.setAttribute('aria-label', label);
  toggleButton.title = label;
}

// JavaScript で作る画面部品（表の行など）に使うアイコン
// 線で描くシンプルなアイコンを、名前で呼び出せるようにする。

const ICON_PATHS = {
  pdf: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8zM14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m20 16-4.5-4.5L8 19"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
};

/**
 * アイコンの <svg> 要素を作る。
 * @param {'pdf'|'image'|'more'} name
 */
export function createIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON_PATHS[name]; // 中身は上の固定の文字列だけ（外部の文字列は入れない）
  return svg;
}

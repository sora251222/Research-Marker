// マーカーの色（実際の色は CSS 変数 --marker-yellow などで管理する）
// 色だけで区別しないよう、必ず色名（label）も一緒に表示する。

export const MARKER_COLORS = [
  { id: 'yellow', label: '黄' },
  { id: 'green', label: '緑' },
  { id: 'pink', label: 'ピンク' },
  { id: 'blue', label: '青' },
];

export const DEFAULT_MARKER_COLOR = 'yellow';

export function colorLabel(colorId) {
  return MARKER_COLORS.find((color) => color.id === colorId)?.label ?? colorId;
}

export function isValidColor(colorId) {
  return MARKER_COLORS.some((color) => color.id === colorId);
}

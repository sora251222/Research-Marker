// 画面に表示するための書式（容量・日時）

/** バイト数を「1.5 MB」のような読みやすい表記にする */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '不明';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/** ISO形式の日時を「2026/11/12 23:30」のような日本の表記にする */
export function formatDateTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '不明';
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

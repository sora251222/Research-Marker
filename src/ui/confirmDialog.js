// 確認ダイアログ（削除など、取り消しにくい操作の前に表示する）
// HTML 標準の <dialog> を使うので、Esc キーで閉じる・背面を操作できない、などが自動で備わる。

/**
 * 確認ダイアログを表示し、利用者が「実行」を選んだら true を返す。
 * @param {{title: string, message: string, confirmLabel: string}} options
 * @returns {Promise<boolean>}
 */
export function confirmAction({ title, message, confirmLabel }) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok').textContent = confirmLabel;

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'confirm'),
      { once: true }
    );
    dialog.returnValue = 'cancel';
    dialog.showModal();
  });
}

// マーカー・メモの読み書き（IndexedDB 版）
// 将来 Supabase の highlights テーブルに移すときは、このファイルを差し替える。

import { runTransaction, requestToPromise } from './db.js';

/** 別の画面（または別のタブ）で先に更新されていたときのエラー */
export class HighlightConflictError extends Error {
  constructor() {
    super('このマーカーは別の画面で更新されています。画面を開き直してから、もう一度お試しください。');
    this.name = 'HighlightConflictError';
  }
}

/** 論文のマーカーのうち、削除されていないものを返す */
export async function listHighlights(paperId) {
  const all = await runTransaction(['highlights'], 'readonly', ({ highlights }) =>
    requestToPromise(highlights.index('paperId').getAll(paperId))
  );
  return all.filter((highlight) => !highlight.deletedAt);
}

/**
 * マーカーを1件追加する。保存後に読み直し、内容が一致することを確認してから返す。
 * @param {object} highlight
 */
export async function addHighlight(highlight) {
  await runTransaction(['highlights'], 'readwrite', ({ highlights }) => {
    // add：同じIDがあれば失敗する（二重登録を防ぐ）
    highlights.add(highlight);
  });
  const stored = await getHighlight(highlight.id);
  if (!stored || stored.quoteText !== highlight.quoteText) {
    throw new Error('マーカーの保存内容を確認できませんでした。');
  }
  return stored;
}

export async function getHighlight(id) {
  return runTransaction(['highlights'], 'readonly', ({ highlights }) => requestToPromise(highlights.get(id)));
}

/**
 * マーカーの一部（メモ・色など）を更新する。
 * expectedUpdatedAt と保存されている updatedAt が違えば、上書きせずにエラーにする
 * （別のタブで先に書き換えられていた場合に、その内容を消さないため）。
 * @returns {Promise<object>} 更新後のマーカー
 */
export async function updateHighlight(id, changes, expectedUpdatedAt) {
  const now = new Date().toISOString();
  const updated = await runTransaction(['highlights'], 'readwrite', async ({ highlights }) => {
    const current = await requestToPromise(highlights.get(id));
    if (!current || current.deletedAt) {
      throw new Error('このマーカーは見つかりません（削除された可能性があります）。');
    }
    if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
      throw new HighlightConflictError();
    }
    const next = { ...current, ...changes, updatedAt: now };
    highlights.put(next);
    return next;
  });
  return updated;
}

/** マーカーを削除済みにする（論理削除：データは消さずに deletedAt を記録する） */
export async function softDeleteHighlight(id) {
  const now = new Date().toISOString();
  await runTransaction(['highlights'], 'readwrite', async ({ highlights }) => {
    const current = await requestToPromise(highlights.get(id));
    if (current && !current.deletedAt) {
      highlights.put({ ...current, deletedAt: now, updatedAt: now });
    }
  });
}

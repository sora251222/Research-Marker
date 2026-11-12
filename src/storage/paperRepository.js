// 論文データの読み書き（IndexedDB 版）
// 画面のコードはこのファイルの関数だけを使い、IndexedDB を直接さわらない。
// 将来 Supabase に移すときは、このファイルの中身を差し替えれば画面側を変えずに済む。

import { runTransaction, requestToPromise } from './db.js';
import { sha256Hex } from '../utils/hash.js';

/** 同じファイルがすでに登録されているときのエラー */
export class DuplicateFileError extends Error {
  constructor(message, existingPaperId) {
    super(message);
    this.name = 'DuplicateFileError';
    this.existingPaperId = existingPaperId;
  }
}

/** 削除されていない論文の一覧を、新しい順に返す */
export async function listPapers() {
  const papers = await runTransaction(['papers'], 'readonly', ({ papers: store }) =>
    requestToPromise(store.getAll())
  );
  return papers
    .filter((paper) => !paper.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 論文1件と、その元ファイル情報・ページを返す。見つからなければ null */
export async function getPaperBundle(paperId) {
  return runTransaction(['papers', 'sourceFiles', 'pages'], 'readonly', async (stores) => {
    const paper = await requestToPromise(stores.papers.get(paperId));
    if (!paper || paper.deletedAt) {
      return null;
    }
    const files = await requestToPromise(stores.sourceFiles.index('paperId').getAll(paperId));
    const pages = await requestToPromise(stores.pages.index('paperId').getAll(paperId));
    return {
      paper,
      files: files.sort((a, b) => a.orderIndex - b.orderIndex),
      pages: pages.sort((a, b) => a.orderIndex - b.orderIndex),
    };
  });
}

/** 元ファイルの中身（Blob）を返す */
export async function getFileBlob(fileId) {
  const record = await runTransaction(['fileBlobs'], 'readonly', ({ fileBlobs }) =>
    requestToPromise(fileBlobs.get(fileId))
  );
  if (!record) {
    throw new Error('元ファイルのデータが見つかりません。');
  }
  return record.blob;
}

/**
 * SHA-256 の一覧のうち、すでに登録されているものを調べる。
 * @returns {Promise<Map<string, string>>} 指紋 → 登録済みの論文ID
 */
export async function findExistingFiles(sha256List) {
  return runTransaction(['sourceFiles', 'papers'], 'readonly', async (stores) => {
    const found = new Map();
    for (const sha256 of sha256List) {
      const files = await requestToPromise(stores.sourceFiles.index('sha256').getAll(sha256));
      for (const file of files) {
        const paper = await requestToPromise(stores.papers.get(file.paperId));
        if (paper && !paper.deletedAt) {
          found.set(sha256, paper.id);
        }
      }
    }
    return found;
  });
}

/**
 * 論文1件分（論文・元ファイル・中身・ページ）を、1つのトランザクションでまとめて保存する。
 * 途中で失敗すると何も保存されない（半端なデータを残さない）。
 * 保存後、中身を読み直して SHA-256 が一致することまで確認してから返す。
 *
 * @param {{paper: object, files: Array<{record: object, blob: Blob}>, pages: object[]}} bundle
 */
export async function savePaperBundle({ paper, files, pages }) {
  const storeNames = ['papers', 'sourceFiles', 'fileBlobs', 'pages'];

  await runTransaction(storeNames, 'readwrite', async (stores) => {
    // 保存の直前にも重複を確認する（別のタブで同時に登録した場合に備える）
    for (const { record } of files) {
      const sameFiles = await requestToPromise(stores.sourceFiles.index('sha256').getAll(record.sha256));
      for (const sameFile of sameFiles) {
        const existingPaper = await requestToPromise(stores.papers.get(sameFile.paperId));
        if (existingPaper && !existingPaper.deletedAt) {
          throw new DuplicateFileError(
            `「${record.originalName}」と同じ内容のファイルが、すでに登録されています。`,
            existingPaper.id
          );
        }
      }
    }

    // add：同じIDがあれば失敗する（誤って上書きしないため put ではなく add を使う）
    stores.papers.add(paper);
    for (const { record, blob } of files) {
      stores.sourceFiles.add(record);
      stores.fileBlobs.add({ fileId: record.id, blob });
    }
    for (const page of pages) {
      stores.pages.add(page);
    }
  });

  // 保存した中身を読み直し、元のファイルと同じ指紋か確かめる
  try {
    for (const { record } of files) {
      const storedBlob = await getFileBlob(record.id);
      const storedHash = await sha256Hex(await storedBlob.arrayBuffer());
      if (storedHash !== record.sha256) {
        throw new Error(`「${record.originalName}」の保存内容が元のファイルと一致しません。`);
      }
    }
  } catch (error) {
    // 確認に失敗したら、今回書き込んだデータだけを取り消す（壊れたデータを残さない）
    await removePaperBundle(paper.id, files, pages).catch(() => {});
    throw error;
  }
}

/** savePaperBundle の確認に失敗したときに、今回書き込んだデータだけを取り除く（内部用） */
async function removePaperBundle(paperId, files, pages) {
  await runTransaction(['papers', 'sourceFiles', 'fileBlobs', 'pages'], 'readwrite', (stores) => {
    stores.papers.delete(paperId);
    for (const { record } of files) {
      stores.sourceFiles.delete(record.id);
      stores.fileBlobs.delete(record.id);
    }
    for (const page of pages) {
      stores.pages.delete(page.id);
    }
  });
}

/**
 * 論文を「削除済み」にする（論理削除）。
 * データ自体は消さずに deletedAt（削除日時）を記録し、一覧に表示しないようにするだけ。
 * 誤って削除したときに元に戻せるようにするため（元に戻す画面は開発予定）。
 * @param {string[]} paperIds
 */
export async function softDeletePapers(paperIds) {
  const now = new Date().toISOString();
  await runTransaction(['papers'], 'readwrite', async ({ papers }) => {
    for (const paperId of paperIds) {
      const paper = await requestToPromise(papers.get(paperId));
      if (paper && !paper.deletedAt) {
        papers.put({ ...paper, deletedAt: now, updatedAt: now });
      }
    }
  });
}

/**
 * ブラウザの保存容量の目安と、消されにくい設定（永続化）の状態を返す。
 * 対応していないブラウザでは null の項目がある。
 */
export async function getStorageStatus() {
  const status = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      status.usage = estimate.usage ?? null;
      status.quota = estimate.quota ?? null;
    }
    if (navigator.storage?.persisted) {
      status.persisted = await navigator.storage.persisted();
    }
  } catch {
    // 取得できない場合は「不明」として扱う
  }
  return status;
}

/**
 * ブラウザに「容量が不足しても、このサイトのデータを自動で消さないで」と依頼する。
 * 許可されるかどうかはブラウザが決める。
 */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // 依頼できない環境では何もしない
  }
  return false;
}

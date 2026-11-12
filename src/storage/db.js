// IndexedDB（ブラウザ内の大容量データベース）への接続
//
// 【開発段階の一時的な保存先】
// クラウド（Supabase）のログイン・アクセス制御が完成するまでの間だけ使う。
// ブラウザのデータを削除すると消える。別の端末・別のブラウザからは見えない。
//
// 保存の単位は将来の Supabase のテーブルと同じにして、移行しやすくしている。
//   papers      … 論文（書誌情報）
//   sourceFiles … 元ファイルの情報（名前・形式・サイズ・SHA-256 など）
//   fileBlobs   … 元ファイルの中身そのもの（変更しない）
//   pages       … ページ（表示・OCR・マーカーの単位）

const DB_NAME = 'research-marker-local';
const DB_VERSION = 1;

let databasePromise = null;

/** データベースを開く（初回だけ表を作る）。2回目以降は同じ接続を使い回す */
export function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('このブラウザでは IndexedDB を使えないため、論文を保存できません。'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // 初めて開いたとき（または版を上げたとき）に、表と索引を作る
    request.onupgradeneeded = () => {
      const db = request.result;
      const papers = db.createObjectStore('papers', { keyPath: 'id' });
      papers.createIndex('createdAt', 'createdAt');

      const sourceFiles = db.createObjectStore('sourceFiles', { keyPath: 'id' });
      sourceFiles.createIndex('paperId', 'paperId');
      sourceFiles.createIndex('sha256', 'sha256'); // 重複ファイルの検出に使う

      db.createObjectStore('fileBlobs', { keyPath: 'fileId' });

      const pages = db.createObjectStore('pages', { keyPath: 'id' });
      pages.createIndex('paperId', 'paperId');
    };

    request.onsuccess = () => {
      const db = request.result;
      // 別のタブで新しい版が開かれたら、この接続を閉じて譲る
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('別のタブで Research Marker が開かれているため、データベースを準備できません。他のタブを閉じてください。'));
  }).catch((error) => {
    databasePromise = null; // 失敗したら、次回もう一度開き直せるようにする
    throw error;
  });

  return databasePromise;
}

/** IndexedDB の「要求」（request）を、await で待てる Promise に変える */
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * トランザクション（まとめて成功するか、まとめて取り消されるかの処理単位）を実行する。
 * work の中の処理がすべて書き込まれた（oncomplete）ことを確認してから結果を返す。
 * 途中で失敗した場合は、それまでの書き込みもすべて取り消される。
 *
 * @param {string[]} storeNames 使う表の名前
 * @param {'readonly'|'readwrite'} mode
 * @param {(stores: Record<string, IDBObjectStore>, transaction: IDBTransaction) => Promise<any>|any} work
 */
export async function runTransaction(storeNames, mode, work) {
  const db = await openDatabase();
  const transaction = db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));

  const completed = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('保存処理が中断されました。'));
  });

  let result;
  try {
    result = await work(stores, transaction);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // すでに終了している場合は何もしない
    }
    await completed.catch(() => {});
    throw error;
  }

  await completed;
  return result;
}

/** 保存失敗の原因を、利用者に分かる日本語のメッセージにする */
export function describeStorageError(error) {
  if (error?.name === 'QuotaExceededError') {
    return 'ブラウザの保存容量が不足しているため、保存できませんでした。不要なデータを整理するか、ファイルを小さく分けてください。';
  }
  if (error?.name === 'DuplicateFileError') {
    return error.message;
  }
  return `保存できませんでした（${error?.message ?? '原因不明のエラー'}）。`;
}

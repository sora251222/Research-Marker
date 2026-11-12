// ファイルの取り込み処理
//   1. analyzeFiles：選んだファイルを読み、形式・容量・重複・ページを調べる（まだ保存しない）
//   2. saveImport  ：利用者が確認した内容（タイトル・画像の順番）で保存する
// 元のファイルの中身は一切変更せず、そのまま保存する。

import { detectFileKind, validateFileEntry, validateSelection, LIMITS } from './fileValidation.js';
import { sha256Hex } from '../utils/hash.js';
import { loadPdfDocument, inspectPdfPage, describePdfError, destroyPdfDocument } from '../pdf/pdfjs.js';
import { findExistingFiles, savePaperBundle } from '../storage/paperRepository.js';

/** 取り込みを続けられない問題（利用者に見せるメッセージ付き） */
export class ImportError extends Error {
  constructor(message, existingPaperId = null) {
    super(message);
    this.name = 'ImportError';
    this.existingPaperId = existingPaperId;
  }
}

const MIME_TYPES = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png' };

/**
 * 選んだファイルを調べ、保存の準備をする。
 * @param {File[]} files
 * @param {(message: string) => void} onProgress 進み具合の表示
 * @returns {Promise<{kind: 'pdf'|'images', items: object[]}>}
 */
export async function analyzeFiles(files, onProgress) {
  // 1. 読み込みの前に、組み合わせと容量をざっと確認する（大きすぎるファイルを読み込まないため）
  const roughEntries = files.map((file) => ({ kind: guessKindFromType(file), size: file.size }));
  const roughError = validateSelection(roughEntries);
  if (roughError) {
    throw new ImportError(roughError);
  }

  // 2. 1つずつ読み込み、中身の形式を確認して指紋を計算する
  const items = [];
  for (const [index, file] of files.entries()) {
    onProgress(`ファイルを確認しています（${index + 1} / ${files.length}）…`);
    const bytes = await file.arrayBuffer();
    const detectedKind = detectFileKind(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024)));
    const entryError = validateFileEntry({ name: file.name, size: file.size, detectedKind });
    if (entryError) {
      throw new ImportError(entryError);
    }
    items.push({
      name: file.name,
      size: file.size,
      kind: detectedKind,
      mimeType: MIME_TYPES[detectedKind],
      bytes,
      sha256: await sha256Hex(bytes),
    });
  }

  // 3. 中身で判定した形式で、組み合わせをもう一度確認する
  const selectionError = validateSelection(items);
  if (selectionError) {
    throw new ImportError(selectionError);
  }

  // 4. 重複の確認（今回選んだファイル同士、すでに登録済みのファイル）
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.sha256)) {
      throw new ImportError(`「${seen.get(item.sha256)}」と「${item.name}」は同じ内容のファイルです。どちらか一方だけを選んでください。`);
    }
    seen.set(item.sha256, item.name);
  }
  const existing = await findExistingFiles(items.map((item) => item.sha256));
  const duplicate = items.find((item) => existing.has(item.sha256));
  if (duplicate) {
    throw new ImportError(
      `「${duplicate.name}」と同じ内容のファイルが、すでに登録されています。`,
      existing.get(duplicate.sha256)
    );
  }

  // 5. ページの情報を調べる
  if (items[0].kind === 'pdf') {
    items[0].pages = await inspectPdf(items[0], onProgress);
    return { kind: 'pdf', items };
  }
  for (const [index, item] of items.entries()) {
    onProgress(`画像を確認しています（${index + 1} / ${items.length}）…`);
    Object.assign(item, await inspectImage(item));
  }
  return { kind: 'images', items };
}

/** ファイルの種類（ブラウザが判断したもの）から、おおまかな形式を推定する（最初の確認用） */
function guessKindFromType(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  return 'image';
}

/** PDFのページ数と、各ページの大きさ・文字情報の有無を調べる */
async function inspectPdf(item, onProgress) {
  let pdfDocument;
  try {
    // PDF.js に渡したデータは使えなくなるため、コピーを渡す（元のデータは保存用に残す）
    pdfDocument = await loadPdfDocument(new Uint8Array(item.bytes.slice(0)));
  } catch (error) {
    throw new ImportError(`「${item.name}」：${describePdfError(error)}`);
  }

  try {
    const pageCount = pdfDocument.numPages;
    if (pageCount > LIMITS.maxPages) {
      throw new ImportError(`「${item.name}」は ${pageCount} ページあります。1件の論文は ${LIMITS.maxPages} ページまでです。`);
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress(`PDFのページを確認しています（${pageNumber} / ${pageCount}）…`);
      pages.push(await inspectPdfPage(pdfDocument, pageNumber));
    }
    return pages;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(`「${item.name}」：${describePdfError(error)}`);
  } finally {
    await destroyPdfDocument(pdfDocument); // 解析が終わったらメモリを解放する
  }
}

/** 画像の大きさを調べる（スマートフォンの写真の向き情報 EXIF も反映した大きさ） */
async function inspectImage(item) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([item.bytes], { type: item.mimeType }));
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    throw new ImportError(`「${item.name}」は画像として読み込めませんでした。ファイルが壊れている可能性があります。`);
  } finally {
    bitmap?.close();
  }
}

/**
 * 確認済みの内容で保存する。
 * @param {{kind: 'pdf'|'images', items: object[]}} prepared analyzeFiles の結果（items は利用者が並べ替えた順）
 * @param {{title: string}} options
 * @returns {Promise<object>} 保存した論文
 */
export async function saveImport(prepared, { title }) {
  const now = new Date().toISOString();
  const paperId = crypto.randomUUID();
  const trimmedTitle = title.trim();

  const files = prepared.items.map((item, index) => ({
    record: {
      id: crypto.randomUUID(),
      paperId,
      kind: item.kind === 'pdf' ? 'pdf' : 'image',
      mimeType: item.mimeType,
      originalName: item.name,
      size: item.size,
      sha256: item.sha256,
      width: item.width ?? null,
      height: item.height ?? null,
      orderIndex: index,
      storedVariant: 'original', // 原本をそのまま保存（縮小版ではない）
      createdAt: now,
    },
    blob: new Blob([item.bytes], { type: item.mimeType }),
  }));

  const pages =
    prepared.kind === 'pdf'
      ? prepared.items[0].pages.map((pageInfo, index) => ({
          id: crypto.randomUUID(),
          paperId,
          sourceFileId: files[0].record.id,
          sourceIndex: index + 1, // PDFの何ページ目か（1から数える）
          orderIndex: index,
          kind: 'pdf',
          textStatus: pageInfo.textStatus, // 'has-text'（通常）または 'no-text'（スキャンの可能性）
          width: pageInfo.width,
          height: pageInfo.height,
          unit: 'pt',
          pageLabel: null, // 掲載ページ（確実に分かる場合だけ後で設定する）
          createdAt: now,
        }))
      : files.map(({ record }, index) => ({
          id: crypto.randomUUID(),
          paperId,
          sourceFileId: record.id,
          sourceIndex: 1,
          orderIndex: index,
          kind: 'image',
          textStatus: 'image', // 画像は文字情報を持たない（OCR対象）
          width: record.width,
          height: record.height,
          unit: 'px',
          pageLabel: null,
          createdAt: now,
        }));

  const paper = {
    id: paperId,
    schemaVersion: 1,
    title: trimmedTitle || null, // 未入力なら「未設定」。推測では埋めない
    displayName: prepared.items[0].name, // タイトル未設定のときに一覧で使う名前
    authors: [],
    year: null,
    journal: null,
    doi: null,
    sourceKind: prepared.kind,
    pageCount: pages.length,
    totalBytes: prepared.items.reduce((sum, item) => sum + item.size, 0),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    // クラウド移行用の情報：移行時は id と SHA-256 で照合し、重複や消失を防ぐ
    sync: { status: 'local-only', remoteId: null, syncedAt: null },
  };

  await savePaperBundle({ paper, files, pages });
  return paper;
}

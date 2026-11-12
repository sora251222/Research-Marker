// PDF.js（Mozilla 製のPDF表示ライブラリ）の準備と、よく使う処理をまとめる

import * as pdfjsLib from 'pdfjs-dist';
// ?url：ファイルの中身ではなく「配信されるURL」を受け取る Vite の書き方
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDFの解析は重いので、画面とは別の裏側の処理（Web Worker）で行う
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// 補助ファイルの場所（scripts/copy-pdfjs-assets.mjs が public/pdfjs/ にコピーする）
const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

/** この文字数以上の文字情報があるページを「通常のページ」とみなす（未満はスキャンページの可能性が高い） */
const MIN_TEXT_CHARS = 20;

/**
 * PDFのデータを読み込んで、PDF.js の文書オブジェクトを返す。
 * 注意：渡したデータは PDF.js の Worker に移されて使えなくなるため、必要ならコピーを渡す。
 * @param {Uint8Array} bytes
 */
export function loadPdfDocument(bytes) {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    isEvalSupported: false, // 安全のため、PDF内の文字列をプログラムとして評価しない
  });
  return loadingTask.promise;
}

/**
 * 使い終わったPDFを閉じ、Worker 側のメモリも解放する。
 * （PDF.js v6 では、文書ではなく「読み込み処理（loadingTask）」の destroy で解放する）
 */
export async function destroyPdfDocument(pdfDocument) {
  if (!pdfDocument) return;
  try {
    await pdfDocument.loadingTask.destroy();
  } catch {
    // すでに閉じている場合などは無視する
  }
}

/**
 * 1ページの大きさと、文字情報の有無を調べる。
 * @returns {Promise<{width: number, height: number, textStatus: 'has-text'|'no-text', charCount: number}>}
 */
export async function inspectPdfPage(pdfDocument, pageNumber) {
  const page = await pdfDocument.getPage(pageNumber);
  try {
    // scale: 1 のときの大きさ（単位はポイント。1ポイント = 1/72 インチ）。ページの回転も反映される
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const charCount = textContent.items.reduce(
      (count, item) => count + (item.str ? item.str.replace(/\s/g, '').length : 0),
      0
    );
    return {
      width: viewport.width,
      height: viewport.height,
      textStatus: charCount >= MIN_TEXT_CHARS ? 'has-text' : 'no-text',
      charCount,
    };
  } finally {
    page.cleanup(); // ページ単位の一時データを解放してメモリを節約する
  }
}

/**
 * 文字を選べるようにする「テキストレイヤー」を作る。
 * PDFの文字と同じ位置に、透明な文字を重ねる仕組み（見た目は canvas の絵のまま、選択だけできる）。
 * @param {object} options
 * @param {object} options.pdfDocument
 * @param {number} options.pageNumber 1から始まるページ番号
 * @param {HTMLElement} options.container 透明な文字を入れる要素（ページの台紙の中）
 * @param {number} options.cssWidth 画面上の幅（canvas と同じ値）
 * @returns {{promise: Promise<void>, cancel: () => void}}
 */
export function renderTextLayer({ pdfDocument, pageNumber, container, cssWidth }) {
  let textLayer = null;
  let cancelled = false;

  const promise = (async () => {
    const page = await pdfDocument.getPage(pageNumber);
    if (cancelled) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: cssWidth / baseViewport.width });

    // PDF.js のテキストレイヤーは、CSS 変数で拡大率を受け取る
    container.style.setProperty('--scale-factor', String(viewport.scale));
    container.style.setProperty('--user-unit', '1');
    container.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))');
    container.style.setProperty('--scale-round-x', '1px');
    container.style.setProperty('--scale-round-y', '1px');

    textLayer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    await textLayer.render();
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      textLayer?.cancel();
    },
  };
}

/** PDF.js のエラーを、利用者に分かる日本語のメッセージに変える */
export function describePdfError(error) {
  switch (error?.name) {
    case 'PasswordException':
      return 'パスワードで保護されたPDFは、現在は取り込めません。';
    case 'InvalidPDFException':
      return 'PDFファイルが壊れているか、正しいPDFではありません。';
    case 'MissingPDFException':
      return 'PDFのデータが見つかりません。';
    default:
      return `PDFを読み込めませんでした（${error?.message ?? '原因不明のエラー'}）。`;
  }
}

/**
 * PDFの1ページを canvas に描く。
 * @param {object} options
 * @param {object} options.pdfDocument PDF.js の文書
 * @param {number} options.pageNumber 1から始まるページ番号
 * @param {HTMLCanvasElement} options.canvas 描画先
 * @param {number} options.cssWidth 画面上の幅（CSSピクセル）
 * @param {number} options.maxCanvasPixels canvas の最大画素数（メモリ使用量の上限）
 * @returns {{promise: Promise<void>, cancel: () => void}}
 */
export function renderPdfPage({ pdfDocument, pageNumber, canvas, cssWidth, maxCanvasPixels }) {
  let renderTask = null;
  let cancelled = false;

  const promise = (async () => {
    const page = await pdfDocument.getPage(pageNumber);
    if (cancelled) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: cssWidth / baseViewport.width });

    // 高解像度の画面（Retina 等）ではくっきり描くため画素を増やす。ただし上限を超えないようにする
    const pixelRatio = window.devicePixelRatio || 1;
    const maxRatio = Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height));
    const outputScale = Math.max(0.5, Math.min(pixelRatio, maxRatio));

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    renderTask = page.render({
      canvas,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    });
    await renderTask.promise;
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      renderTask?.cancel();
    },
  };
}

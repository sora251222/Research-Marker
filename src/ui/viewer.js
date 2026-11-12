// 論文閲覧画面：PDF・画像の表示、ページ移動、拡大・縮小
// メモリを節約するため、表示中の1ページだけを描画する。

import { getPaperBundle, getFileBlob } from '../storage/paperRepository.js';
import { loadPdfDocument, renderPdfPage, describePdfError, destroyPdfDocument } from '../pdf/pdfjs.js';

// 拡大率の段階（1 = 表示エリアの幅に合わせた大きさ）
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM_INDEX = 2;
// canvas の画素数の上限（大きすぎるとメモリ不足でブラウザが落ちることがあるため）
const MAX_CANVAS_PIXELS = 12_000_000;

let elements;

// 表示中の論文の状態
const viewer = {
  loadToken: 0, // 読み込みのたびに増やし、古い処理の結果を捨てるための番号
  paperId: null,
  bundle: null, // { paper, files, pages }
  pdfDocument: null,
  pageIndex: 0,
  zoomIndex: DEFAULT_ZOOM_INDEX,
  imageUrls: new Map(), // 元ファイルID → 画像の表示用URL
  renderHandle: null,
  lastWidth: 0,
};

export function initViewer() {
  elements = {
    heading: document.getElementById('viewer-heading'),
    titleTag: document.getElementById('viewer-title-tag'),
    message: document.getElementById('viewer-message'),
    layout: document.getElementById('viewer-layout'),
    display: document.getElementById('document-display'),
    pageIndicator: document.getElementById('page-indicator'),
    zoomIndicator: document.getElementById('zoom-indicator'),
    prev: document.getElementById('page-prev'),
    next: document.getElementById('page-next'),
    zoomOut: document.getElementById('zoom-out'),
    zoomIn: document.getElementById('zoom-in'),
    pageStatus: document.getElementById('ocr-status'),
    bibTitle: document.querySelector('#bibliography [data-field="title"]'),
  };

  elements.prev.addEventListener('click', () => goToPage(viewer.pageIndex - 1));
  elements.next.addEventListener('click', () => goToPage(viewer.pageIndex + 1));
  elements.zoomOut.addEventListener('click', () => setZoom(viewer.zoomIndex - 1));
  elements.zoomIn.addEventListener('click', () => setZoom(viewer.zoomIndex + 1));

  // 表示エリアにフォーカスがあるときのキーボード操作
  elements.display.addEventListener('keydown', (event) => {
    const actions = {
      PageDown: () => goToPage(viewer.pageIndex + 1),
      PageUp: () => goToPage(viewer.pageIndex - 1),
      '+': () => setZoom(viewer.zoomIndex + 1),
      '-': () => setZoom(viewer.zoomIndex - 1),
    };
    const action = actions[event.key];
    if (action && viewer.bundle) {
      event.preventDefault();
      action();
    }
  });

  // 表示エリアの幅が変わったら（ウィンドウのサイズ変更・画面の回転）描き直す
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const width = elements.display.clientWidth;
      if (viewer.bundle && Math.abs(width - viewer.lastWidth) > 2) {
        renderCurrentPage();
      }
    }, 150);
  }).observe(elements.display);
}

/** 論文を開く。すでに同じ論文を開いていれば、描き直すだけにする */
export async function showPaperInViewer(paperId) {
  if (paperId && paperId === viewer.paperId && viewer.bundle) {
    renderCurrentPage();
    return;
  }

  closeViewer();
  const token = viewer.loadToken;
  viewer.paperId = paperId;

  if (!paperId) {
    showNotFound('論文ライブラリから、読みたい論文を選んでください。');
    return;
  }

  setHeading('読み込んでいます…', false);
  elements.message.hidden = true;
  elements.layout.hidden = false;
  showDisplayMessage('論文を読み込んでいます…');
  updateToolbar();

  try {
    const bundle = await getPaperBundle(paperId);
    if (token !== viewer.loadToken) return; // 別の論文が開かれたら、この結果は捨てる
    if (!bundle) {
      showNotFound('指定された論文が見つかりません。論文ライブラリから選び直してください。');
      return;
    }

    const { paper } = bundle;
    setHeading(paper.title ?? paper.displayName, !paper.title);
    elements.bibTitle.textContent = paper.title ?? '未取得';

    if (paper.sourceKind === 'pdf') {
      const blob = await getFileBlob(bundle.files[0].id);
      const pdfDocument = await loadPdfDocument(new Uint8Array(await blob.arrayBuffer()));
      if (token !== viewer.loadToken) {
        destroyPdfDocument(pdfDocument);
        return;
      }
      viewer.pdfDocument = pdfDocument;
    }

    viewer.bundle = bundle;
    viewer.pageIndex = 0;
    viewer.zoomIndex = DEFAULT_ZOOM_INDEX;
    await renderCurrentPage();
  } catch (error) {
    if (token !== viewer.loadToken) return;
    const message = error?.name?.endsWith('Exception') ? describePdfError(error) : `論文を表示できませんでした（${error?.message ?? '原因不明のエラー'}）。`;
    showDisplayMessage(message, true);
  }
}

/** 閲覧中の論文を閉じ、メモリを解放する（別の画面に移るときに呼ぶ） */
export function closeViewer() {
  viewer.loadToken += 1;
  viewer.renderHandle?.cancel();
  viewer.renderHandle = null;
  destroyPdfDocument(viewer.pdfDocument);
  viewer.pdfDocument = null;
  viewer.imageUrls.forEach((url) => URL.revokeObjectURL(url));
  viewer.imageUrls.clear();
  viewer.bundle = null;
  viewer.paperId = null;
  viewer.lastWidth = 0;
  releaseCanvases();
  if (elements) {
    elements.bibTitle.textContent = '未取得';
  }
}

function goToPage(index) {
  if (!viewer.bundle || index < 0 || index >= viewer.bundle.pages.length) return;
  viewer.pageIndex = index;
  renderCurrentPage();
  elements.display.scrollTo(0, 0);
}

function setZoom(index) {
  if (!viewer.bundle || index < 0 || index >= ZOOM_STEPS.length) return;
  viewer.zoomIndex = index;
  renderCurrentPage();
}

/** 表示中のページを描く */
async function renderCurrentPage() {
  if (!viewer.bundle) return;
  const token = viewer.loadToken;
  const page = viewer.bundle.pages[viewer.pageIndex];

  // 前の描画がまだ終わっていなければ止める（素早くページを送ったときの競合を防ぐ）
  viewer.renderHandle?.cancel();
  viewer.renderHandle = null;
  updateToolbar();

  // 表示エリアの幅（余白を除く）に、拡大率を掛けた大きさで描く。縦横比は元のページのまま
  const style = getComputedStyle(elements.display);
  const availableWidth =
    elements.display.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  viewer.lastWidth = elements.display.clientWidth;
  const cssWidth = Math.max(160, availableWidth) * ZOOM_STEPS[viewer.zoomIndex];
  const cssHeight = (cssWidth * page.height) / page.width;

  // ページの台紙（将来、この上に文字レイヤーやマーカーを重ねる）
  const surface = document.createElement('div');
  surface.className = 'page-surface';
  surface.style.width = `${cssWidth}px`;
  surface.style.height = `${cssHeight}px`;
  surface.dataset.pageId = page.id;

  try {
    if (page.kind === 'pdf') {
      const canvas = document.createElement('canvas');
      canvas.className = 'page-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${viewer.pageIndex + 1}ページ目`);
      surface.append(canvas);

      const handle = renderPdfPage({
        pdfDocument: viewer.pdfDocument,
        pageNumber: page.sourceIndex,
        canvas,
        cssWidth,
        maxCanvasPixels: MAX_CANVAS_PIXELS,
      });
      viewer.renderHandle = handle;
      await handle.promise;
    } else {
      const image = document.createElement('img');
      image.className = 'page-image';
      image.alt = `${viewer.pageIndex + 1}ページ目の画像`;
      image.src = await getImageUrl(page.sourceFileId);
      surface.append(image);
      await image.decode();
    }
  } catch (error) {
    if (error?.name === 'RenderingCancelledException' || token !== viewer.loadToken) {
      return; // 途中で止めた描画は、エラーとして扱わない
    }
    showDisplayMessage(`このページを表示できませんでした（${error?.message ?? '原因不明のエラー'}）。`, true);
    return;
  }

  if (token !== viewer.loadToken || viewer.bundle?.pages[viewer.pageIndex] !== page) {
    return; // 描いている間に別のページ・論文に移った
  }
  releaseCanvases();
  elements.display.replaceChildren(surface);
}

/** 画像の表示用URLを作る（同じ論文を開いている間は使い回す） */
async function getImageUrl(fileId) {
  if (!viewer.imageUrls.has(fileId)) {
    const blob = await getFileBlob(fileId);
    viewer.imageUrls.set(fileId, URL.createObjectURL(blob));
  }
  return viewer.imageUrls.get(fileId);
}

/** ページ番号・拡大率・ボタンの状態・文字情報の状態を更新する */
function updateToolbar() {
  const pages = viewer.bundle?.pages ?? [];
  const hasPaper = pages.length > 0;
  elements.pageIndicator.textContent = hasPaper ? `${viewer.pageIndex + 1} / ${pages.length} ページ` : '― / ― ページ';
  elements.zoomIndicator.textContent = `${Math.round(ZOOM_STEPS[viewer.zoomIndex] * 100)}%`;
  elements.prev.disabled = !hasPaper || viewer.pageIndex === 0;
  elements.next.disabled = !hasPaper || viewer.pageIndex >= pages.length - 1;
  elements.zoomOut.disabled = !hasPaper || viewer.zoomIndex === 0;
  elements.zoomIn.disabled = !hasPaper || viewer.zoomIndex === ZOOM_STEPS.length - 1;

  const statusText = {
    'has-text': 'このページ：文字情報あり（文字の選択・マーカーは開発予定）',
    'no-text': 'このページ：文字情報なし（スキャンの可能性。OCRは開発予定）',
    image: 'このページ：画像（OCRは開発予定）',
  };
  const page = pages[viewer.pageIndex];
  elements.pageStatus.textContent = page ? statusText[page.textStatus] : '';
}

function setHeading(text, isUntitled) {
  elements.heading.textContent = text;
  elements.titleTag.hidden = !isUntitled;
}

function showNotFound(message) {
  setHeading('論文が選択されていません', false);
  elements.message.textContent = message;
  elements.message.hidden = false;
  elements.layout.hidden = true;
}

function showDisplayMessage(text, isError = false) {
  releaseCanvases();
  const message = document.createElement('p');
  message.className = isError ? 'display-message display-message--error' : 'display-message';
  message.textContent = isError ? `エラー：${text}` : text;
  elements.display.replaceChildren(message);
}

/** 使い終わった canvas の画素データを解放する（メモリの節約） */
function releaseCanvases() {
  elements?.display.querySelectorAll('canvas').forEach((canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
}

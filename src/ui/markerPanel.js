// マーカーとメモ
//   ・本文の文字を選ぶ → 近くに出る色のメニュー（またはパネルのボタン）でマーカーを保存
//   ・ページの上にマーカーを描く（ページ正規化座標なので、拡大・縮小してもずれない）
//   ・右のパネルにマーカー一覧を表示し、選ぶとそのページへ移動してメモを書ける
//   ・メモは入力をやめて少しすると自動で保存する（保存の成功を確認してから「保存しました」と表示）

import { onViewerEvent, getCurrentPageInfo, goToPageById } from './viewer.js';
import { confirmAction } from './confirmDialog.js';
import { clientRectsToQuads, quadBounds, pointInQuad, compareHighlights } from '../highlights/geometry.js';
import { DEFAULT_MARKER_COLOR, colorLabel, isValidColor } from '../highlights/colors.js';
import {
  listHighlights,
  addHighlight,
  updateHighlight,
  softDeleteHighlight,
  HighlightConflictError,
} from '../storage/highlightRepository.js';
import { describeStorageError } from '../storage/db.js';
import { normalizeForSearch } from '../utils/search.js';
import { readPreference, writePreference } from '../utils/preferences.js';

const MAX_QUOTE_LENGTH = 5000; // 1つのマーカーで選べる文字数の上限
const CONTEXT_LENGTH = 40; // 前後の文字列（位置がずれたときの照合用）の長さ
const MEMO_SAVE_DELAY = 800; // 入力をやめてから自動保存するまでの時間（ミリ秒）
const SVG_NS = 'http://www.w3.org/2000/svg';

let elements;

const state = {
  paper: null,
  highlights: [], // 開いている論文のマーカー（削除されていないもの）
  selectedId: null, // パネルで選んでいるマーカー
  color: DEFAULT_MARKER_COLOR, // 新しく引くマーカーの色
  pendingSelection: null, // { range, text, textLayer } 今選ばれている本文の文字
  isCreating: false, // 保存中の二重クリック防止
  scrollToIdAfterRender: null, // ページ移動後にスクロールして見せるマーカー
  memo: { dirty: false, timer: null, saving: null },
};

export function initMarkerPanel() {
  elements = {
    display: document.getElementById('document-display'),
    toolbar: document.getElementById('selection-toolbar'),
    colors: document.getElementById('marker-colors'),
    addButton: document.getElementById('add-marker-button'),
    pageNote: document.getElementById('marker-page-note'),
    status: document.getElementById('marker-status'),
    list: document.getElementById('marker-list'),
    count: document.getElementById('marker-count'),
    memoTarget: document.getElementById('memo-target'),
    memoInput: document.getElementById('memo-input'),
    memoStatus: document.getElementById('memo-status'),
  };

  const savedColor = readPreference('markerColor', DEFAULT_MARKER_COLOR);
  setCurrentColor(isValidColor(savedColor) ? savedColor : DEFAULT_MARKER_COLOR);

  // 閲覧画面の出来事に合わせて動く
  onViewerEvent('paperOpened', handlePaperOpened);
  onViewerEvent('pageRendered', handlePageRendered);
  onViewerEvent('paperClosed', handlePaperClosed);

  // 文字の選択が変わったら、色のメニューを出す／隠す
  let selectionTimer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(captureSelection, 120);
  });

  // ボタンを押したときに、本文の選択が外れないようにする（mousedown の既定の動きを止める）
  [elements.toolbar, elements.addButton].forEach((element) =>
    element.addEventListener('mousedown', (event) => event.preventDefault())
  );

  elements.toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-color]');
    if (button) {
      setCurrentColor(button.dataset.color);
      createHighlightFromSelection(button.dataset.color);
    }
  });
  elements.addButton.addEventListener('click', () => createHighlightFromSelection(state.color));
  elements.colors.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-color]');
    if (button) setCurrentColor(button.dataset.color);
  });

  // ページの上のマーカーをクリックしたら、そのマーカーを選ぶ
  elements.display.addEventListener('click', handleDisplayClick);
  elements.display.addEventListener('scroll', hideToolbar);
  window.addEventListener('resize', hideToolbar);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideToolbar();
  });

  // マーカー一覧のボタン（選ぶ・削除）
  elements.list.addEventListener('click', (event) => {
    const selectButton = event.target.closest('button[data-select-id]');
    const deleteButton = event.target.closest('button[data-delete-id]');
    if (selectButton) selectHighlight(selectButton.dataset.selectId, { goToPage: true });
    if (deleteButton) deleteHighlight(deleteButton.dataset.deleteId);
  });

  // メモの自動保存
  elements.memoInput.addEventListener('input', () => {
    state.memo.dirty = true;
    setMemoStatus('入力中…（入力をやめると自動で保存します）');
    clearTimeout(state.memo.timer);
    state.memo.timer = setTimeout(saveMemo, MEMO_SAVE_DELAY);
  });
  elements.memoInput.addEventListener('blur', () => saveMemo());

  // 保存していないメモがあるままページを閉じようとしたら確認する
  window.addEventListener('beforeunload', (event) => {
    if (state.memo.dirty || state.memo.saving) {
      event.preventDefault();
    }
  });

  renderList();
  renderMemoEditor();
}

// ---------- 論文を開いた・ページを描いた・閉じた ----------

async function handlePaperOpened(bundle) {
  state.paper = bundle.paper;
  state.highlights = [];
  state.selectedId = null;
  hideStatus();
  renderList();
  renderMemoEditor();
  try {
    const highlights = await listHighlights(bundle.paper.id);
    if (state.paper?.id !== bundle.paper.id) return; // 読み込み中に別の論文に移った
    state.highlights = highlights.sort(compareHighlights);
  } catch (error) {
    showStatus('error', `マーカーを読み込めませんでした（${error?.message ?? '原因不明のエラー'}）。`);
  }
  renderList();
  redrawCurrentPage();
}

function handlePageRendered({ page, surface }) {
  state.pendingSelection = null;
  hideToolbar();
  drawHighlightLayer(surface, page.id);
  updateAddButton();

  // 文字情報がないページでは、マーカーを引けない理由を表示する
  const canMark = page.textStatus === 'has-text';
  elements.pageNote.hidden = canMark;
  elements.pageNote.textContent = canMark
    ? ''
    : 'このページには文字情報がないため、今はマーカーを引けません（OCR後に引けるようになります・OCRは開発予定）。';

  if (state.scrollToIdAfterRender) {
    scrollToHighlight(state.scrollToIdAfterRender, surface);
    state.scrollToIdAfterRender = null;
  }
}

function handlePaperClosed() {
  saveMemo(); // 保存していないメモがあれば保存する（完了を待たずに続ける）
  state.paper = null;
  state.highlights = [];
  state.selectedId = null;
  state.pendingSelection = null;
  hideToolbar();
  renderList();
  renderMemoEditor();
}

// ---------- 文字の選択 ----------

/** 今選ばれている文字が、表示中のページの本文の中なら覚えておき、色のメニューを出す */
function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    state.pendingSelection = null;
    hideToolbar();
    updateAddButton();
    return;
  }

  const range = selection.getRangeAt(0);
  const ancestor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  const textLayer = ancestor?.closest('.textLayer');
  const text = selection.toString();

  if (!textLayer || !elements.display.contains(textLayer) || !text.trim()) {
    state.pendingSelection = null;
    hideToolbar();
    updateAddButton();
    return;
  }

  state.pendingSelection = { range: range.cloneRange(), text, textLayer };
  updateAddButton();
  showToolbarNear(range);
}

function updateAddButton() {
  elements.addButton.disabled = !state.pendingSelection || state.isCreating;
}

/** 選ばれた文字の上（入らなければ下）に、色のメニューを出す */
function showToolbarNear(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
  if (rects.length === 0) return;
  const toolbar = elements.toolbar;
  toolbar.hidden = false;
  const { width, height } = toolbar.getBoundingClientRect();
  const first = rects[0];
  const last = rects[rects.length - 1];

  let top = first.top - height - 8;
  if (top < 8) top = last.bottom + 8;
  const left = Math.min(Math.max(first.left, 8), window.innerWidth - width - 8);
  toolbar.style.top = `${Math.round(top)}px`;
  toolbar.style.left = `${Math.round(left)}px`;
}

function hideToolbar() {
  if (elements) elements.toolbar.hidden = true;
}

// ---------- マーカーの作成 ----------

async function createHighlightFromSelection(color) {
  const pending = state.pendingSelection;
  const current = getCurrentPageInfo();
  if (!pending || !current || state.isCreating) return;

  const surface = pending.textLayer.closest('.page-surface');
  if (!surface || surface.dataset.pageId !== current.page.id) {
    showStatus('error', 'ページが切り替わったため、もう一度文字を選んでください。');
    return;
  }

  const quoteText = pending.text;
  if (quoteText.length > MAX_QUOTE_LENGTH) {
    showStatus('error', `一度に選べるのは ${MAX_QUOTE_LENGTH} 文字までです。範囲を分けてマーカーを引いてください。`);
    return;
  }

  const quads = clientRectsToQuads(textRectsInRange(pending.range, pending.textLayer), surface.getBoundingClientRect());
  if (quads.length === 0) {
    showStatus('error', '選んだ文字の位置を取得できませんでした。もう一度選び直してください。');
    return;
  }

  const now = new Date().toISOString();
  const highlight = {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    paperId: current.paper.id,
    pageId: current.page.id,
    pageIndex: current.page.orderIndex + 1, // 論文の何ページ目か（1から数える）
    sourcePageNumber: current.page.sourceIndex, // PDFの何ページ目か
    textSource: 'pdf-text', // 将来 OCR の文字には 'ocr' を入れる
    color,
    quads,
    quoteText, // 選んだ文字（取り出したまま。改変しない）
    quoteNormalized: normalizeForSearch(quoteText), // 検索用
    prefix: contextText(pending.textLayer, pending.range, 'before'),
    suffix: contextText(pending.textLayer, pending.range, 'after'),
    memo: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    clientRequestId: crypto.randomUUID(), // クラウド移行時の二重送信防止
    sync: { status: 'local-only', remoteId: null, syncedAt: null },
  };

  state.isCreating = true;
  updateAddButton();
  showStatus('progress', 'マーカーを保存しています…');
  try {
    const saved = await addHighlight(highlight);
    state.highlights = [...state.highlights, saved].sort(compareHighlights);
    window.getSelection()?.removeAllRanges();
    state.pendingSelection = null;
    hideToolbar();
    await selectHighlight(saved.id, { goToPage: false });
    showStatus('success', `マーカー（${colorLabel(color)}・${saved.pageIndex}ページ目）を保存しました。右の「メモ」に書き込めます。`);
  } catch (error) {
    showStatus('error', `マーカーを保存できませんでした。${describeStorageError(error)}`);
  } finally {
    state.isCreating = false;
    updateAddButton();
  }
}

/**
 * 選択範囲に含まれる文字だけの位置（画面上の長方形）を集める。
 * Range 全体の getClientRects() は、要素の枠など余分な長方形を含むことがあるため、
 * 文字のまとまり（テキストノード）ごとに切り出して測る。
 */
function textRectsInRange(range, root) {
  const rects = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const piece = document.createRange();
    piece.selectNodeContents(node);
    if (node === range.startContainer) piece.setStart(node, range.startOffset);
    if (node === range.endContainer) piece.setEnd(node, range.endOffset);
    if (!piece.collapsed) rects.push(...piece.getClientRects());
  }
  return rects;
}

/** 選んだ文字の前（before）または後ろ（after）の文字列を取り出す */
function contextText(root, range, side) {
  const context = document.createRange();
  context.selectNodeContents(root);
  if (side === 'before') {
    context.setEnd(range.startContainer, range.startOffset);
    return context.toString().slice(-CONTEXT_LENGTH);
  }
  context.setStart(range.endContainer, range.endOffset);
  return context.toString().slice(0, CONTEXT_LENGTH);
}

// ---------- ページの上にマーカーを描く ----------

function redrawCurrentPage() {
  const surface = elements.display.querySelector('.page-surface');
  if (surface) drawHighlightLayer(surface, surface.dataset.pageId);
}

/**
 * ページの台紙にマーカーを描く。
 * SVG の viewBox を 0〜1 にしているので、保存した正規化座標をそのまま使える。
 * 文字を選べるよう、テキストレイヤーより下（canvas の上）に置く。
 */
function drawHighlightLayer(surface, pageId) {
  surface.querySelector('.highlight-layer')?.remove();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'highlight-layer');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  for (const highlight of state.highlights.filter((item) => item.pageId === pageId)) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', `hl hl--${highlight.color}${highlight.id === state.selectedId ? ' is-selected' : ''}`);
    group.dataset.highlightId = highlight.id;
    for (const quad of highlight.quads) {
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('points', quad.map(([x, y]) => `${x},${y}`).join(' '));
      group.append(polygon);
    }
    svg.append(group);
  }

  const textLayer = surface.querySelector('.textLayer');
  surface.insertBefore(svg, textLayer ?? null);
}

/** ページの上をクリックした位置にマーカーがあれば、それを選ぶ */
function handleDisplayClick(event) {
  if (!window.getSelection()?.isCollapsed) return; // 文字を選んでいる最中は何もしない
  const surface = event.target.closest('.page-surface');
  if (!surface) return;
  const rect = surface.getBoundingClientRect();
  const point = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  const hit = state.highlights
    .filter((highlight) => highlight.pageId === surface.dataset.pageId)
    .reverse() // 後から引いたもの（上に描かれているもの）を優先する
    .find((highlight) => highlight.quads.some((quad) => pointInQuad(point, quad)));
  if (hit) {
    selectHighlight(hit.id, { goToPage: false, focusList: true });
  }
}

/** マーカーが見える位置まで、表示エリアをスクロールする */
function scrollToHighlight(highlightId, surface) {
  const highlight = state.highlights.find((item) => item.id === highlightId);
  if (!highlight || !surface) return;
  const bounds = quadBounds(highlight.quads[0]);
  // 表示エリアの中での、ページの台紙の上端の位置（スクロール量を含む）
  const display = elements.display;
  const surfaceTop = surface.getBoundingClientRect().top - display.getBoundingClientRect().top + display.scrollTop;
  const top = surfaceTop + bounds.y1 * surface.offsetHeight - 80; // 少し上に余白を残す
  display.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

// ---------- 選択・一覧 ----------

/**
 * マーカーを選ぶ。保存していないメモがあれば、先に保存する。
 * @param {string} highlightId
 * @param {{goToPage?: boolean, focusList?: boolean}} options
 */
async function selectHighlight(highlightId, { goToPage = false, focusList = false } = {}) {
  await saveMemo();
  state.selectedId = highlightId;
  renderList();
  renderMemoEditor();

  const highlight = state.highlights.find((item) => item.id === highlightId);
  const current = getCurrentPageInfo();
  if (goToPage && highlight && current && highlight.pageId !== current.page.id) {
    state.scrollToIdAfterRender = highlightId;
    await goToPageById(highlight.pageId); // 描き終わると handlePageRendered でスクロールする
  } else {
    redrawCurrentPage();
    if (goToPage) scrollToHighlight(highlightId, elements.display.querySelector('.page-surface'));
  }

  if (focusList) {
    elements.list.querySelector(`button[data-select-id="${highlightId}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

function renderList() {
  const highlights = state.highlights;
  elements.count.textContent = highlights.length > 0 ? `（${highlights.length}）` : '';

  if (highlights.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-message';
    empty.textContent = state.paper ? 'この論文にはまだマーカーがありません。' : 'マーカーはまだありません。';
    elements.list.replaceChildren(empty);
    return;
  }

  elements.list.replaceChildren(...highlights.map(createListItem));
}

function createListItem(highlight) {
  const item = document.createElement('li');
  item.className = 'marker-item';
  const isSelected = highlight.id === state.selectedId;
  item.classList.toggle('is-selected', isSelected);

  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'marker-item__main';
  selectButton.dataset.selectId = highlight.id;
  selectButton.setAttribute('aria-pressed', String(isSelected));

  const meta = document.createElement('span');
  meta.className = 'marker-item__meta';
  const chip = document.createElement('span');
  chip.className = `marker-dot marker-dot--${highlight.color}`;
  chip.setAttribute('aria-hidden', 'true');
  meta.append(chip, `${colorLabel(highlight.color)}・${highlight.pageIndex}ページ目`);
  if (highlight.memo) {
    const memoTag = document.createElement('span');
    memoTag.className = 'tag';
    memoTag.textContent = 'メモあり';
    meta.append(memoTag);
  }

  const quote = document.createElement('span');
  quote.className = 'marker-item__quote';
  quote.textContent = highlight.quoteText;

  selectButton.append(meta, quote);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'marker-item__delete button button--small';
  deleteButton.dataset.deleteId = highlight.id;
  deleteButton.textContent = '削除';
  deleteButton.setAttribute('aria-label', `${highlight.pageIndex}ページ目のマーカー「${highlight.quoteText.slice(0, 20)}」を削除`);

  item.append(selectButton, deleteButton);
  return item;
}

async function deleteHighlight(highlightId) {
  const highlight = state.highlights.find((item) => item.id === highlightId);
  if (!highlight) return;
  const confirmed = await confirmAction({
    title: 'マーカーを削除しますか？',
    message:
      `${highlight.pageIndex}ページ目のマーカー「${highlight.quoteText.slice(0, 60)}${highlight.quoteText.length > 60 ? '…' : ''}」` +
      `${highlight.memo ? 'と、そのメモ' : ''}を削除します。データはこのブラウザ内に残していますが、元に戻す画面は開発予定です。`,
    confirmLabel: '削除する',
  });
  if (!confirmed) return;

  try {
    if (highlightId === state.selectedId) {
      await saveMemo();
    }
    await softDeleteHighlight(highlightId);
    state.highlights = state.highlights.filter((item) => item.id !== highlightId);
    if (highlightId === state.selectedId) {
      state.selectedId = null;
      renderMemoEditor();
    }
    renderList();
    redrawCurrentPage();
    showStatus('success', 'マーカーを削除しました。');
  } catch (error) {
    showStatus('error', `マーカーを削除できませんでした（${error?.message ?? '原因不明のエラー'}）。`);
  }
}

// ---------- 色 ----------

function setCurrentColor(colorId) {
  state.color = colorId;
  writePreference('markerColor', colorId);
  elements.colors.querySelectorAll('button[data-color]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.color === colorId));
  });
  elements.addButton.textContent = `選択した文章にマーカーを引く（${colorLabel(colorId)}）`;
}

// ---------- メモ ----------

function renderMemoEditor() {
  const highlight = state.highlights.find((item) => item.id === state.selectedId);
  clearTimeout(state.memo.timer);
  state.memo.dirty = false;

  if (!highlight) {
    elements.memoInput.value = '';
    elements.memoInput.disabled = true;
    elements.memoTarget.textContent = 'マーカーを選ぶと、そのマーカーへのメモを書けます。';
    setMemoStatus('');
    return;
  }

  elements.memoInput.disabled = false;
  elements.memoInput.value = highlight.memo ?? '';
  const quote = highlight.quoteText.replace(/\s+/g, ' ').trim();
  elements.memoTarget.textContent =
    `${colorLabel(highlight.color)}・${highlight.pageIndex}ページ目「${quote.slice(0, 40)}${quote.length > 40 ? '…' : ''}」へのメモ`;
  setMemoStatus(highlight.memo ? `保存済み（${formatTime(highlight.updatedAt)}）` : '');
}

/**
 * 入力中のメモを保存する。保存が終わるまで待てる（別のマーカーを選ぶ前などに使う）。
 * 保存に失敗したときは、入力した内容を消さずに残し、エラーを表示する。
 */
async function saveMemo() {
  clearTimeout(state.memo.timer);
  if (state.memo.saving) {
    await state.memo.saving; // 保存中なら、終わるのを待ってから続ける
  }
  if (!state.memo.dirty) return;

  const highlight = state.highlights.find((item) => item.id === state.selectedId);
  if (!highlight) return;
  const memo = elements.memoInput.value;

  state.memo.saving = (async () => {
    setMemoStatus('保存しています…');
    try {
      const updated = await updateHighlight(highlight.id, { memo }, highlight.updatedAt);
      state.highlights = state.highlights.map((item) => (item.id === updated.id ? updated : item));
      // 保存している間に、さらに書き足していなければ「保存済み」にする
      if (elements.memoInput.value === memo && state.selectedId === updated.id) {
        state.memo.dirty = false;
        setMemoStatus(`保存しました（${formatTime(updated.updatedAt)}）`);
      }
      renderListKeepingFocus();
    } catch (error) {
      const message = error instanceof HighlightConflictError ? error.message : describeStorageError(error);
      setMemoStatus(`エラー：メモを保存できませんでした。入力した内容は残っています。${message}`, true);
    }
  })();

  try {
    await state.memo.saving;
  } finally {
    state.memo.saving = null;
  }
}

/** 一覧を作り直す（メモ欄に入力中ならフォーカスを奪わない） */
function renderListKeepingFocus() {
  const active = document.activeElement;
  renderList();
  if (active === elements.memoInput) elements.memoInput.focus();
}

function setMemoStatus(text, isError = false) {
  elements.memoStatus.textContent = text;
  elements.memoStatus.classList.toggle('is-error', isError);
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

// ---------- 状態メッセージ ----------

function showStatus(type, message) {
  const prefix = { progress: '処理中：', success: '完了：', error: 'エラー：' }[type];
  const label = document.createElement('strong');
  label.textContent = prefix;
  const text = document.createElement('span');
  text.textContent = message;
  elements.status.replaceChildren(label, text);
  elements.status.className = `status-message status-message--${type}`;
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
}

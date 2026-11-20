// アップロード中のファイル（進み具合・キャンセル・保存前の確認・保存）
// 流れ：ファイルを選ぶ → 確認（進み具合を表示）→ 保存前の確認（タイトル・画像の順番）→ 保存 → 完了の表示

import { analyzeFiles, saveImport, ImportError, ImportCancelledError } from '../import/importer.js';
import { moveItem } from '../import/fileValidation.js';
import { describeStorageError } from '../storage/db.js';
import { requestPersistentStorage } from '../storage/paperRepository.js';
import { formatBytes } from '../utils/format.js';
import { paperRouteHash } from '../router.js';
import { createIcon } from './icons.js';
import { autoFillBibliography } from '../metadata/autofill.js';
import { LookupError, METADATA_LOOKUP_AVAILABLE, LOOKUP_UNAVAILABLE_MESSAGE } from '../metadata/lookup.js';

let elements;
let prepared = null; // analyzeFiles の結果（保存前の状態）
let isBusy = false; // 確認中・保存中は、次の取り込みを受け付けない
let abortController = null; // 確認中のキャンセル用
let thumbnailUrls = []; // 画像のプレビュー用URL（使い終わったら解放する）
let onSavedCallback = () => {};

export function initImportPanel({ onSaved }) {
  onSavedCallback = onSaved;
  elements = {
    panel: document.getElementById('import-panel'),
    summary: document.getElementById('import-summary'),
    list: document.getElementById('import-file-list'),
    title: document.getElementById('import-title'),
    save: document.getElementById('import-save'),
    cancel: document.getElementById('import-cancel'),
    status: document.getElementById('upload-status'),
    queueEmpty: document.getElementById('upload-queue-empty'),
    progress: document.getElementById('upload-progress'),
    progressIcon: document.getElementById('upload-progress-icon'),
    progressName: document.getElementById('upload-progress-name'),
    progressBar: document.getElementById('upload-progress-bar'),
    progressText: document.getElementById('upload-progress-text'),
    progressCancel: document.getElementById('upload-progress-cancel'),
    dropZoneStatus: document.getElementById('drop-zone-status'),
  };

  elements.save.addEventListener('click', handleSave);
  elements.cancel.addEventListener('click', cancelImport);
  elements.progressCancel.addEventListener('click', cancelImport);

  // 画像の並べ替え・取り除くボタン（一覧の中のボタンをまとめて受け付ける）
  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || isBusy || !prepared) return;
    const index = Number(button.dataset.index);
    const { action } = button.dataset;
    if (action === 'up') prepared.items = moveItem(prepared.items, index, index - 1);
    if (action === 'down') prepared.items = moveItem(prepared.items, index, index + 1);
    if (action === 'remove') prepared.items = prepared.items.filter((_, i) => i !== index);
    renderPanel();
    // 動かした画像のボタンにフォーカスを戻し、続けてキーボードで操作できるようにする
    const nextIndex = action === 'up' ? index - 1 : action === 'down' ? index + 1 : Math.min(index, prepared.items.length - 1);
    const nextButton = elements.list.querySelector(`button[data-action="${action}"][data-index="${nextIndex}"]`);
    if (nextButton && !nextButton.disabled) {
      nextButton.focus();
    } else {
      elements.title.focus();
    }
  });

  // 保存中にページを閉じようとしたら確認する
  window.addEventListener('beforeunload', (event) => {
    if (isBusy) {
      event.preventDefault();
    }
  });
}

/** 確認中・保存中かどうか（ほかの画面部品が二重の取り込みを防ぐために使う） */
export function isImportBusy() {
  return isBusy;
}

/** ファイルが選ばれたときに呼ぶ。内容を調べて、保存前の確認を表示する */
export async function startImport(fileList) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return;
  if (isBusy) {
    showStatus('info', '別のファイルを処理中です。終わってからもう一度選んでください。');
    return;
  }

  closePanel();
  hideStatus();
  setBusy(true);
  abortController = new AbortController();
  showProgress(files);
  setDropZoneStatus(`「${files[0].name}」${files.length > 1 ? ` ほか${files.length - 1}件` : ''}を確認しています…`);
  reveal(elements.progress, 'nearest'); // 進み具合が画面の外にあるときは、見える位置までスクロールする

  try {
    prepared = await analyzeFiles(
      files,
      (message, fraction) => updateProgress(fraction, message),
      abortController.signal
    );
    updateProgress(1, '確認完了・保存前の確認待ち');
    renderPanel();
    showStatus('info', '内容を確認して「ライブラリに保存」を押してください。まだ保存されていません。');
    setDropZoneStatus('確認が終わりました。下の「保存前の確認」で「ライブラリに保存」を押してください。');
    reveal(elements.progress, 'start'); // 進み具合から保存ボタンまでが見えるようにする
    elements.title.focus({ preventScroll: true });
  } catch (error) {
    prepared = null;
    hideProgress();
    if (error instanceof ImportCancelledError) {
      showStatus('info', error.message);
      setDropZoneStatus('');
    } else if (error instanceof ImportError) {
      showStatus('error', error.message, error.existingPaperId);
      setDropZoneStatus('エラー：取り込めませんでした。理由は下に表示しています。');
    } else {
      showStatus('error', `ファイルを確認できませんでした（${error?.message ?? '原因不明のエラー'}）。`);
      setDropZoneStatus('エラー：取り込めませんでした。理由は下に表示しています。');
    }
    reveal(elements.status, 'nearest');
  } finally {
    abortController = null;
    setBusy(false);
  }
}

/** キャンセル：確認中なら処理を止め、確認待ちなら取り込みを取りやめる（保存中は止めない） */
function cancelImport() {
  if (abortController) {
    abortController.abort(); // 確認処理が次の区切りで止まる
    return;
  }
  if (isBusy) return; // 保存中は途中で止めない（半端な保存を防ぐため）
  closePanel();
  hideProgress();
  setDropZoneStatus('');
  showStatus('info', '取り込みを取り消しました。まだ何も保存されていません。');
}

async function handleSave() {
  if (isBusy || !prepared || prepared.items.length === 0) return;

  setBusy(true);
  updateProgress(1, '保存中…（このページを閉じないでください）');
  elements.progressCancel.disabled = true;
  try {
    const paper = await saveImport(prepared, { title: elements.title.value });
    // 保存と内容の確認が終わってから「完了」と表示する
    await requestPersistentStorage();
    closePanel();
    hideProgress();
    showStatus('success', '保存が完了しました（このブラウザ内に保存）。', paper.id, '開く');
    setDropZoneStatus('保存が完了しました。続けて別のファイルも追加できます。');
    reveal(elements.status, 'nearest');
    await onSavedCallback(paper);
    runAutoFillAfterSave(paper); // 書誌情報の自動取得は、保存とは別に裏側で進める（完了を待たない）
  } catch (error) {
    updateProgress(1, '保存できませんでした');
    showStatus('error', describeStorageError(error), error?.existingPaperId ?? null);
    reveal(elements.status, 'nearest');
  } finally {
    setBusy(false);
  }
}

// ---------- 保存後の書誌情報の自動取得 ----------

/**
 * 保存した論文の書誌情報を自動で探し、結果を保存完了の表示に書き足す。
 * 失敗しても論文の保存には影響しない（あとから論文を開いて取得し直せる）。
 */
async function runAutoFillAfterSave(paper) {
  const note = document.createElement('span');
  note.className = 'status-message__sub';
  elements.status.append(note);
  const say = (text) => {
    note.textContent = text;
  };

  if (!METADATA_LOOKUP_AVAILABLE) {
    say(LOOKUP_UNAVAILABLE_MESSAGE);
    return;
  }
  if (paper.sourceKind !== 'pdf') {
    say('画像の論文は、OCR（開発予定）ができるまで書誌情報を自動で読み取れません。論文を開くと、DOI やタイトルで探せます。');
    return;
  }

  say('書誌情報を自動で探しています…');
  try {
    const outcome = await autoFillBibliography(paper, (message) => say(message));
    if (outcome.status === 'applied') {
      say(
        outcome.appliedCount > 0
          ? `書誌情報を自動入力しました（取得元：${outcome.sources.join('・')}、${outcome.appliedCount}項目）。論文を開いて確認できます。`
          : '書誌情報を確認しました。'
      );
    } else if (outcome.status === 'needs-review') {
      say('書誌情報の候補が見つかりました。論文を開いて、内容を確認してから反映してください。');
    } else {
      say('書誌情報は自動で見つかりませんでした。論文を開くと、DOI やタイトルで探すか、手入力できます。');
    }
    await onSavedCallback(outcome.paper);
  } catch (error) {
    say(`書誌情報の自動取得はできませんでした（${error instanceof LookupError ? error.message : error?.message ?? '原因不明'}）。論文を開いて、あとから取得し直せます。`);
  }
}

// ---------- 進み具合の行 ----------

function showProgress(files) {
  const isPdf = files[0].name.toLowerCase().endsWith('.pdf');
  elements.progressIcon.replaceChildren(createIcon(isPdf ? 'pdf' : 'image'));
  elements.progressIcon.className = `upload-progress__icon upload-progress__icon--${isPdf ? 'pdf' : 'image'}`;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  elements.progressName.textContent =
    files.length === 1 ? files[0].name : `${files[0].name} ほか${files.length - 1}件（合計 ${formatBytes(totalBytes)}）`;
  elements.progressCancel.disabled = false;
  elements.progress.hidden = false;
  elements.queueEmpty.hidden = true;
  updateProgress(0, '準備中');
}

/** 進み具合を更新する。％は「確認処理の進み具合」を表す（読み込んだMB数ではない） */
function updateProgress(fraction, message) {
  const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  elements.progressBar.style.width = `${percent}%`;
  elements.progressBar.setAttribute('aria-valuenow', String(percent));
  elements.progressBar.setAttribute('aria-valuetext', `${percent}%、${message}`);
  elements.progressText.textContent = `${percent}%（${message}）`;
}

function hideProgress() {
  elements.progress.hidden = true;
  elements.queueEmpty.hidden = false;
}

// ---------- 保存前の確認 ----------

/** 保存前の確認の中身を作る */
function renderPanel() {
  const { items, kind } = prepared;
  releaseThumbnails();

  if (kind === 'pdf') {
    const pages = items[0].pages;
    const noTextCount = pages.filter((page) => page.textStatus === 'no-text').length;
    elements.summary.textContent =
      `PDF・${pages.length}ページ。文字情報のあるページ：${pages.length - noTextCount}、` +
      `文字情報のないページ（スキャンの可能性・OCRは開発予定）：${noTextCount}`;
  } else {
    elements.summary.textContent =
      `画像 ${items.length}枚を、1件の論文として登録します。上から順に1ページ目、2ページ目…になります。`;
  }

  elements.list.replaceChildren(...items.map((item, index) => createFileRow(item, index, items.length, kind)));
  elements.panel.hidden = false;
}

function createFileRow(item, index, total, kind) {
  const row = document.createElement('li');
  row.className = 'import-file';

  if (kind === 'images') {
    const order = document.createElement('span');
    order.className = 'import-file__order';
    order.textContent = `${index + 1}`;

    const url = URL.createObjectURL(new Blob([item.bytes], { type: item.mimeType }));
    thumbnailUrls.push(url);
    const thumbnail = document.createElement('img');
    thumbnail.className = 'import-file__thumb';
    thumbnail.src = url;
    thumbnail.alt = '';
    row.append(order, thumbnail);
  }

  const info = document.createElement('div');
  info.className = 'import-file__info';
  const name = document.createElement('span');
  name.className = 'import-file__name';
  name.textContent = item.name;
  const meta = document.createElement('span');
  meta.className = 'import-file__meta';
  const sizeText = item.width ? `${item.width} × ${item.height} px` : `${item.pages.length}ページ`;
  meta.textContent = `${formatBytes(item.size)}・${sizeText}`;
  info.append(name, meta);
  row.append(info);

  if (kind === 'images') {
    const actions = document.createElement('div');
    actions.className = 'import-file__actions';
    actions.append(
      createRowButton('up', index, '↑', `${index + 1}枚目を上へ移動`, index === 0),
      createRowButton('down', index, '↓', `${index + 1}枚目を下へ移動`, index === total - 1),
      createRowButton('remove', index, '取り除く', `${index + 1}枚目（${item.name}）を取り除く`, total === 1)
    );
    row.append(actions);
  }
  return row;
}

function createRowButton(action, index, text, label, disabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--small';
  button.dataset.action = action;
  button.dataset.index = String(index);
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  return button;
}

function closePanel() {
  prepared = null;
  releaseThumbnails();
  elements.list.replaceChildren();
  elements.title.value = '';
  elements.panel.hidden = true;
}

function releaseThumbnails() {
  thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbnailUrls = [];
}

function setBusy(busy) {
  isBusy = busy;
  elements.save.disabled = busy;
  elements.cancel.disabled = busy;
  elements.title.disabled = busy;
  document.getElementById('file-input').disabled = busy;
  document.getElementById('drop-zone').classList.toggle('is-disabled', busy);
}

// ---------- 画面の外にある表示を見せる ----------

/**
 * 要素が画面の外にあるときに、見える位置までスクロールする。
 * （狭い画面では、進み具合や保存ボタンがファイル選択ボタンより下の、画面の外に出るため）
 * @param {HTMLElement} element
 * @param {'start'|'nearest'} block start：要素の上端を画面の上に合わせる／nearest：見えるだけ動かす
 */
function reveal(element, block) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block, behavior: reduceMotion ? 'auto' : 'smooth' });
}

/** ファイル置き場の中に、処理状況を短く表示する（空文字なら隠す） */
function setDropZoneStatus(text) {
  elements.dropZoneStatus.textContent = text;
  elements.dropZoneStatus.hidden = !text;
  elements.dropZoneStatus.classList.toggle('is-error', text.startsWith('エラー'));
}

// ---------- 状態メッセージ ----------

/**
 * 状態メッセージを表示する。
 * @param {'progress'|'info'|'success'|'error'} type
 * @param {string} message
 * @param {string|null} paperId あれば「開く」リンクを付ける
 */
function showStatus(type, message, paperId = null, linkText = '登録済みの論文を開く') {
  const prefix = { progress: '処理中：', info: '確認：', success: '完了：', error: 'エラー：' }[type];
  const label = document.createElement('strong');
  label.textContent = prefix;
  const text = document.createElement('span');
  text.textContent = message;
  elements.status.replaceChildren(label, text);

  if (paperId) {
    const link = document.createElement('a');
    link.href = paperRouteHash(paperId);
    link.textContent = linkText;
    link.className = 'status-message__link';
    elements.status.append(' ', link);
  }
  elements.status.className = `status-message status-message--${type}`;
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
}

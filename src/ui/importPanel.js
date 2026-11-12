// 取り込み確認パネル
// ファイルを選ぶ → 確認（画像の並べ替え・タイトル入力）→ 「ライブラリに保存」→ 保存完了の確認、の流れを担当する。

import { analyzeFiles, saveImport, ImportError } from '../import/importer.js';
import { moveItem } from '../import/fileValidation.js';
import { describeStorageError } from '../storage/db.js';
import { requestPersistentStorage } from '../storage/paperRepository.js';
import { formatBytes } from '../utils/format.js';
import { paperRouteHash } from '../router.js';

let elements;
let prepared = null; // analyzeFiles の結果（保存前の状態）
let isBusy = false; // 処理中は二重に実行しない
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
  };

  elements.save.addEventListener('click', handleSave);
  elements.cancel.addEventListener('click', () => {
    if (isBusy) return;
    closePanel();
    hideStatus();
  });

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

/** ファイルが選ばれたときに呼ぶ。内容を調べて確認パネルを表示する */
export async function startImport(fileList) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0 || isBusy) return;

  closePanel();
  setBusy(true);
  showStatus('progress', 'ファイルを確認しています…');
  try {
    prepared = await analyzeFiles(files, (message) => showStatus('progress', message));
    renderPanel();
    showStatus('info', '内容を確認して「ライブラリに保存」を押してください。まだ保存されていません。');
    elements.title.focus();
  } catch (error) {
    prepared = null;
    if (error instanceof ImportError) {
      showStatus('error', error.message, error.existingPaperId);
    } else {
      showStatus('error', `ファイルを確認できませんでした（${error?.message ?? '原因不明のエラー'}）。`);
    }
  } finally {
    setBusy(false);
  }
}

async function handleSave() {
  if (isBusy || !prepared || prepared.items.length === 0) return;

  setBusy(true);
  showStatus('progress', '保存しています…。完了するまでページを閉じないでください。');
  try {
    const paper = await saveImport(prepared, { title: elements.title.value });
    // 保存と内容の確認が終わってから「完了」と表示する
    await requestPersistentStorage();
    closePanel();
    showStatus('success', '保存が完了しました（このブラウザ内に保存）。', paper.id, '開く');
    await onSavedCallback(paper);
  } catch (error) {
    showStatus('error', describeStorageError(error), error?.existingPaperId ?? null);
  } finally {
    setBusy(false);
  }
}

/** 確認パネルの中身を作る */
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
}

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

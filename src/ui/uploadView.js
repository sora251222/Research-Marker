// 論文の格納（アップロード）画面
//   ・ファイルを置く場所（ドラッグ＆ドロップ／ファイルを選択）
//   ・格納された論文の表（並べ替え・選択・削除）
//   ・保存容量の目安
// 取り込みの進み具合と保存は importPanel.js が担当する。

import { appState } from '../state.js';
import { startImport } from './importPanel.js';
import { confirmAction } from './confirmDialog.js';
import { createIcon } from './icons.js';
import { sortPapers, paperDisplayTitle } from '../utils/papers.js';
import { formatBytes, formatDateTime } from '../utils/format.js';
import { paperRouteHash } from '../router.js';
import { softDeletePapers, getStorageStatus } from '../storage/paperRepository.js';

let elements;
let onChangedCallback = async () => {};
const sortState = { key: 'createdAt', direction: 'descending' }; // 既定：登録日時の新しい順
const selectedIds = new Set(); // チェックを入れた論文のID

export function initUploadView({ onChanged }) {
  onChangedCallback = onChanged;
  elements = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    tableBody: document.getElementById('stored-table-body'),
    table: document.getElementById('stored-table'),
    selectAll: document.getElementById('select-all'),
    deleteButton: document.getElementById('delete-selected'),
    count: document.getElementById('stored-count'),
    empty: document.getElementById('stored-empty'),
    status: document.getElementById('stored-status'),
    storageUsage: document.getElementById('storage-usage'),
  };

  // 「ファイルを選択」で選んだとき
  elements.fileInput.addEventListener('change', () => {
    const files = Array.from(elements.fileInput.files ?? []);
    elements.fileInput.value = ''; // 同じファイルをもう一度選んだときも反応するように空に戻す
    startImport(files);
  });

  setUpDragAndDrop();

  // 表の見出しの並べ替えボタン
  elements.table.querySelectorAll('.sort-button').forEach((button) => {
    button.addEventListener('click', () => {
      const { sortKey } = button.dataset;
      if (sortState.key === sortKey) {
        sortState.direction = sortState.direction === 'ascending' ? 'descending' : 'ascending';
      } else {
        sortState.key = sortKey;
        sortState.direction = sortKey === 'createdAt' ? 'descending' : 'ascending';
      }
      renderStoredTable();
    });
  });

  // すべて選択／選択解除
  elements.selectAll.addEventListener('change', () => {
    appState.papers.forEach((paper) => {
      if (elements.selectAll.checked) selectedIds.add(paper.id);
      else selectedIds.delete(paper.id);
    });
    renderStoredTable();
  });

  // 行のチェックボックスと「…」メニューの削除ボタン
  elements.tableBody.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-paper-id]');
    if (!checkbox) return;
    if (checkbox.checked) selectedIds.add(checkbox.dataset.paperId);
    else selectedIds.delete(checkbox.dataset.paperId);
    updateSelectionControls();
  });
  elements.tableBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-delete-id]');
    if (button) {
      button.closest('details')?.removeAttribute('open');
      deletePapers([button.dataset.deleteId]);
    }
  });
  // 「…」メニューは1つだけ開くようにする
  elements.tableBody.addEventListener('toggle', (event) => {
    if (event.target.open) {
      elements.tableBody.querySelectorAll('details[open]').forEach((menu) => {
        if (menu !== event.target) menu.removeAttribute('open');
      });
    }
  }, true);

  elements.deleteButton.addEventListener('click', () => deletePapers([...selectedIds]));
}

/** ドラッグ＆ドロップでファイルを受け取る */
function setUpDragAndDrop() {
  const zone = elements.dropZone;
  let dragDepth = 0; // 子要素の上を通るときの出入りを数えて、ちらつきを防ぐ

  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault(); // これがないと drop が起きない
    event.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) zone.classList.remove('is-dragover');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    zone.classList.remove('is-dragover');
    startImport(Array.from(event.dataTransfer?.files ?? []));
  });

  // 置き場所以外にファイルを落としたとき、ブラウザがそのファイルを開いて画面が切り替わるのを防ぐ
  window.addEventListener('dragover', (event) => {
    if (!zone.contains(event.target)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!zone.contains(event.target)) event.preventDefault();
  });
}

/** 格納された論文の表を作り直す */
export function renderStoredTable() {
  const papers = sortPapers(appState.papers, sortState.key, sortState.direction);

  // もう存在しない論文の選択は外す
  const existingIds = new Set(papers.map((paper) => paper.id));
  [...selectedIds].forEach((id) => {
    if (!existingIds.has(id)) selectedIds.delete(id);
  });

  elements.tableBody.replaceChildren(...papers.map(createRow));
  elements.count.textContent = `（この端末に保存中：${papers.length}件）`;
  elements.empty.hidden = papers.length > 0;
  elements.table.hidden = papers.length === 0;

  // 見出しの並べ替えの状態（読み上げソフト用の aria-sort と、目で見える矢印）
  elements.table.querySelectorAll('th[data-sort-key]').forEach((header) => {
    const active = header.dataset.sortKey === sortState.key;
    header.setAttribute('aria-sort', active ? sortState.direction : 'none');
    header.querySelector('.sort-mark').textContent = active ? (sortState.direction === 'ascending' ? '▲' : '▼') : '↕';
  });

  updateSelectionControls();
}

function createRow(paper) {
  const row = document.createElement('tr');
  const title = paperDisplayTitle(paper);

  // 選択
  const checkCell = document.createElement('td');
  checkCell.className = 'data-table__check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.paperId = paper.id;
  checkbox.checked = selectedIds.has(paper.id);
  checkbox.setAttribute('aria-label', `「${title}」を選択`);
  checkCell.append(checkbox);

  // タイトル（アイコン＋リンク）
  const titleCell = document.createElement('td');
  titleCell.className = 'data-table__title';
  const link = document.createElement('a');
  link.href = paperRouteHash(paper.id);
  link.append(createIcon(paper.sourceKind === 'pdf' ? 'pdf' : 'image'));
  const titleText = document.createElement('span');
  titleText.textContent = title;
  link.append(titleText);
  titleCell.append(link);
  if (!paper.title) {
    const untitled = document.createElement('span');
    untitled.className = 'tag tag--muted';
    untitled.textContent = 'タイトル未設定';
    titleCell.append(untitled);
  }

  const kindCell = createCell('', paper.sourceKind === 'pdf' ? 'PDF' : `画像（${paper.pageCount}枚）`, 'tag');
  kindCell.dataset.label = '形式';
  const pagesCell = createCell('', `${paper.pageCount}ページ`);
  pagesCell.dataset.label = 'ページ数';
  const sizeCell = createCell('', formatBytes(paper.totalBytes));
  sizeCell.dataset.label = 'サイズ';
  const dateCell = createCell('', formatDateTime(paper.createdAt));
  dateCell.dataset.label = '登録日時';

  row.append(checkCell, titleCell, kindCell, pagesCell, sizeCell, dateCell, createMenuCell(paper, title));
  return row;
}

function createCell(className, text, innerClass) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  if (innerClass) {
    const span = document.createElement('span');
    span.className = innerClass;
    span.textContent = text;
    cell.append(span);
  } else {
    cell.textContent = text;
  }
  return cell;
}

/** 行の「…」メニュー（開く・削除）。details/summary で開閉する */
function createMenuCell(paper, title) {
  const cell = document.createElement('td');
  cell.className = 'data-table__menu';
  const menu = document.createElement('details');
  menu.className = 'row-menu';
  const summary = document.createElement('summary');
  summary.className = 'icon-button';
  summary.setAttribute('aria-label', `「${title}」の操作`);
  summary.append(createIcon('more'));

  const list = document.createElement('div');
  list.className = 'row-menu__list';
  const open = document.createElement('a');
  open.href = paperRouteHash(paper.id);
  open.className = 'row-menu__item';
  open.textContent = '開く';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'row-menu__item row-menu__item--danger';
  remove.dataset.deleteId = paper.id;
  remove.textContent = '削除';
  list.append(open, remove);

  menu.append(summary, list);
  cell.append(menu);
  return cell;
}

/** 選択数に合わせて「削除」ボタンと「すべて選択」の状態を更新する */
function updateSelectionControls() {
  const total = appState.papers.length;
  const count = selectedIds.size;
  elements.deleteButton.disabled = count === 0;
  elements.deleteButton.lastChild.textContent = count > 0 ? ` 削除（${count}件）` : ' 削除';
  elements.selectAll.checked = total > 0 && count === total;
  elements.selectAll.indeterminate = count > 0 && count < total; // 一部だけ選択中の表示
}

/** 確認してから論文を削除する（論理削除：データは消さずに一覧から外す） */
async function deletePapers(paperIds) {
  if (paperIds.length === 0) return;
  const titles = paperIds
    .map((id) => appState.papers.find((paper) => paper.id === id))
    .filter(Boolean)
    .map((paper) => `「${paperDisplayTitle(paper)}」`);
  const titleText = titles.length <= 2 ? titles.join('、') : `${titles.slice(0, 2).join('、')} ほか${titles.length - 2}件`;

  const confirmed = await confirmAction({
    title: `${paperIds.length}件の論文を削除しますか？`,
    message:
      `${titleText}をライブラリから削除します。削除した論文は一覧に表示されなくなります。` +
      'データ自体はこのブラウザ内に残していますが、元に戻す画面は開発予定です。',
    confirmLabel: '削除する',
  });
  if (!confirmed) return;

  try {
    await softDeletePapers(paperIds);
    paperIds.forEach((id) => selectedIds.delete(id));
    showStoredStatus('success', `${paperIds.length}件の論文を削除しました。`);
    await onChangedCallback();
  } catch (error) {
    showStoredStatus('error', `削除できませんでした（${error?.message ?? '原因不明のエラー'}）。`);
  }
}

function showStoredStatus(type, message) {
  const label = document.createElement('strong');
  label.textContent = type === 'error' ? 'エラー：' : '完了：';
  const text = document.createElement('span');
  text.textContent = message;
  elements.status.replaceChildren(label, text);
  elements.status.className = `status-message status-message--${type}`;
  elements.status.hidden = false;
}

/** ブラウザ内の保存容量の目安を表示する */
export async function updateStorageUsage() {
  const { usage, quota, persisted } = await getStorageStatus();
  const parts = [];
  if (usage !== null && quota !== null) {
    parts.push(`このブラウザでの使用量：${formatBytes(usage)}（上限の目安 ${formatBytes(quota)}）`);
  }
  if (persisted === true) {
    parts.push('容量不足時に自動で消されにくい設定：有効');
  } else if (persisted === false) {
    parts.push('容量不足時に自動で消されにくい設定：未設定');
  }
  elements.storageUsage.textContent = parts.join('／');
}

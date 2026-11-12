// 論文ライブラリ画面：論文一覧の表示・検索・ファイル選択・保存場所の案内

import { appState } from '../state.js';
import { filterPapers } from '../utils/search.js';
import { formatBytes, formatDateTime } from '../utils/format.js';
import { paperRouteHash } from '../router.js';
import { listPapers, getStorageStatus } from '../storage/paperRepository.js';
import { startImport } from './importPanel.js';

let listElement;
let resultCountElement;
let storageUsageElement;
let loadError = null; // 一覧を読み込めなかったときのメッセージ

export function initLibrary() {
  listElement = document.getElementById('paper-list');
  resultCountElement = document.getElementById('search-result-count');
  storageUsageElement = document.getElementById('storage-usage');

  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const fileInput = document.getElementById('file-input');

  // 入力するたびに一覧を絞り込む（ボタンを押す必要はない）
  searchInput.addEventListener('input', () => {
    appState.searchQuery = searchInput.value;
    renderPaperList();
  });

  // Enter キーでフォームが送信され、ページが再読み込みされるのを防ぐ
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    // 同じファイルをもう一度選んだときも change が起きるように、選択を空に戻す
    fileInput.value = '';
    startImport(files);
  });

  renderPaperList();
}

/** 保存されている論文を読み込み直して、一覧と容量の表示を更新する */
export async function refreshLibrary() {
  try {
    appState.papers = await listPapers();
    loadError = null;
  } catch (error) {
    loadError = `保存されている論文を読み込めませんでした（${error?.message ?? '原因不明のエラー'}）。`;
  }
  renderPaperList();
  await updateStorageUsage();
}

/** 検索語に合う論文だけを一覧に表示する */
export function renderPaperList() {
  const matchedPapers = filterPapers(appState.papers, appState.searchQuery);
  const query = appState.searchQuery.trim();

  // 一覧を作り直す。文字は textContent で入れる（外部の文字列をHTMLとして解釈させない安全な方法）
  listElement.replaceChildren(...matchedPapers.map(createPaperItem));

  resultCountElement.classList.toggle('is-error', Boolean(loadError));
  if (loadError) {
    resultCountElement.textContent = loadError;
  } else if (appState.papers.length === 0) {
    resultCountElement.textContent = '論文はまだ登録されていません。「PDF・画像を追加」から登録できます。';
  } else if (matchedPapers.length === 0) {
    resultCountElement.textContent = `「${query}」に一致する論文はありません。`;
  } else if (query) {
    resultCountElement.textContent = `${appState.papers.length}件中 ${matchedPapers.length}件が一致しました。`;
  } else {
    resultCountElement.textContent = `${appState.papers.length}件の論文`;
  }
}

/** 論文1件分の一覧項目（<li>）を作る */
function createPaperItem(paper) {
  const item = document.createElement('li');
  item.className = 'paper-item';

  const article = document.createElement('article');
  article.dataset.paperId = paper.id;

  const title = document.createElement('h4');
  title.className = 'paper-title';
  const link = document.createElement('a');
  link.href = paperRouteHash(paper.id);
  // タイトルが未設定なら、ファイル名を表示する（タイトルを推測では作らない）
  link.textContent = paper.title ?? paper.displayName;
  title.append(link);

  const meta = document.createElement('p');
  meta.className = 'paper-meta';
  const kindText = paper.sourceKind === 'pdf' ? `PDF・${paper.pageCount}ページ` : `画像・${paper.pageCount}枚`;
  meta.append(
    createSpan('', kindText),
    createSpan('', formatBytes(paper.totalBytes)),
    createSpan('', `登録 ${formatDateTime(paper.createdAt)}`)
  );
  if (!paper.title) {
    meta.append(createSpan('tag tag--muted', 'タイトル未設定'));
  }
  meta.append(createSpan('tag', 'このブラウザに保存'));

  article.append(title, meta);
  item.append(article);
  return item;
}

function createSpan(className, text) {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

/** ブラウザ内の保存容量の目安を表示する */
async function updateStorageUsage() {
  const { usage, quota, persisted } = await getStorageStatus();
  const parts = [];
  if (usage !== null && quota !== null) {
    parts.push(`このブラウザでの使用量：${formatBytes(usage)}（上限の目安 ${formatBytes(quota)}）`);
  }
  if (persisted === true) {
    parts.push('容量不足時に自動で消されにくい設定：有効');
  } else if (persisted === false) {
    parts.push('容量不足時に自動で消されにくい設定：未設定（ブラウザが許可しない場合があります）');
  }
  storageUsageElement.textContent = parts.join('／');
}

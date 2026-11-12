// 論文ライブラリ画面：論文一覧の表示・検索・ファイル選択

import { appState } from '../state.js';
import { filterPapers } from '../utils/search.js';
import { paperRouteHash } from '../router.js';

let listElement;
let resultCountElement;
let uploadStatusElement;

export function initLibrary() {
  listElement = document.getElementById('paper-list');
  resultCountElement = document.getElementById('search-result-count');
  uploadStatusElement = document.getElementById('upload-status');

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
    showSelectedFiles(fileInput.files);
    // 同じファイルをもう一度選んだときも change が起きるように、選択を空に戻す
    fileInput.value = '';
  });

  renderPaperList();
}

/** 検索語に合う論文だけを一覧に表示する */
export function renderPaperList() {
  const matchedPapers = filterPapers(appState.papers, appState.searchQuery);
  const query = appState.searchQuery.trim();

  // 一覧を作り直す。文字は textContent で入れる（外部の文字列をHTMLとして解釈させない安全な方法）
  listElement.replaceChildren(...matchedPapers.map(createPaperItem));

  if (appState.papers.length === 0) {
    resultCountElement.textContent = '論文はまだ登録されていません。';
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
  link.textContent = paper.title;
  title.append(link);

  const meta = document.createElement('p');
  meta.className = 'paper-meta';
  meta.append(
    createSpan('paper-authors', paper.authors.join(', ')),
    createSpan('paper-journal', paper.journal),
    createSpan('paper-year', `${paper.year}年`),
    createSpan('tag', paper.fileTypeLabel)
  );
  if (paper.isSample) {
    meta.append(createSpan('tag tag--sample', 'サンプル'));
  }

  article.append(title, meta);
  item.append(article);
  return item;
}

function createSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/**
 * ファイルが選ばれたときの表示。
 * フェーズ1では読み込み・保存をしないので、「まだ登録されていない」ことをはっきり伝える。
 */
function showSelectedFiles(fileList) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) {
    uploadStatusElement.hidden = true;
    return;
  }

  const names = files.map((file) => file.name).join('、');
  uploadStatusElement.textContent =
    `${files.length}件のファイルを選択しました（${names}）。` +
    'ファイルの読み込み・保存は次のフェーズで実装予定のため、まだ論文として登録されていません。';
  uploadStatusElement.hidden = false;
}

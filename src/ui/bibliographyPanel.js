// 書誌情報（表示・手入力での編集）と参考文献（生成・コピー・書式の設定）
// 書誌情報は推測で埋めない。入力されていない項目は「未入力」と表示し、参考文献では「不足」として知らせる。

import { onViewerEvent, updateCurrentPaper } from './viewer.js';
import { formatVancouver, formatPages, resolveStyle, DEFAULT_CITATION_SETTINGS, ET_AL_OPTIONS } from '../citation/vancouver.js';
import { updatePaperBibliography, PaperConflictError } from '../storage/paperRepository.js';
import { describeStorageError } from '../storage/db.js';
import { readPreference, writePreference } from '../utils/preferences.js';
import { formatDateTime } from '../utils/format.js';
import { readBibliographyForm } from '../citation/bibliographyForm.js';

let elements;
let onChangedCallback = async () => {};
let currentPaper = null;
let isSaving = false;
let settings = { ...DEFAULT_CITATION_SETTINGS };

// フォームの入力欄と、論文データの項目の対応
const TEXT_FIELDS = {
  'bib-title': 'title',
  'bib-journal': 'journal',
  'bib-journal-abbr': 'journalAbbr',
  'bib-year': 'year',
  'bib-volume': 'volume',
  'bib-issue': 'issue',
  'bib-page-start': 'pageStart',
  'bib-page-end': 'pageEnd',
  'bib-article-number': 'articleNumber',
  'bib-doi': 'doi',
  'bib-title-en': 'titleEn',
  'bib-journal-abbr-nlm': 'journalAbbrNlm',
};
const LIST_FIELDS = { 'bib-authors': 'authors', 'bib-authors-en': 'authorsEn' };

export function initBibliographyPanel({ onChanged }) {
  onChangedCallback = onChanged;
  elements = {
    list: document.getElementById('bibliography'),
    editButton: document.getElementById('bib-edit'),
    status: document.getElementById('bib-status'),
    form: document.getElementById('bib-form'),
    formError: document.getElementById('bib-form-error'),
    save: document.getElementById('bib-save'),
    cancel: document.getElementById('bib-cancel'),
    language: document.getElementById('bib-language'),
    citationOutput: document.getElementById('citation-output'),
    citationStyleLabel: document.getElementById('citation-style-label'),
    citationMissing: document.getElementById('citation-missing'),
    copyButton: document.getElementById('citation-copy'),
    copyStatus: document.getElementById('citation-copy-status'),
    styleSelect: document.getElementById('citation-style'),
    etAlSelect: document.getElementById('citation-etal'),
    abbreviateCheckbox: document.getElementById('citation-abbreviate-pages'),
    doiCheckbox: document.getElementById('citation-include-doi'),
  };

  loadSettings();

  onViewerEvent('paperOpened', (bundle) => {
    currentPaper = bundle.paper;
    closeForm();
    hideStatus();
    renderAll();
  });
  onViewerEvent('paperClosed', () => {
    currentPaper = null;
    closeForm();
    renderAll();
  });

  elements.editButton.addEventListener('click', openForm);
  elements.cancel.addEventListener('click', () => {
    closeForm();
    elements.editButton.focus();
  });
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault(); // ページの再読み込みを防ぎ、JavaScript で保存する
    saveForm();
  });

  elements.copyButton.addEventListener('click', copyCitation);

  // 書式の設定が変わったら、記憶して参考文献を作り直す
  [elements.styleSelect, elements.etAlSelect, elements.abbreviateCheckbox, elements.doiCheckbox].forEach((control) =>
    control.addEventListener('change', () => {
      settings = {
        style: elements.styleSelect.value,
        etAl: elements.etAlSelect.value,
        abbreviatePages: elements.abbreviateCheckbox.checked,
        includeDoi: elements.doiCheckbox.checked,
      };
      writePreference('citationSettings', settings);
      renderCitation();
    })
  );

  renderAll();
}

function renderAll() {
  renderBibliography();
  renderCitation();
}

// ---------- 書誌情報の表示 ----------

function renderBibliography() {
  const paper = currentPaper ?? {};
  const pagesText = formatPages(paper, false);
  const rows = [
    ['タイトル', paper.title],
    ['著者', (paper.authors ?? []).join('、')],
    ['発行年', paper.year],
    ['雑誌名', paper.journal],
    ['略誌名', paper.journalAbbr],
    ['巻・号', [paper.volume ? `${paper.volume}巻` : '', paper.issue ? `${paper.issue}号` : ''].filter(Boolean).join(' ')],
    ['ページ', pagesText],
    ['DOI', paper.doi],
    ['言語', currentPaper ? (paper.language === 'en' ? '英語' : '日本語') : ''],
  ];

  elements.list.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      const text = value === null || value === undefined ? '' : String(value).trim();
      detail.textContent = text || '未入力';
      detail.classList.toggle('is-empty', !text);
      row.append(term, detail);
      return row;
    })
  );

  // 手入力した項目があれば、その旨と最終更新日時を表示する
  const sources = Object.values(currentPaper?.fieldSources ?? {});
  if (sources.length > 0) {
    const latest = sources.map((source) => source.at).sort().pop();
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = '取得元';
    const detail = document.createElement('dd');
    detail.textContent = `手入力（最終更新 ${formatDateTime(latest)}）`;
    row.append(term, detail);
    elements.list.append(row);
  }

  elements.editButton.disabled = !currentPaper || !elements.form.hidden;
}

// ---------- 書誌情報の編集 ----------

function openForm() {
  if (!currentPaper) return;
  elements.language.value = currentPaper.language === 'en' ? 'en' : 'ja';
  for (const [id, field] of Object.entries(TEXT_FIELDS)) {
    document.getElementById(id).value = currentPaper[field] ?? '';
  }
  for (const [id, field] of Object.entries(LIST_FIELDS)) {
    document.getElementById(id).value = (currentPaper[field] ?? []).join('\n');
  }
  elements.formError.hidden = true;
  elements.form.hidden = false;
  elements.editButton.disabled = true;
  hideStatus();
  document.getElementById('bib-title').focus();
}

function closeForm() {
  elements.form.hidden = true;
  elements.formError.hidden = true;
  elements.editButton.disabled = !currentPaper;
}

async function saveForm() {
  if (!currentPaper || isSaving) return;

  const values = { language: elements.language.value };
  for (const [id, field] of Object.entries({ ...TEXT_FIELDS, ...LIST_FIELDS })) {
    values[field] = document.getElementById(id).value;
  }
  const { changes, error } = readBibliographyForm(values);
  if (error) {
    showFormError(error);
    return;
  }

  isSaving = true;
  elements.save.disabled = true;
  elements.save.textContent = '保存しています…';
  try {
    const updated = await updatePaperBibliography(currentPaper.id, changes, currentPaper.updatedAt);
    currentPaper = updated;
    updateCurrentPaper(updated); // 閲覧画面の見出しも新しいタイトルにする
    closeForm();
    renderAll();
    showStatus('success', '書誌情報を保存しました。');
    elements.editButton.focus();
    await onChangedCallback(); // ライブラリの一覧も新しい内容にする
  } catch (saveError) {
    showFormError(
      saveError instanceof PaperConflictError ? saveError.message : `保存できませんでした。入力した内容は残っています。${describeStorageError(saveError)}`
    );
  } finally {
    isSaving = false;
    elements.save.disabled = false;
    elements.save.textContent = '保存';
  }
}

function showFormError(message) {
  elements.formError.textContent = `エラー：${message}`;
  elements.formError.hidden = false;
  elements.formError.scrollIntoView({ block: 'nearest' });
}

// ---------- 参考文献 ----------

function loadSettings() {
  const saved = readPreference('citationSettings', {});
  settings = { ...DEFAULT_CITATION_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!['auto', 'domestic', 'nlm'].includes(settings.style)) settings.style = 'auto';
  if (!ET_AL_OPTIONS.includes(settings.etAl)) settings.etAl = 'et al.';
  elements.styleSelect.value = settings.style;
  elements.etAlSelect.value = settings.etAl;
  elements.abbreviateCheckbox.checked = Boolean(settings.abbreviatePages);
  elements.doiCheckbox.checked = Boolean(settings.includeDoi);
}

function renderCitation() {
  elements.copyStatus.textContent = '';
  if (!currentPaper) {
    elements.citationOutput.textContent = '論文を開くと、ここに参考文献が表示されます。';
    elements.citationOutput.classList.add('is-empty');
    elements.citationStyleLabel.textContent = '';
    elements.citationMissing.hidden = true;
    elements.copyButton.disabled = true;
    return;
  }

  const result = formatVancouver(currentPaper, settings);
  const styleName = resolveStyle(currentPaper, settings) === 'nlm' ? 'NLM形式' : '国内形式';
  elements.citationStyleLabel.textContent = `書式：${styleName}${settings.style === 'auto' ? '（自動）' : ''}・バンクーバー方式`;

  elements.citationOutput.textContent = result.text || '書誌情報を入力すると、ここに参考文献が表示されます。';
  elements.citationOutput.classList.toggle('is-empty', !result.text);

  const messages = [];
  if (result.missing.length > 0) {
    messages.push(`不足している項目：${result.missing.join('、')}。入力するまでコピーできません（「書誌情報を編集」から入力できます）。`);
  }
  if (result.warnings.length > 0) {
    messages.push(`入力されていない項目：${result.warnings.join('、')}（論文によっては不要です）。`);
  }
  elements.citationMissing.textContent = messages.join(' ');
  elements.citationMissing.hidden = messages.length === 0;
  elements.citationMissing.classList.toggle('is-blocking', result.missing.length > 0);
  elements.copyButton.disabled = !result.canCopy;
}

async function copyCitation() {
  if (!currentPaper) return;
  const { text, canCopy } = formatVancouver(currentPaper, settings);
  if (!canCopy) return;

  try {
    await navigator.clipboard.writeText(text);
    elements.copyStatus.textContent = 'コピーしました。原稿などに貼り付けできます。';
    elements.copyStatus.classList.remove('is-error');
  } catch {
    // クリップボードを使えない環境では、表示されている文字を選んだ状態にして手動コピーを案内する
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(elements.citationOutput);
    selection.removeAllRanges();
    selection.addRange(range);
    elements.copyStatus.textContent = '自動でコピーできませんでした。参考文献を選択した状態にしたので、Ctrl + C（スマートフォンは「コピー」）でコピーしてください。';
    elements.copyStatus.classList.add('is-error');
  }
}

// ---------- 状態メッセージ ----------

function showStatus(type, message) {
  const label = document.createElement('strong');
  label.textContent = type === 'error' ? 'エラー：' : '完了：';
  const text = document.createElement('span');
  text.textContent = message;
  elements.status.replaceChildren(label, text);
  elements.status.className = `status-message status-message--${type}`;
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
}

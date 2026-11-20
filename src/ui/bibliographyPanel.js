// 書誌情報（表示・手入力での編集）と参考文献（生成・コピー・書式の設定）
// 書誌情報は推測で埋めない。入力されていない項目は「未入力」と表示し、参考文献では「不足」として知らせる。

import { onViewerEvent, updateCurrentPaper } from './viewer.js';
import { formatVancouver, formatPages, resolveStyle, DEFAULT_CITATION_SETTINGS, ET_AL_OPTIONS } from '../citation/vancouver.js';
import { updatePaperBibliography, PaperConflictError } from '../storage/paperRepository.js';
import { describeStorageError } from '../storage/db.js';
import { readPreference, writePreference } from '../utils/preferences.js';
import { formatDateTime } from '../utils/format.js';
import { readBibliographyForm } from '../citation/bibliographyForm.js';
import {
  autoFillBibliography,
  findBibliographyFromPdf,
  findBibliographyFromQuery,
  compareWithCurrent,
  applyRows,
} from '../metadata/autofill.js';
import { lookupByDoi, LookupError, METADATA_LOOKUP_AVAILABLE, LOOKUP_UNAVAILABLE_MESSAGE } from '../metadata/lookup.js';
import { recordLookupResult } from '../storage/paperRepository.js';

// 取得元の表示名
const SOURCE_LABELS = { manual: '手入力', JaLC: 'JaLC', Crossref: 'Crossref', PubMed: 'PubMed' };

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
    autoButton: document.getElementById('bib-auto'),
    lookupForm: document.getElementById('bib-lookup-form'),
    lookupQuery: document.getElementById('bib-lookup-query'),
    lookupSubmit: document.getElementById('bib-lookup-submit'),
    lookupStatus: document.getElementById('bib-lookup-status'),
    proposal: document.getElementById('bib-proposal'),
  };

  loadSettings();

  onViewerEvent('paperOpened', (bundle) => {
    currentPaper = bundle.paper;
    closeForm();
    hideStatus();
    clearProposal();
    setLookupStatus('');
    elements.lookupQuery.value = '';
    renderAll();
    runLookupOnOpen();
  });
  onViewerEvent('paperClosed', () => {
    currentPaper = null;
    closeForm();
    clearProposal();
    setLookupStatus('');
    renderAll();
  });

  elements.autoButton.addEventListener('click', () => runLookup('pdf'));
  elements.lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runLookup('query');
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

  // 表示の行と、取得元を調べる項目の対応
  const sourceKeys = {
    タイトル: ['title'], 著者: ['authors'], 発行年: ['year'], 雑誌名: ['journal'], 略誌名: ['journalAbbr'],
    '巻・号': ['volume', 'issue'], ページ: ['pageStart', 'pageEnd', 'articleNumber'], DOI: ['doi'], 言語: ['language'],
  };
  const fieldSources = currentPaper?.fieldSources ?? {};

  elements.list.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      const text = value === null || value === undefined ? '' : String(value).trim();
      detail.textContent = text || '未入力';
      detail.classList.toggle('is-empty', !text);

      // 取得元（JaLC・Crossref・PubMed・手入力）を小さく表示する
      const source = (sourceKeys[label] ?? []).map((key) => fieldSources[key]).find(Boolean);
      if (text && source) {
        const tag = document.createElement('span');
        tag.className = 'source-tag';
        tag.textContent = SOURCE_LABELS[source.source] ?? source.source;
        tag.title = `${SOURCE_LABELS[source.source] ?? source.source}（${formatDateTime(source.at)}）`;
        detail.append(' ', tag);
      }
      row.append(term, detail);
      return row;
    })
  );

  elements.editButton.disabled = !currentPaper || !elements.form.hidden;
  elements.autoButton.disabled = !currentPaper || lookupBusy;
  // 画像の論文と、自動取得が使えない公開版では「PDFから書誌情報を取得」を出さない
  elements.autoButton.hidden = currentPaper?.sourceKind === 'images' || !METADATA_LOOKUP_AVAILABLE;
  elements.lookupSubmit.disabled = !currentPaper || lookupBusy || !METADATA_LOOKUP_AVAILABLE;
  elements.lookupQuery.disabled = !METADATA_LOOKUP_AVAILABLE;
}

// ---------- 書誌情報の自動取得 ----------

let lookupBusy = false;

/** 論文を開いたとき：まだ一度も自動取得していなければ自動で、要確認なら候補を表示する */
function runLookupOnOpen() {
  const lookup = currentPaper?.bibliographyLookup;
  if (!currentPaper) return;
  if (!METADATA_LOOKUP_AVAILABLE) {
    setLookupStatus(LOOKUP_UNAVAILABLE_MESSAGE);
    return;
  }
  if (currentPaper.sourceKind === 'images') {
    setLookupStatus('画像から文字を読み取るには OCR（開発予定）が必要です。上の欄に DOI かタイトルを入力すると探せます。');
    return;
  }
  if (!lookup) runLookup('auto');
  else if (lookup.status === 'needs-review') runLookup('pdf');
}

/**
 * 書誌情報を探す。
 * @param {'auto'|'pdf'|'query'} trigger
 *   auto：初めて開いたとき（タイトルが一致すれば空いている項目に自動で反映）
 *   pdf ：ボタンや要確認のとき（取得した内容を表示し、反映する項目を選んでもらう）
 *   query：入力した DOI・タイトルで探す
 */
async function runLookup(trigger) {
  if (!currentPaper || lookupBusy) return;
  if (!METADATA_LOOKUP_AVAILABLE) {
    setLookupStatus(LOOKUP_UNAVAILABLE_MESSAGE);
    return;
  }
  const paperId = currentPaper.id;
  let query = '';
  if (trigger === 'query') {
    query = elements.lookupQuery.value.trim();
    if (!query) {
      setLookupStatus('DOI またはタイトルを入力してください。', true);
      elements.lookupQuery.focus();
      return;
    }
  }

  lookupBusy = true;
  renderBibliography();
  clearProposal();
  const onProgress = (message) => setLookupStatus(message);

  try {
    if (trigger === 'auto') {
      const outcome = await autoFillBibliography(currentPaper, onProgress);
      if (currentPaper?.id !== paperId) return;
      currentPaper = outcome.paper;
      if (outcome.status === 'applied') {
        updateCurrentPaper(currentPaper);
        renderAll();
        setLookupStatus(
          outcome.appliedCount > 0
            ? `書誌情報を自動入力しました（取得元：${outcome.sources.join('・')}、${outcome.appliedCount}項目）。PDF のタイトルと一致することを確認済みです。間違いがあれば「書誌情報を編集」で直せます。`
            : `取得した内容は、今の書誌情報と同じでした（取得元：${outcome.sources.join('・')}）。`
        );
        await onChangedCallback();
      } else {
        showLookupResult(outcome.result);
        await onChangedCallback();
      }
    } else {
      const result = trigger === 'query'
        ? await findBibliographyFromQuery(query, onProgress)
        : await findBibliographyFromPdf(paperId, onProgress);
      if (currentPaper?.id !== paperId) return;
      showLookupResult(result);
    }
  } catch (error) {
    if (currentPaper?.id !== paperId) return;
    setLookupStatus(
      `エラー：${error instanceof LookupError ? error.message : `書誌情報を取得できませんでした（${error?.message ?? '原因不明のエラー'}）。`}手入力でも登録できます。`,
      true
    );
  } finally {
    lookupBusy = false;
    renderBibliography();
  }
}

/** 探した結果を表示する */
function showLookupResult(result) {
  if (result.kind === 'proposal') {
    setLookupStatus('');
    renderProposal(result.proposal);
  } else if (result.kind === 'candidates') {
    setLookupStatus('');
    renderCandidates(result.candidates, result.searchedTitle);
  } else {
    setLookupStatus(result.message);
  }
}

/** 取得した書誌情報を表示し、反映する項目を選んでもらう */
function renderProposal(proposal) {
  const rows = compareWithCurrent(currentPaper, proposal.fields);
  const box = elements.proposal;
  box.replaceChildren();

  const header = document.createElement('p');
  header.className = 'bib-proposal__title';
  header.textContent = `取得した書誌情報（取得元：${proposal.sources.join('・')}）`;
  box.append(header);

  const check = document.createElement('p');
  if (proposal.verified) {
    check.className = 'bib-proposal__check is-ok';
    check.textContent = '✓ PDF のタイトルと一致しました。';
  } else if (proposal.origin === 'pdf-doi') {
    check.className = 'bib-proposal__check is-warning';
    check.textContent = '⚠ PDF のタイトルとの一致を確認できませんでした。別の論文の DOI の可能性があります。内容をよく確認してから反映してください。';
  } else {
    check.className = 'bib-proposal__check';
    check.textContent = '選んだ DOI の書誌情報です。この論文と同じものか確認してから反映してください。';
  }
  box.append(check);

  if (rows.length === 0) {
    const same = document.createElement('p');
    same.className = 'note';
    same.textContent = '取得した内容は、今の書誌情報と同じです。';
    box.append(same, createButtonRow([['閉じる', 'button', () => clearProposal()]]));
    box.hidden = false;
    return;
  }

  const list = document.createElement('ul');
  list.className = 'bib-proposal__list';
  rows.forEach((row, index) => {
    const item = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'checkbox-field';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = row.selected;
    checkbox.dataset.index = String(index);
    const name = document.createElement('span');
    name.className = 'bib-proposal__label';
    name.textContent = row.label;
    label.append(checkbox, name);

    const value = document.createElement('span');
    value.className = 'bib-proposal__value';
    value.textContent = displayValue(row.key, row.value);
    const source = document.createElement('span');
    source.className = 'source-tag';
    source.textContent = proposal.fieldSources[row.key] ?? '';
    value.append(' ', source);
    item.append(label, value);

    if (row.current !== null && row.current !== undefined && String(row.current).trim() !== '' && !(Array.isArray(row.current) && row.current.length === 0)) {
      const current = document.createElement('span');
      current.className = 'bib-proposal__current';
      current.textContent = `今の値：${displayValue(row.key, row.current)}（チェックを入れると置き換えます）`;
      item.append(current);
    }
    list.append(item);
  });
  box.append(list);

  box.append(
    createButtonRow([
      ['選んだ項目を反映', 'button button--primary', () => applyProposal(proposal, rows)],
      ['反映しない', 'button', () => {
        clearProposal();
        setLookupStatus('反映しませんでした。必要なら「書誌情報を編集」で入力できます。');
      }],
    ])
  );
  box.hidden = false;
}

async function applyProposal(proposal, rows) {
  const checked = Array.from(elements.proposal.querySelectorAll('input[type="checkbox"]'))
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => rows[Number(checkbox.dataset.index)]);
  if (checked.length === 0) {
    setLookupStatus('反映する項目にチェックを入れてください。', true);
    return;
  }
  try {
    let updated = await applyRows(currentPaper, checked, proposal.fieldSources);
    updated = await recordLookupResult(updated.id, { status: 'applied', sources: proposal.sources });
    currentPaper = updated;
    updateCurrentPaper(updated);
    clearProposal();
    renderAll();
    setLookupStatus(`${checked.length}項目を反映しました（取得元：${proposal.sources.join('・')}）。間違いがあれば「書誌情報を編集」で直せます。`);
    await onChangedCallback();
  } catch (error) {
    setLookupStatus(
      `エラー：${error instanceof PaperConflictError ? error.message : `反映できませんでした。${describeStorageError(error)}`}`,
      true
    );
  }
}

/** タイトルで検索した候補を表示し、該当する論文を選んでもらう */
function renderCandidates(candidates, searchedTitle) {
  const box = elements.proposal;
  box.replaceChildren();

  const header = document.createElement('p');
  header.className = 'bib-proposal__title';
  header.textContent = `候補が見つかりました。この論文に当てはまるものを選んでください（「${searchedTitle.slice(0, 40)}${searchedTitle.length > 40 ? '…' : ''}」で検索）。`;
  box.append(header);

  const list = document.createElement('ul');
  list.className = 'bib-candidates';
  for (const candidate of candidates) {
    const item = document.createElement('li');
    const title = document.createElement('p');
    title.className = 'bib-candidates__title';
    title.textContent = candidate.title ?? '（タイトル不明）';
    const meta = document.createElement('p');
    meta.className = 'bib-candidates__meta';
    const authors = candidate.authors ?? [];
    meta.textContent = [
      authors.length > 3 ? `${authors.slice(0, 3).join(', ')} ほか` : authors.join(', '),
      candidate.journal,
      candidate.year ? `${candidate.year}年` : null,
      candidate.volume ? `${candidate.volume}${candidate.issue ? `(${candidate.issue})` : ''}` : null,
      candidate.doi ? `DOI: ${candidate.doi}` : 'DOI なし',
    ].filter(Boolean).join('　');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--small';
    if (candidate.doi) {
      button.textContent = 'この論文を選ぶ';
      button.addEventListener('click', () => chooseCandidate(candidate));
    } else {
      button.textContent = 'DOI がないため自動取得できません';
      button.disabled = true;
    }
    item.append(title, meta, button);
    list.append(item);
  }
  box.append(list);

  // J-STAGE の結果を表示するときは、規約に従ってクレジットを表示する
  if (candidates.some((candidate) => candidate.source === 'J-STAGE')) {
    const credit = document.createElement('p');
    credit.className = 'bib-candidates__credit';
    const link = document.createElement('a');
    link.href = 'https://www.jstage.jst.go.jp/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Powered by J-STAGE';
    credit.append(link, '（候補の表示だけに使い、保存しません。選んだ論文は JaLC から取得します）');
    box.append(credit);
  }

  box.append(createButtonRow([['どれも当てはまらない', 'button', () => {
    clearProposal();
    setLookupStatus('DOI やタイトルを変えて探すか、「書誌情報を編集」で入力してください。');
  }]]));
  box.hidden = false;
}

async function chooseCandidate(candidate) {
  if (lookupBusy) return;
  lookupBusy = true;
  setLookupStatus(`DOI（${candidate.doi}）で書誌情報を問い合わせています…`);
  try {
    const result = await lookupByDoi(candidate.doi, { japaneseFirst: candidate.source === 'J-STAGE' });
    if (!result) {
      setLookupStatus(`DOI（${candidate.doi}）の書誌情報を取得できませんでした。「書誌情報を編集」で入力してください。`, true);
      return;
    }
    setLookupStatus('');
    renderProposal({ ...result, doi: candidate.doi, verified: false, origin: 'candidate' });
  } catch (error) {
    setLookupStatus(`エラー：${error instanceof LookupError ? error.message : '書誌情報を取得できませんでした。'}`, true);
  } finally {
    lookupBusy = false;
    renderBibliography();
  }
}

function createButtonRow(buttons) {
  const row = document.createElement('div');
  row.className = 'button-row';
  for (const [text, className, onClick] of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.addEventListener('click', onClick);
    row.append(button);
  }
  return row;
}

function displayValue(key, value) {
  if (Array.isArray(value)) return value.join('、');
  if (key === 'language') return value === 'en' ? '英語' : '日本語';
  return String(value);
}

function clearProposal() {
  elements.proposal.replaceChildren();
  elements.proposal.hidden = true;
}

function setLookupStatus(text, isError = false) {
  elements.lookupStatus.textContent = text;
  elements.lookupStatus.classList.toggle('is-error', isError);
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

  // 必須の不足（赤・コピー不可）と、任意の未入力（灰色・コピー可）を分けて表示する
  const blocks = [];
  if (result.missing.length > 0) {
    const required = document.createElement('p');
    required.className = 'citation-missing__required';
    const label = document.createElement('strong');
    label.textContent = '入力が必要：';
    required.append(label, `${result.missing.join('、')}（入力するまでコピーできません）`);
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'button button--small citation-missing__edit';
    editButton.textContent = '書誌情報を入力する';
    editButton.addEventListener('click', () => {
      openForm();
      elements.form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    blocks.push(required, editButton);
  }
  if (result.warnings.length > 0) {
    const optional = document.createElement('p');
    optional.className = 'citation-missing__optional';
    optional.textContent = `未入力（論文によっては不要）：${result.warnings.join('、')}`;
    blocks.push(optional);
  }
  elements.citationMissing.replaceChildren(...blocks);
  elements.citationMissing.hidden = blocks.length === 0;
  elements.copyButton.disabled = !result.canCopy;
  elements.copyButton.textContent = result.canCopy ? '参考文献をコピー' : '参考文献をコピー（入力が必要）';
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

// 書誌情報の自動取得（DOIの抽出・タイトルの照合・各サービスの結果の変換）のテスト
// 変換のテストに使う値は、各サービスの実際の応答（書誌情報の部分）にもとづく
import { describe, it, expect } from 'vitest';
import { normalizeDoi, extractDoiCandidates, extractTitleCandidate, titleAppearsInText } from '../../src/metadata/extract.js';
import { parseJalcRecord, parseCrossrefWork, parsePubmedSummary, formatWesternAuthor, initialsFromGiven, splitPages, cleanText } from '../../src/metadata/parsers.js';
import { normalizeCjk, japaneseRatio } from '../../src/utils/japanese.js';
import { normalizeForSearch } from '../../src/utils/search.js';

describe('日本語の比較用の正規化', () => {
  it('部首の文字（⻑・⼭）を通常の漢字にそろえる', () => {
    expect(normalizeCjk('⻑期経過')).toBe('長期経過');
    expect(normalizeCjk('⼭⽥太郎')).toBe('山田太郎');
  });
  it('検索でも「長期」で「⻑期」が見つかる', () => {
    expect(normalizeForSearch('網膜症の⻑期経過')).toContain('長期');
  });
  it('日本語の割合', () => {
    expect(japaneseRatio('糖尿病性網膜症')).toBe(1);
    expect(japaneseRatio('Diabetic retinopathy')).toBe(0);
  });
});

describe('DOI の抽出', () => {
  it('URL・doi: の形をそろえ、末尾の句読点を除く', () => {
    expect(normalizeDoi('https://doi.org/10.1272/jnms1923.51.758.')).toBe('10.1272/jnms1923.51.758');
    expect(normalizeDoi('doi: 10.1056/NEJMsb020632）')).toBe('10.1056/NEJMsb020632');
  });
  it('全角で書かれた DOI も見つける', () => {
    expect(extractDoiCandidates('ＤＯＩ：１０．１２７２／jnms1923.51.758')).toEqual(['10.1272/jnms1923.51.758']);
  });
  it('参考文献欄より後ろの DOI（引用文献の DOI）は使わない', () => {
    const text = 'タイトル\nDOI: 10.1111/main.001\n本文…\n参考文献\n1) 他の論文. doi:10.2222/other.002';
    expect(extractDoiCandidates(text)).toEqual(['10.1111/main.001']);
  });
  it('同じ DOI は1つにまとめ、出てきた順に返す', () => {
    expect(extractDoiCandidates('10.1/a 10.1234/x.1 10.1234/X.1 10.5678/y')).toEqual(['10.1234/x.1', '10.5678/y']);
  });
});

describe('タイトルの候補', () => {
  it('1ページ目のいちばん大きな文字をつなげる', () => {
    const items = [
      { str: '日本医科大学雑誌', height: 9 },
      { str: '糖尿病性眼疾患', height: 16 },
      { str: '糖尿病性網膜症', height: 15.5 },
      { str: '清水 由規', height: 10 },
    ];
    expect(extractTitleCandidate(items)).toBe('糖尿病性眼疾患糖尿病性網膜症');
  });
  it('短すぎる候補は使わない', () => {
    expect(extractTitleCandidate([{ str: 'JMS', height: 20 }, { str: '本文', height: 10 }])).toBeNull();
  });
});

describe('タイトルの照合（自動で採用してよいか）', () => {
  const pdfText = '2型糖尿病患者における網膜症の⻑期経過に関する\n後ろ向き検討\n山田 太郎';
  it('空白・改行・部首の文字の違いを無視して一致を確かめる', () => {
    expect(titleAppearsInText('2型糖尿病患者における網膜症の長期経過に関する後ろ向き検討', pdfText)).toBe(true);
  });
  it('違うタイトルは一致しない', () => {
    expect(titleAppearsInText('糖尿病性腎症の治療', pdfText)).toBe(false);
  });
  it('英語は大文字・小文字の違いを無視する', () => {
    expect(titleAppearsInText('Solid-Organ Transplantation in HIV-Infected Patients', 'solid-organ transplantation in HIV-infected patients')).toBe(true);
  });
});

describe('名前・ページの整形', () => {
  it('欧文の名を頭文字に', () => {
    expect(initialsFromGiven('Scott D.')).toBe('SD');
    expect(initialsFromGiven('Jean-Pierre')).toBe('JP');
    expect(formatWesternAuthor('Halpern', 'Scott D.')).toBe('Halpern SD');
    expect(formatWesternAuthor('Shimizu', 'Yoshinori')).toBe('Shimizu Y');
  });
  it('ページを分ける・HTMLタグを除く', () => {
    expect(splitPages('284-287')).toEqual({ pageStart: '284', pageEnd: '287' });
    expect(splitPages('e012345')).toEqual({ pageStart: 'e012345', pageEnd: null });
    expect(cleanText('Effect of <i>Helicobacter pylori</i>  on')).toBe('Effect of Helicobacter pylori on');
  });
});

// JaLC の実際の応答（10.1272/jnms1923.51.758）の書誌情報部分
const jalcData = {
  doi: '10.1272/jnms1923.51.758',
  title_list: [
    { lang: 'en', title: 'Ocular diseases in diabetes. Diabetic retinopathy.' },
    { title: '糖尿病性眼疾患　　糖尿病性網膜症', subtitle: '糖尿病性網膜症' },
  ],
  creator_list: [{ sequence: '1', type: 'person', names: [{ lang: 'ja', last_name: '清水', first_name: '由規' }] }],
  publication_date: { publication_year: '1984' },
  alternate_identifier_list: [{ alternate_identifier: '6520204', type: 'PMID' }],
  content_language: 'ja',
  journal_title_name_list: [
    { journal_title_name: 'Nippon Ika Daigaku Zasshi', type: 'abbreviation', lang: 'en' },
    { journal_title_name: '日本医科大学雑誌', type: 'full', lang: 'ja' },
    { journal_title_name: 'Journal of Nippon Medical School', type: 'abbreviation', lang: 'en' },
    { journal_title_name: '日医大医会誌', type: 'abbreviation', lang: 'ja' },
    { journal_title_name: 'Journal of Nippon Medical School', type: 'full', lang: 'en' },
  ],
  volume: '51',
  issue: '6',
  first_page: '758',
  last_page: '761',
};

describe('JaLC の結果の変換', () => {
  it('日本語のタイトル・著者・誌名・略誌名・巻号・ページ・PMID', () => {
    const { fields, pmid } = parseJalcRecord(jalcData);
    expect(fields).toMatchObject({
      language: 'ja',
      title: '糖尿病性眼疾患 糖尿病性網膜症', // 連続した空白は1つにする。副題はすでに含まれるので重ねない
      titleEn: 'Ocular diseases in diabetes. Diabetic retinopathy.',
      authors: ['清水由規'],
      journal: '日本医科大学雑誌',
      journalAbbr: '日医大医会誌',
      year: '1984',
      volume: '51',
      issue: '6',
      pageStart: '758',
      pageEnd: '761',
      doi: '10.1272/jnms1923.51.758',
    });
    expect(pmid).toBe('6520204');
  });
});

describe('Crossref の結果の変換', () => {
  it('英語論文：著者を「姓 頭文字」に、ページを分ける', () => {
    const { fields } = parseCrossrefWork({
      DOI: '10.1056/NEJMsb020632',
      title: ['Solid-Organ Transplantation in HIV-Infected Patients'],
      author: [
        { given: 'Scott D.', family: 'Halpern' },
        { given: 'Peter A.', family: 'Ubel' },
        { given: 'Arthur L.', family: 'Caplan' },
      ],
      'container-title': ['New England Journal of Medicine'],
      'short-container-title': ['N Engl J Med'],
      volume: '347',
      issue: '4',
      page: '284-287',
      issued: { 'date-parts': [[2002, 7, 25]] },
    });
    expect(fields).toMatchObject({
      language: 'en',
      title: 'Solid-Organ Transplantation in HIV-Infected Patients',
      authors: ['Halpern SD', 'Ubel PA', 'Caplan AL'],
      journal: 'New England Journal of Medicine',
      journalAbbr: 'N Engl J Med',
      year: '2002',
      pageStart: '284',
      pageEnd: '287',
    });
  });
});

describe('PubMed の結果の変換', () => {
  it('日本語論文：英訳タイトルの [ ] とピリオドを外し、NLM略誌名を取り出す', () => {
    const result = parsePubmedSummary({
      uid: '6520204',
      title: '[Ocular diseases in diabetes. Diabetic retinopathy].',
      authors: [{ name: 'Shimizu Y', authtype: 'Author' }],
      source: 'Nihon Ika Daigaku Zasshi',
      lang: ['jpn'],
      pubdate: '1984 Dec',
    });
    expect(result).toMatchObject({
      isJapanese: true,
      title: 'Ocular diseases in diabetes. Diabetic retinopathy',
      authors: ['Shimizu Y'],
      journalAbbr: 'Nihon Ika Daigaku Zasshi',
      year: '1984',
    });
  });
  it('英語論文：NLM の著者表記と略誌名', () => {
    const result = parsePubmedSummary({
      uid: '12140307',
      title: 'Solid-organ transplantation in HIV-infected patients.',
      authors: [{ name: 'Halpern SD' }, { name: 'Ubel PA' }, { name: 'Caplan AL' }],
      source: 'N Engl J Med',
      lang: ['eng'],
      pubdate: '2002 Jul 25',
    });
    expect(result.title).toBe('Solid-organ transplantation in HIV-infected patients');
    expect(result.journalAbbr).toBe('N Engl J Med');
    expect(result.isJapanese).toBe(false);
  });
});

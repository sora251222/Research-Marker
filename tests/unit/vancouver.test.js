// バンクーバー方式の参考文献のテスト
// 例文は NLM の Citing Medicine / ICMJE のサンプルと、CLAUDE.md 第10章の国内形式の例による
import { describe, it, expect } from 'vitest';
import {
  formatVancouver,
  formatAuthors,
  formatPages,
  abbreviateEndPage,
  resolveStyle,
  DEFAULT_CITATION_SETTINGS,
} from '../../src/citation/vancouver.js';

const englishPaper = {
  language: 'en',
  authors: ['Halpern SD', 'Ubel PA', 'Caplan AL'],
  title: 'Solid-organ transplantation in HIV-infected patients',
  journalAbbr: 'N Engl J Med',
  year: '2002',
  volume: '347',
  issue: '4',
  pageStart: '284',
  pageEnd: '287',
  doi: '10.1056/NEJMsa021052',
};

const japanesePaper = {
  language: 'ja',
  authors: ['清水由規'],
  title: '糖尿病性眼疾患 糖尿病性網膜症',
  journalAbbr: '日医大医会誌',
  year: '1984',
  volume: '51',
  issue: '6',
  pageStart: '758',
  pageEnd: '761',
  authorsEn: ['Shimizu Y'],
  titleEn: 'Ocular diseases in diabetes. Diabetic retinopathy.',
  journalAbbrNlm: 'Nihon Ika Daigaku Zasshi',
};

describe('formatVancouver：基本', () => {
  it('英語論文（NLM形式・ページは省略しない）', () => {
    const result = formatVancouver(englishPaper);
    expect(result.text).toBe(
      'Halpern SD, Ubel PA, Caplan AL. Solid-organ transplantation in HIV-infected patients. N Engl J Med. 2002;347(4):284-287.'
    );
    expect(result.style).toBe('nlm');
    expect(result.canCopy).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('日本語論文（国内形式）', () => {
    const result = formatVancouver(japanesePaper);
    expect(result.text).toBe('清水由規. 糖尿病性眼疾患 糖尿病性網膜症. 日医大医会誌. 1984;51(6):758-761.');
    expect(result.style).toBe('domestic');
  });

  it('日本語論文をNLM形式で：英訳タイトルを [ ] で囲み、末尾に Japanese.', () => {
    const result = formatVancouver(japanesePaper, { ...DEFAULT_CITATION_SETTINGS, style: 'nlm' });
    expect(result.text).toBe(
      'Shimizu Y. [Ocular diseases in diabetes. Diabetic retinopathy]. Nihon Ika Daigaku Zasshi. 1984;51(6):758-761. Japanese.'
    );
  });

  it('ページを省略形にする設定', () => {
    const result = formatVancouver(englishPaper, { ...DEFAULT_CITATION_SETTINGS, abbreviatePages: true });
    expect(result.text.endsWith('2002;347(4):284-7.')).toBe(true);
  });

  it('DOI を付ける設定', () => {
    const result = formatVancouver(englishPaper, { ...DEFAULT_CITATION_SETTINGS, includeDoi: true });
    expect(result.text.endsWith('284-287. doi:10.1056/NEJMsa021052')).toBe(true);
  });
});

describe('著者', () => {
  const seven = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
  it('6名までは全員', () => {
    expect(formatAuthors(seven.slice(0, 6))).toBe('A1, A2, A3, A4, A5, A6');
  });
  it('7名以上は最初の6名＋et al.（ほか・他も選べる）', () => {
    expect(formatAuthors(seven)).toBe('A1, A2, A3, A4, A5, A6, et al.');
    expect(formatAuthors(seven, 'ほか')).toBe('A1, A2, A3, A4, A5, A6, ほか');
    expect(formatAuthors(seven, '他')).toBe('A1, A2, A3, A4, A5, A6, 他');
  });
  it('et al. のあとにピリオドを重ねない', () => {
    const text = formatVancouver({ ...englishPaper, authors: seven }).text;
    expect(text.startsWith('A1, A2, A3, A4, A5, A6, et al. Solid-organ')).toBe(true);
  });
  it('「ほか」のあとにはピリオドを付ける', () => {
    const text = formatVancouver({ ...japanesePaper, authors: seven }, { ...DEFAULT_CITATION_SETTINGS, etAl: 'ほか' }).text;
    expect(text.startsWith('A1, A2, A3, A4, A5, A6, ほか. 糖尿病性')).toBe(true);
  });
  it('団体著者や前後の空白：表記は変えず、空白だけ除く', () => {
    expect(formatAuthors(['  World Health Organization  '.trim()])).toBe('World Health Organization');
  });
});

describe('巻・号・ページ', () => {
  it('号がない場合', () => {
    expect(formatVancouver({ ...englishPaper, issue: '' }).text.endsWith('2002;347:284-287.')).toBe(true);
  });
  it('論文番号（ページの代わり）', () => {
    const paper = { ...englishPaper, pageStart: '', pageEnd: '', articleNumber: 'e012345' };
    expect(formatVancouver(paper).text.endsWith('2002;347(4):e012345.')).toBe(true);
  });
  it('1ページだけの論文', () => {
    expect(formatPages({ pageStart: '1234', pageEnd: '1234' })).toBe('1234');
  });
  it('ページの省略形のルール', () => {
    expect(abbreviateEndPage('284', '287')).toBe('7');
    expect(abbreviateEndPage('1234', '1245')).toBe('45');
    expect(abbreviateEndPage('98', '102')).toBe('102'); // 桁数が違う → そのまま
    expect(abbreviateEndPage('S12', 'S15')).toBe('S15'); // 数字以外を含む → そのまま
    expect(abbreviateEndPage('100', '109')).toBe('9');
  });
});

describe('タイトルの末尾', () => {
  it('? や ! で終わるタイトルにはピリオドを付けない', () => {
    const text = formatVancouver({ ...englishPaper, title: 'Is it safe?' }).text;
    expect(text).toContain('Is it safe? N Engl J Med.');
  });
  it('すでにピリオドで終わっていれば重ねない', () => {
    const text = formatVancouver({ ...englishPaper, title: 'A study.' }).text;
    expect(text).toContain('A study. N Engl J Med.');
  });
});

describe('不足している項目（推測で埋めない）', () => {
  it('必須項目が足りないとコピーできず、不足を知らせる', () => {
    const result = formatVancouver({ language: 'ja', title: 'タイトルだけの論文' });
    expect(result.canCopy).toBe(false);
    expect(result.missing).toEqual(['著者', '略誌名', '発行年']);
    expect(result.warnings).toEqual(['巻', 'ページ（または論文番号）']);
    expect(result.text).toBe('タイトルだけの論文.');
  });
  it('略誌名がなくても、正式な誌名で代用しない', () => {
    const result = formatVancouver({ ...englishPaper, journalAbbr: '', journal: 'The New England Journal of Medicine' });
    expect(result.text).not.toContain('New England');
    expect(result.missing).toContain('略誌名');
  });
  it('日本語論文をNLM形式にするとき、英語表記がなければ不足として知らせる（自動で翻訳・ローマ字化しない）', () => {
    const result = formatVancouver({ ...japanesePaper, authorsEn: [], titleEn: '', journalAbbrNlm: '' }, { ...DEFAULT_CITATION_SETTINGS, style: 'nlm' });
    expect(result.missing).toEqual(['著者（英語表記）', 'タイトル（英語）', 'NLM略誌名']);
    expect(result.text).not.toContain('清水');
  });
});

describe('resolveStyle', () => {
  it('自動：日本語は国内形式、英語はNLM形式。言語が未設定なら国内形式', () => {
    expect(resolveStyle({ language: 'ja' }, DEFAULT_CITATION_SETTINGS)).toBe('domestic');
    expect(resolveStyle({ language: 'en' }, DEFAULT_CITATION_SETTINGS)).toBe('nlm');
    expect(resolveStyle({}, DEFAULT_CITATION_SETTINGS)).toBe('domestic');
    expect(resolveStyle({ language: 'en' }, { ...DEFAULT_CITATION_SETTINGS, style: 'domestic' })).toBe('domestic');
  });
});

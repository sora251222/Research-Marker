// 論文検索の文字列処理のテスト
import { describe, it, expect } from 'vitest';
import { normalizeForSearch, paperMatchesQuery, filterPapers } from '../../src/utils/search.js';

const japanesePaper = {
  id: 'a',
  title: '糖尿病性網膜症の長期経過に関する検討',
  authors: ['山田太郎', '鈴木花子'],
  journal: '日本医学雑誌',
  year: 2024,
  doi: '10.1234/ABC.2024.001',
};

const englishPaper = {
  id: 'b',
  title: 'Long-term Outcomes of Diabetic Retinopathy',
  authors: ['Smith J', 'Brown A'],
  journal: 'J Med',
  year: 2023,
};

describe('normalizeForSearch', () => {
  it('全角英数字を半角に、大文字を小文字にそろえる', () => {
    expect(normalizeForSearch('ＡＢＣ１２３')).toBe('abc123');
  });

  it('半角カナを全角カナにそろえる', () => {
    expect(normalizeForSearch('ｶﾀｶﾅ')).toBe('カタカナ');
  });

  it('全角スペースを含む連続した空白を1つにまとめ、前後の空白を除く', () => {
    expect(normalizeForSearch('　糖尿病　　網膜症 ')).toBe('糖尿病 網膜症');
  });

  it('null や undefined は空文字にする', () => {
    expect(normalizeForSearch(null)).toBe('');
    expect(normalizeForSearch(undefined)).toBe('');
  });
});

describe('paperMatchesQuery', () => {
  it('検索語が空なら一致とする', () => {
    expect(paperMatchesQuery(japanesePaper, '')).toBe(true);
    expect(paperMatchesQuery(japanesePaper, '　 ')).toBe(true);
  });

  it('日本語タイトルの一部で一致する', () => {
    expect(paperMatchesQuery(japanesePaper, '網膜症')).toBe(true);
  });

  it('著者名・雑誌名・発行年・DOI でも一致する', () => {
    expect(paperMatchesQuery(japanesePaper, '鈴木')).toBe(true);
    expect(paperMatchesQuery(japanesePaper, '日本医学')).toBe(true);
    expect(paperMatchesQuery(japanesePaper, '2024')).toBe(true);
    expect(paperMatchesQuery(japanesePaper, '10.1234/abc')).toBe(true);
  });

  it('全角数字や大文字で入力しても一致する', () => {
    expect(paperMatchesQuery(japanesePaper, '２０２４')).toBe(true);
    expect(paperMatchesQuery(englishPaper, 'DIABETIC')).toBe(true);
  });

  it('空白で区切った複数の語は、すべて含む場合だけ一致する（AND検索）', () => {
    expect(paperMatchesQuery(japanesePaper, '網膜症　山田')).toBe(true);
    expect(paperMatchesQuery(japanesePaper, '網膜症 Smith')).toBe(false);
  });

  it('DOI や著者がない論文でもエラーにならない', () => {
    expect(paperMatchesQuery({ title: 'タイトルのみ' }, 'タイトル')).toBe(true);
  });
});

describe('filterPapers', () => {
  it('一致する論文だけを返し、元の配列は変更しない', () => {
    const papers = [japanesePaper, englishPaper];
    const result = filterPapers(papers, 'retinopathy');
    expect(result).toEqual([englishPaper]);
    expect(papers).toHaveLength(2);
  });
});

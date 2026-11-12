// 書誌情報の入力内容の確認のテスト
import { describe, it, expect } from 'vitest';
import { readBibliographyForm } from '../../src/citation/bibliographyForm.js';

describe('readBibliographyForm', () => {
  it('前後の空白を除き、空欄は未入力（null）にする', () => {
    const { changes } = readBibliographyForm({ language: 'ja', title: '  タイトル  ', journal: '   ' }, 2026);
    expect(changes.title).toBe('タイトル');
    expect(changes.journal).toBeNull();
    expect(changes.language).toBe('ja');
  });

  it('著者は1行ずつに分け、空の行を除く（表記は変えない）', () => {
    const { changes } = readBibliographyForm({ authors: '山田太郎\n\n  Halpern SD \r\n鈴木 花子' }, 2026);
    expect(changes.authors).toEqual(['山田太郎', 'Halpern SD', '鈴木 花子']);
  });

  it('発行年は4桁の数字だけ受け付ける', () => {
    expect(readBibliographyForm({ year: '2024' }, 2026).changes.year).toBe('2024');
    expect(readBibliographyForm({ year: '24' }, 2026).error).toContain('4 桁');
    expect(readBibliographyForm({ year: '２０２４' }, 2026).error).toContain('4 桁');
    expect(readBibliographyForm({ year: '2099' }, 2026).error).toContain('2027');
  });

  it('DOI の URL 形式や「doi:」を取り除き、形を確認する', () => {
    expect(readBibliographyForm({ doi: 'https://doi.org/10.1056/NEJMsa021052' }, 2026).changes.doi).toBe('10.1056/NEJMsa021052');
    expect(readBibliographyForm({ doi: 'doi: 10.1272/jnms1923.51.758' }, 2026).changes.doi).toBe('10.1272/jnms1923.51.758');
    expect(readBibliographyForm({ doi: 'abc' }, 2026).error).toContain('10.');
  });

  it('言語は ja か en だけ（それ以外は ja）', () => {
    expect(readBibliographyForm({ language: 'en' }, 2026).changes.language).toBe('en');
    expect(readBibliographyForm({ language: 'fr' }, 2026).changes.language).toBe('ja');
  });
});

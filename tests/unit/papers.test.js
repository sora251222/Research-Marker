// 論文一覧の並べ替えのテスト
import { describe, it, expect } from 'vitest';
import { sortPapers, paperDisplayTitle } from '../../src/utils/papers.js';

const papers = [
  { id: '1', title: '網膜症の検討', createdAt: '2026-11-10T10:00:00Z' },
  { id: '2', title: null, displayName: 'scan.pdf', createdAt: '2026-11-12T10:00:00Z' },
  { id: '3', title: 'Abstract study', createdAt: '2026-11-11T10:00:00Z' },
];

describe('paperDisplayTitle', () => {
  it('タイトルが未設定ならファイル名を使う', () => {
    expect(paperDisplayTitle(papers[0])).toBe('網膜症の検討');
    expect(paperDisplayTitle(papers[1])).toBe('scan.pdf');
  });
});

describe('sortPapers', () => {
  it('登録日時の新しい順・古い順', () => {
    expect(sortPapers(papers, 'createdAt', 'descending').map((p) => p.id)).toEqual(['2', '3', '1']);
    expect(sortPapers(papers, 'createdAt', 'ascending').map((p) => p.id)).toEqual(['1', '3', '2']);
  });

  it('タイトル順（未設定はファイル名で比較）', () => {
    const ids = sortPapers(papers, 'title', 'ascending').map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect(sortPapers(papers, 'title', 'descending').map((p) => p.id)).toEqual([...ids].reverse());
  });

  it('元の配列は変更しない', () => {
    const before = papers.map((p) => p.id);
    sortPapers(papers, 'title', 'ascending');
    expect(papers.map((p) => p.id)).toEqual(before);
  });
});

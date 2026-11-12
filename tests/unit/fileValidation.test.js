// 取り込むファイルの検証のテスト
import { describe, it, expect } from 'vitest';
import {
  detectFileKind,
  kindFromFileName,
  validateFileEntry,
  validateSelection,
  moveItem,
  LIMITS,
} from '../../src/import/fileValidation.js';

const bytesOf = (...values) => new Uint8Array(values);
const textBytes = (text) => new TextEncoder().encode(text);

describe('detectFileKind（中身による形式の判定）', () => {
  it('PDF・JPEG・PNG を判定する', () => {
    expect(detectFileKind(textBytes('%PDF-1.7\n...'))).toBe('pdf');
    expect(detectFileKind(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpeg');
    expect(detectFileKind(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('png');
  });

  it('先頭に余分なデータがある PDF も判定する', () => {
    expect(detectFileKind(textBytes('\n\n  %PDF-1.4'))).toBe('pdf');
  });

  it('対応していない形式や短すぎるデータは null', () => {
    expect(detectFileKind(textBytes('Hello, world'))).toBeNull();
    expect(detectFileKind(bytesOf(0x50, 0x4b, 0x03, 0x04, 0x00))).toBeNull(); // ZIP / Word
    expect(detectFileKind(bytesOf(0xff))).toBeNull();
    expect(detectFileKind(null)).toBeNull();
  });
});

describe('kindFromFileName（拡張子による判定）', () => {
  it('大文字・小文字を区別しない', () => {
    expect(kindFromFileName('論文.PDF')).toBe('pdf');
    expect(kindFromFileName('page1.JPG')).toBe('jpeg');
    expect(kindFromFileName('page1.jpeg')).toBe('jpeg');
    expect(kindFromFileName('scan.png')).toBe('png');
    expect(kindFromFileName('memo.docx')).toBeNull();
  });
});

describe('validateFileEntry（1ファイルの検証）', () => {
  it('正しいファイルは null', () => {
    expect(validateFileEntry({ name: 'a.pdf', size: 1000, detectedKind: 'pdf' })).toBeNull();
    expect(validateFileEntry({ name: 'p.jpg', size: 1000, detectedKind: 'jpeg' })).toBeNull();
  });

  it('空のファイル・対応外の形式を拒否する', () => {
    expect(validateFileEntry({ name: 'a.pdf', size: 0, detectedKind: 'pdf' })).toContain('空のファイル');
    expect(validateFileEntry({ name: 'a.docx', size: 10, detectedKind: null })).toContain('取り込めません');
  });

  it('拡張子と中身が違うファイルを拒否する（例：中身がPNGなのに .pdf）', () => {
    expect(validateFileEntry({ name: 'a.pdf', size: 10, detectedKind: 'png' })).toContain('一致しない');
  });

  it('容量の上限を超えたファイルを拒否する', () => {
    expect(validateFileEntry({ name: 'a.pdf', size: LIMITS.pdfMaxBytes + 1, detectedKind: 'pdf' })).toContain('PDFの上限');
    expect(validateFileEntry({ name: 'a.pdf', size: LIMITS.pdfMaxBytes, detectedKind: 'pdf' })).toBeNull();
    expect(validateFileEntry({ name: 'p.png', size: LIMITS.imageMaxBytes + 1, detectedKind: 'png' })).toContain('画像1枚の上限');
  });
});

describe('validateSelection（組み合わせの検証）', () => {
  it('PDF 1件、画像複数枚は受け付ける', () => {
    expect(validateSelection([{ kind: 'pdf', size: 10 }])).toBeNull();
    expect(validateSelection([{ kind: 'jpeg', size: 10 }, { kind: 'png', size: 10 }])).toBeNull();
  });

  it('PDF複数・PDFと画像の混在・空の選択を拒否する', () => {
    expect(validateSelection([{ kind: 'pdf', size: 1 }, { kind: 'pdf', size: 1 }])).toContain('1件ずつ');
    expect(validateSelection([{ kind: 'pdf', size: 1 }, { kind: 'jpeg', size: 1 }])).toContain('同時に取り込めません');
    expect(validateSelection([])).toContain('選択されていません');
  });

  it('画像の枚数と合計容量の上限を確認する', () => {
    const tooMany = Array.from({ length: LIMITS.maxPages + 1 }, () => ({ kind: 'jpeg', size: 1 }));
    expect(validateSelection(tooMany)).toContain(`${LIMITS.maxPages} 枚まで`);
    const tooLarge = Array.from({ length: 20 }, () => ({ kind: 'jpeg', size: 20 * 1024 * 1024 }));
    expect(validateSelection(tooLarge)).toContain('合計');
  });
});

describe('moveItem（画像の並べ替え）', () => {
  it('指定した位置に移動した新しい配列を返し、元の配列は変えない', () => {
    const original = ['1枚目', '2枚目', '3枚目'];
    expect(moveItem(original, 2, 0)).toEqual(['3枚目', '1枚目', '2枚目']);
    expect(moveItem(original, 0, 1)).toEqual(['2枚目', '1枚目', '3枚目']);
    expect(original).toEqual(['1枚目', '2枚目', '3枚目']);
  });

  it('範囲外への移動は何もしない', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});

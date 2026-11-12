// 表示用の書式のテスト
import { describe, it, expect } from 'vitest';
import { formatBytes, formatDateTime } from '../../src/utils/format.js';

describe('formatBytes', () => {
  it('単位を付けて読みやすくする', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(30 * 1024 * 1024)).toBe('30.0 MB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
  });

  it('不正な値は「不明」', () => {
    expect(formatBytes(-1)).toBe('不明');
    expect(formatBytes(Number.NaN)).toBe('不明');
  });
});

describe('formatDateTime', () => {
  it('日本の表記にする', () => {
    expect(formatDateTime('2026-11-12T14:30:00Z')).toMatch(/^2026\/11\/1[23] \d{2}:\d{2}$/);
  });

  it('不正な日時は「不明」', () => {
    expect(formatDateTime('not-a-date')).toBe('不明');
  });
});

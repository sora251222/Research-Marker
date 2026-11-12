// 画面の切り替え（ルーター）のテスト
import { describe, it, expect } from 'vitest';
import { parseRoute, paperRouteHash } from '../../src/router.js';

describe('parseRoute', () => {
  it('ハッシュがないときは論文ライブラリ', () => {
    expect(parseRoute('')).toEqual({ view: 'library' });
    expect(parseRoute('#')).toEqual({ view: 'library' });
    expect(parseRoute(undefined)).toEqual({ view: 'library' });
  });

  it('各画面のハッシュを正しく読み取る', () => {
    expect(parseRoute('#/library')).toEqual({ view: 'library' });
    expect(parseRoute('#/upload')).toEqual({ view: 'upload' });
    expect(parseRoute('#/search')).toEqual({ view: 'library', focusSearch: true });
    expect(parseRoute('#/settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#/paper/sample-1')).toEqual({ view: 'viewer', paperId: 'sample-1' });
  });

  it('論文IDがない閲覧画面は paperId が null', () => {
    expect(parseRoute('#/paper')).toEqual({ view: 'viewer', paperId: null });
  });

  it('知らないハッシュは論文ライブラリに戻す', () => {
    expect(parseRoute('#/unknown')).toEqual({ view: 'library', unknown: true });
  });

  it('壊れた文字列のIDでもエラーで止まらない', () => {
    expect(parseRoute('#/paper/%E0%A4%A')).toEqual({ view: 'viewer', paperId: null });
  });
});

describe('paperRouteHash', () => {
  it('日本語や記号を含むIDも、元に戻せる形で URL に入れる', () => {
    const id = '論文/1 ?#';
    expect(parseRoute(paperRouteHash(id))).toEqual({ view: 'viewer', paperId: id });
  });
});

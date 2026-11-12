// マーカーの位置計算のテスト
import { describe, it, expect } from 'vitest';
import {
  clientRectsToQuads,
  mergeLineRects,
  rectToQuad,
  quadBounds,
  pointInQuad,
  compareHighlights,
} from '../../src/highlights/geometry.js';

// 幅 500px・高さ 700px のページが、画面の (100, 50) にある想定
const page = { left: 100, top: 50, width: 500, height: 700 };

describe('clientRectsToQuads（画面の位置 → ページ正規化座標）', () => {
  it('ページ内の位置を 0〜1 に変換する', () => {
    const quads = clientRectsToQuads([{ left: 150, top: 120, width: 100, height: 14 }], page);
    expect(quads).toEqual([[[0.1, 0.1], [0.3, 0.1], [0.3, 0.12], [0.1, 0.12]]]);
  });

  it('表示の大きさが変わっても、同じ場所なら同じ座標になる（拡大率に依存しない）', () => {
    const small = clientRectsToQuads([{ left: 150, top: 120, width: 100, height: 14 }], page);
    const zoomed = clientRectsToQuads(
      [{ left: 100 + 50 * 2, top: 50 + 70 * 2, width: 200, height: 28 }],
      { left: 100, top: 50, width: 1000, height: 1400 }
    );
    expect(zoomed).toEqual(small);
  });

  it('同じ行の細切れの長方形を1つにまとめ、別の行は分ける', () => {
    const quads = clientRectsToQuads(
      [
        { left: 150, top: 120, width: 40, height: 14 },
        { left: 191, top: 121, width: 60, height: 13 },
        { left: 150, top: 140, width: 80, height: 14 },
      ],
      page
    );
    expect(quads).toHaveLength(2);
    expect(quadBounds(quads[0])).toEqual({ x1: 0.1, y1: 0.1, x2: 0.302, y2: 0.12 });
  });

  it('大きさのない長方形やページの外の部分を取り除く', () => {
    const quads = clientRectsToQuads(
      [
        { left: 150, top: 120, width: 0, height: 14 },
        { left: 550, top: 700, width: 200, height: 100 }, // 右下にはみ出す
      ],
      page
    );
    expect(quads).toHaveLength(1);
    expect(quadBounds(quads[0])).toEqual({ x1: 0.9, y1: 0.92857, x2: 1, y2: 1 });
  });

  it('ページの大きさが 0 なら空', () => {
    expect(clientRectsToQuads([{ left: 1, top: 1, width: 5, height: 5 }], { left: 0, top: 0, width: 0, height: 0 })).toEqual([]);
  });
});

describe('mergeLineRects', () => {
  it('2段組みの左右の段は、同じ高さでも離れていればまとめない', () => {
    const lines = mergeLineRects([
      { x1: 0.1, y1: 0.2, x2: 0.45, y2: 0.22 },
      { x1: 0.55, y1: 0.2, x2: 0.9, y2: 0.22 },
    ]);
    expect(lines).toHaveLength(2);
  });
});

describe('pointInQuad（クリックした点がマーカーの中か）', () => {
  const quad = rectToQuad({ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.12 });
  it('内側と外側を判定する', () => {
    expect(pointInQuad([0.2, 0.11], quad)).toBe(true);
    expect(pointInQuad([0.35, 0.11], quad)).toBe(false);
  });

  it('傾いた四角形でも判定できる', () => {
    const tilted = [[0.5, 0.1], [0.6, 0.2], [0.5, 0.3], [0.4, 0.2]];
    expect(pointInQuad([0.5, 0.2], tilted)).toBe(true);
    expect(pointInQuad([0.42, 0.12], tilted)).toBe(false);
  });
});

describe('compareHighlights（一覧の並び順）', () => {
  it('ページ順 → 上から順', () => {
    const items = [
      { id: 'c', pageIndex: 2, quads: [rectToQuad({ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.12 })] },
      { id: 'b', pageIndex: 1, quads: [rectToQuad({ x1: 0.1, y1: 0.5, x2: 0.2, y2: 0.52 })] },
      { id: 'a', pageIndex: 1, quads: [rectToQuad({ x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.22 })] },
    ];
    expect([...items].sort(compareHighlights).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

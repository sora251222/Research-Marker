// マーカーの位置の計算（画面やブラウザに依存しない純粋な関数）
//
// 位置は「ページ正規化座標」で保存する：ページの左上が (0, 0)、右下が (1, 1)。
// どんな大きさで表示しても、ページのどこにあるかは変わらないため、
// 拡大・縮小、画面幅の変更、別の端末でも同じ位置にマーカーを描ける。
// 形は「4点の四角形（quad）」で持つ：[[左上], [右上], [右下], [左下]]。
// 通常のPDFでは傾きのない長方形だが、将来のOCR（傾いた写真）でも同じ形式を使える。

const PRECISION = 100000; // 小数点以下5桁で保存する（十分に細かく、データも小さい）

const round = (value) => Math.round(value * PRECISION) / PRECISION;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * 画面上の長方形（ブラウザの getClientRects() の結果）を、ページ正規化座標の4点の四角形に変える。
 * 同じ行に並ぶ長方形はまとめ、極端に小さいものは捨てる。
 *
 * @param {Array<{left: number, top: number, width: number, height: number}>} clientRects
 * @param {{left: number, top: number, width: number, height: number}} pageRect ページの台紙の位置と大きさ
 * @returns {number[][][]} 4点の四角形の配列
 */
export function clientRectsToQuads(clientRects, pageRect) {
  if (!pageRect.width || !pageRect.height) {
    return [];
  }

  const normalized = Array.from(clientRects)
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => {
      const x1 = clamp01((rect.left - pageRect.left) / pageRect.width);
      const y1 = clamp01((rect.top - pageRect.top) / pageRect.height);
      const x2 = clamp01((rect.left + rect.width - pageRect.left) / pageRect.width);
      const y2 = clamp01((rect.top + rect.height - pageRect.top) / pageRect.height);
      return { x1, y1, x2, y2 };
    })
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);

  return mergeLineRects(normalized).map(rectToQuad);
}

/**
 * 同じ行にある長方形を1つにまとめる。
 * 縦方向に半分以上重なり、横の隙間が小さいものを「同じ行」とみなす。
 * （PDFの文字は1文字・1単語ごとに分かれていることが多く、そのままだと細切れになるため）
 */
export function mergeLineRects(rects, maxGap = 0.01) {
  const sorted = [...rects].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const lines = [];

  for (const rect of sorted) {
    const line = lines.find((candidate) => {
      const overlap = Math.min(candidate.y2, rect.y2) - Math.max(candidate.y1, rect.y1);
      const minHeight = Math.min(candidate.y2 - candidate.y1, rect.y2 - rect.y1);
      const gap = Math.max(rect.x1 - candidate.x2, candidate.x1 - rect.x2);
      return overlap >= minHeight * 0.5 && gap <= maxGap;
    });
    if (line) {
      line.x1 = Math.min(line.x1, rect.x1);
      line.y1 = Math.min(line.y1, rect.y1);
      line.x2 = Math.max(line.x2, rect.x2);
      line.y2 = Math.max(line.y2, rect.y2);
    } else {
      lines.push({ ...rect });
    }
  }
  return lines.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
}

/** 長方形を4点の四角形にする（左上・右上・右下・左下の順） */
export function rectToQuad({ x1, y1, x2, y2 }) {
  return [
    [round(x1), round(y1)],
    [round(x2), round(y1)],
    [round(x2), round(y2)],
    [round(x1), round(y2)],
  ];
}

/** 4点の四角形を囲む長方形 */
export function quadBounds(quad) {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/**
 * 点が4点の四角形の中にあるか（傾いた四角形にも対応）。
 * 各辺に対して点が同じ側にあれば内側とみなす。
 */
export function pointInQuad([px, py], quad) {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % quad.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

/** マーカーの並び順：ページ順 → ページ内で上から順 → 左から順 */
export function compareHighlights(a, b) {
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  const boundsA = quadBounds(a.quads[0]);
  const boundsB = quadBounds(b.quads[0]);
  return boundsA.y1 - boundsB.y1 || boundsA.x1 - boundsB.x1;
}

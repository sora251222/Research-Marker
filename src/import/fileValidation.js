// 取り込むファイルの検証（形式・容量・組み合わせ）
// 画面にもブラウザの機能にも依存しない「純粋な関数」だけを置き、自動テストで確認する。

const MB = 1024 * 1024;

/** 取り込みの上限（CLAUDE.md 第7章） */
export const LIMITS = {
  pdfMaxBytes: 30 * MB, // PDF 1ファイル
  imageMaxBytes: 20 * MB, // 画像 1枚
  maxPages: 100, // 1論文あたりのページ数
  totalMaxBytes: 300 * MB, // 1回の取り込みの合計（ブラウザのメモリを使いすぎないため）
};

const KIND_LABELS = { pdf: 'PDF', jpeg: 'JPEG', png: 'PNG' };

/**
 * ファイル先頭のバイト列（数値の並び）から、本当の形式を判定する。
 * 拡張子は名前を変えるだけで偽れるため、中身で確認する。
 * @param {Uint8Array} bytes ファイル先頭（1024バイト程度）
 * @returns {'pdf'|'jpeg'|'png'|null}
 */
export function detectFileKind(bytes) {
  if (!bytes || bytes.length < 4) {
    return null;
  }
  // PNG：89 50 4E 47 0D 0A 1A 0A
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSignature.every((value, index) => bytes[index] === value)) {
    return 'png';
  }
  // JPEG：FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // PDF：先頭1024バイト以内に「%PDF-」がある（規格上、先頭に少し余分なデータがあってもよい）
  const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const searchEnd = Math.min(bytes.length, 1024) - pdfSignature.length;
  for (let start = 0; start <= searchEnd; start += 1) {
    if (pdfSignature.every((value, offset) => bytes[start + offset] === value)) {
      return 'pdf';
    }
  }
  return null;
}

/** ファイル名の拡張子から形式を判定する（大文字・小文字は区別しない） */
export function kindFromFileName(fileName) {
  const extension = String(fileName).toLowerCase().split('.').pop();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'png') return 'png';
  return null;
}

/**
 * 1つのファイルを検証する。問題があれば日本語のメッセージ、なければ null を返す。
 * @param {{name: string, size: number, detectedKind: string|null}} entry
 */
export function validateFileEntry({ name, size, detectedKind }) {
  if (size === 0) {
    return `「${name}」は空のファイルです。`;
  }
  if (!detectedKind) {
    return `「${name}」は PDF・JPEG・PNG のいずれでもないため、取り込めません。`;
  }
  const nameKind = kindFromFileName(name);
  if (nameKind !== detectedKind) {
    return `「${name}」は拡張子と中身の形式（${KIND_LABELS[detectedKind]}）が一致しないため、取り込めません。`;
  }
  if (detectedKind === 'pdf' && size > LIMITS.pdfMaxBytes) {
    return `「${name}」は ${formatLimit(LIMITS.pdfMaxBytes)} を超えているため、取り込めません（PDFの上限）。`;
  }
  if (detectedKind !== 'pdf' && size > LIMITS.imageMaxBytes) {
    return `「${name}」は ${formatLimit(LIMITS.imageMaxBytes)} を超えているため、取り込めません（画像1枚の上限）。`;
  }
  return null;
}

/**
 * 選んだファイルの組み合わせを検証する。
 * PDF は1回に1件、画像は複数枚を1件の論文としてまとめる。PDFと画像の混在は受け付けない。
 * @param {Array<{kind: string, size: number}>} entries
 * @returns {string|null} 問題があればメッセージ
 */
export function validateSelection(entries) {
  if (entries.length === 0) {
    return 'ファイルが選択されていません。';
  }
  const pdfCount = entries.filter((entry) => entry.kind === 'pdf').length;
  const imageCount = entries.length - pdfCount;

  if (pdfCount > 0 && imageCount > 0) {
    return 'PDFと画像は同時に取り込めません。PDFは1件ずつ、画像は同じ論文のページだけをまとめて選んでください。';
  }
  if (pdfCount > 1) {
    return 'PDFは1件ずつ取り込んでください。';
  }
  if (imageCount > LIMITS.maxPages) {
    return `画像は1件の論文につき ${LIMITS.maxPages} 枚までです（${imageCount} 枚選択されています）。`;
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes > LIMITS.totalMaxBytes) {
    return `1回に取り込めるのは合計 ${formatLimit(LIMITS.totalMaxBytes)} までです。枚数を分けてください。`;
  }
  return null;
}

/** 配列の要素を from の位置から to の位置へ動かした「新しい配列」を返す（元の配列は変えない） */
export function moveItem(items, fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
    return [...items];
  }
  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

function formatLimit(bytes) {
  return `${Math.round(bytes / MB)}MB`;
}

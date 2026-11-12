// 表示確認用のサンプル論文（架空のデータ）
// 実際の論文の登録・保存はフェーズ2以降で実装する。
// isSample: true を付け、画面上でも必ず「サンプル」と表示する。

export const samplePapers = [
  {
    id: 'sample-1',
    isSample: true,
    title:
      '日本語の医学論文のタイトルがここに入ります：長いタイトルでも自然に折り返して表示されることを確認するための例文です',
    authors: ['山田太郎', '鈴木花子', '佐藤一郎'],
    journal: 'サンプル医学雑誌',
    year: 2024,
    fileTypeLabel: '通常PDF',
  },
  {
    id: 'sample-2',
    isSample: true,
    title: 'Title of an English paper for layout testing',
    authors: ['Smith J', 'Brown A'],
    journal: 'Sample J Med',
    year: 2023,
    fileTypeLabel: '画像（3枚）',
  },
];

// 論文閲覧画面：選ばれた論文のタイトルを表示する
// PDF・画像の表示はフェーズ2で実装する。

import { findPaperById } from '../state.js';

/** 表示する論文を切り替える。論文が見つからなければ案内を表示する */
export function showPaperInViewer(paperId) {
  const heading = document.getElementById('viewer-heading');
  const sampleTag = document.getElementById('viewer-sample-tag');
  const message = document.getElementById('viewer-message');
  const layout = document.getElementById('viewer-layout');

  const paper = paperId ? findPaperById(paperId) : null;

  if (!paper) {
    heading.textContent = '論文が選択されていません';
    sampleTag.hidden = true;
    message.textContent = paperId
      ? '指定された論文が見つかりません。論文ライブラリから選び直してください。'
      : '論文ライブラリから、読みたい論文を選んでください。';
    message.hidden = false;
    layout.hidden = true;
    return;
  }

  heading.textContent = paper.title;
  sampleTag.hidden = !paper.isSample;
  message.hidden = true;
  layout.hidden = false;
}

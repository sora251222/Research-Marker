// 画面の切り替え（ルーター）
// URL の「#」より後ろ（ハッシュ）を読んで、どの画面を表示するかを決める。
//   #/library        … 論文ライブラリ
//   #/upload         … 論文の格納（アップロード）
//   #/search         … 論文ライブラリ（検索欄に移動）
//   #/paper/論文ID   … 論文閲覧
//   #/settings       … 設定
// ハッシュを使うと、ページを再読み込みしなくても画面を切り替えられ、
// ブラウザの「戻る」ボタンも使える。

/**
 * ハッシュ文字列を「表示する画面の情報」に変換する（純粋な関数）。
 * 例：'#/paper/sample-1' → { view: 'viewer', paperId: 'sample-1' }
 */
export function parseRoute(hash) {
  const path = String(hash ?? '').replace(/^#\/?/, '');
  const [section, rawId] = path.split('/');

  switch (section) {
    case '':
    case 'library':
      return { view: 'library' };
    case 'upload':
      return { view: 'upload' };
    case 'search':
      return { view: 'library', focusSearch: true };
    case 'paper':
      return { view: 'viewer', paperId: decodeId(rawId) };
    case 'settings':
      return { view: 'settings' };
    default:
      // 知らないアドレスのときは、論文ライブラリを表示する
      return { view: 'library', unknown: true };
  }
}

/** URL に入れた論文IDを元に戻す。壊れた文字列でもエラーで止まらないようにする */
function decodeId(rawId) {
  if (!rawId) {
    return null;
  }
  try {
    return decodeURIComponent(rawId);
  } catch {
    return null;
  }
}

/** 論文IDから、論文閲覧画面のハッシュを作る */
export function paperRouteHash(paperId) {
  return `#/paper/${encodeURIComponent(paperId)}`;
}

/**
 * ルーターを開始する。
 * ハッシュが変わるたびに onRouteChange(画面の情報, { isInitial }) を呼ぶ。
 */
export function startRouter(onRouteChange) {
  const handleChange = (isInitial) => {
    onRouteChange(parseRoute(window.location.hash), { isInitial });
  };
  window.addEventListener('hashchange', () => handleChange(false));
  handleChange(true);
}

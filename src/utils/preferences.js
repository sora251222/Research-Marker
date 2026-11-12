// 画面の好み（サイドバーを閉じているか等）を、この端末のブラウザに覚えさせる。
// 論文やマーカーのような大切なデータには使わない（それらはクラウドに保存する予定）。
// プライベートモードなどで保存できない場合もあるため、失敗しても画面が動くようにする。

const KEY_PREFIX = 'research-marker:';

/** 保存した値を読む。読めなければ fallback（既定値）を返す */
export function readPreference(name, fallback) {
  try {
    const stored = window.localStorage.getItem(KEY_PREFIX + name);
    return stored === null ? fallback : JSON.parse(stored);
  } catch {
    return fallback;
  }
}

/** 値を保存する。保存できなくてもエラーで止めない */
export function writePreference(name, value) {
  try {
    window.localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value));
  } catch {
    // 保存できない環境では、今回の表示中だけ有効になる
  }
}

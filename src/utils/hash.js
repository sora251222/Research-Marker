// ファイルの「指紋」（SHA-256）を計算する
// 同じ中身のファイルなら必ず同じ値になるため、重複登録の検出や、
// 保存したデータが壊れていないかの確認に使う。

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string>} 64文字の16進数の文字列
 */
export async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

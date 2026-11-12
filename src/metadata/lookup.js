// 外部の書誌情報サービスへの問い合わせ
// 呼び出し先は自分のサーバーの /api/...（開発中は vite.config.js が中継する）。
// 送るのは DOI・タイトルなどの検索語だけ。PDF・画像は送らない。
//
// 使い分け（CLAUDE.md 第9章）：
//   JaLC      … 日本語論文の書誌情報（保存してよい）
//   Crossref  … 英語論文の書誌情報（保存してよい）、DOIがないときのタイトル検索
//   PubMed    … NLM の書き方の著者名・略誌名・英語タイトル
//   J-STAGE   … DOIがない日本語論文の検索だけに使う（結果は保存しない。24時間以上の保存は規約で禁止）

import { parseJalcRecord, parseCrossrefWork, parsePubmedSummary, cleanText } from './parsers.js';

const API = {
  jalc: '/api/jalc',
  crossref: '/api/crossref',
  jstage: '/api/jstage',
  ncbi: '/api/ncbi',
};
const TIMEOUT_MS = 15000;

/** 外部サービスにつながらない・応答がおかしいときのエラー */
export class LookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LookupError';
  }
}

/** URL から取得する（404 は「見つからない」として null を返す） */
async function request(url, type = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: type === 'json' ? 'application/json' : 'application/xml' } });
  } catch {
    throw new LookupError('外部の書誌情報サービスに接続できませんでした。インターネット接続を確認してください。');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) return null;
  if (response.status === 429) {
    throw new LookupError('外部の書誌情報サービスへの問い合わせが多すぎます。少し時間をおいてから、もう一度お試しください。');
  }
  if (!response.ok) {
    throw new LookupError(`外部の書誌情報サービスから正しい応答がありませんでした（${response.status}）。`);
  }
  try {
    return type === 'json' ? await response.json() : await response.text();
  } catch {
    throw new LookupError('外部の書誌情報サービスの応答を読み取れませんでした。');
  }
}

// ---------- DOI から取得 ----------

async function fetchJalc(doi) {
  // JaLC の API は、DOI の「/」を2回エンコードした形（%252F）で受け付ける
  const json = await request(`${API.jalc}/v2/dois/${encodeURIComponent(encodeURIComponent(doi))}`);
  return json?.status === 'OK' && json.data ? json.data : null;
}

async function fetchCrossref(doi) {
  const json = await request(`${API.crossref}/works/${encodeURIComponent(doi)}`);
  return json?.message ?? null;
}

async function findPmidByDoi(doi) {
  const term = encodeURIComponent(`${doi}[doi]`);
  const json = await request(`${API.ncbi}/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${term}`);
  const ids = json?.esearchresult?.idlist ?? [];
  return ids.length === 1 ? ids[0] : null; // 1件に決まらないときは使わない
}

async function fetchPubmedSummary(pmid) {
  const json = await request(`${API.ncbi}/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}`);
  return json?.result?.[pmid] ?? null;
}

/**
 * DOI から書誌情報を取得する。
 * 日本語論文らしければ JaLC を先に、そうでなければ Crossref を先に問い合わせる。
 * PubMed に収載されていれば、NLM の書き方の著者名・略誌名（・英語タイトル）で補う。
 * @returns {Promise<null|{fields: object, fieldSources: Record<string, string>, sources: string[], warnings: string[]}>}
 */
export async function lookupByDoi(doi, { japaneseFirst = false } = {}) {
  const fieldSources = {};
  const sources = [];
  const warnings = [];
  let fields = null;
  let pmid = null;

  const tryJalc = async () => {
    const data = await fetchJalc(doi);
    if (!data) return false;
    const parsed = parseJalcRecord(data);
    fields = parsed.fields;
    pmid = parsed.pmid;
    markSources(fields, fieldSources, 'JaLC');
    sources.push('JaLC');
    return true;
  };
  const tryCrossref = async () => {
    const message = await fetchCrossref(doi);
    if (!message) return false;
    fields = parseCrossrefWork(message).fields;
    markSources(fields, fieldSources, 'Crossref');
    sources.push('Crossref');
    return true;
  };

  const found = japaneseFirst ? (await tryJalc()) || (await tryCrossref()) : (await tryCrossref()) || (await tryJalc());
  if (!found) return null;

  // PubMed で補う（失敗しても、ここまでの結果は使う）
  try {
    pmid = pmid ?? (await findPmidByDoi(doi));
    const record = pmid ? await fetchPubmedSummary(pmid) : null;
    if (record) {
      const pubmed = parsePubmedSummary(record);
      sources.push('PubMed');
      setField(fields, fieldSources, 'pmid', pubmed.pmid, 'PubMed');
      if (fields.language === 'ja' || pubmed.isJapanese) {
        // 日本語論文：NLM形式で書くための英語表記
        setField(fields, fieldSources, 'titleEn', pubmed.title, 'PubMed');
        setField(fields, fieldSources, 'authorsEn', pubmed.authors, 'PubMed');
        setField(fields, fieldSources, 'journalAbbrNlm', pubmed.journalAbbr, 'PubMed');
      } else {
        // 英語論文：NLM の書き方の著者名・略誌名・タイトル（文頭だけ大文字の書き方）
        setField(fields, fieldSources, 'authors', pubmed.authors, 'PubMed');
        setField(fields, fieldSources, 'journalAbbr', pubmed.journalAbbr, 'PubMed');
        setField(fields, fieldSources, 'title', pubmed.title, 'PubMed');
      }
    }
  } catch (error) {
    warnings.push(`PubMed には問い合わせできませんでした（${error.message}）`);
  }

  // DOI は大文字・小文字を区別しないが、サービスによっては小文字で返すため、論文に書かれていた形を使う
  if (!fields.doi || fields.doi.toLowerCase() === doi.toLowerCase()) {
    setField(fields, fieldSources, 'doi', doi, fieldSources.doi ?? sources[0]);
  }
  return { fields, fieldSources, sources, warnings };
}

function markSources(fields, fieldSources, source) {
  for (const [key, value] of Object.entries(fields)) {
    if (hasValue(value)) fieldSources[key] = source;
  }
}

function setField(fields, fieldSources, key, value, source) {
  if (!hasValue(value)) return;
  fields[key] = value;
  fieldSources[key] = source;
}

export function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== '';
}

// ---------- タイトルで検索（候補を返すだけ。保存はしない） ----------

/**
 * J-STAGE で日本語論文を探す。結果は候補として表示するだけで、保存しない（J-STAGE の規約）。
 * 候補を選んだら、その DOI で JaLC から取り直して保存する。
 */
export async function searchJstage(title) {
  const query = encodeURIComponent(title.slice(0, 60));
  const xml = await request(`${API.jstage}/searchapi/do?service=3&count=5&article=${query}`, 'text');
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const text = (parent, selector) => cleanText(parent.getElementsByTagName(selector)[0]?.textContent);

  return Array.from(doc.getElementsByTagName('entry')).map((entry) => {
    const articleTitle = entry.getElementsByTagName('article_title')[0];
    const material = entry.getElementsByTagName('material_title')[0];
    const author = entry.getElementsByTagName('author')[0];
    const names = author ? Array.from(author.getElementsByTagName('ja')[0]?.getElementsByTagName('name') ?? []) : [];
    return {
      source: 'J-STAGE',
      title: (articleTitle && (text(articleTitle, 'ja') ?? text(articleTitle, 'en'))) ?? null,
      authors: names.map((name) => cleanText(name.textContent)).filter(Boolean),
      journal: (material && (text(material, 'ja') ?? text(material, 'en'))) ?? null,
      year: text(entry, 'pubyear'),
      volume: text(entry, 'prism:volume'),
      issue: text(entry, 'prism:number'),
      pageStart: text(entry, 'prism:startingPage'),
      doi: text(entry, 'prism:doi'),
    };
  });
}

/** Crossref でタイトルから探す（主に英語論文） */
export async function searchCrossref(title) {
  const query = encodeURIComponent(title.slice(0, 200));
  const select = 'DOI,title,author,container-title,short-container-title,volume,issue,page,issued';
  const json = await request(`${API.crossref}/works?rows=5&query.bibliographic=${query}&select=${select}`);
  return (json?.message?.items ?? []).map((item) => {
    const { fields } = parseCrossrefWork(item);
    return { source: 'Crossref', ...fields };
  });
}

// 外部の書誌情報サービスの結果を、Research Marker の書誌情報の形に変える（純粋な関数）
//
// 変換のルール：
//   ・取得した表記をできるだけそのまま使う（ただし HTML のタグと、連続する空白は取り除く）
//   ・欧文の名は、頭文字に変えて「姓 頭文字」（例：Scott D. → Halpern SD）にする（NLM の書き方）
//   ・ない項目は作らない（null のまま）

/** HTML のタグ・連続する空白を取り除く */
export function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** 欧文の名を頭文字にする（例：「Scott D.」→「SD」、「Jean-Pierre」→「JP」） */
export function initialsFromGiven(given) {
  return String(given ?? '')
    .split(/[\s.\-‐]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** 欧文の著者名を NLM の書き方にする（例：Halpern, Scott D. → Halpern SD） */
export function formatWesternAuthor(family, given) {
  const familyName = cleanText(family);
  if (!familyName) return null;
  const initials = initialsFromGiven(given);
  return initials ? `${familyName} ${initials}` : familyName;
}

/** ページ「284-287」を開始・終了に分ける */
export function splitPages(page) {
  const text = cleanText(page);
  if (!text) return { pageStart: null, pageEnd: null };
  const [start, end] = text.split(/[-‐–—]/).map((part) => part.trim());
  return { pageStart: start || null, pageEnd: end || null };
}

// ---------- JaLC（日本の論文の DOI 登録機関） ----------

/**
 * JaLC REST API（/v2/dois/{doi}）の data を変換する。
 * @returns {{fields: object, pmid: string|null}}
 */
export function parseJalcRecord(data) {
  const language = data.content_language === 'en' ? 'en' : 'ja';
  const titles = data.title_list ?? [];
  const isJapaneseText = (text) => /[぀-ヿ㐀-鿿]/.test(text ?? '');
  const jaTitle = titles.find((item) => item.lang === 'ja') ?? titles.find((item) => !item.lang && isJapaneseText(item.title));
  const enTitle = titles.find((item) => item.lang === 'en');

  // タイトルに副題が含まれていなければ、空白をはさんで付け足す
  const withSubtitle = (item) => {
    if (!item) return null;
    const title = cleanText(item.title);
    const subtitle = cleanText(item.subtitle);
    if (title && subtitle && !title.includes(subtitle)) return `${title} ${subtitle}`;
    return title;
  };

  const persons = (data.creator_list ?? []).filter((creator) => creator.type !== 'organization');
  const japaneseNames = persons
    .map((creator) => creator.names?.find((name) => name.lang === 'ja'))
    .filter(Boolean)
    .map((name) => `${cleanText(name.last_name) ?? ''}${cleanText(name.first_name) ?? ''}`)
    .filter(Boolean);
  const englishNames = persons
    .map((creator) => creator.names?.find((name) => name.lang === 'en'))
    .filter(Boolean)
    .map((name) => formatWesternAuthor(name.last_name, name.first_name))
    .filter(Boolean);

  const journals = data.journal_title_name_list ?? [];
  const journalName = (type, lang) =>
    cleanText(journals.find((item) => item.type === type && item.lang === lang)?.journal_title_name);

  const pmid = (data.alternate_identifier_list ?? []).find((item) => item.type === 'PMID')?.alternate_identifier ?? null;
  const mainTitle = language === 'ja' ? withSubtitle(jaTitle) ?? withSubtitle(enTitle) : withSubtitle(enTitle) ?? withSubtitle(jaTitle);

  return {
    fields: {
      language,
      title: mainTitle,
      titleEn: language === 'ja' ? withSubtitle(enTitle) : null,
      authors: language === 'ja' && japaneseNames.length > 0 ? japaneseNames : englishNames,
      authorsEn: language === 'ja' ? englishNames : [],
      journal: language === 'ja' ? journalName('full', 'ja') ?? journalName('full', 'en') : journalName('full', 'en'),
      journalAbbr: language === 'ja' ? journalName('abbreviation', 'ja') : journalName('abbreviation', 'en'),
      year: cleanText(data.publication_date?.publication_year),
      volume: cleanText(data.volume),
      issue: cleanText(data.issue),
      pageStart: cleanText(data.first_page),
      pageEnd: cleanText(data.last_page),
      doi: cleanText(data.doi),
      pmid,
    },
    pmid,
  };
}

// ---------- Crossref（主に英語論文の DOI 登録機関） ----------

/** Crossref の works の message を変換する */
export function parseCrossrefWork(message) {
  const authors = (message.author ?? [])
    .map((author) => (author.family ? formatWesternAuthor(author.family, author.given) : cleanText(author.name)))
    .filter(Boolean);
  const dateParts = (message.issued ?? message['published-print'] ?? message['published-online'])?.['date-parts']?.[0];
  const { pageStart, pageEnd } = splitPages(message.page);

  return {
    fields: {
      language: message.language === 'ja' ? 'ja' : 'en',
      title: cleanText(message.title?.[0]),
      authors,
      journal: cleanText(message['container-title']?.[0]),
      journalAbbr: cleanText(message['short-container-title']?.[0]),
      year: dateParts?.[0] ? String(dateParts[0]) : null,
      volume: cleanText(message.volume),
      issue: cleanText(message.issue),
      pageStart,
      pageEnd,
      articleNumber: pageStart ? null : cleanText(message['article-number']),
      doi: cleanText(message.DOI),
    },
  };
}

// ---------- PubMed（NLM の医学文献データベース） ----------

/**
 * PubMed の esummary の1件を変換する。
 * PubMed の値は NLM の書き方（著者「Halpern SD」、略誌名「N Engl J Med」）なので、
 * 英語論文では著者・略誌名に、日本語論文では NLM 形式用の英語表記に使う。
 */
export function parsePubmedSummary(record) {
  const isJapanese = (record.lang ?? []).includes('jpn');
  const authors = (record.authors ?? [])
    .filter((author) => author.authtype !== 'CollectiveName' || author.name)
    .map((author) => cleanText(author.name))
    .filter(Boolean);
  // 日本語論文の英訳タイトルは「[...]」で囲まれ、末尾にピリオドがある → 囲みとピリオドを外す
  const title = cleanText(record.title)?.replace(/^\[(.*)\]\.?$/, '$1').replace(/\.$/, '') ?? null;
  const year = cleanText(record.pubdate)?.match(/\d{4}/)?.[0] ?? null;

  return {
    isJapanese,
    pmid: cleanText(record.uid),
    authors,
    title,
    journalAbbr: cleanText(record.source),
    year,
    volume: cleanText(record.volume),
    issue: cleanText(record.issue),
  };
}

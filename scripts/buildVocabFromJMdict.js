/**
 * Builds src/data/vocab.json from JMdict + JmdictFurigana.
 *
 * For each kanji in our dataset, collects all JMdict entries containing it,
 * ranks by frequency (common flag), derives JLPT level from the hardest kanji
 * in the word, attaches furigana decomposition (ruby/rt pairs), and stores
 * kanjiUsed so the app can filter by what the user has already learned.
 *
 * Output shape per entry:
 * {
 *   word: "土曜日",
 *   reading: "どようび",
 *   meaning: "Saturday",
 *   jlptLevel: 5,        // min level = hardest kanji in word (5=easiest, 1=hardest)
 *   common: true,
 *   parts: [
 *     { text: "土", reading: "ど" },
 *     { text: "曜", reading: "よう" },
 *     { text: "日", reading: "び" }
 *   ],
 *   kanjiUsed: ["土", "曜", "日"]   // CJK chars in word — for known-kanji filtering
 * }
 *
 * Usage:
 *   node scripts/buildVocabFromJMdict.js
 *   node scripts/buildVocabFromJMdict.js --limit 20   (words per kanji, default 15)
 */

const fs   = require('fs');
const path = require('path');

const KANJI_JSON    = path.join(__dirname, '../src/data/kanji.json');
const JMDICT_JSON   = path.join(__dirname, '../src/data/jmdict-eng-3.6.2.json');
const FURIGANA_JSON = path.join(__dirname, './JmdictFurigana.json');
const OUT_FILE      = path.join(__dirname, '../src/data/vocab.json');

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit=')) ?? args[args.indexOf('--limit') + 1];
const LIMIT = (limitArg && !limitArg.startsWith('--')) ? parseInt(limitArg) : 15;

// ─── Load data ────────────────────────────────────────────────────────────────

console.log('Loading kanji.json...');
const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON, 'utf8'));

console.log('Loading JMdict...');
const jmdict = JSON.parse(fs.readFileSync(JMDICT_JSON, 'utf8'));

console.log('Loading JmdictFurigana...');
const furiganaRaw = fs.readFileSync(FURIGANA_JSON, 'utf8').replace(/^\uFEFF/, '');
const furiganaList = JSON.parse(furiganaRaw);

// ─── Build lookup maps ────────────────────────────────────────────────────────

// kanji character → JLPT level (5=N5 easiest, 1=N1 hardest, 0=not in our set)
const kanjiLevel = {};
for (const k of allKanji) kanjiLevel[k.character] = k.jlptLevel;

const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;

function kanjiIn(text) {
  return [...text.matchAll(CJK_RE)].map(m => m[0]);
}

// Derive word's JLPT level: min level = hardest kanji (highest number = easiest)
// Returns 0 if any kanji is unknown to us
function wordJlptLevel(word) {
  const chars = kanjiIn(word);
  if (chars.length === 0) return 5; // kana-only words default to N5
  let minLevel = 5;
  for (const c of chars) {
    const lv = kanjiLevel[c];
    if (!lv) return 0; // contains kanji not in our dataset
    if (lv < minLevel) minLevel = lv;
  }
  return minLevel;
}

// Furigana lookup: word+reading → parts array
// Build map keyed by "word|reading"
console.log('Building furigana index...');
const furiganaMap = {};
for (const entry of furiganaList) {
  const key = `${entry.text}|${entry.reading}`;
  if (!furiganaMap[key]) furiganaMap[key] = entry.furigana;
}

// ─── Build word index from JMdict ─────────────────────────────────────────────

// For each JMdict entry, extract the best kanji form + kana reading + meaning
// "best" = common=true preferred, then first available
console.log('Indexing JMdict entries...');

const wordEntries = []; // { word, reading, meaning, common, jlptLevel, parts, kanjiUsed }

for (const entry of jmdict.words) {
  // Get kanji forms (entries with actual kanji characters)
  const kanjiforms = (entry.kanji ?? []).filter(k =>
    k.text && /[\u4E00-\u9FFF]/.test(k.text) &&        // must contain at least one kanji
    !/[0-9０-９〇①-⑨]/.test(k.text) &&                // no Arabic/fullwidth/circle numerals
    !/^[一二三四五六七八九十百千万]+$/.test(k.text) &&  // skip pure number combinations (十八, 一八, etc.)
    !/[一二三四五六七八九][一二三四五六七八九]/.test(k.text) && // skip abbreviated numbers (二四, 三一, etc.)
    !/[\u30A1-\u30F6]/.test(k.text) &&                 // skip words containing katakana (loanword hybrids)
    !k.tags?.includes('sK') &&                          // skip search-only forms
    !k.tags?.includes('rK')                             // skip rarely-used forms
  );
  if (kanjiforms.length === 0) continue; // kana-only words — skip

  // Get kana readings
  const kanaForms = (entry.kana ?? []).filter(k => !k.tags?.includes('sk'));
  if (kanaForms.length === 0) continue;

  // Get English meaning — skip X-rated, idioms, proverbs, yojijukugo, archaic, rare
  const SKIP_MISC = new Set(['X', 'id', 'proverb', 'yoji', 'arch', 'obs', 'rare', 'dated', 'hist', 'poet']);
  const sense = entry.sense?.find(s =>
    s.gloss?.length > 0 && !(s.misc ?? []).some(m => SKIP_MISC.has(m))
  );
  if (!sense) continue;
  const meaning = sense.gloss[0].text;
  const pos = sense.partOfSpeech ?? [];

  // For each kanji form, pair with its applicable kana reading
  for (const kf of kanjiforms) {
    // Find kana that applies to this kanji form (appliesToKanji = "*" or includes this form)
    const kana = kanaForms.find(k =>
      k.appliesToKanji?.includes('*') || k.appliesToKanji?.includes(kf.text)
    ) ?? kanaForms[0];

    const word    = kf.text;
    const reading = kana.text;
    const common  = kf.common || kana.common;
    const jlptLevel = wordJlptLevel(word);
    if (jlptLevel === 0) continue; // contains kanji outside our dataset

    const furiganaKey = `${word}|${reading}`;
    const furigana = furiganaMap[furiganaKey];
    const parts = furigana
      ? furigana.map(f => ({ text: f.ruby, reading: f.rt }))
      : null; // null = no decomp available

    const kanji = kanjiIn(word);

    wordEntries.push({ word, reading, meaning, pos, common, jlptLevel, parts, kanjiUsed: kanji });
  }
}

console.log(`Total word entries: ${wordEntries.length}`);

// ─── Build per-kanji vocab lists ──────────────────────────────────────────────

// For each kanji, collect entries that contain it, ranked:
//   1. common=true first
//   2. higher jlptLevel first (N5 before N1 — simpler words first)
//   3. shorter word first (simpler compounds)
//   4. has furigana decomp

const result = {};
let totalWords = 0;
let noDecomp = 0;

for (const k of allKanji) {
  const char = k.character;

  const matches = wordEntries
    .filter(e => e.word.includes(char) && e.kanjiUsed.includes(char))
    .sort((a, b) => {
      // common first
      if (b.common !== a.common) return b.common ? 1 : -1;
      // higher jlptLevel first (5=easiest)
      if (b.jlptLevel !== a.jlptLevel) return b.jlptLevel - a.jlptLevel;
      // shorter word first
      if (a.word.length !== b.word.length) return a.word.length - b.word.length;
      // has decomp
      if (!!b.parts !== !!a.parts) return b.parts ? 1 : -1;
      return 0;
    });

  // Deduplicate by word (keep best-ranked)
  const seen = new Set();
  const deduped = [];
  for (const e of matches) {
    if (!seen.has(e.word)) {
      seen.add(e.word);
      deduped.push(e);
    }
  }

  const top = deduped.slice(0, LIMIT);
  result[char] = top.map(e => ({
    word: e.word,
    reading: e.reading,
    meaning: capitalize(e.meaning),
    pos: e.pos,
    jlptLevel: e.jlptLevel,
    common: e.common,
    parts: e.parts,
    kanjiUsed: e.kanjiUsed,
  }));

  totalWords += result[char].length;
  noDecomp += result[char].filter(e => !e.parts).length;
}

// ─── Write output ─────────────────────────────────────────────────────────────

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));

const covered = Object.values(result).filter(v => v.length > 0).length;
console.log(`\nDone!`);
console.log(`Kanji covered: ${covered}/${allKanji.length}`);
console.log(`Total vocab entries: ${totalWords}`);
console.log(`Entries without furigana decomp: ${noDecomp}`);
console.log(`Output: src/data/vocab.json`);

// ─── Sample output ────────────────────────────────────────────────────────────

console.log('\nSample — 日:');
(result['日'] ?? []).slice(0, 5).forEach(e => {
  const parts = e.parts?.map(p => `${p.text}(${p.reading})`).join('+') ?? '—';
  console.log(`  ${e.word} [${e.reading}] N${e.jlptLevel} common=${e.common} → ${parts}`);
  console.log(`    "${e.meaning}"`);
});

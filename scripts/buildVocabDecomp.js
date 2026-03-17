/**
 * Builds a word → reading decomposition table for all vocab entries.
 * For each word, greedily matches each kanji character's known readings
 * (on-yomi and kun-yomi) against the full hiragana reading from left to right.
 *
 * Output: scripts/vocabDecomp.json
 * {
 *   "一日": {
 *     "reading": "いちにち",
 *     "parts": [
 *       { "kanji": "一", "reading": "いち", "type": "on" },
 *       { "kanji": "日", "reading": "にち", "type": "on" }
 *     ]
 *   },
 *   ...
 * }
 *
 * Parts where no reading matched (kana-only stretches, okurigana, unrecognized)
 * are emitted as: { "kanji": "の", "reading": "の", "type": "kana" }
 *
 * Usage:
 *   node scripts/buildVocabDecomp.js
 */

const fs   = require('fs');
const path = require('path');

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const VOCAB_JSON = path.join(__dirname, '../src/data/vocab.json');
const OUT_FILE   = path.join(__dirname, './vocabDecomp.json');

// ─── Load ────────────────────────────────────────────────────────────────────

const allKanji = JSON.parse(fs.readFileSync(KANJI_JSON));
const vocab    = JSON.parse(fs.readFileSync(VOCAB_JSON));

// Build a map: kanji character → { on: string[], kun: string[] }
// Kun readings: strip everything after . or - (okurigana / stem markers)
const kanjiReadings = {};
for (const k of allKanji) {
  kanjiReadings[k.character] = {
    on:  k.readings_on.map(r => toHiragana(r)),
    kun: k.readings_kun.map(r => toHiragana(
    r.replace(/\..*/, '')   // strip okurigana after dot (e.g. ひと.つ → ひと)
     .replace(/^-/, '')     // strip leading dash (e.g. -り → り)
     .replace(/-$/, '')     // strip trailing dash (e.g. ひと- → ひと)
  )).filter(r => r.length > 0),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

function isKanji(ch) { return KANJI_RE.test(ch); }

function toHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// Rendaku map: unvoiced first mora → voiced variant(s)
const RENDAKU = {
  'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご',
  'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
  'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど',
  'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ',
  // h-row can also become p (han-dakuten) in some cases
  'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ',
};

// Apply rendaku to the first mora of a reading (single or compound mora)
function applyRendaku(reading) {
  if (!reading) return reading;
  // Compound mora (2 chars): voice the first char
  const first1 = reading[0];
  const first2 = reading.slice(0, 2);
  const voiced2 = RENDAKU[first2[0]];
  if (voiced2 && reading.length >= 2) return voiced2 + reading.slice(1);
  if (RENDAKU[first1]) return RENDAKU[first1] + reading.slice(1);
  return reading;
}

// Sokuon (gemination): readings ending in ち/く/つ can drop that mora and append っ
// e.g. いち → いっ (before ぽ in いっぽん)
const GEMINATE_ENDINGS = new Set(['ち', 'く', 'つ', 'き', 'ぷ', 'ぺ', 'ぴ', 'ぽ', 'ぱ']);
function applyGeminate(reading) {
  if (reading.length < 2) return null;
  const last = reading[reading.length - 1];
  if (GEMINATE_ENDINGS.has(last)) return reading.slice(0, -1) + 'っ';
  return null;
}

/**
 * Try to decompose `reading` into parts matching each character of `word`.
 * Returns an array of parts, or null if decomposition fails.
 *
 * Strategy: greedy left-to-right.
 * For each character in word:
 *   - If it's a kanji: try all its on+kun readings (longest first) against
 *     the remaining reading string. Take the first match.
 *   - If it's kana: consume matching kana from the reading directly.
 */
function decompose(word, reading) {
  const parts = [];
  let pos = 0; // cursor into reading string

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const remaining = reading.slice(pos);

    if (!isKanji(ch)) {
      // Kana character — consume it directly from the reading
      const hch = toHiragana(ch);
      if (remaining.startsWith(hch)) {
        parts.push({ kanji: ch, reading: hch, type: 'kana' });
        pos += hch.length;
      } else if (remaining.length > 0) {
        // Mismatch — consume one mora anyway and mark unknown
        parts.push({ kanji: ch, reading: remaining[0], type: 'unknown' });
        pos += 1;
      } else {
        parts.push({ kanji: ch, reading: '', type: 'unknown' });
      }
      continue;
    }

    const kr = kanjiReadings[ch];
    if (!kr) {
      // Unknown kanji — try to consume something
      parts.push({ kanji: ch, reading: '', type: 'unknown' });
      continue;
    }

    // Collect all candidate readings, sort longest first (greedy)
    const baseCandidates = [
      ...kr.on.map(r  => ({ reading: r,  type: 'on'  })),
      ...kr.kun.map(r => ({ reading: r,  type: 'kun' })),
    ].filter(c => c.reading.length > 0);

    // Expand with rendaku (sequential voicing) and sokuon (geminate) variants
    const candidates = [];
    for (const c of baseCandidates) {
      candidates.push(c);
      // Rendaku: voice the first mora of the reading
      const rendaku = applyRendaku(c.reading);
      if (rendaku !== c.reading) candidates.push({ reading: rendaku, type: c.type });
      // Sokuon: reading ends in ち/く/つ → truncate last mora, append っ (e.g. いち→いっ)
      const sokuon = applyGeminate(c.reading);
      if (sokuon) candidates.push({ reading: sokuon, type: c.type });
    }
    candidates.sort((a, b) => b.reading.length - a.reading.length);

    const match = candidates.find(c => remaining.startsWith(c.reading));
    if (match) {
      parts.push({ kanji: ch, reading: match.reading, type: match.type });
      pos += match.reading.length;
    } else {
      // No reading matched — attach remaining string to this kanji if it's the last one,
      // otherwise record empty and let later kanji consume the reading
      if (i === word.length - 1 && remaining.length > 0) {
        parts.push({ kanji: ch, reading: remaining, type: 'unknown' });
        pos = reading.length;
      } else {
        parts.push({ kanji: ch, reading: '', type: 'unknown' });
      }
    }
  }

  // If there's leftover reading, attach it to the last part
  if (pos < reading.length) {
    const leftover = reading.slice(pos);
    if (parts.length > 0) {
      parts[parts.length - 1].reading += leftover;
    } else {
      parts.push({ kanji: '', reading: leftover, type: 'kana' });
    }
  }

  return parts;
}

// ─── Build table ─────────────────────────────────────────────────────────────

const result = {};
let total = 0;
let unknown = 0;

for (const entries of Object.values(vocab)) {
  for (const entry of entries) {
    const { word, reading } = entry;
    if (!word || !reading || result[word]) continue;

    const hira = toHiragana(reading);
    const parts = decompose(word, hira);
    result[word] = { reading: hira, parts };
    total++;

    if (parts.some(p => p.type === 'unknown')) unknown++;
  }
}

// Sort keys for readability
const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 2));

console.log(`Done. ${total} words decomposed, ${unknown} with unmatched readings.`);
console.log(`Output: scripts/vocabDecomp.json`);

// Show examples
const examples = ['一日', '二人', '九月', '日本語', '勉強', '電話'];
console.log('\nExamples:');
for (const w of examples) {
  const d = result[w];
  if (!d) { console.log(`  ${w} — not in vocab`); continue; }
  const parts = d.parts.map(p => `${p.kanji}(${p.reading}/${p.type})`).join(' + ');
  console.log(`  ${w} → ${parts}`);
}

/**
 * Convert romaji input to hiragana.
 * Handles standard Hepburn romanization.
 * Partial input (e.g. "ka" mid-type) is left as-is so live search works.
 */

// Ordered longest-first so multi-char sequences match before single chars
const ROMAJI_MAP: [string, string][] = [
  // Special double-consonant (っ) — e.g. "kk" → っk, "tt" → っt
  // Handled dynamically below

  // Three-char sequences first
  ['shi', 'し'], ['chi', 'ち'], ['tsu', 'つ'],
  ['sha', 'しゃ'], ['shu', 'しゅ'], ['sho', 'しょ'],
  ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['cho', 'ちょ'],
  ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'],
  ['dzi', 'ぢ'], ['dzu', 'づ'],
  ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
  ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
  ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
  ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
  ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
  ['dya', 'ぢゃ'], ['dyu', 'ぢゅ'], ['dyo', 'ぢょ'],
  ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
  ['jya', 'じゃ'], ['jyu', 'じゅ'], ['jyo', 'じょ'],

  // Two-char sequences
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['sa', 'さ'], ['si', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['ta', 'た'], ['ti', 'ち'], ['tu', 'つ'], ['te', 'て'], ['to', 'と'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['hu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['fu', 'ふ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wi', 'ゐ'], ['we', 'ゑ'], ['wo', 'を'],
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['za', 'ざ'], ['zi', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['ji', 'じ'],
  ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'],

  // Single vowels
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],

  // n — must come after other n-combos
  ['n', 'ん'],
];

export function romajiToHiragana(input: string): string {
  const s = input.toLowerCase();
  let result = '';
  let i = 0;

  while (i < s.length) {
    // Double consonant → っ (e.g. "kk" → っ + continue with "k")
    if (
      i + 1 < s.length &&
      s[i] === s[i + 1] &&
      s[i] !== 'n' &&
      /[a-z]/.test(s[i])
    ) {
      result += 'っ';
      i++; // consume one consonant, leave the second for normal processing
      continue;
    }

    // Try longest match first
    let matched = false;
    for (const [rom, hira] of ROMAJI_MAP) {
      if (s.startsWith(rom, i)) {
        result += hira;
        i += rom.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Pass through unmatched characters (mid-type partial input, spaces, etc.)
      result += s[i];
      i++;
    }
  }

  return result;
}

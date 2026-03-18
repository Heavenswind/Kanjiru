import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { VocabPart } from '../../hooks/useVocabData';

// Alternating colors for kanji segments
const KANJI_COLORS = ['#7eb8f7', '#f7a97e', '#a8e6a3', '#d8a8f7'];

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょァィゥェォャュョ');
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

function toHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

function splitMora(reading: string): string[] {
  const hira = toHiragana(reading);
  const mora: string[] = [];
  let i = 0;
  while (i < hira.length) {
    const cur = hira[i];
    const next = hira[i + 1];
    if (next && SMALL_KANA.has(next)) {
      mora.push(cur + next);
      i += 2;
    } else {
      mora.push(cur);
      i++;
    }
  }
  return mora;
}

type Props =
  | { parts: VocabPart[]; reading?: never; fontSize?: number }
  | { reading: string; parts?: never; fontSize?: number };

/**
 * Renders the kanji word with each kanji character colored to match
 * its reading segment in ColoredReading (same color index logic).
 * Kana/okurigana segments are rendered in white.
 */
export function ColoredWord({ parts, fontSize = 20 }: { parts: VocabPart[]; fontSize?: number }) {
  let kanjiColorIndex = 0;
  return (
    <View style={styles.row}>
      {parts.map((p, i) => {
        const isKanji = CJK_RE.test(p.text);
        const color = isKanji
          ? KANJI_COLORS[kanjiColorIndex++ % KANJI_COLORS.length]
          : '#fff';
        return (
          <Text key={i} style={[styles.wordSegment, { color, fontSize }]}>
            {p.text}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * Renders the word with furigana (hiragana) above each kanji segment.
 * Kanji segments are color-coded; plain kana segments have no ruby text.
 * Font size scales down automatically for longer words.
 */
export function FuriganaWord({ parts, fontSize = 72 }: { parts: VocabPart[]; fontSize?: number }) {
  // Scale down for longer words so they fit on one line
  const charCount = parts.reduce((n, p) => n + p.text.length, 0);
  const scaled = charCount <= 2 ? fontSize
    : charCount <= 3 ? Math.round(fontSize * 0.78)
    : charCount <= 4 ? Math.round(fontSize * 0.65)
    : Math.round(fontSize * 0.52);
  const rubySize = Math.max(9, Math.round(scaled * 0.38));
  let kanjiColorIndex = 0;
  return (
    <View style={styles.furiganaRow}>
      {parts.map((p, i) => {
        const isKanji = CJK_RE.test(p.text);
        const color = isKanji
          ? KANJI_COLORS[kanjiColorIndex++ % KANJI_COLORS.length]
          : '#fff';
        return (
          <View key={i} style={styles.furiganaCell}>
            <Text style={[styles.furiganaReading, { fontSize: rubySize, color: isKanji ? color : 'transparent' }]}>
              {isKanji && p.reading ? p.reading : ' '}
            </Text>
            <Text style={[styles.furiganaChar, { fontSize: scaled, color }]}>
              {p.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Renders a Japanese reading with color-coded segments.
 *
 * - parts mode: uses JMdict furigana decomposition. Each kanji segment gets
 *   an alternating color; plain kana segments (okurigana) are grey.
 * - reading mode: splits into mora and cycles through colors.
 */
export function ColoredReading({ parts, reading, fontSize = 13 }: Props) {
  if (parts) {
    let kanjiColorIndex = 0;
    return (
      <View style={styles.row}>
        {parts.map((p, i) => {
          const isKanji = CJK_RE.test(p.text);
          const color = isKanji
            ? KANJI_COLORS[kanjiColorIndex++ % KANJI_COLORS.length]
            : '#888';
          // Show the reading if available, otherwise show the text itself (kana)
          const display = p.reading ?? p.text;
          return (
            <Text key={i} style={[styles.segment, { color, fontSize }]}>
              {display}
            </Text>
          );
        })}
      </View>
    );
  }

  const mora = splitMora(reading!);
  return (
    <View style={styles.row}>
      {mora.map((m, i) => (
        <Text
          key={i}
          style={[styles.segment, { color: KANJI_COLORS[i % KANJI_COLORS.length], fontSize }]}
        >
          {m}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  segment: {
    fontWeight: '500',
  },
  wordSegment: {
    fontWeight: 'bold',
  },
  furiganaRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'flex-end',
  },
  furiganaCell: {
    alignItems: 'center',
  },
  furiganaReading: {
    fontWeight: '400',
    lineHeight: undefined,
  },
  furiganaChar: {
    fontWeight: 'bold',
  },
});

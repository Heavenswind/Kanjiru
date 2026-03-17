import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

// Colors that cycle across mora segments — used when no decomp data available
const MORA_COLORS = ['#7eb8f7', '#f7a97e', '#a8e6a3', '#d8a8f7'];

const TYPE_COLOR: Record<string, string> = {
  on: '#7eb8f7',
  kun: '#f7a97e',
  kana: '#888',
  unknown: '#888',
};

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょァィゥェォャュョ');

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

export type DecompPart = {
  kanji: string;
  reading: string;
  type: 'on' | 'kun' | 'kana' | 'unknown';
};

type Props =
  | { reading: string; parts?: never; fontSize?: number }
  | { parts: DecompPart[]; reading?: never; fontSize?: number };

export function ColoredReading({ reading, parts, fontSize = 12 }: Props) {
  if (parts) {
    return (
      <View style={styles.row}>
        {parts.map((p, i) => (
          <Text
            key={i}
            style={[styles.mora, { color: TYPE_COLOR[p.type] ?? '#888', fontSize }]}
          >
            {p.reading}
          </Text>
        ))}
      </View>
    );
  }

  const mora = splitMora(reading!);
  return (
    <View style={styles.row}>
      {mora.map((m, i) => (
        <Text
          key={i}
          style={[styles.mora, { color: MORA_COLORS[i % MORA_COLORS.length], fontSize }]}
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
  },
  mora: {
    fontWeight: '500',
  },
});

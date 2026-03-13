import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RouteProp} from '@react-navigation/native';
import {LearnStackParamList} from '../../types/navigation';
import {useKanjiById} from '../../hooks/useKanjiData';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {formatReading} from '../../utils/kanjiUtils';
import StrokeOrderDiagram from '../../components/kanji/StrokeOrderDiagram';
import strokeData from '../../data/strokes.json';
import radicalKanjiData from '../../data/radicalKanji.json';

const radicalKanji = radicalKanjiData as Record<string, string>;

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'KanjiDetail'>;
  route: RouteProp<LearnStackParamList, 'KanjiDetail'>;
};

export default function KanjiDetailScreen({route}: Props) {
  const {kanjiId} = route.params;
  const kanji = useKanjiById(kanjiId);
  const {data: progress} = useProgressQuery();

  if (!kanji) return null;

  const existing = progress?.find(p => p.kanjiId === kanjiId);
  const srsLabel = existing ? `SRS Level ${existing.srsLevel}` : 'Not enrolled';
  const strokes: string[] = (strokeData as Record<string, string[]>)[kanji.character] ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.characterContainer}>
        <Text style={styles.character}>{kanji.character}</Text>
        <Text style={styles.srsLabel}>{srsLabel}</Text>
      </View>

      {strokes.length > 0 && (
        <Section title="Stroke Order">
          <StrokeOrderDiagram strokes={strokes} size={160} autoPlay />
        </Section>
      )}

      <Section title="Meaning">
        <Text style={styles.primaryMeaning}>{kanji.meanings[0]}</Text>
        {kanji.meanings.length > 1 && (
          <Text style={styles.altMeanings}>{kanji.meanings.slice(1).join(', ')}</Text>
        )}
      </Section>

      {kanji.readings_on.length > 0 && (
        <Section title="On-yomi (Chinese reading)">
          <View style={styles.readingRow}>
            {kanji.readings_on.map((r, i) => (
              <View key={i} style={styles.readingPill}>
                <Text style={styles.readingText}>{r}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {kanji.readings_kun.length > 0 && (
        <Section title="Kun-yomi (Japanese reading)">
          <View style={styles.readingRow}>
            {[...new Set(kanji.readings_kun.map(r => formatReading(r)).filter(r => r.length > 0))]
              .map((r, i) => (
                <View key={i} style={[styles.readingPill, styles.kunPill]}>
                  <Text style={styles.readingText}>{r}</Text>
                </View>
              ))}
          </View>
        </Section>
      )}

      {kanji.radicals.length > 0 && (
        <Section title="Radicals">
          <View style={styles.readingRow}>
            {kanji.radicals.map((r, i) => {
              const symbol = radicalKanji[r];
              return (
                <View key={i} style={styles.radicalPill}>
                  {symbol && <Text style={styles.radicalSymbol}>{symbol}</Text>}
                  <Text style={styles.radicalText}>{r}</Text>
                </View>
              );
            })}
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  content: {padding: 24, paddingBottom: 48},
  characterContainer: {alignItems: 'center', marginBottom: 32},
  character: {fontSize: 96, color: '#fff'},
  srsLabel: {color: '#555', marginTop: 4, fontSize: 12},
  section: {marginBottom: 24},
  sectionTitle: {color: '#e94560', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase'},
  primaryMeaning: {color: '#fff', fontSize: 24, fontWeight: 'bold'},
  altMeanings: {color: '#aaa', marginTop: 4},
  readingRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  readingPill: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#285393',
  },
  kunPill: {borderColor: '#8858b5'},
  readingText: {color: '#fff', fontSize: 16},
  radicalPill: {
    backgroundColor: '#1e3a5f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 52,
  },
  radicalSymbol: {color: '#fff', fontSize: 20, fontWeight: 'bold'},
  radicalText: {color: '#aaa', fontSize: 11, marginTop: 2},
});

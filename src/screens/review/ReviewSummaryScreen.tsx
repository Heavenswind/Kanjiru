import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReviewStackParamList } from '../../types/navigation';
import { useKanjiData } from '../../hooks/useKanjiData';
import { useReviewStore } from '../../stores/useReviewStore';

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewSummary'>;
  route: RouteProp<ReviewStackParamList, 'ReviewSummary'>;
};

export default function ReviewSummaryScreen({ navigation, route }: Props) {
  const { correct, incorrect, deferred, kanjiReviewed, kanjiWrong } = route.params;
  const insets = useSafeAreaInsets();
  const allKanji = useKanjiData();
  const total = correct + incorrect;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  const reviewedKanji = allKanji.filter(k => kanjiReviewed.includes(k.id));
  const wrongKanji = allKanji.filter(k => kanjiWrong.includes(k.id));
  const startSession = useReviewStore(s => s.startSession);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 16 }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Session Complete!</Text>

        <View style={styles.statsRow}>
          <StatBox label="Correct" value={correct} color="#4caf50" />
          <StatBox label="Wrong" value={incorrect} color="#ef5350" />
          <StatBox label="Deferred" value={deferred} color="#888" />
        </View>

        <View style={styles.accuracyBox}>
          <Text style={styles.accuracyValue}>{accuracy}%</Text>
          <Text style={styles.accuracyLabel}>Accuracy</Text>
        </View>

        <Text style={styles.reviewedTitle}>Kanji reviewed</Text>
        <View style={styles.kanjiGrid}>
          {reviewedKanji.map(k => (
            <View key={k.id} style={styles.kanjiCell}>
              <Text style={styles.kanjiChar}>{k.character}</Text>
            </View>
          ))}
        </View>

        {wrongKanji.length > 0 && (
          <>
            <Text style={styles.wrongTitle}>Needs extra study</Text>
            <View style={styles.kanjiGrid}>
              {wrongKanji.map(k => (
                <View key={k.id} style={[styles.kanjiCell, styles.kanjiCellWrong]}>
                  <Text style={styles.kanjiChar}>{k.character}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={styles.practiceBtn}
              onPress={() => {
                startSession(wrongKanji);
                navigation.replace('ReviewSession', {practiceMode: true});
              }}>
              <Text style={styles.practiceBtnText}>Practice these ({wrongKanji.length})</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.doneBtn}
        onPress={() => navigation.replace('ReviewHome')}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 24 },
  scrollContent: { paddingBottom: 16 },
  title: { fontSize: 24, color: '#fff', fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    flex: 1,
  },
  statValue: { fontSize: 28, fontWeight: 'bold' },
  statLabel: { color: '#aaa', marginTop: 2, fontSize: 12 },
  accuracyBox: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    width: '100%',
  },
  accuracyValue: { fontSize: 52, color: '#e94560', fontWeight: 'bold' },
  accuracyLabel: { color: '#aaa' },
  reviewedTitle: { color: '#aaa', marginBottom: 8, fontSize: 12 },
  kanjiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  kanjiCell: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kanjiChar: { fontSize: 22, color: '#fff' },
  doneBtn: {
    backgroundColor: '#e94560',
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  wrongTitle: { color: '#ef5350', marginBottom: 8, fontSize: 12 },
  kanjiCellWrong: { borderWidth: 1, borderColor: '#ef5350' },
  practiceBtn: { borderWidth: 1, borderColor: '#ef5350', borderRadius: 12, paddingVertical: 10, alignItems: 'center' as const, marginTop: 8 },
  practiceBtnText: { color: '#ef5350', fontWeight: '600' as const, fontSize: 14 },
});

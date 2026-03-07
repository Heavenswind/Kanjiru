import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet, ScrollView} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RouteProp} from '@react-navigation/native';
import {ReviewStackParamList} from '../../types/navigation';
import {useKanjiData} from '../../hooks/useKanjiData';

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewSummary'>;
  route: RouteProp<ReviewStackParamList, 'ReviewSummary'>;
};

export default function ReviewSummaryScreen({navigation, route}: Props) {
  const {correct, incorrect, deferred, kanjiReviewed} = route.params;
  const allKanji = useKanjiData();
  const total = correct + incorrect;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  const reviewedKanji = allKanji.filter(k => kanjiReviewed.includes(k.id));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      <TouchableOpacity
        style={styles.doneBtn}
        onPress={() => navigation.replace('ReviewHome')}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatBox({label, value, color}: {label: string; value: number; color: string}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, {color}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  content: {padding: 24, alignItems: 'center'},
  title: {fontSize: 28, color: '#fff', fontWeight: 'bold', marginBottom: 32},
  statsRow: {flexDirection: 'row', gap: 12, marginBottom: 24},
  statBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    flex: 1,
  },
  statValue: {fontSize: 36, fontWeight: 'bold'},
  statLabel: {color: '#aaa', marginTop: 4},
  accuracyBox: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 32,
    width: '100%',
  },
  accuracyValue: {fontSize: 64, color: '#e94560', fontWeight: 'bold'},
  accuracyLabel: {color: '#aaa'},
  reviewedTitle: {color: '#aaa', alignSelf: 'flex-start', marginBottom: 12},
  kanjiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 32,
    alignSelf: 'flex-start',
  },
  kanjiCell: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kanjiChar: {fontSize: 24, color: '#fff'},
  doneBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  doneBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 18},
});

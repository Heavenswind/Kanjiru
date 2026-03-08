import React, {useMemo} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {ReviewStackParamList} from '../../types/navigation';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useKanjiData} from '../../hooks/useKanjiData';
import {useReviewStore} from '../../stores/useReviewStore';
import {isDue} from '../../engine/srs/scheduler';

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewHome'>;
};

export default function ReviewHomeScreen({navigation}: Props) {
  const allKanji = useKanjiData();
  const {data: progress, isLoading} = useProgressQuery();
  const startSession = useReviewStore(s => s.startSession);

  const dueProgress = useMemo(
    () => (progress ?? []).filter(isDue),
    [progress],
  );

  const kanjiById = useMemo(
    () => Object.fromEntries(allKanji.map(k => [k.id, k])),
    [allKanji],
  );

  const dueKanji = useMemo(
    () => dueProgress.map(p => kanjiById[p.kanjiId]).filter(Boolean),
    [dueProgress, kanjiById],
  );

  const weakKanji = useMemo(() => {
    return (progress ?? [])
      .filter(p => p.repetitions > 0 && p.srsLevel <= 1)
      .map(p => kanjiById[p.kanjiId])
      .filter(Boolean);
  }, [progress, kanjiById]);

  function handleStart() {
    if (dueKanji.length === 0) return;
    startSession(dueKanji);
    navigation.navigate('ReviewSession', {});
  }

  function handlePracticeWeak() {
    if (weakKanji.length === 0) return;
    startSession(weakKanji);
    navigation.navigate('ReviewSession', {practiceMode: true});
  }

  const nextReview = useMemo(() => {
    if (dueKanji.length > 0) return null;
    const sorted = [...(progress ?? [])].sort(
      (a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime(),
    );
    return sorted[0]?.nextReview ?? null;
  }, [progress, dueKanji]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reviews</Text>

      <View style={styles.card}>
        <Text style={styles.dueCount}>{dueKanji.length}</Text>
        <Text style={styles.dueLabel}>items due</Text>
      </View>

      {dueKanji.length === 0 && nextReview && (
        <Text style={styles.nextReview}>
          Next review:{' '}
          {new Date(nextReview).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.startBtn, dueKanji.length === 0 && styles.startBtnDisabled]}
        onPress={handleStart}
        disabled={dueKanji.length === 0 || isLoading}>
        <Text style={styles.startText}>
          {isLoading ? 'Loading...' : dueKanji.length === 0 ? 'Nothing due' : 'Start Reviews'}
        </Text>
      </TouchableOpacity>

      {weakKanji.length > 0 && (
        <TouchableOpacity style={styles.practiceBtn} onPress={handlePracticeWeak}>
          <Text style={styles.practiceBtnText}>Practice weak kanji ({weakKanji.length})</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e', padding: 24, alignItems: 'center', justifyContent: 'center'},
  title: {fontSize: 32, color: '#fff', fontWeight: 'bold', marginBottom: 32},
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    marginBottom: 24,
    minWidth: 200,
  },
  dueCount: {fontSize: 72, color: '#e94560', fontWeight: 'bold'},
  dueLabel: {color: '#aaa', fontSize: 16},
  nextReview: {color: '#888', marginBottom: 24},
  startBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
  },
  startBtnDisabled: {backgroundColor: '#444'},
  startText: {color: '#fff', fontWeight: 'bold', fontSize: 18},
  practiceBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  practiceBtnText: {color: '#e94560', fontWeight: '600', fontSize: 15},
});

import React, {useMemo} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {StackNavigationProp} from '@react-navigation/stack';
import {ReviewStackParamList} from '../../types/navigation';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useVocabProgressQuery} from '../../queries/useVocabProgressQuery';
import {useKanjiData} from '../../hooks/useKanjiData';
import {useReviewStore} from '../../stores/useReviewStore';
import {isDue} from '../../engine/srs/scheduler';
import {ReviewItem} from '../../types/review';
import vocabData from '../../data/vocab.json';

const allVocab = vocabData as Record<string, {word: string; reading: string; meaning: string; jlptLevel: number}[]>;

type Props = {
  navigation: StackNavigationProp<ReviewStackParamList, 'ReviewHome'>;
};

export default function ReviewHomeScreen({navigation}: Props) {
  const insets = useSafeAreaInsets();
  const allKanji = useKanjiData();
  const {data: progress, isLoading} = useProgressQuery();
  const {data: vocabProgress, isLoading: vocabLoading} = useVocabProgressQuery();
  const startSession = useReviewStore(s => s.startSession);

  const kanjiById = useMemo(
    () => Object.fromEntries(allKanji.map(k => [k.id, k])),
    [allKanji],
  );

  const dueKanjiItems = useMemo<ReviewItem[]>(() => {
    return (progress ?? [])
      .filter(isDue)
      .map(p => kanjiById[p.kanjiId])
      .filter(Boolean)
      .map(k => ({kind: 'kanji' as const, kanji: k}));
  }, [progress, kanjiById]);

  const enrolledKanjiIds = useMemo(
    () => new Set((progress ?? []).map(p => p.kanjiId)),
    [progress],
  );

  const dueVocabItems = useMemo<ReviewItem[]>(() => {
    type VocabItem = {kind: 'vocab'; vocab: {word: string; reading: string; meaning: string; jlptLevel: number}; kanjiId: string; questionType: 'meaning' | 'reading'};
    const allKanjiKnown = (word: string) =>
      [...word].filter(c => c >= '\u4e00' && c <= '\u9fff').every(c => enrolledKanjiIds.has(c));
    const items: VocabItem[] = [];
    for (const p of (vocabProgress ?? [])) {
      if (p.srsLevel < 0) continue;
      if (new Date(p.nextReview) > new Date()) continue;
      const words = allVocab[p.kanjiId] ?? [];
      const entry = words.find(v => v.word === p.vocabWord);
      if (!entry || !allKanjiKnown(entry.word)) continue;
      items.push({kind: 'vocab', vocab: entry, kanjiId: p.kanjiId, questionType: 'meaning'});
      items.push({kind: 'vocab', vocab: entry, kanjiId: p.kanjiId, questionType: 'reading'});
    }
    return items;
  }, [vocabProgress, enrolledKanjiIds]);

  // Interleave kanji and vocab so sessions feel varied
  const allDueItems = useMemo<ReviewItem[]>(() => {
    const result: ReviewItem[] = [];
    const k = [...dueKanjiItems];
    const v = [...dueVocabItems];
    while (k.length > 0 || v.length > 0) {
      if (k.length > 0) result.push(k.shift()!);
      if (v.length > 0) result.push(v.shift()!);
    }
    return result;
  }, [dueKanjiItems, dueVocabItems]);

  const weakKanji = useMemo(() => {
    return (progress ?? [])
      .filter(p => p.repetitions > 0 && p.srsLevel <= 1)
      .map(p => kanjiById[p.kanjiId])
      .filter(Boolean);
  }, [progress, kanjiById]);

  function handleStart() {
    if (allDueItems.length === 0) return;
    startSession(allDueItems);
    navigation.navigate('ReviewSession', {});
  }

  function handlePracticeWeak() {
    if (weakKanji.length === 0) return;
    startSession(weakKanji.map(k => ({kind: 'kanji' as const, kanji: k})));
    navigation.navigate('ReviewSession', {practiceMode: true});
  }

  const nextReview = useMemo(() => {
    if (allDueItems.length > 0) return null;
    const kanjiDates = (progress ?? []).map(p => new Date(p.nextReview).getTime());
    const vocabDates = (vocabProgress ?? []).filter(p => p.srsLevel >= 0).map(p => new Date(p.nextReview).getTime());
    const all = [...kanjiDates, ...vocabDates].sort((a, b) => a - b);
    return all[0] ? new Date(all[0]) : null;
  }, [progress, vocabProgress, allDueItems]);

  const isLoadingAny = isLoading || vocabLoading;

  return (
    <View style={[styles.container, {paddingTop: insets.top + 16}]}>
      <Text style={styles.title}>Reviews</Text>

      <View style={styles.card}>
        <Text style={styles.dueCount}>{allDueItems.length}</Text>
        <Text style={styles.dueLabel}>items due</Text>
        {allDueItems.length > 0 && (
          <View style={styles.breakdown}>
            {dueKanjiItems.length > 0 && (
              <Text style={styles.breakdownText}>{dueKanjiItems.length} kanji</Text>
            )}
            {dueVocabItems.length > 0 && (
              <Text style={[styles.breakdownText, styles.vocabBreakdown]}>{dueVocabItems.length} vocab</Text>
            )}
          </View>
        )}
      </View>

      {allDueItems.length === 0 && nextReview && (
        <Text style={styles.nextReview}>
          Next review:{' '}
          {nextReview.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.startBtn, allDueItems.length === 0 && styles.startBtnDisabled]}
        onPress={handleStart}
        disabled={allDueItems.length === 0 || isLoadingAny}>
        <Text style={styles.startText}>
          {isLoadingAny ? 'Loading...' : allDueItems.length === 0 ? 'Nothing due' : 'Start Reviews'}
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
  breakdown: {flexDirection: 'row', gap: 12, marginTop: 8},
  breakdownText: {color: '#888', fontSize: 13},
  vocabBreakdown: {color: '#9b59b6'},
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

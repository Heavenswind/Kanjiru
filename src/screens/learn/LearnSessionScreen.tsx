import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RouteProp} from '@react-navigation/native';
import {LearnStackParamList} from '../../types/navigation';
import {useKanjiGrouped} from '../../hooks/useKanjiData';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {useAuthStore} from '../../stores/useAuthStore';
import {buildNewProgress} from '../../engine/srs/scheduler';
import {upsertProgressBatch as upsertLocalBatch} from '../../services/database/queries';
import {upsertProgress as upsertRemote} from '../../services/supabase/progress';
import {useQueryClient} from '@tanstack/react-query';
import {PROGRESS_QUERY_KEY} from '../../queries/useProgressQuery';
import {formatReading, uuid} from '../../utils/kanjiUtils';
import {useSettingsStore} from '../../stores/useSettingsStore';
import type {KanjiEntry} from '../../types/kanji';

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'LearnSession'>;
  route: RouteProp<LearnStackParamList, 'LearnSession'>;
};

type Phase = 'loading' | 'studying' | 'enrolling' | 'done' | 'empty';

export default function LearnSessionScreen({navigation, route}: Props) {
  const {jlptLevel} = route.params;
  const grouped = useKanjiGrouped();
  const {data: progress} = useProgressQuery();
  const session = useAuthStore(s => s.session);
  const queryClient = useQueryClient();
  const lessonsPerSession = useSettingsStore(s => s.lessonsPerSession);
  const autoShowReadings = useSettingsStore(s => s.autoShowReadings);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('studying');
  const [showDetails, setShowDetails] = useState(autoShowReadings);

  // Reset details visibility when moving to a new card
  useEffect(() => {
    setShowDetails(autoShowReadings);
  }, [index, autoShowReadings]);

  const enrolledIds = React.useMemo(
    () => new Set((progress ?? []).map(p => p.kanjiId)),
    [progress],
  );

  const batch = React.useMemo<KanjiEntry[]>(() => {
    const levelKanji = grouped[jlptLevel] ?? [];
    return levelKanji
      .filter(k => !enrolledIds.has(k.id))
      .slice(0, lessonsPerSession);
  }, [grouped, jlptLevel, enrolledIds, lessonsPerSession]);

  const current = batch[index];
  const isLast = index === batch.length - 1;

  const handleNext = useCallback(async () => {
    if (isLast) {
      setPhase('enrolling');
      try {
        console.log('[Enroll] session:', session?.user.id ?? 'NULL');
        const userId = session!.user.id;
        const newProgress = batch.map(k => ({
          id: uuid(),
          ...buildNewProgress(userId, k.id, jlptLevel),
        }));
        console.log('[Enroll] starting upsertLocalBatch', newProgress.length);
        await upsertLocalBatch(newProgress);
        console.log('[Enroll] upsertLocalBatch done');
        queryClient.invalidateQueries({queryKey: [PROGRESS_QUERY_KEY]});
        console.log('[Enroll] invalidated, setting done');
        setPhase('done');
        Promise.all(newProgress.map(p => upsertRemote(p))).catch(() => {});
      } catch (e) {
        console.error('[Enroll] error', e);
        setPhase('done');
      }
    } else {
      setIndex(i => i + 1);
    }
  }, [isLast, batch, session, jlptLevel, queryClient]);

  if (batch.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.doneTitle}>All caught up!</Text>
        <Text style={styles.doneSubtitle}>
          You've enrolled all N{jlptLevel} kanji. Keep reviewing to master them.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'enrolling') {
    console.log('[Enroll] rendering enrolling screen, batch:', batch.length);
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.enrollingText}>Adding to your reviews…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.container}>
        <Text style={styles.doneTitle}>Nice work!</Text>
        <Text style={styles.doneSubtitle}>
          {batch.length} N{jlptLevel} kanji added to your reviews.{'\n'}
          Head to the Review tab to practice them.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.progressHeader}>
          {index > 0 ? (
            <TouchableOpacity onPress={() => { setIndex(i => i - 1); }}>
              <Text style={styles.backText}>‹ Prev</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <Text style={styles.progressText}>{index + 1} / {batch.length}</Text>
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Leave Session', 'Leave without enrolling these kanji?', [
                {text: 'Stay', style: 'cancel'},
                {text: 'Leave', style: 'destructive', onPress: () => navigation.goBack()},
              ])
            }>
            <Text style={styles.exitText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, {width: `${((index + 1) / batch.length) * 100}%`}]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Kanji character */}
        <View style={styles.characterBox}>
          <Text style={styles.character}>{current.character}</Text>
          <Text style={styles.levelBadge}>N{jlptLevel}</Text>
        </View>

        {/* Primary meaning — always shown */}
        <Text style={styles.meaning}>{current.meanings[0]}</Text>

        {/* Tap to reveal readings */}
        {!showDetails ? (
          <TouchableOpacity style={styles.revealBtn} onPress={() => setShowDetails(true)}>
            <Text style={styles.revealText}>Show readings</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.details}>
            {current.readings_on.length > 0 && (
              <View style={styles.readingSection}>
                <Text style={styles.readingLabel}>On-yomi</Text>
                <View style={styles.pillRow}>
                  {current.readings_on.map((r, i) => (
                    <View key={i} style={styles.pill}>
                      <Text style={styles.pillText}>{r}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {current.readings_kun.length > 0 && (
              <View style={styles.readingSection}>
                <Text style={styles.readingLabel}>Kun-yomi</Text>
                <View style={styles.pillRow}>
                  {[...new Set(current.readings_kun.map(r => formatReading(r)).filter(r => r.length > 0))]
                    .map((r, i) => (
                      <View key={i} style={[styles.pill, styles.kunPill]}>
                        <Text style={styles.pillText}>{r}</Text>
                      </View>
                    ))}
                </View>
              </View>
            )}
            {current.meanings.length > 1 && (
              <Text style={styles.altMeanings}>
                Also: {current.meanings.slice(1).join(', ')}
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
        <Text style={styles.nextBtnText}>
          {isLast ? `Add ${batch.length} kanji to reviews` : 'Next'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e', padding: 24, alignItems: 'center', justifyContent: 'center'},
  progressRow: {width: '100%', marginBottom: 24},
  progressHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6},
  progressText: {color: '#888', fontSize: 13},
  backText: {color: '#888', fontSize: 13},
  exitText: {color: '#888', fontSize: 18},
  headerSpacer: {width: 40},
  progressBar: {width: '100%', height: 4, backgroundColor: '#333', borderRadius: 2},
  progressFill: {height: 4, backgroundColor: '#e94560', borderRadius: 2},
  content: {alignItems: 'center', paddingBottom: 24, width: '100%'},
  characterBox: {alignItems: 'center', marginBottom: 16},
  character: {fontSize: 120, color: '#fff'},
  levelBadge: {color: '#e94560', fontWeight: 'bold', fontSize: 13, marginTop: 4},
  meaning: {fontSize: 28, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 24},
  revealBtn: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  revealText: {color: '#888', fontSize: 15},
  details: {width: '100%', marginTop: 8},
  readingSection: {marginBottom: 16},
  readingLabel: {color: '#e94560', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8},
  pillRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  pill: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#285393',
  },
  kunPill: {borderColor: '#8858b5'},
  pillText: {color: '#fff', fontSize: 16},
  altMeanings: {color: '#aaa', marginTop: 8, textAlign: 'center'},
  nextBtn: {
    width: '100%',
    backgroundColor: '#e94560',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  nextBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
  enrollingText: {color: '#aaa', marginTop: 16},
  doneTitle: {fontSize: 32, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 12},
  doneSubtitle: {color: '#aaa', textAlign: 'center', marginBottom: 32, lineHeight: 22},
  btn: {backgroundColor: '#e94560', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12},
  btnText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
});

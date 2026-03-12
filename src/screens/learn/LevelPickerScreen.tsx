import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {StackNavigationProp} from '@react-navigation/stack';
import {LearnStackParamList} from '../../types/navigation';
import {useKanjiGrouped} from '../../hooks/useKanjiData';
import {useProgressQuery} from '../../queries/useProgressQuery';
import {JLPT_LEVELS} from '../../utils/kanjiUtils';
import {useSettingsStore} from '../../stores/useSettingsStore';

type Props = {
  navigation: StackNavigationProp<LearnStackParamList, 'LevelPicker'>;
};

const LEVEL_COLORS: Record<number, string> = {
  5: '#e94560',
  4: '#dd7e1b',
  3: '#8858b5',
  2: '#285393',
  1: '#0a7abf',
};

export default function LevelPickerScreen({navigation}: Props) {
  const insets = useSafeAreaInsets();
  const grouped = useKanjiGrouped();
  const {data: progress} = useProgressQuery();
  const progressiveUnlock = useSettingsStore(s => s.progressiveUnlock);

  const enrolledIds = React.useMemo(
    () => new Set((progress ?? []).map(p => p.kanjiId)),
    [progress],
  );

  const progressByKanji = React.useMemo(() => {
    const map: Record<string, number> = {};
    (progress ?? []).forEach(p => {
      map[p.kanjiId] = p.srsLevel;
    });
    return map;
  }, [progress]);

  // A level is locked if progressiveUnlock is on and the previous easier level
  // (higher JLPT number) hasn't had all its kanji enrolled yet.
  // JLPT_LEVELS = [5, 4, 3, 2, 1] — N5 is always unlocked.
  const isLevelLocked = React.useCallback(
    (level: number): boolean => {
      if (!progressiveUnlock) return false;
      const idx = JLPT_LEVELS.indexOf(level as typeof JLPT_LEVELS[number]);
      if (idx <= 0) return false; // N5 always unlocked
      const prevLevel = JLPT_LEVELS[idx - 1]; // easier level
      const prevKanji = grouped[prevLevel] ?? [];
      return prevKanji.some(k => !enrolledIds.has(k.id));
    },
    [progressiveUnlock, grouped, enrolledIds],
  );

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <Text style={styles.header}>Choose a Level</Text>
    <ScrollView contentContainerStyle={styles.content}>
      {JLPT_LEVELS.map(level => {
        const kanji = grouped[level] ?? [];
        const learned = kanji.filter(k => progressByKanji[k.id] > 0).length;
        const remaining = kanji.filter(k => !enrolledIds.has(k.id)).length;
        const color = LEVEL_COLORS[level];
        const locked = isLevelLocked(level);

        return (
          <View key={level} style={[styles.card, {borderLeftColor: locked ? '#333' : color}, locked && styles.cardLocked]}>
            <TouchableOpacity
              style={styles.cardMain}
              disabled={locked}
              onPress={() => navigation.navigate('LearnSession', {jlptLevel: level})}>
              <View style={styles.cardLeft}>
                <Text style={[styles.levelLabel, {color: locked ? '#555' : color}]}>N{level}</Text>
                <Text style={styles.kanjiCount}>{kanji.length} kanji</Text>
              </View>
              <View style={styles.cardRight}>
                {locked ? (
                  <Text style={styles.lockedText}>🔒 Complete N{level + 1} first</Text>
                ) : (
                  <>
                    <Text style={styles.progressText}>
                      {learned}/{kanji.length} learned
                    </Text>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${kanji.length > 0 ? (learned / kanji.length) * 100 : 0}%`,
                            backgroundColor: color,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.learnHint, {color: remaining > 0 ? color : '#555'}]}>
                      {remaining > 0 ? `${Math.min(10, remaining)} new to learn` : 'All enrolled'}
                    </Text>
                  </>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.browseLink}
              disabled={locked}
              onPress={() => navigation.navigate('KanjiList', {jlptLevel: level})}>
              <Text style={[styles.browseLinkText, locked && styles.browseLinkLocked]}>Browse all kanji</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  header: {fontSize: 28, color: '#fff', fontWeight: 'bold', paddingHorizontal: 20, paddingVertical: 16},
  content: {paddingHorizontal: 20, paddingBottom: 20},
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    overflow: 'hidden',
  },
  cardMain: {
    padding: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardLeft: {flex: 1},
  cardRight: {flex: 2},
  levelLabel: {fontSize: 32, fontWeight: 'bold'},
  kanjiCount: {color: '#aaa', marginTop: 4},
  progressText: {color: '#aaa', marginBottom: 8, textAlign: 'right'},
  progressBar: {width: '100%', height: 6, backgroundColor: '#333', borderRadius: 3},
  progressFill: {height: 6, borderRadius: 3},
  learnHint: {fontSize: 12, marginTop: 6, textAlign: 'right'},
  browseLink: {paddingHorizontal: 20, paddingBottom: 14},
  browseLinkText: {color: '#555', fontSize: 13},
  cardLocked: {opacity: 0.55},
  lockedText: {color: '#555', fontSize: 13, textAlign: 'right'},
  browseLinkLocked: {color: '#333'},
});

import React, {useState, useMemo} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';

const GRID_COLS = 6;
const CELL_SIZE = Math.floor((Dimensions.get('window').width - 16) / GRID_COLS);
import {useNavigation} from '@react-navigation/native';
import {StackNavigationProp} from '@react-navigation/stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAllKanji} from '../../hooks/useKanjiData';
import {SearchStackParamList} from '../../types/navigation';
import {romajiToHiragana} from '../../utils/romaji';

type Mode = 'meaning' | 'reading' | 'radical';
type Nav = StackNavigationProp<SearchStackParamList, 'Search'>;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const allKanji = useAllKanji();

  const [mode, setMode] = useState<Mode>('meaning');
  const [query, setQuery] = useState('');
  const [radicalFilter, setRadicalFilter] = useState('');
  const [selectedRadicals, setSelectedRadicals] = useState<Set<string>>(new Set());

  // All unique radicals sorted alphabetically
  const allRadicals = useMemo(() => {
    const s = new Set<string>();
    allKanji.forEach(k => k.radicals.forEach(r => s.add(r)));
    return [...s].sort();
  }, [allKanji]);

  // Radical pill list filtered by the search box
  const visibleRadicals = useMemo(() => {
    if (!radicalFilter.trim()) return allRadicals;
    const q = radicalFilter.trim().toLowerCase();
    return allRadicals.filter(r => r.toLowerCase().includes(q));
  }, [allRadicals, radicalFilter]);

  // For reading mode: auto-convert romaji → hiragana, pass kana through as-is
  const readingQuery = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return '';
    const hasKana = /[\u3040-\u30ff]/.test(trimmed);
    return hasKana ? trimmed : romajiToHiragana(trimmed);
  }, [query]);

  // Filtered results based on mode
  const results = useMemo(() => {
    if (mode === 'meaning') {
      if (!query.trim()) return [];
      const q = query.trim().toLowerCase();
      return allKanji.filter(k =>
        k.meanings.some(m => m.toLowerCase().includes(q)),
      );
    }
    if (mode === 'reading') {
      if (!readingQuery) return [];
      return allKanji.filter(k =>
        [...k.readings_on, ...k.readings_kun].some(r => r.startsWith(readingQuery)),
      );
    }
    // radical
    if (selectedRadicals.size === 0) return [];
    return allKanji.filter(k =>
      [...selectedRadicals].every(r => k.radicals.includes(r)),
    );
  }, [mode, query, readingQuery, selectedRadicals, allKanji]);

  function toggleRadical(r: string) {
    setSelectedRadicals(prev => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
    // Clear filter after selecting so the picker collapses and layout stays clean
    setRadicalFilter('');
  }

  function switchMode(m: Mode) {
    setMode(m);
    setQuery('');
    setRadicalFilter('');
    setSelectedRadicals(new Set());
  }

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      {/* Header */}
      <Text style={styles.header}>Search</Text>

      {/* Mode switcher */}
      <View style={styles.tabs}>
        {(['meaning', 'reading', 'radical'] as Mode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.tab, mode === m && styles.tabActive]}
            onPress={() => switchMode(m)}>
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === 'meaning' ? '意 Meaning' : m === 'reading' ? '音 Reading' : '部 Radical'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Input area */}
      {mode !== 'radical' ? (
        <>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={
                mode === 'meaning'
                  ? 'e.g. fire, water, person…'
                  : 'e.g. kaku, mizu, or かく…'
              }
              placeholderTextColor="#444"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
                <Text style={styles.clearText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          {mode === 'reading' && query.trim().length > 0 && (
            <Text style={styles.kanaPreview}>
              → {readingQuery}
            </Text>
          )}
        </>
      ) : (
        <>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={radicalFilter}
              onChangeText={setRadicalFilter}
              placeholder="Filter radicals, e.g. fire, water…"
              placeholderTextColor="#444"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {radicalFilter.length > 0 && (
              <TouchableOpacity onPress={() => setRadicalFilter('')} style={styles.clearBtn}>
                <Text style={styles.clearText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Selected radicals chips — always visible, tap to remove */}
          {selectedRadicals.size > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.selectedScroll}
              contentContainerStyle={styles.selectedRow}>
              {[...selectedRadicals].map(r => (
                <TouchableOpacity
                  key={r}
                  style={styles.selectedChip}
                  onPress={() => toggleRadical(r)}>
                  <Text style={styles.selectedChipText}>{r}</Text>
                  <Text style={styles.selectedChipX}> ✕</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.clearAllBtn}
                onPress={() => setSelectedRadicals(new Set())}>
                <Text style={styles.clearText}>Clear all</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {selectedRadicals.size > 0 && (
            <Text style={styles.radicalResultCount}>
              {results.length} kanji match
            </Text>
          )}

          {selectedRadicals.size === 0 && radicalFilter.trim().length === 0 && (
            <Text style={styles.radicalHintText}>Type above to find radicals</Text>
          )}
        </>
      )}

      {/* Radical picker — only render pills once user starts typing */}
      {mode === 'radical' && radicalFilter.trim().length > 0 && (
        <ScrollView
          style={styles.radicalScroll}
          contentContainerStyle={styles.radicalGrid}>
          {visibleRadicals.map(r => (
            <TouchableOpacity
              key={r}
              style={[
                styles.radicalPill,
                selectedRadicals.has(r) && styles.radicalPillActive,
              ]}
              onPress={() => toggleRadical(r)}>
              <Text
                style={[
                  styles.radicalPillText,
                  selectedRadicals.has(r) && styles.radicalPillTextActive,
                ]}>
                {r}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Results */}
      {mode !== 'radical' || selectedRadicals.size > 0 ? (
        <FlatList
          style={styles.results}
          data={results}
          keyExtractor={item => item.id}
          numColumns={mode === 'radical' ? GRID_COLS : 1}
          key={mode === 'radical' ? 'grid' : 'list'}
          ListEmptyComponent={
            (mode !== 'radical' && query.trim()) || (mode === 'radical' && selectedRadicals.size > 0) ? (
              <Text style={styles.empty}>No results</Text>
            ) : null
          }
          renderItem={({item}) =>
            mode === 'radical' ? (
              <TouchableOpacity
                style={styles.gridCell}
                onPress={() => navigation.navigate('SearchDetail', {kanjiId: item.id})}>
                <Text style={styles.gridChar}>{item.character}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.resultRow}
                onPress={() => navigation.navigate('SearchDetail', {kanjiId: item.id})}>
                <Text style={styles.resultChar}>{item.character}</Text>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultMeaning}>{item.meanings[0]}</Text>
                  <Text style={styles.resultReading}>
                    {item.readings_on[0] ?? item.readings_kun[0] ?? ''}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e'},
  header: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#0f0f1e',
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {backgroundColor: '#e94560'},
  tabText: {color: '#555', fontSize: 12, fontWeight: '600'},
  tabTextActive: {color: '#fff'},
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#16213e',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 12,
  },
  clearBtn: {padding: 4},
  clearText: {color: '#e94560', fontSize: 13, fontWeight: '600'},
  kanaPreview: {
    color: '#e94560',
    fontSize: 13,
    marginHorizontal: 20,
    marginTop: -6,
    marginBottom: 8,
  },
  radicalHintText: {color: '#aaa', fontSize: 13, marginHorizontal: 16, marginBottom: 4},
  radicalResultCount: {color: '#e94560', fontSize: 13, marginHorizontal: 16, marginBottom: 4},
  selectedScroll: {marginBottom: 4, flexGrow: 0, flexShrink: 1},
  selectedRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  selectedChipText: {color: '#fff', fontSize: 12, fontWeight: '600'},
  selectedChipX: {color: 'rgba(255,255,255,0.7)', fontSize: 11},
  clearAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  radicalScroll: {maxHeight: 140, flexGrow: 0, flexShrink: 1},
  radicalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 6,
    paddingBottom: 4,
  },
  radicalPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  radicalPillActive: {backgroundColor: '#e94560', borderColor: '#e94560'},
  radicalPillText: {color: '#aaa', fontSize: 11},
  radicalPillTextActive: {color: '#fff'},
  results: {flex: 1},
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  resultChar: {fontSize: 32, color: '#fff', width: 48},
  resultInfo: {flex: 1, marginLeft: 12},
  resultMeaning: {color: '#fff', fontSize: 15, fontWeight: '600'},
  resultReading: {color: '#888', fontSize: 13, marginTop: 2},
  gridCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    margin: 1,
    backgroundColor: '#16213e',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridChar: {fontSize: 20, color: '#fff'},
  empty: {color: '#555', textAlign: 'center', marginTop: 40, fontSize: 14},
});

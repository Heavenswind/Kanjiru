import React, { useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { signOut } from '../../services/supabase/auth';

import { deleteAllProgressForUser as deleteRemote } from '../../services/supabase/progress';
import { deleteAllProgressForUser as deleteLocal } from '../../services/database/queries';
import { useQueryClient } from '@tanstack/react-query';
import { PROGRESS_QUERY_KEY } from '../../queries/useProgressQuery';
import { VOCAB_PROGRESS_QUERY_KEY } from '../../queries/useVocabProgressQuery';

const LESSONS_OPTIONS = [5, 10, 15, 20];
const SPEED_OPTIONS: { label: string; value: number }[] = [
  { label: 'Fast', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Slow', value: 2 },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const {
    progressiveUnlock, setProgressiveUnlock,
    lessonsPerSession, setLessonsPerSession,
    autoShowReadings, setAutoShowReadings,
    strokeSpeed, setStrokeSpeed,
    autoAdvanceOnCorrect, setAutoAdvanceOnCorrect,
    reduceMotion, setReduceMotion,
  } = useSettingsStore();
  const session = useAuthStore(s => s.session);
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);

  async function handleResetProgress() {
    Alert.alert(
      'Reset All Progress',
      'This will delete all your kanji and vocab progress. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const userId = session!.user.id;
            setResetting(true);
            try {
              await deleteLocal(userId);
              await deleteRemote(userId);
              queryClient.invalidateQueries({ queryKey: [PROGRESS_QUERY_KEY] });
              queryClient.invalidateQueries({ queryKey: [VOCAB_PROGRESS_QUERY_KEY] });
              Alert.alert('Done', 'All progress has been reset.');
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.header}>Settings</Text>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* LEARNING */}
        <Text style={styles.sectionTitle}>LEARNING</Text>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Progressive Unlock</Text>
            <Text style={styles.rowDesc}>Complete N5 before unlocking N4, etc.</Text>
          </View>
          <Switch
            value={progressiveUnlock}
            onValueChange={setProgressiveUnlock}
            trackColor={{ false: '#333', true: '#e94560' }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Lessons per session</Text>
            <Text style={styles.rowDesc}>How many new kanji to study at once</Text>
          </View>
          <View style={styles.chipRow}>
            {LESSONS_OPTIONS.map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.chip, lessonsPerSession === n && styles.chipActive]}
                onPress={() => setLessonsPerSession(n)}>
                <Text style={[styles.chipText, lessonsPerSession === n && styles.chipTextActive]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Auto-show readings</Text>
            <Text style={styles.rowDesc}>Expand on'yomi & kun'yomi automatically on each lesson card</Text>
          </View>
          <Switch
            value={autoShowReadings}
            onValueChange={setAutoShowReadings}
            trackColor={{ false: '#333', true: '#e94560' }}
            thumbColor="#fff"
          />
        </View>

        {/* REVIEW */}
        <Text style={styles.sectionTitle}>REVIEW</Text>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Auto-advance on correct</Text>
            <Text style={styles.rowDesc}>Move to next card automatically after a correct answer</Text>
          </View>
          <Switch
            value={autoAdvanceOnCorrect}
            onValueChange={setAutoAdvanceOnCorrect}
            trackColor={{ false: '#333', true: '#e94560' }}
            thumbColor="#fff"
          />
        </View>

        {/* ANIMATION */}
        <Text style={styles.sectionTitle}>ANIMATIONS</Text>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Disable animations</Text>
            <Text style={styles.rowDesc}>Skip all card and stroke animations</Text>
          </View>
          <Switch
            value={reduceMotion}
            onValueChange={setReduceMotion}
            trackColor={{ false: '#333', true: '#e94560' }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Stroke speed</Text>
            <Text style={styles.rowDesc}>Drawing speed for stroke order animation</Text>
          </View>
          <View style={styles.chipRow}>
            {SPEED_OPTIONS.map(({ label, value }) => (
              <TouchableOpacity
                key={label}
                style={[styles.chip, strokeSpeed === value && styles.chipActive, reduceMotion && styles.chipDisabled]}
                onPress={() => !reduceMotion && setStrokeSpeed(value)}>
                <Text style={[styles.chipText, strokeSpeed === value && !reduceMotion && styles.chipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ACCOUNT */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{session?.user.email}</Text>
        </View>
        <TouchableOpacity
          style={[styles.resetBtn, resetting && styles.btnDisabled]}
          onPress={handleResetProgress}
          disabled={resetting}>
          {resetting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.resetText}>Reset All Progress</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { fontSize: 28, color: '#fff', fontWeight: 'bold', paddingHorizontal: 20, paddingVertical: 16 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle: { color: '#e94560', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  row: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  rowContent: { flex: 1 },
  rowLabel: { color: '#fff', fontSize: 16 },
  rowDesc: { color: '#888', fontSize: 13, marginTop: 2 },
  chipRow: { flexDirection: 'row', gap: 6 },
  chipDisabled: { opacity: 0.35 },
  chip: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#888', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  resetBtn: {
    borderWidth: 1,
    borderColor: '#c62828',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  resetText: { color: '#c62828', fontWeight: 'bold' },
  btnDisabled: { opacity: 0.5 },
  signOutBtn: {
    backgroundColor: '#c62828',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  signOutText: { color: '#fff', fontWeight: 'bold' },
});

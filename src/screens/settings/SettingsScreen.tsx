import React from 'react';
import {View, Text, Switch, TouchableOpacity, StyleSheet, Alert} from 'react-native';
import {useSettingsStore} from '../../stores/useSettingsStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {signOut} from '../../services/supabase/auth';

export default function SettingsScreen() {
  const {progressiveUnlock, setProgressiveUnlock} = useSettingsStore();
  const session = useAuthStore(s => s.session);

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure?', [
      {text: 'Cancel', style: 'cancel'},
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
    <View style={styles.container}>
      <Text style={styles.header}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LEARNING</Text>
        <View style={styles.row}>
          <View style={styles.rowContent}>
            <Text style={styles.rowLabel}>Progressive Unlock</Text>
            <Text style={styles.rowDesc}>Complete N5 before unlocking N4, etc.</Text>
          </View>
          <Switch
            value={progressiveUnlock}
            onValueChange={setProgressiveUnlock}
            trackColor={{false: '#333', true: '#e94560'}}
            thumbColor="#fff"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{session?.user.email}</Text>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a2e', padding: 20},
  header: {fontSize: 28, color: '#fff', fontWeight: 'bold', marginBottom: 32},
  section: {marginBottom: 32},
  sectionTitle: {color: '#e94560', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 16},
  row: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  rowContent: {flex: 1},
  rowLabel: {color: '#fff', fontSize: 16},
  rowDesc: {color: '#888', fontSize: 13, marginTop: 2},
  signOutBtn: {
    backgroundColor: '#c62828',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  signOutText: {color: '#fff', fontWeight: 'bold'},
});

import 'react-native-url-polyfill/auto';
import {createClient} from '@supabase/supabase-js';
import {MMKV} from 'react-native-mmkv';

const mmkv = new MMKV({id: 'supabase-auth'});

const mmkvStorageAdapter = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => mmkv.delete(key),
};

const SUPABASE_URL = 'https://tmzeaxjhfpgmdmpawbcf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__6Yc5_5VYjtt-JSOWLvKOQ_COEFA0bF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: mmkvStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

import {supabase} from './client';

export async function signIn(email: string, password: string) {
  const {data, error} = await supabase.auth.signInWithPassword({email, password});
  if (error) throw error;
  return data.session;
}

export async function signUp(email: string, password: string) {
  const {data, error} = await supabase.auth.signUp({email, password});
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const {error} = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email: string) {
  const {error} = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

export function onAuthStateChange(callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) {
  return supabase.auth.onAuthStateChange(callback);
}

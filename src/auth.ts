import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type { Session };

/** Subscribe to session changes; fires immediately with the current session. */
export function onSession(callback: (session: Session | null) => void): () => void {
  supabase.auth.getSession().then(({ data }) => callback(data.session));
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => sub.subscription.unsubscribe();
}

/** Send a magic login link. Signups are disabled server-side; this only works for existing accounts. */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

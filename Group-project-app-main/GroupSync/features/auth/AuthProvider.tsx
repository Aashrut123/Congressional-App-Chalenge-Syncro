import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(null);
      return null;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) return null;
    const next = (data as Profile | null) ?? null;
    setProfile(next);
    return next;
  };

  useEffect(() => {
    let alive = true;
    const finish = () => {
      if (alive) setLoading(false);
    };
    // If Supabase does not answer, stop waiting and show the sign-in screen.
    const timer = setTimeout(finish, 8000);
    // Do not call another auth method inside this callback. Supabase holds a lock
    // until it finishes, and a nested auth call never returns, so the app stays on the spinner.
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      finish();
    }).catch(() => finish());
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      if (!next) setProfile(null);
      finish();
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    let alive = true;
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle().then(({ data }) => {
      if (alive) setProfile((data as Profile | null) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  return <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, refreshProfile }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

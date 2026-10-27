import { Redirect } from 'expo-router';

import { Loading } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) return <Loading />;

  return <Redirect href={user ? '/(tabs)' : '/auth'} />;
}
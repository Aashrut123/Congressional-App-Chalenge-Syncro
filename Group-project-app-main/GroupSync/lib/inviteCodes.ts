import AsyncStorage from '@react-native-async-storage/async-storage';

type SavedInvite = { code: string; members: number };

function key(groupId: string) {
  return `groupsync-invite:${groupId}`;
}

export async function saveInviteCode(groupId: string, code: string, members: number) {
  const saved: SavedInvite = { code, members };
  await AsyncStorage.setItem(key(groupId), JSON.stringify(saved));
}

export async function loadInviteCode(groupId: string): Promise<SavedInvite | null> {
  const raw = await AsyncStorage.getItem(key(groupId));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<SavedInvite>;
    if (typeof saved.code !== 'string' || !saved.code.trim()) return null;
    return { code: saved.code, members: typeof saved.members === 'number' ? saved.members : 1 };
  } catch {
    return null;
  }
}

export async function clearInviteCode(groupId: string) {
  await AsyncStorage.removeItem(key(groupId));
}

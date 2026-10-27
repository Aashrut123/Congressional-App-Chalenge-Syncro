export type MemberRole = 'owner' | 'admin' | 'member';

export function canManageProject(role: MemberRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function canRemoveMember(
  caller: MemberRole | undefined,
  target: MemberRole,
  isSelf: boolean,
): { allowed: boolean; reason: string } {
  if (isSelf) {
    if (target === 'owner') {
      return { allowed: false, reason: 'Transfer ownership before leaving this project.' };
    }
    return { allowed: true, reason: '' };
  }
  if (caller !== 'owner' && caller !== 'admin') {
    return { allowed: false, reason: 'Only owners and admins can remove members.' };
  }
  if (target === 'owner') {
    return { allowed: false, reason: 'The owner cannot be removed.' };
  }
  if (caller === 'admin' && target === 'admin') {
    return { allowed: false, reason: 'Admins cannot remove other admins.' };
  }
  return { allowed: true, reason: '' };
}

export function canPromoteMember(
  caller: MemberRole | undefined,
  target: MemberRole,
): boolean {
  return caller === 'owner' && target === 'member';
}

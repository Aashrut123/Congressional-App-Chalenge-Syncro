export interface ScheduleItem {
  id: string;
  title: string;
  start: string;
  end: string;
  kind: 'meeting' | 'event' | 'deadline' | 'unavailable';
}

export interface ScheduleConflict {
  a: string;
  b: string;
  reason: string;
}

function overlaps(a: ScheduleItem, b: ScheduleItem): boolean {
  const aStart = Date.parse(a.start);
  const aEnd = Date.parse(a.end);
  const bStart = Date.parse(b.start);
  const bEnd = Date.parse(b.end);
  if ([aStart, aEnd, bStart, bEnd].some((value) => Number.isNaN(value))) return false;
  return aStart < bEnd && bStart < aEnd;
}

/** Deadlines are dates, not time blocks, so they do not collide with meetings. */
export function findConflicts(items: ScheduleItem[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i];
      const right = items[j];
      if (!left || !right) continue;
      if (left.kind === 'deadline' || right.kind === 'deadline') continue;
      if (!overlaps(left, right)) continue;
      const involvesUnavailable = left.kind === 'unavailable' || right.kind === 'unavailable';
      conflicts.push({
        a: left.title,
        b: right.title,
        reason: involvesUnavailable
          ? 'A commitment falls inside an unavailable period.'
          : 'Two calendar blocks overlap.',
      });
    }
  }
  return conflicts;
}

export function overloadedDays(
  tasks: { dueDate: string; estimatedMinutes: number; status: string }[],
  dailyCapacityMinutes: number,
): { day: string; minutes: number }[] {
  if (dailyCapacityMinutes <= 0) return [];
  const totals = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === 'completed' || !task.dueDate) continue;
    const day = task.dueDate.slice(0, 10);
    totals.set(day, (totals.get(day) ?? 0) + task.estimatedMinutes);
  }
  return [...totals.entries()]
    .filter(([, minutes]) => minutes > dailyCapacityMinutes)
    .map(([day, minutes]) => ({ day, minutes }));
}

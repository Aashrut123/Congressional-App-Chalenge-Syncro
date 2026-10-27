import { addDays, formatDay, parseDay } from '../planner/dates';
import { pickNextTask } from '../home';
import { findSlot, placeTasks, type BusySpan, type PlacementTask } from '../planner/slots';

export interface AssistantProject {
  id: string;
  name: string;
  deadline: string | null;
}

export interface AssistantTask {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  dueLabel: string;
  groupId: string | null;
  groupName: string | null;
  blockedReason: string;
  assigneeIds: string[];
  createdBy: string;
  estimatedMinutes: number | null;
  priority: 'low' | 'medium' | 'high';
}

export interface AssistantMeeting {
  id: string;
  title: string;
  groupId: string;
  groupName: string;
  day: string;
  startMinute: number;
  endMinute: number;
}

export interface AssistantSchedule {
  userId: string;
  windows: { weekday: number; startMinute: number; endMinute: number }[];
  unavailable: { start: string; end: string }[];
}

export interface AssistantContext {
  userId: string;
  now: Date;
  projects: AssistantProject[];
  tasks: AssistantTask[];
  meetings: AssistantMeeting[];
  focusGroupId?: string | null;
  windows: { weekday: number; startMinute: number; endMinute: number }[];
  unavailable: { start: string; end: string }[];
  busy: BusySpan[];
  members?: { groupId: string; userId: string }[];
  schedules?: AssistantSchedule[];
}

export type AssistantAction =
  | { kind: 'none' }
  | { kind: 'open-plan'; mode: 'new' | 'revise'; name: string; outcome: string; groupId: string | null; revision: string }
  | { kind: 'move-task'; taskId: string; title: string; fromLabel: string; day: string }
  | { kind: 'post-update'; groupId: string; groupName: string; accomplishments: string }
  | { kind: 'create-meeting'; groupId: string; groupName: string; title: string; day: string; startMinute: number; endMinute: number }
  | { kind: 'move-meeting'; eventId: string; title: string; day: string; startMinute: number; endMinute: number }
  | { kind: 'reschedule'; moves: { taskId: string; title: string; day: string; startMinute: number; endMinute: number; note: string }[] };

export type AssistantFollowUp =
  | null
  | { kind: 'update' }
  | { kind: 'create-meeting' }
  | { kind: 'meeting-choice'; source: string }
  | { kind: 'move-meeting'; day: string | null; nextWeek: boolean; shared?: boolean; source?: string }
  | { kind: 'meeting-day'; eventId: string; nextWeek: boolean; shared?: boolean };

export interface AssistantTurn {
  reply: string;
  action: AssistantAction;
  followUp?: AssistantFollowUp;
}

const dayNames: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function clock(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  const face = hour % 12 || 12;
  return `${face}:${String(rest).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function nextNamedDay(now: Date, weekday: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const delta = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return formatDay(date);
}

function mine(context: AssistantContext): AssistantTask[] {
  return context.tasks.filter((task) => (
    task.status !== 'completed'
    && (
      task.assigneeIds.includes(context.userId)
      || task.createdBy === context.userId
      || task.assigneeIds.length === 0
    )
  ));
}

function projectByName(context: AssistantContext, text: string): AssistantProject | null {
  const haystack = text.toLowerCase();
  const ranked = context.projects
    .filter((project) => project.name.trim() && haystack.includes(project.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  if (ranked[0]) return ranked[0];
  if (context.focusGroupId) return context.projects.find((project) => project.id === context.focusGroupId) ?? null;
  if (context.projects.length === 1) return context.projects[0];
  return null;
}

const moveWords = new Set(['task', 'tasks', 'move', 'this', 'that', 'from', 'with', 'your', 'next', 'week', 'today', 'friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'saturday', 'sunday', 'tomorrow', 'meeting', 'meetings', 'reschedule', 'resceduele', 'adjust', 'push', 'make', 'cant', 'cannot']);

function matchTasks(context: AssistantContext, text: string): AssistantTask[] {
  const open = mine(context);
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !moveWords.has(word));
  const titled = words.length
    ? open.filter((task) => words.some((word) => task.title.toLowerCase().includes(word)))
    : [];
  if (titled.length) return titled;
  if (/\bmy task\b|\bthe task\b|\bthis task\b/i.test(text) && open.length === 1) return open;
  if (!words.length && open.length === 1) return open;
  return titled;
}

function upcomingMeetings(context: AssistantContext): AssistantMeeting[] {
  const today = formatDay(new Date(context.now.getFullYear(), context.now.getMonth(), context.now.getDate()));
  const minute = context.now.getHours() * 60 + context.now.getMinutes();
  return context.meetings.filter((meeting) => meeting.day > today || (meeting.day === today && meeting.endMinute > minute));
}

function mentionedDayOfMonth(text: string): number | null {
  const match = /\b(?:on|the)\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text);
  const raw = match?.[1] || match?.[2];
  if (!raw) return null;
  const day = Number(raw);
  return day >= 1 && day <= 31 ? day : null;
}

function monthDate(text: string, now: Date): string | null {
  const match = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text);
  if (!match) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = months.findIndex((name) => match[1].toLowerCase().startsWith(name));
  const day = Number(match[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  let year = now.getFullYear();
  let date = new Date(year, month, day);
  if (date.getMonth() !== month || date.getDate() !== day) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date < today) {
    year += 1;
    date = new Date(year, month, day);
    if (date.getMonth() !== month || date.getDate() !== day) return null;
  }
  return formatDay(date);
}

function matchMeetings(context: AssistantContext, text: string): AssistantMeeting[] {
  let open = upcomingMeetings(context);
  const project = projectByName(context, text);
  if (project && text.toLowerCase().includes(project.name.toLowerCase())) {
    const inProject = open.filter((meeting) => meeting.groupId === project.id);
    if (inProject.length) open = inProject;
  }
  const hay = text.toLowerCase().trim();
  const contained = open.filter((meeting) => {
    const title = meeting.title.toLowerCase().trim();
    return title.length > 0 && hay.includes(title);
  });
  if (contained.length) {
    const longest = Math.max(...contained.map((meeting) => meeting.title.length));
    return contained.filter((meeting) => meeting.title.length === longest);
  }
  if (!monthDate(text, context.now)) {
    const dayOfMonth = mentionedDayOfMonth(text);
    if (dayOfMonth) {
      const onDay = open.filter((meeting) => Number(meeting.day.slice(8, 10)) === dayOfMonth);
      if (onDay.length) return onDay;
    }
  }
  const words = hay.split(/[^a-z0-9]+/).filter((word) => (word.length > 2 || /^\d+$/.test(word)) && !moveWords.has(word));
  const titled = words.length
    ? open.filter((meeting) => words.some((word) => meeting.title.toLowerCase().includes(word)))
    : [];
  if (titled.length) return titled;
  if (/\bmeetings?\b/i.test(text) && open.length === 1) return open;
  return titled;
}

function wantsNewMeeting(text: string): boolean {
  return /\bfind a time\b/i.test(text)
    || /\bnew meeting\b/i.test(text)
    || (/\b(schedule|book|add|create|set up|setup)\b/i.test(text) && /\bmeetings?\b/i.test(text));
}

function nearWord(word: string, target: string, limit: number): boolean {
  if (Math.abs(word.length - target.length) > limit) return false;
  const prev = Array.from({ length: target.length + 1 }, (_, index) => index);
  const next = new Array<number>(target.length + 1);
  for (let i = 1; i <= word.length; i += 1) {
    next[0] = i;
    let best = next[0];
    for (let j = 1; j <= target.length; j += 1) {
      const cost = word[i - 1] === target[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      if (next[j] < best) best = next[j];
    }
    if (best > limit) return false;
    for (let j = 0; j <= target.length; j += 1) prev[j] = next[j];
  }
  return prev[target.length] <= limit;
}

function wantsMeetingMove(text: string): boolean {
  const typo = text.toLowerCase().split(/[^a-z]+/).some((word) => (
    word.startsWith('re') && word.length >= 8 && (nearWord(word, 'reschedule', 3) || nearWord(word, 'rescheduled', 3))
  ));
  return typo
    || /\b(move|push|adjust|re-?schedul\w*|re-?scedul\w*)\b/i.test(text)
    || /\b(?:can(?:not|'?t)?|cant)\s+make\b/i.test(text);
}

function wantsSharedTime(text: string): boolean {
  return /\bavail/i.test(text) || /\bboth of us\b|\beveryone\b|\bfree time\b|\bopen time\b/i.test(text);
}

function labelDay(day: string): string {
  const date = parseDay(day);
  if (!date) return day;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function meetingLength(meeting: AssistantMeeting): number {
  const raw = meeting.endMinute - meeting.startMinute;
  if (raw < 30 || raw > 240) return 60;
  const rounded = Math.round(raw / 30) * 30;
  return rounded > 0 ? rounded : 60;
}

function overlapWindows(people: { weekday: number; startMinute: number; endMinute: number }[][]): { weekday: number; startMinute: number; endMinute: number }[] {
  if (!people.length) return [];
  let spans = people[0].map((window) => ({ weekday: window.weekday, startMinute: window.startMinute, endMinute: window.endMinute }));
  for (const person of people.slice(1)) {
    const next: typeof spans = [];
    for (const left of spans) {
      for (const right of person) {
        if (left.weekday !== right.weekday) continue;
        const startMinute = Math.max(left.startMinute, right.startMinute);
        const endMinute = Math.min(left.endMinute, right.endMinute);
        if (endMinute > startMinute) next.push({ weekday: left.weekday, startMinute, endMinute });
      }
    }
    spans = next;
  }
  return spans;
}

function shiftWeek(day: string): string | null {
  const parsed = parseDay(day);
  return parsed ? formatDay(addDays(parsed, 7)) : null;
}

function sharedSlot(context: AssistantContext, meeting: AssistantMeeting, day: string, duration: number): { ok: true; startMinute: number; endMinute: number } | { ok: false; reason: string } {
  const memberIds = [...new Set((context.members ?? []).filter((member) => member.groupId === meeting.groupId).map((member) => member.userId))];
  const schedules = (context.schedules ?? []).filter((schedule) => memberIds.includes(schedule.userId));
  if (memberIds.length < 2) {
    return { ok: false, reason: 'This project needs two people before I can look for a time that works for both of you.' };
  }
  if (schedules.length < memberIds.length || schedules.some((schedule) => schedule.windows.length === 0)) {
    return { ok: false, reason: 'Someone on this project has no saved hours, so I can’t check a time for both of you yet.' };
  }
  const windows = overlapWindows(schedules.map((schedule) => schedule.windows));
  const unavailable = schedules.flatMap((schedule) => schedule.unavailable);
  const busy = context.busy.filter((span) => !(span.day === meeting.day && span.startMinute === meeting.startMinute && span.endMinute === meeting.endMinute));
  const slot = findSlot({
    durationMinutes: duration,
    earliest: { day, minute: 0 },
    windows,
    unavailable,
    busy,
    horizonDays: 1,
  });
  if (!slot.ok || slot.day !== day) {
    return { ok: false, reason: `${labelDay(day)} has no open hour that fits both saved schedules.` };
  }
  return { ok: true, startMinute: slot.startMinute, endMinute: slot.endMinute };
}

function proposeMove(context: AssistantContext, meeting: AssistantMeeting, day: string, shared: boolean): AssistantTurn {
  const length = meetingLength(meeting);
  let startMinute = meeting.startMinute;
  let endMinute = meeting.endMinute > meeting.startMinute ? meeting.endMinute : meeting.startMinute + 60;
  let note = ' The length stays the same.';
  if (shared) {
    const slot = sharedSlot(context, meeting, day, length);
    if (!slot.ok) return { reply: slot.reason, action: { kind: 'none' }, followUp: null };
    startMinute = slot.startMinute;
    endMinute = slot.endMinute;
    note = ' That time is open for both saved schedules.';
  }
  return {
    reply: `Move “${meeting.title}” to ${labelDay(day)} at ${clock(startMinute)}.${note} Confirm to save that time.`,
    action: {
      kind: 'move-meeting',
      eventId: meeting.id,
      title: meeting.title,
      day,
      startMinute,
      endMinute,
    },
    followUp: null,
  };
}

function answerMoveMeeting(context: AssistantContext, text: string, day: string | null, nextWeek = false, shared = false): AssistantTurn {
  const found = matchMeetings(context, text);
  const pendingWeek = nextWeek || /\bnext week\b/i.test(text);
  const keepShared = shared || wantsSharedTime(text);
  const askWhich = (options: AssistantMeeting[]): AssistantTurn => ({
    reply: `Which meeting should move? ${options.slice(0, 4).map((meeting) => meeting.title).join(', ')}.`,
    action: { kind: 'none' },
    followUp: { kind: 'move-meeting', day, nextWeek: pendingWeek, shared: keepShared, source: text },
  });
  if (!found.length) {
    const open = upcomingMeetings(context);
    if (!open.length) return { reply: 'There is no upcoming meeting to move.', action: { kind: 'none' }, followUp: null };
    return askWhich(open);
  }
  if (found.length > 1) return askWhich(found);
  const meeting = found[0];
  const destination = (pendingWeek ? shiftWeek(meeting.day) : null) ?? day;
  if (!destination) {
    return {
      reply: `Which day should “${meeting.title}” move to?`,
      action: { kind: 'none' },
      followUp: { kind: 'meeting-day', eventId: meeting.id, nextWeek: pendingWeek, shared: keepShared },
    };
  }
  return proposeMove(context, meeting, destination, keepShared);
}

function targetDay(text: string, now: Date): string | null {
  const named = monthDate(text, now);
  if (named) return named;
  if (/\bnext week\b/i.test(text)) return formatDay(addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 7));
  if (/\btomorrow\b/i.test(text)) return formatDay(addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1));
  if (/\btoday\b/i.test(text) && /\bmove|reschedul|rescedul|push\b/i.test(text)) return formatDay(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  for (const [name, weekday] of Object.entries(dayNames)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) return nextNamedDay(now, weekday);
  }
  return null;
}

function planTitle(raw: string): string {
  const cleaned = raw.replace(/[.?!]+$/, '').replace(/^(my|our|the)\s+/i, '').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function nowClock(now: Date): { day: string; minute: number } {
  return { day: formatDay(now), minute: now.getHours() * 60 + now.getMinutes() };
}

export function suggestedPrompts(context: AssistantContext): string[] {
  const prompts = ['What should I work on today?'];
  const overdue = mine(context).some((task) => task.dueAt && new Date(task.dueAt).getTime() < context.now.getTime());
  if (overdue) prompts.push("We're behind schedule. Help us get back on track.");
  if (context.projects[0]) prompts.push(`Create a plan for ${context.projects[0].name}.`);
  else prompts.push('Create a plan for my science fair project.');
  prompts.push('Find a time for our next team meeting.');
  return prompts.slice(0, 3);
}

function answerNext(context: AssistantContext): AssistantTurn {
  const open = mine(context).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    createdBy: task.createdBy,
    assigneeIds: task.assigneeIds,
  }));
  const next = pickNextTask(open, context.userId, context.now);
  if (!next) {
    return { reply: 'Nothing assigned to you is still open. Add a task when the next piece of work is clear.', action: { kind: 'none' } };
  }
  const task = context.tasks.find((item) => item.id === next.task.id);
  const where = task?.groupName || 'Personal';
  const when = task?.dueLabel || 'no due date';
  const why = next.reason === 'overdue' ? 'It is overdue.' : next.reason === 'soon' ? 'It is due soon.' : 'It is the next open task.';
  return { reply: `Work on “${next.task.title}” in ${where}. ${why} Due ${when}.`, action: { kind: 'none' } };
}

function answerStatus(context: AssistantContext, text: string): AssistantTurn {
  const project = projectByName(context, text);
  const pool = context.tasks.filter((task) => task.status !== 'completed' && (!project || task.groupId === project.id));
  const blocked = pool.filter((task) => task.status === 'blocked' || task.blockedReason.trim());
  const overdue = pool.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < context.now.getTime());
  const scope = project ? project.name : 'your projects';
  if (!blocked.length && !overdue.length) {
    return { reply: `Nothing is marked blocked in ${scope}, and no open task is overdue.`, action: { kind: 'none' } };
  }
  const lines = [
    ...blocked.slice(0, 4).map((task) => `“${task.title}” is blocked${task.blockedReason.trim() ? `: ${task.blockedReason.trim()}` : '.'}`),
    ...overdue.slice(0, 4).map((task) => `“${task.title}” is overdue (${task.dueLabel}).`),
  ];
  return { reply: lines.join(' '), action: { kind: 'none' } };
}

function answerRecover(context: AssistantContext, text: string): AssistantTurn {
  const project = projectByName(context, text);
  const overdue = mine(context).filter((task) => (
    task.dueAt
    && new Date(task.dueAt).getTime() < context.now.getTime()
    && (!project || task.groupId === project.id)
    && task.assigneeIds.length <= 1
  ));
  if (!overdue.length) {
    return { reply: project ? `${project.name} has no overdue task assigned to you.` : 'None of your tasks are overdue.', action: { kind: 'none' } };
  }
  if (!context.windows.length) {
    return {
      reply: `${overdue.length} task${overdue.length === 1 ? ' is' : 's are'} overdue. No weekly hours are saved, so no new times were invented. Add availability, or revise the plan after you confirm.`,
      action: project
        ? { kind: 'open-plan', mode: 'revise', name: project.name, outcome: '', groupId: project.id, revision: text }
        : { kind: 'none' },
    };
  }
  const tasks: PlacementTask[] = overdue.map((task) => ({
    id: task.id,
    title: task.title,
    minutes: task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 60,
    priority: task.priority,
    overdue: true,
    slotInvalid: false,
    current: null,
    dependsOn: [],
    shared: false,
    groupDeadline: project?.deadline ?? null,
  }));
  const placed = placeTasks({
    now: nowClock(context.now),
    tasks,
    windows: context.windows,
    unavailable: context.unavailable,
    busy: context.busy,
  });
  if (!placed.moves.length) {
    const reason = placed.stuck[0]?.reason || 'No open block is long enough.';
    return { reply: reason, action: { kind: 'none' } };
  }
  const preview = placed.moves.slice(0, 4).map((move) => `${move.id ? overdue.find((task) => task.id === move.id)?.title : 'Task'} → ${move.day} ${clock(move.startMinute)}`).join('. ');
  return {
    reply: `These overdue tasks can move into your saved hours. ${preview}. Nothing changes until you confirm.`,
    action: {
      kind: 'reschedule',
      moves: placed.moves.map((move) => ({
        taskId: move.id,
        title: overdue.find((task) => task.id === move.id)?.title || 'Task',
        day: move.day,
        startMinute: move.startMinute,
        endMinute: move.endMinute,
        note: move.reason,
      })),
    },
  };
}

function answerMeeting(context: AssistantContext, text: string): AssistantTurn {
  const project = projectByName(context, text);
  if (!project) {
    return { reply: 'Which project is this meeting for?', action: { kind: 'none' }, followUp: { kind: 'create-meeting' } };
  }
  if (!context.windows.length) {
    return { reply: `No weekly hours are saved, so a meeting time for ${project.name} was not invented. Add your hours first.`, action: { kind: 'none' } };
  }
  const slot = findSlot({
    durationMinutes: 60,
    earliest: nowClock(context.now),
    windows: context.windows,
    unavailable: context.unavailable,
    busy: context.busy,
  });
  if (!slot.ok) return { reply: slot.reason, action: { kind: 'none' } };
  return {
    reply: `The next open hour for ${project.name} is ${slot.day} at ${clock(slot.startMinute)}. Confirm to put it on the calendar.`,
    action: {
      kind: 'create-meeting',
      groupId: project.id,
      groupName: project.name,
      title: 'Team meeting',
      day: slot.day,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
    },
  };
}

function answerUpdate(context: AssistantContext, text: string): AssistantTurn {
  const project = projectByName(context, text);
  if (!project) return { reply: 'Which project should this update go on?', action: { kind: 'none' } };
  const detail = text
    .replace(/post an update( about)?/i, '')
    .replace(/what i completed/i, '')
    .replace(/write an update( that)?/i, '')
    .replace(/[.?!]/g, ' ')
    .trim();
  const recent = context.tasks.filter((task) => task.status === 'completed' && task.groupId === project.id).slice(0, 3);
  const accomplishments = detail.length >= 8
    ? detail
    : recent.length
      ? `Finished: ${recent.map((task) => task.title).join(', ')}.`
      : '';
  if (accomplishments.length < 2) {
    return { reply: `What did you actually finish on ${project.name}? I will not invent it.`, action: { kind: 'none' }, followUp: { kind: 'update' } };
  }
  return {
    reply: `Draft for ${project.name}: “${accomplishments}” Post it only if that is what got done.`,
    action: { kind: 'post-update', groupId: project.id, groupName: project.name, accomplishments },
  };
}

function normalizeFollowUp(followUp?: AssistantFollowUp | 'update'): AssistantFollowUp {
  if (!followUp) return null;
  if (followUp === 'update') return { kind: 'update' };
  return followUp;
}

function keepsThread(text: string): boolean {
  return !/\b(what should i work on|work on today|next task|behind schedule|back on track|create a plan|make a plan)\b/i.test(text);
}

export const unmatchedReply = 'I can plan a project, show the next task, move a due date, reschedule a meeting, or draft an update. What should we do?';

/** True when the local planner has no action or follow-up for this message. */
export function needsModel(turn: AssistantTurn): boolean {
  return turn.action.kind === 'none' && !turn.followUp && turn.reply === unmatchedReply;
}

export function interpret(text: string, context: AssistantContext, followUp?: AssistantFollowUp | 'update'): AssistantTurn {
  const said = text.trim();
  if (!said) return { reply: 'Tell me what you want to plan, move, or check.', action: { kind: 'none' }, followUp: null };
  const pending = keepsThread(said) ? normalizeFollowUp(followUp) : null;
  if (pending?.kind === 'meeting-choice') {
    if (wantsNewMeeting(said) || /\bnew\b/i.test(said)) return answerMeeting(context, pending.source);
    return answerMoveMeeting(context, pending.source, targetDay(pending.source, context.now), /\bnext week\b/i.test(pending.source), wantsSharedTime(pending.source));
  }
  if (pending?.kind === 'meeting-day') {
    const meeting = context.meetings.find((item) => item.id === pending.eventId);
    if (meeting) {
      const named = (pending.nextWeek || /\bnext week\b/i.test(said)) ? shiftWeek(meeting.day) : targetDay(said, context.now);
      if (named) return proposeMove(context, meeting, named, Boolean(pending.shared) || wantsSharedTime(said));
      return {
        reply: `Which day should “${meeting.title}” move to?`,
        action: { kind: 'none' },
        followUp: pending,
      };
    }
  }
  if (pending?.kind === 'move-meeting') {
    const combined = `${pending.source ?? ''} ${said}`.trim();
    return answerMoveMeeting(context, combined, pending.day ?? targetDay(combined, context.now), pending.nextWeek, Boolean(pending.shared) || wantsSharedTime(combined));
  }
  if (pending?.kind === 'create-meeting') return answerMeeting(context, said);
  if (pending?.kind === 'update' && !/plan|meeting|move|friday|schedule/i.test(said)) {
    return answerUpdate(context, `Post an update ${said}`);
  }
  const day = targetDay(said, context.now);
  const wantsMove = wantsMeetingMove(said);
  const movingMeeting = (wantsMove && /\bmeetings?\b/i.test(said)) || (/\bexisting\b/i.test(said) && !/\btask\b/i.test(said));
  if (movingMeeting) return answerMoveMeeting(context, said, /\bnext week\b/i.test(said) ? null : day, /\bnext week\b/i.test(said), wantsSharedTime(said));
  if (wantsMove && day) {
    const found = matchTasks(context, said);
    if (found.length === 1) {
      const task = found[0];
      return {
        reply: `Move “${task.title}” to ${day}. The previous date was ${task.dueLabel}. Confirm to save that date.`,
        action: { kind: 'move-task', taskId: task.id, title: task.title, fromLabel: task.dueLabel, day },
      };
    }
    if (found.length > 1) {
      return { reply: `Which task should move to ${day}? ${found.slice(0, 4).map((task) => task.title).join(', ')}.`, action: { kind: 'none' } };
    }
    return { reply: 'I could not match that to one of your open tasks.', action: { kind: 'none' } };
  }
  if (wantsMove) return { reply: 'Which task should move, and to which day?', action: { kind: 'none' } };
  if (wantsNewMeeting(said)) return answerMeeting(context, said);
  if (/\bmeetings?\b/i.test(said)) {
    return {
      reply: 'Do you want to move an existing meeting, or find a time for a new one?',
      action: { kind: 'none' },
      followUp: { kind: 'meeting-choice', source: said },
    };
  }
  if (/\b(update|completed|finished)\b/i.test(said) && /\b(post|update|finished|completed)\b/i.test(said)) return answerUpdate(context, said);
  if (/\bwhat should i work on\b|\bwork on today\b|\bnext task\b/i.test(said)) return answerNext(context);
  if (/\bblocking\b|\bmilestone\b|\bstatus\b/i.test(said)) return answerStatus(context, said);
  if (/\bbehind schedule\b|\bback on track\b|\boverdue\b/i.test(said)) return answerRecover(context, said);
  const created = /(?:create|make|build)\s+(?:a\s+)?plan\s+for\s+(?:my\s+|our\s+|the\s+)?(.+)/i.exec(said);
  if (created || /\bplan\b/i.test(said)) {
    const title = planTitle(created?.[1] || '');
    if (!title) return { reply: 'What is the project, and what should be true when it is done?', action: { kind: 'none' } };
    const existing = context.projects.find((project) => project.name.toLowerCase() === title.toLowerCase());
    if (existing) {
      return {
        reply: `${existing.name} already exists. This opens the current planner so you can revise it. Nothing is saved until you confirm the draft.`,
        action: { kind: 'open-plan', mode: 'revise', name: existing.name, outcome: existing.name, groupId: existing.id, revision: said },
      };
    }
    return {
      reply: `This opens the planner for “${title}”. You can review the draft before anything is saved.`,
      action: { kind: 'open-plan', mode: 'new', name: title, outcome: said, groupId: null, revision: '' },
    };
  }
  if (/\brevise\b|\breplan\b/i.test(said)) {
    const project = projectByName(context, said);
    if (!project) return { reply: 'Which project should be revised?', action: { kind: 'none' } };
    return {
      reply: `This opens the planner for ${project.name}. The current tasks stay until you confirm a draft.`,
      action: { kind: 'open-plan', mode: 'revise', name: project.name, outcome: '', groupId: project.id, revision: said },
    };
  }
  return { reply: unmatchedReply, action: { kind: 'none' }, followUp: null };
}

import { phasesForFocus } from '../goals';
import { addDays, daySpan, eachDay, formatDay, parseDay } from './dates';
import { phasesForProjectType } from './presets';
import type { GeneratedPlan, PlannerInput, PlannerMember, PlanPriority, PlanTask } from './types';

function memberUnavailable(member: PlannerMember, day: Date): boolean {
  const key = formatDay(day);
  if (member.availableWeekdays.length && !member.availableWeekdays.includes(day.getDay())) return true;
  return member.unavailable.some((range) => key >= range.start.slice(0, 10) && key <= range.end.slice(0, 10));
}

function workableDays(member: PlannerMember, start: Date, end: Date): Date[] {
  return eachDay(start, end).filter((day) => !memberUnavailable(member, day));
}

function skillScore(member: PlannerMember, title: string): number {
  const skills = member.skills.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const haystack = title.toLowerCase();
  return skills.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

function atHour(day: Date, hour: number): string {
  const copy = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
  return copy.toISOString();
}

export function buildFallbackPlan(input: PlannerInput): GeneratedPlan {
  const start = parseDay(input.startDate) as Date;
  const explicitDeadline = parseDay(input.deadline);
  const assumedDeadline = !explicitDeadline;
  const deadline = explicitDeadline ?? addDays(start, 28);
  const span = Math.max(1, daySpan(start, deadline));
  const pace = input.pace === 'sprint' || input.pace === 'flexible' ? input.pace : 'steady';
  const bufferRatio = pace === 'sprint' ? 0.05 : pace === 'flexible' ? 0.25 : 0.15;
  const bufferDays = Math.max(1, Math.floor(span * bufferRatio));
  const scheduleEnd = span > 3 ? addDays(deadline, -bufferDays) : deadline;
  const effectiveEnd = scheduleEnd < start ? deadline : scheduleEnd;

  const phaseNames = phasesForProjectType(input.projectType) ?? phasesForFocus(input.focus, span) ?? (span < 10
    ? [
        { name: 'Frame', summary: 'Agree on the outcome, constraints, and who owns the first slice of work.' },
        { name: 'Build', summary: 'Do the core work in small sessions that fit the team’s available hours.' },
        { name: 'Finish', summary: 'Review, fix gaps, and leave a buffer before the deadline.' },
      ]
    : [
        { name: 'Discover', summary: 'Confirm scope, skills, and the first milestone.' },
        { name: 'Build', summary: 'Produce the main deliverable in dependency order.' },
        { name: 'Review', summary: 'Check quality, unblock teammates, and adjust the remaining work.' },
        { name: 'Deliver', summary: 'Finish, document, and hold the final checkpoint before the deadline.' },
      ]);

  const seeds: { title: string; description: string; phase: string; priority: PlanPriority; minutes: number }[] = [
    {
      title: `Define “${input.title}” outcome`,
      description: input.outcome,
      phase: phaseNames[0]?.name ?? 'Frame',
      priority: 'high',
      minutes: 60,
    },
  ];

  for (const milestone of input.milestones) {
    seeds.push({
      title: milestone.title,
      description: milestone.date ? `Milestone target date: ${milestone.date}.` : 'Milestone from the project setup.',
      phase: phaseNames[Math.min(1, phaseNames.length - 1)]?.name ?? 'Build',
      priority: input.priority,
      minutes: 120,
    });
  }

  seeds.push({
    title: `Build the core of ${input.title}`,
    description: input.notes
      ? `Keep these notes in mind: ${input.notes}`
      : 'Complete the main deliverable in small, reviewable pieces.',
    phase: phaseNames[Math.min(1, phaseNames.length - 1)]?.name ?? 'Build',
    priority: input.priority === 'low' ? 'medium' : input.priority,
    minutes: 180,
  });

  seeds.push({
    title: `Review and buffer before ${formatDay(deadline)}`,
    description: 'Leave time to fix issues instead of scheduling work against the final deadline.',
    phase: phaseNames[phaseNames.length - 1]?.name ?? 'Finish',
    priority: 'medium',
    minutes: 90,
  });

  const existingOpen = input.existingTasks.filter((task) => task.status !== 'completed');
  const existingDone = input.existingTasks.filter((task) => task.status === 'completed');
  for (const task of existingOpen) {
    if (seeds.some((seed) => seed.title.toLowerCase() === task.title.toLowerCase())) continue;
    seeds.push({
      title: task.title,
      description: 'Already on the project board. This plan will not create a second copy.',
      phase: phaseNames[Math.min(1, phaseNames.length - 1)]?.name ?? 'Build',
      priority: 'medium',
      minutes: task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : 90,
    });
  }

  const capacityMinutes = input.members.reduce((sum, member) => {
    const weeks = Math.max(1, span / 7);
    return sum + member.weeklyHours * weeks * 60;
  }, 0);
  const demand = seeds.reduce((sum, seed) => sum + seed.minutes, 0);
  const teamHasAnyDay = input.members.some((member) => workableDays(member, start, deadline).length > 0);
  const feasible = demand <= capacityMinutes * 0.85 && teamHasAnyDay;

  const load = new Map<string, number>();
  for (const member of input.members) load.set(member.id, 0);

  const chooseAssignee = (title: string): PlannerMember => {
    const ranked = [...input.members].sort((a, b) => {
      const skill = skillScore(b, title) - skillScore(a, title);
      if (skill !== 0) return skill;
      return (load.get(a.id) ?? 0) / a.weeklyHours - (load.get(b.id) ?? 0) / b.weeklyHours;
    });
    return ranked[0] as PlannerMember;
  };

  const tasks: PlanTask[] = [];
  let previousTitle = '';
  seeds.forEach((seed, index) => {
    const assignee = chooseAssignee(seed.title);
    load.set(assignee.id, (load.get(assignee.id) ?? 0) + seed.minutes);
    const days = workableDays(assignee, start, effectiveEnd);
    const place = (offset: number) => {
      const linear = seeds.length <= 1 ? 1 : offset / seeds.length;
      const shaped = pace === 'sprint' ? linear * 0.72 : linear;
      return days[Math.min(days.length - 1, Math.floor(shaped * (days.length - 1)))];
    };
    const slot = days.length ? place(index + 1) : effectiveEnd;
    const startSlot = days.length ? place(index) : start;
    const alreadyTracked = existingOpen.some((task) => task.title.toLowerCase() === seed.title.toLowerCase())
      || existingDone.some((task) => task.title.toLowerCase() === seed.title.toLowerCase());
    const phaseIndex = Math.min(phaseNames.length - 1, Math.floor((index / seeds.length) * phaseNames.length));
    tasks.push({
      title: seed.title,
      description: seed.description,
      phase: phaseNames[phaseIndex]?.name ?? seed.phase,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      priority: seed.priority,
      estimatedMinutes: seed.minutes,
      startDate: formatDay(startSlot ?? start),
      dueDate: formatDay(slot ?? deadline),
      dependsOnTitles: previousTitle && !alreadyTracked ? [previousTitle] : [],
      microGoals: [
        `Open ${seed.title.toLowerCase()} and write the first concrete step.`,
        'Do one focused session and note what is still unfinished.',
        'Hand the result to a teammate or mark the task complete.',
      ],
      alreadyTracked,
    });
    if (!alreadyTracked) previousTitle = seed.title;
  });

  const risks: string[] = [];
  if (!feasible) {
    risks.push('The estimated work is larger than the hours the team said they have, or someone has no open days.');
  }
  if (!teamHasAnyDay) risks.push('No teammate has an available day before the deadline.');
  if (input.members.length === 1) risks.push('All new work is on one person because the project has a single member.');
  if (bufferDays > 0) risks.push(`The last ${bufferDays} day${bufferDays === 1 ? '' : 's'} before the deadline are held as buffer.`);

  const kickoff = workableDays(input.members[0] as PlannerMember, start, deadline)[0] ?? start;
  const midpoint = addDays(start, Math.floor(span / 2));
  const reviewDay = addDays(deadline, span > 2 ? -1 : 0);
  const meetings = [
    {
      title: `${input.title} kickoff`,
      agenda: 'Confirm the outcome, owners, and the first tasks.',
      startsAt: atHour(kickoff, 16),
      endsAt: atHour(kickoff, 17),
      reason: 'Start the project with a shared understanding of the plan.',
    },
    {
      title: `${input.title} checkpoint`,
      agenda: 'Review progress logs, blockers, and whether the deadline still fits.',
      startsAt: atHour(midpoint, 16),
      endsAt: atHour(midpoint, 17),
      reason: 'Catch delays while there is still time to reschedule.',
    },
  ];
  if (formatDay(reviewDay) !== formatDay(kickoff)) {
    meetings.push({
      title: `${input.title} final review`,
      agenda: 'Check remaining tasks and decide what can ship before the deadline.',
      startsAt: atHour(reviewDay, 16),
      endsAt: atHour(reviewDay, 17),
      reason: 'Use the buffer instead of discovering gaps on the due date.',
    });
  }

  const milestoneDates = input.milestones.map((milestone, index) => {
    const explicit = milestone.date ? parseDay(milestone.date) : null;
    const fallbackDate = addDays(start, Math.min(span, Math.round(((index + 1) / (input.milestones.length + 1)) * span)));
    return { title: milestone.title, dueDate: formatDay(explicit && explicit >= start && explicit <= deadline ? explicit : fallbackDate) };
  });

  return {
    source: 'fallback',
    notices: ['This schedule was built by the in-app planner because an AI provider was not used.'],
    feasible: feasible && teamHasAnyDay,
    summary: feasible
      ? `${tasks.length} tasks across ${phaseNames.length} phases, using about ${Math.round(demand / 60)} hours before the buffer.`
      : `This plan needs about ${Math.round(demand / 60)} hours and the team has about ${Math.round(capacityMinutes / 60)} hours. It does not fit as written.`,
    assumptions: [
      'Durations are estimates, not recorded work.',
      'A due date is a deadline, not a scheduled work block.',
      'Completed tasks already on the board are left unchanged.',
      pace === 'sprint'
        ? 'Sprint pacing places work earlier and keeps a shorter buffer.'
        : pace === 'flexible'
          ? 'Flexible pacing spreads work later and keeps a longer buffer.'
          : 'Steady pacing spreads work evenly across open days.',
      input.notes ? `Notes considered: ${input.notes}` : '',
      existingDone.length ? `${existingDone.length} completed task${existingDone.length === 1 ? '' : 's'} were kept as history and not regenerated.` : 'No completed work was on the board yet.',
      assumedDeadline ? 'No deadline was given, so this draft uses a four-week window. Those dates are proposals.' : '',
      input.projectType ? `Project type considered: ${input.projectType}.` : '',
      input.revision ? `Additional instruction: ${input.revision}` : '',
    ].filter(Boolean),
    risks,
    questions: [],
    phases: phaseNames,
    milestones: milestoneDates,
    tasks,
    meetings,
    criticalPath: [],
    workload: [],
    alternatives: [],
  };
}

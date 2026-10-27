export type PlanningStyle = 'steady' | 'sprint' | 'flexible';

export interface GoalPreset {
  id: string;
  label: string;
  detail: string;
  milestones: string[];
  phases: { name: string; summary: string }[];
}

export const GOAL_PRESETS: GoalPreset[] = [
  {
    id: 'competition',
    label: 'Competition team',
    detail: 'Design, prototype, test, and submit.',
    milestones: ['Design freeze', 'Working prototype', 'Test and revise', 'Submission'],
    phases: [
      { name: 'Design', summary: 'Lock the approach before building.' },
      { name: 'Prototype', summary: 'Build a version the team can try.' },
      { name: 'Test', summary: 'Find what fails and fix the important gaps.' },
      { name: 'Submit', summary: 'Package the work before the deadline.' },
    ],
  },
  {
    id: 'software',
    label: 'Software project',
    detail: 'Features, building, testing, and a release.',
    milestones: ['Scope the first version', 'Build the core flow', 'Test with a teammate', 'Release'],
    phases: [
      { name: 'Scope', summary: 'Decide what the first version includes.' },
      { name: 'Build', summary: 'Implement the core flow in small pieces.' },
      { name: 'Test', summary: 'Try the flow and fix what blocks a release.' },
      { name: 'Release', summary: 'Ship what is ready and note what waits.' },
    ],
  },
  {
    id: 'school',
    label: 'School assignment',
    detail: 'Research, writing, a presentation, and review.',
    milestones: ['Research notes', 'Draft', 'Presentation', 'Final review'],
    phases: [
      { name: 'Research', summary: 'Collect the sources and the question.' },
      { name: 'Draft', summary: 'Write the argument in sections.' },
      { name: 'Present', summary: 'Turn the draft into something the group can show.' },
      { name: 'Review', summary: 'Check citations, timing, and the final file.' },
    ],
  },
  {
    id: 'club',
    label: 'Club or organization',
    detail: 'Events, owners, and follow-through.',
    milestones: ['Agree on the plan', 'Assign owners', 'Tell people'],
    phases: [
      { name: 'Plan', summary: 'Agree on the outcome and the date.' },
      { name: 'Owners', summary: 'Give each piece a person.' },
      { name: 'Promote', summary: 'Tell the people who need to know.' },
      { name: 'Run', summary: 'Hold the event and note what to change next time.' },
    ],
  },
  {
    id: 'event',
    label: 'Hackathon or event',
    detail: 'Prep, the build window, and the demo.',
    milestones: ['Prep checklist', 'Build window', 'Demo'],
    phases: [
      { name: 'Prep', summary: 'Gather what the team needs before the event.' },
      { name: 'Build', summary: 'Use the event time for the core result.' },
      { name: 'Demo', summary: 'Show the result and list what is unfinished.' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal organization',
    detail: 'Priorities, deadlines, and a daily plan.',
    milestones: ['This week’s priority', 'Weekly review'],
    phases: [
      { name: 'Choose', summary: 'Pick the one outcome that matters this week.' },
      { name: 'Schedule', summary: 'Put the work on days you can actually use.' },
      { name: 'Review', summary: 'Record what got done and what moves next.' },
    ],
  },
  {
    id: 'skill',
    label: 'Build a skill',
    detail: 'Practice, feedback, and a check-in.',
    milestones: ['Practice target', 'First sessions', 'Feedback'],
    phases: [
      { name: 'Target', summary: 'Name the skill and the first practice.' },
      { name: 'Practice', summary: 'Do the sessions on the days you set aside.' },
      { name: 'Feedback', summary: 'Check what improved and what to practice next.' },
    ],
  },
  {
    id: 'volunteer',
    label: 'Volunteering',
    detail: 'A community effort with owners and a date.',
    milestones: ['Agree on the need', 'Line up help', 'Do the work', 'Follow up'],
    phases: [
      { name: 'Need', summary: 'Name who the work is for and what done looks like.' },
      { name: 'Help', summary: 'Find the people and materials required.' },
      { name: 'Do', summary: 'Carry out the work in small pieces.' },
      { name: 'Follow up', summary: 'Close the loop and note what to repeat.' },
    ],
  },
  {
    id: 'work',
    label: 'Work project',
    detail: 'A professional outcome with a review.',
    milestones: ['Define the outcome', 'Do the work', 'Review', 'Hand off'],
    phases: [
      { name: 'Define', summary: 'Agree on the outcome and the constraints.' },
      { name: 'Do', summary: 'Finish the core work in reviewable pieces.' },
      { name: 'Review', summary: 'Check the result against the outcome.' },
      { name: 'Hand off', summary: 'Deliver what is ready and list what remains.' },
    ],
  },
];

export const PLANNING_STYLES: { id: PlanningStyle; label: string; detail: string }[] = [
  { id: 'steady', label: 'Steady', detail: 'Even progress across the week.' },
  { id: 'sprint', label: 'Sprint', detail: 'Short bursts and a nearer deadline.' },
  { id: 'flexible', label: 'Flexible', detail: 'Room to move work when the week changes.' },
];

export function goalPreset(id: string): GoalPreset | undefined {
  return GOAL_PRESETS.find((goal) => goal.id === id);
}

export function goalSummary(goals: string[] | null | undefined, customGoal?: string | null): string {
  const labels = (goals ?? [])
    .map((id) => goalPreset(id)?.label)
    .filter((label): label is string => Boolean(label));
  const custom = customGoal?.trim();
  if (custom) labels.push(custom);
  return labels.join(' · ');
}

export function suggestedMilestones(goals: string[] | null | undefined, customGoal?: string | null): string[] {
  const titles: string[] = [];
  for (const id of goals ?? []) {
    const preset = goalPreset(id);
    if (preset) titles.push(...preset.milestones);
  }
  const custom = customGoal?.trim();
  if (custom) titles.push(custom.slice(0, 140));
  return [...new Set(titles)].slice(0, 6);
}

export function phasesForFocus(focus: string | undefined, _span: number): { name: string; summary: string }[] | null {
  const preset = focus ? goalPreset(focus) : undefined;
  return preset ? preset.phases : null;
}

export function homeLead(goals: string[] | null | undefined, style?: string | null): string {
  const primary = goalPreset(goals?.[0] ?? '');
  const pace = PLANNING_STYLES.find((item) => item.id === style)?.detail;
  if (primary && pace) return `${primary.label}. ${pace}`;
  if (primary) return primary.detail;
  if (pace) return pace;
  return '';
}

export const PROJECT_TYPES = [
  'General project',
  'Congressional App Challenge',
  'Conrad Challenge',
  'ARC Rocketry Challenge',
] as const;

export type ProjectTypeName = (typeof PROJECT_TYPES)[number];

const presetPhases: Record<Exclude<ProjectTypeName, 'General project'>, { name: string; summary: string }[]> = {
  'Congressional App Challenge': [
    { name: 'Define the app', summary: 'Choose the problem and the smallest useful version.' },
    { name: 'Build', summary: 'Implement the core flow a judge can try.' },
    { name: 'Demo', summary: 'Record the walkthrough and fix what the video exposes.' },
    { name: 'Submit', summary: 'Check the rules and turn the project in.' },
  ],
  'Conrad Challenge': [
    { name: 'Problem', summary: 'State who is affected and what is already known.' },
    { name: 'Solution', summary: 'Describe the approach and why it is realistic.' },
    { name: 'Prototype', summary: 'Build the evidence the team can show.' },
    { name: 'Pitch', summary: 'Prepare the explanation and the materials that support it.' },
  ],
  'ARC Rocketry Challenge': [
    { name: 'Design', summary: 'Lock the requirements, materials, and safety limits.' },
    { name: 'Build', summary: 'Assemble the rocket and the payload in testable pieces.' },
    { name: 'Test', summary: 'Check the build before a flight attempt.' },
    { name: 'Report', summary: 'Record results and finish the required documentation.' },
  ],
};

export function knownProjectType(value: unknown): ProjectTypeName | '' {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return (PROJECT_TYPES as readonly string[]).includes(trimmed) ? (trimmed as ProjectTypeName) : '';
}

/** Presets change the built-in phase list. General project keeps the normal phases. */
export function phasesForProjectType(value: string | undefined): { name: string; summary: string }[] | null {
  const type = knownProjectType(value);
  if (!type || type === 'General project') return null;
  return presetPhases[type];
}

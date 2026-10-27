import assert from 'node:assert/strict';
import test from 'node:test';

import { GOAL_PRESETS, goalSummary, phasesForFocus, suggestedMilestones } from './goals.ts';

test('goals suggest milestones without duplicates', () => {
  const titles = suggestedMilestones(['school', 'school'], '  Demo video  ');
  assert.deepEqual(titles.slice(0, 2), ['Research notes', 'Draft']);
  assert.equal(titles.at(-1), 'Demo video');
  assert.equal(new Set(titles).size, titles.length);
});

test('milestone suggestions leave out time blocked and run it', () => {
  const titles = GOAL_PRESETS.flatMap((goal) => goal.milestones);
  assert.equal(titles.includes('Time blocked'), false);
  assert.equal(titles.includes('Run it'), false);
});

test('unknown goals do not invent a summary', () => {
  assert.equal(goalSummary(['missing'], ''), '');
  assert.equal(goalSummary(['competition'], ''), 'Competition team');
  assert.equal(phasesForFocus('software', 30)?.[0]?.name, 'Scope');
  assert.equal(phasesForFocus(undefined, 30), null);
});

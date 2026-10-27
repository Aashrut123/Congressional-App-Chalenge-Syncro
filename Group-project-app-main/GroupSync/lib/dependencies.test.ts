import assert from 'node:assert/strict';
import test from 'node:test';

import { dependencyCycle } from './dependencies.ts';

const chain = [
  { taskId: 'a', dependsOn: 'b' },
  { taskId: 'b', dependsOn: 'c' },
];

test('a task cannot depend on itself', () => {
  assert.equal(dependencyCycle([], 'a', 'a'), true);
});

test('an indirect loop is rejected and an unrelated task is allowed', () => {
  assert.equal(dependencyCycle(chain, 'c', 'a'), true);
  assert.equal(dependencyCycle(chain, 'c', 'b'), true);
  assert.equal(dependencyCycle(chain, 'd', 'a'), false);
  assert.equal(dependencyCycle(chain, 'a', 'c'), false);
});

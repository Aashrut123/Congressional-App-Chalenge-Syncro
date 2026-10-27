export interface DependencyLink {
  taskId: string;
  dependsOn: string;
}

/** True when `taskId` depending on `dependsOn` would close a loop, including a self-link. */
export function dependencyCycle(links: DependencyLink[], taskId: string, dependsOn: string): boolean {
  if (!taskId || !dependsOn || taskId === dependsOn) return true;
  const predecessors = new Map<string, string[]>();
  for (const link of links) {
    if (link.taskId === taskId && link.dependsOn === dependsOn) continue;
    const next = predecessors.get(link.taskId) ?? [];
    next.push(link.dependsOn);
    predecessors.set(link.taskId, next);
  }
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === taskId) return true;
    seen.add(current);
    for (const next of predecessors.get(current) ?? []) stack.push(next);
  }
  return false;
}

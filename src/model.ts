export type TourtoisAgentTarget = Readonly<{
  agentId: string;
  label: string;
}>;

/** Keep the routed Agent first while deduplicating the directory projection. */
export function orderedAgentTargets(
  current: TourtoisAgentTarget,
  decoded: readonly TourtoisAgentTarget[],
): readonly TourtoisAgentTarget[] {
  const seen = new Set([current.agentId]);
  return [
    current,
    ...decoded.filter((agent) => {
      if (seen.has(agent.agentId)) return false;
      seen.add(agent.agentId);
      return true;
    }),
  ];
}

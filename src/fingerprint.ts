/**
 * Fingerprint — Builds a behavioral fingerprint from a stream of agent actions.
 *
 * A fingerprint captures the statistical signature of how an agent behaves:
 * what actions it takes, how often, at what times, and how its requests
 * are decided upon.
 */

import { AgentAction, BehavioralFingerprint } from './types.js';

/**
 * Build a behavioral fingerprint from a list of agent actions.
 *
 * Filters to a single agent if agentId is provided, otherwise uses all actions.
 */
export function buildFingerprint(
  actions: AgentAction[],
  agentId?: string,
): BehavioralFingerprint {
  const filtered = agentId
    ? actions.filter((a) => a.agent_id === agentId)
    : actions;

  if (filtered.length === 0) {
    return emptyFingerprint(agentId ?? 'unknown');
  }

  const resolvedAgentId = agentId ?? filtered[0].agent_id;

  // Sort by timestamp
  const sorted = [...filtered].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const start = sorted[0].timestamp;
  const end = sorted[sorted.length - 1].timestamp;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const durationHours = Math.max((endMs - startMs) / 3_600_000, 1 / 3600); // at least 1 second

  // Action frequency: count per hour
  const actionCounts = new Map<string, number>();
  for (const action of sorted) {
    actionCounts.set(action.action_type, (actionCounts.get(action.action_type) ?? 0) + 1);
  }
  const actionFrequency: Record<string, number> = {};
  for (const [type, count] of actionCounts) {
    actionFrequency[type] = Math.round((count / durationHours) * 100) / 100;
  }

  // Tool/resource preferences
  const resourceCounts = new Map<string, number>();
  for (const action of sorted) {
    resourceCounts.set(action.resource, (resourceCounts.get(action.resource) ?? 0) + 1);
  }
  const toolPreferences: Record<string, number> = {};
  for (const [resource, count] of resourceCounts) {
    toolPreferences[resource] = Math.round((count / sorted.length) * 1000) / 1000;
  }

  // Temporal pattern: 24-hour histogram
  const hourCounts = new Array(24).fill(0);
  for (const action of sorted) {
    const hour = new Date(action.timestamp).getUTCHours();
    hourCounts[hour]++;
  }
  const maxHourCount = Math.max(...hourCounts, 1);
  const temporalPattern = hourCounts.map((c: number) => Math.round((c / maxHourCount) * 1000) / 1000);

  // Resource access pattern (ordered by frequency)
  const resourceAccessPattern = [...resourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([resource]) => resource)
    .slice(0, 20);

  // Decision distribution
  const outcomeCounts: Record<string, number> = {
    allow: 0,
    deny: 0,
    require_approval: 0,
    rate_limited: 0,
  };
  for (const action of sorted) {
    outcomeCounts[action.outcome] = (outcomeCounts[action.outcome] ?? 0) + 1;
  }
  const decisionDistribution: Record<string, number> = {};
  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    decisionDistribution[outcome] = Math.round((count / sorted.length) * 1000) / 1000;
  }

  // Average latency
  const totalLatency = sorted.reduce((sum, a) => sum + a.evaluation_time_ms, 0);
  const averageLatency = Math.round((totalLatency / sorted.length) * 100) / 100;

  // Chain depth distribution
  const depthMap = new Map<string, number>(); // action id -> depth
  const depthCounts = new Map<number, number>(); // depth -> count

  for (const action of sorted) {
    let depth = 0;
    if (action.parent_action_id) {
      const parentDepth = depthMap.get(action.parent_action_id) ?? 0;
      depth = parentDepth + 1;
    }
    depthMap.set(action.id, depth);
    depthCounts.set(depth, (depthCounts.get(depth) ?? 0) + 1);
  }

  const maxDepth = depthCounts.size > 0 ? Math.max(...depthCounts.keys()) : 0;
  const chainDepthDistribution = new Array(maxDepth + 1).fill(0);
  for (const [depth, count] of depthCounts) {
    chainDepthDistribution[depth] = count;
  }

  // Error rate
  const errorActions = sorted.filter(
    (a) => a.outcome === 'deny' || a.outcome === 'rate_limited',
  ).length;
  const errorRate = Math.round((errorActions / sorted.length) * 1000) / 1000;

  // Burstiness (coefficient of variation of inter-action times)
  const burstiness = computeBurstiness(sorted);

  return {
    agentId: resolvedAgentId,
    observationWindow: { start, end },
    actionFrequency,
    toolPreferences,
    temporalPattern,
    resourceAccessPattern,
    decisionDistribution,
    averageLatency,
    chainDepthDistribution,
    errorRate,
    burstiness,
    totalActions: sorted.length,
  };
}

/**
 * Compute burstiness as the coefficient of variation of inter-action times.
 * CV = stddev / mean. Higher = more bursty.
 */
function computeBurstiness(sorted: AgentAction[]): number {
  if (sorted.length < 2) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
    intervals.push(gap);
  }

  if (intervals.length === 0) return 0;

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return 0;

  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  return Math.round((stdDev / mean) * 1000) / 1000;
}

/**
 * Create an empty fingerprint for an agent with no observations.
 */
function emptyFingerprint(agentId: string): BehavioralFingerprint {
  return {
    agentId,
    observationWindow: { start: '', end: '' },
    actionFrequency: {},
    toolPreferences: {},
    temporalPattern: new Array(24).fill(0),
    resourceAccessPattern: [],
    decisionDistribution: {},
    averageLatency: 0,
    chainDepthDistribution: [0],
    errorRate: 0,
    burstiness: 0,
    totalActions: 0,
  };
}

/**
 * Incrementally update a fingerprint with a new action.
 * Returns a new fingerprint (does not mutate the original).
 */
export function updateFingerprint(
  fingerprint: BehavioralFingerprint,
  action: AgentAction,
): BehavioralFingerprint {
  // Rebuild from scratch would be expensive, so we do incremental updates
  const fp = structuredClone(fingerprint);
  const n = fp.totalActions;
  const newN = n + 1;

  // Update observation window
  if (!fp.observationWindow.start || action.timestamp < fp.observationWindow.start) {
    fp.observationWindow.start = action.timestamp;
  }
  if (!fp.observationWindow.end || action.timestamp > fp.observationWindow.end) {
    fp.observationWindow.end = action.timestamp;
  }

  // Update action frequency (approximate)
  const startMs = new Date(fp.observationWindow.start).getTime();
  const endMs = new Date(fp.observationWindow.end).getTime();
  const durationHours = Math.max((endMs - startMs) / 3_600_000, 1 / 3600);

  fp.actionFrequency[action.action_type] =
    (fp.actionFrequency[action.action_type] ?? 0) + 1 / durationHours;

  // Update tool preferences (running average)
  const prevResourcePct = fp.toolPreferences[action.resource] ?? 0;
  // Rescale all existing preferences
  for (const key of Object.keys(fp.toolPreferences)) {
    fp.toolPreferences[key] = (fp.toolPreferences[key] * n) / newN;
  }
  fp.toolPreferences[action.resource] = (prevResourcePct * n + 1) / newN;

  // Update temporal pattern
  const hour = new Date(action.timestamp).getUTCHours();
  fp.temporalPattern[hour] = Math.min(1, fp.temporalPattern[hour] + 1 / newN);
  // Renormalize
  const maxTemporal = Math.max(...fp.temporalPattern, 0.001);
  for (let i = 0; i < 24; i++) {
    fp.temporalPattern[i] = Math.round((fp.temporalPattern[i] / maxTemporal) * 1000) / 1000;
  }

  // Update resource access pattern
  if (!fp.resourceAccessPattern.includes(action.resource)) {
    fp.resourceAccessPattern.push(action.resource);
    if (fp.resourceAccessPattern.length > 20) {
      fp.resourceAccessPattern = fp.resourceAccessPattern.slice(0, 20);
    }
  }

  // Update decision distribution
  for (const key of Object.keys(fp.decisionDistribution)) {
    fp.decisionDistribution[key] = (fp.decisionDistribution[key] * n) / newN;
  }
  fp.decisionDistribution[action.outcome] =
    ((fp.decisionDistribution[action.outcome] ?? 0) * n + 1) / newN;

  // Update average latency
  fp.averageLatency = (fp.averageLatency * n + action.evaluation_time_ms) / newN;

  // Update error rate
  const isError = action.outcome === 'deny' || action.outcome === 'rate_limited';
  fp.errorRate = (fp.errorRate * n + (isError ? 1 : 0)) / newN;

  fp.totalActions = newN;

  return fp;
}

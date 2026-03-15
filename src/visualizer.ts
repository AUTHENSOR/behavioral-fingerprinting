/**
 * Visualizer — ASCII charts for terminal output showing fingerprint comparisons.
 *
 * Provides:
 * - Side-by-side fingerprint summaries
 * - Bar chart comparisons
 * - Temporal pattern overlays
 * - Drift score gauges
 */

import { BehavioralFingerprint, ComparisonResult } from './types.js';

// ANSI color codes
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

/**
 * Render a full fingerprint summary to the terminal.
 */
export function renderFingerprint(fp: BehavioralFingerprint): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${C.bold}${C.cyan}Behavioral Fingerprint${C.reset}`);
  lines.push(`${C.dim}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501${C.reset}`);
  lines.push('');

  lines.push(`${C.bold}Agent:${C.reset}         ${fp.agentId}`);
  lines.push(`${C.bold}Total Actions:${C.reset} ${fp.totalActions}`);
  lines.push(`${C.bold}Window:${C.reset}        ${fp.observationWindow.start || 'N/A'} \u2192 ${fp.observationWindow.end || 'N/A'}`);
  lines.push(`${C.bold}Avg Latency:${C.reset}   ${fp.averageLatency.toFixed(1)}ms`);
  lines.push(`${C.bold}Error Rate:${C.reset}    ${(fp.errorRate * 100).toFixed(1)}%`);
  lines.push(`${C.bold}Burstiness:${C.reset}    ${fp.burstiness.toFixed(3)}`);
  lines.push('');

  // Action frequency
  lines.push(`${C.bold}Action Frequency (per hour):${C.reset}`);
  const maxFreq = Math.max(...Object.values(fp.actionFrequency), 0.001);
  const sortedActions = Object.entries(fp.actionFrequency).sort((a, b) => b[1] - a[1]);

  for (const [action, freq] of sortedActions.slice(0, 10)) {
    const barLen = Math.round((freq / maxFreq) * 30);
    const bar = '\u2588'.repeat(barLen) + '\u2591'.repeat(30 - barLen);
    lines.push(`  ${action.padEnd(20)} ${C.blue}${bar}${C.reset} ${freq.toFixed(1)}/hr`);
  }
  lines.push('');

  // Decision distribution
  lines.push(`${C.bold}Decision Distribution:${C.reset}`);
  for (const [outcome, ratio] of Object.entries(fp.decisionDistribution)) {
    const barLen = Math.round(ratio * 30);
    const color = outcome === 'allow' ? C.green : outcome === 'deny' ? C.red : C.yellow;
    const bar = '\u2588'.repeat(barLen) + '\u2591'.repeat(30 - barLen);
    lines.push(`  ${outcome.padEnd(20)} ${color}${bar}${C.reset} ${(ratio * 100).toFixed(1)}%`);
  }
  lines.push('');

  // Temporal pattern (24-hour histogram)
  lines.push(`${C.bold}24-Hour Activity Pattern (UTC):${C.reset}`);
  lines.push(renderTemporalChart(fp.temporalPattern));
  lines.push('');

  // Top resources
  if (fp.resourceAccessPattern.length > 0) {
    lines.push(`${C.bold}Top Resources:${C.reset}`);
    for (const resource of fp.resourceAccessPattern.slice(0, 5)) {
      const pct = fp.toolPreferences[resource] ?? 0;
      lines.push(`  ${C.dim}\u2022${C.reset} ${resource} (${(pct * 100).toFixed(1)}%)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render a comparison between two fingerprints.
 */
export function renderComparison(
  baseline: BehavioralFingerprint,
  current: BehavioralFingerprint,
  result: ComparisonResult,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${C.bold}${C.cyan}Behavioral Fingerprint Comparison${C.reset}`);
  lines.push(`${C.dim}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501${C.reset}`);
  lines.push('');

  // Verdict banner
  const verdictColor =
    result.verdict === 'normal' ? C.green :
    result.verdict === 'drift' ? C.yellow :
    C.red;
  const verdictBg =
    result.verdict === 'normal' ? C.bgGreen :
    result.verdict === 'drift' ? C.bgYellow :
    C.bgRed;

  lines.push(`  ${verdictBg}${C.bold}${C.white} ${result.verdict.toUpperCase()} ${C.reset}`);
  lines.push('');

  // Score summary
  lines.push(`${C.bold}Overall Similarity:${C.reset}  ${renderGauge(result.similarity, 'similarity')}`);
  lines.push(`${C.bold}Drift Score:${C.reset}         ${renderGauge(result.driftScore, 'drift')}`);
  lines.push('');

  // Per-dimension scores
  lines.push(`${C.bold}Dimension Scores:${C.reset}`);
  lines.push(`${'  Dimension'.padEnd(28)} ${'Similarity'.padEnd(14)} Status`);
  lines.push(`  ${C.dim}${'\u2500'.repeat(55)}${C.reset}`);

  for (const [, score] of Object.entries(result.dimensionScores)) {
    const simPct = (score.similarity * 100).toFixed(1) + '%';
    const status = score.isAnomaly
      ? `${C.red}\u2717 ANOMALY${C.reset}`
      : `${C.green}\u2713 OK${C.reset}`;
    const color = score.isAnomaly ? C.red : C.green;

    lines.push(`  ${score.name.padEnd(26)} ${color}${simPct.padEnd(14)}${C.reset} ${status}`);
  }
  lines.push('');

  // Key metric comparison
  lines.push(`${C.bold}Key Metrics:${C.reset}`);
  lines.push(`${'  Metric'.padEnd(24)} ${'Baseline'.padEnd(14)} ${'Current'.padEnd(14)} Delta`);
  lines.push(`  ${C.dim}${'\u2500'.repeat(60)}${C.reset}`);

  const metrics: Array<{ name: string; baseline: string; current: string; delta: string; deltaColor: string }> = [
    {
      name: 'Avg Latency',
      baseline: `${baseline.averageLatency.toFixed(1)}ms`,
      current: `${current.averageLatency.toFixed(1)}ms`,
      delta: formatDelta(baseline.averageLatency, current.averageLatency),
      deltaColor: getDeltaColor(baseline.averageLatency, current.averageLatency, 0.5),
    },
    {
      name: 'Error Rate',
      baseline: `${(baseline.errorRate * 100).toFixed(1)}%`,
      current: `${(current.errorRate * 100).toFixed(1)}%`,
      delta: formatDelta(baseline.errorRate, current.errorRate),
      deltaColor: getDeltaColor(baseline.errorRate, current.errorRate, 0.5),
    },
    {
      name: 'Burstiness',
      baseline: baseline.burstiness.toFixed(3),
      current: current.burstiness.toFixed(3),
      delta: formatDelta(baseline.burstiness, current.burstiness),
      deltaColor: getDeltaColor(baseline.burstiness, current.burstiness, 1.0),
    },
    {
      name: 'Total Actions',
      baseline: String(baseline.totalActions),
      current: String(current.totalActions),
      delta: formatDelta(baseline.totalActions, current.totalActions),
      deltaColor: C.dim,
    },
  ];

  for (const m of metrics) {
    lines.push(
      `  ${m.name.padEnd(22)} ${m.baseline.padEnd(14)} ${m.current.padEnd(14)} ${m.deltaColor}${m.delta}${C.reset}`,
    );
  }
  lines.push('');

  // Temporal comparison
  lines.push(`${C.bold}Temporal Pattern Comparison (UTC):${C.reset}`);
  lines.push(renderTemporalOverlay(baseline.temporalPattern, current.temporalPattern));
  lines.push('');

  // Anomalies
  if (result.anomalies.length > 0) {
    lines.push(`${C.bold}${C.yellow}Anomalies (${result.anomalies.length}):${C.reset}`);
    for (let i = 0; i < Math.min(result.anomalies.length, 10); i++) {
      const a = result.anomalies[i];
      const severityColor =
        a.severity === 'critical' ? C.bgRed + C.white :
        a.severity === 'high' ? C.red :
        a.severity === 'medium' ? C.yellow :
        C.dim;

      lines.push(`  ${severityColor}[${a.severity.toUpperCase().padEnd(8)}]${C.reset} ${a.description}`);
    }
    if (result.anomalies.length > 10) {
      lines.push(`  ${C.dim}... and ${result.anomalies.length - 10} more${C.reset}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render a drift score gauge.
 */
function renderGauge(value: number, type: 'similarity' | 'drift'): string {
  const barLen = 20;
  const filled = Math.round(value * barLen);
  const empty = barLen - filled;

  let color: string;
  if (type === 'similarity') {
    color = value > 0.7 ? C.green : value > 0.4 ? C.yellow : C.red;
  } else {
    color = value < 0.3 ? C.green : value < 0.6 ? C.yellow : C.red;
  }

  const bar = `${color}${'|'.repeat(filled)}${C.dim}${'\u00B7'.repeat(empty)}${C.reset}`;
  return `[${bar}] ${color}${(value * 100).toFixed(1)}%${C.reset}`;
}

/**
 * Render a 24-hour temporal chart.
 */
function renderTemporalChart(pattern: number[]): string {
  const height = 6;
  const lines: string[] = [];

  for (let row = height; row >= 1; row--) {
    const threshold = row / height;
    let line = '  ';
    for (let hour = 0; hour < 24; hour++) {
      if (pattern[hour] >= threshold) {
        line += `${C.blue}\u2588${C.reset}`;
      } else if (pattern[hour] >= threshold - 1 / height) {
        line += `${C.blue}\u2584${C.reset}`;
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  lines.push(`  ${C.dim}${'0'.padEnd(6)}${'6'.padEnd(6)}${'12'.padEnd(5)}${'18'.padEnd(5)}23${C.reset}`);

  return lines.join('\n');
}

/**
 * Render an overlay of two temporal patterns.
 */
function renderTemporalOverlay(baseline: number[], current: number[]): string {
  const height = 6;
  const lines: string[] = [];

  for (let row = height; row >= 1; row--) {
    const threshold = row / height;
    let line = '  ';
    for (let hour = 0; hour < 24; hour++) {
      const bActive = baseline[hour] >= threshold;
      const cActive = current[hour] >= threshold;

      if (bActive && cActive) {
        line += `${C.green}\u2588${C.reset}`; // Both active
      } else if (bActive) {
        line += `${C.blue}\u2591${C.reset}`; // Only baseline
      } else if (cActive) {
        line += `${C.red}\u2588${C.reset}`; // Only current (new activity)
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  lines.push(`  ${C.dim}${'0'.padEnd(6)}${'6'.padEnd(6)}${'12'.padEnd(5)}${'18'.padEnd(5)}23${C.reset}`);
  lines.push(`  ${C.green}\u2588${C.reset} Both  ${C.blue}\u2591${C.reset} Baseline only  ${C.red}\u2588${C.reset} Current only`);

  return lines.join('\n');
}

/**
 * Format a delta between two values.
 */
function formatDelta(baseline: number, current: number): string {
  if (baseline === 0 && current === 0) return '0';
  if (baseline === 0) return '+Inf';

  const ratio = ((current - baseline) / baseline) * 100;
  const sign = ratio >= 0 ? '+' : '';
  return `${sign}${ratio.toFixed(1)}%`;
}

/**
 * Get color for a delta value.
 */
function getDeltaColor(baseline: number, current: number, threshold: number): string {
  if (baseline === 0 && current === 0) return C.dim;
  if (baseline === 0) return C.red;

  const ratio = Math.abs((current - baseline) / baseline);
  if (ratio < threshold * 0.5) return C.green;
  if (ratio < threshold) return C.yellow;
  return C.red;
}

/**
 * Render a monitoring status line (for live monitoring mode).
 */
export function renderMonitorStatus(
  driftScore: number,
  verdict: 'normal' | 'drift' | 'compromised',
  observationCount: number,
  anomalyCount: number,
): string {
  const verdictColor =
    verdict === 'normal' ? C.green :
    verdict === 'drift' ? C.yellow :
    C.red;

  const gauge = renderGauge(driftScore, 'drift');

  return (
    `${C.dim}[${new Date().toISOString()}]${C.reset} ` +
    `Actions: ${observationCount}  ` +
    `Drift: ${gauge}  ` +
    `Verdict: ${verdictColor}${C.bold}${verdict.toUpperCase()}${C.reset}  ` +
    `Anomalies: ${anomalyCount > 0 ? C.yellow : C.dim}${anomalyCount}${C.reset}`
  );
}

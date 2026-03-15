/**
 * Comparator -- Compares two behavioral fingerprints and returns a similarity score.
 *
 * Uses cosine similarity across multiple behavioral dimensions.
 * Identifies specific deviations as anomalies.
 */

import {
  BehavioralFingerprint,
  ComparisonResult,
  FingerprintAnomaly,
  DimensionScore,
} from './types.js';

/** Thresholds for anomaly detection. */
interface ComparisonOptions {
  /** Drift score above which we flag "drift" (default: 0.3). */
  driftThreshold?: number;

  /** Drift score above which we flag "compromised" (default: 0.6). */
  compromisedThreshold?: number;

  /** Per-dimension anomaly threshold in standard deviations (default: 2.0). */
  anomalyThresholdSigma?: number;
}

const DEFAULT_OPTIONS: Required<ComparisonOptions> = {
  driftThreshold: 0.3,
  compromisedThreshold: 0.6,
  anomalyThresholdSigma: 2.0,
};

/**
 * Compare two behavioral fingerprints.
 *
 * Returns a similarity score (0-1), drift score, and specific anomalies.
 */
export function compareFingerprints(
  baseline: BehavioralFingerprint,
  current: BehavioralFingerprint,
  options?: ComparisonOptions,
): ComparisonResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const anomalies: FingerprintAnomaly[] = [];
  const dimensionScores: Record<string, DimensionScore> = {};

  // Compare each dimension
  const scores: number[] = [];

  // 1. Action frequency distribution
  const freqScore = compareDistributions(
    baseline.actionFrequency,
    current.actionFrequency,
    'actionFrequency',
    anomalies,
    opts.anomalyThresholdSigma,
  );
  scores.push(freqScore);
  dimensionScores['actionFrequency'] = {
    name: 'Action Frequency',
    similarity: freqScore,
    isAnomaly: freqScore < 1 - opts.driftThreshold,
    detail: `Similarity: ${(freqScore * 100).toFixed(1)}%`,
  };

  // 2. Tool preferences
  const toolScore = compareDistributions(
    baseline.toolPreferences,
    current.toolPreferences,
    'toolPreferences',
    anomalies,
    opts.anomalyThresholdSigma,
  );
  scores.push(toolScore);
  dimensionScores['toolPreferences'] = {
    name: 'Tool Preferences',
    similarity: toolScore,
    isAnomaly: toolScore < 1 - opts.driftThreshold,
    detail: `Similarity: ${(toolScore * 100).toFixed(1)}%`,
  };

  // 3. Temporal pattern
  const temporalScore = cosineSimilarity(
    baseline.temporalPattern,
    current.temporalPattern,
  );
  scores.push(temporalScore);
  dimensionScores['temporalPattern'] = {
    name: 'Temporal Pattern',
    similarity: temporalScore,
    isAnomaly: temporalScore < 1 - opts.driftThreshold,
    detail: `Cosine similarity: ${(temporalScore * 100).toFixed(1)}%`,
  };

  // Check for specific temporal anomalies
  detectTemporalAnomalies(baseline.temporalPattern, current.temporalPattern, anomalies);

  // 4. Decision distribution
  const decisionScore = compareDistributions(
    baseline.decisionDistribution,
    current.decisionDistribution,
    'decisionDistribution',
    anomalies,
    opts.anomalyThresholdSigma,
  );
  scores.push(decisionScore);
  dimensionScores['decisionDistribution'] = {
    name: 'Decision Distribution',
    similarity: decisionScore,
    isAnomaly: decisionScore < 1 - opts.driftThreshold,
    detail: `Similarity: ${(decisionScore * 100).toFixed(1)}%`,
  };

  // 5. Average latency
  const latencyScore = compareScalar(
    baseline.averageLatency,
    current.averageLatency,
    'averageLatency',
    'Average Latency',
    anomalies,
    opts.anomalyThresholdSigma,
  );
  scores.push(latencyScore);
  dimensionScores['averageLatency'] = {
    name: 'Average Latency',
    similarity: latencyScore,
    isAnomaly: latencyScore < 1 - opts.driftThreshold,
    detail: `Baseline: ${baseline.averageLatency.toFixed(1)}ms, Current: ${current.averageLatency.toFixed(1)}ms`,
  };

  // 6. Error rate
  const errorScore = compareScalar(
    baseline.errorRate,
    current.errorRate,
    'errorRate',
    'Error Rate',
    anomalies,
    opts.anomalyThresholdSigma,
  );
  scores.push(errorScore);
  dimensionScores['errorRate'] = {
    name: 'Error Rate',
    similarity: errorScore,
    isAnomaly: errorScore < 1 - opts.driftThreshold,
    detail: `Baseline: ${(baseline.errorRate * 100).toFixed(1)}%, Current: ${(current.errorRate * 100).toFixed(1)}%`,
  };

  // 7. Burstiness
  const burstScore = compareScalar(
    baseline.burstiness,
    current.burstiness,
    'burstiness',
    'Burstiness',
    anomalies,
    opts.anomalyThresholdSigma,
  );
  scores.push(burstScore);
  dimensionScores['burstiness'] = {
    name: 'Burstiness',
    similarity: burstScore,
    isAnomaly: burstScore < 1 - opts.driftThreshold,
    detail: `Baseline: ${baseline.burstiness.toFixed(3)}, Current: ${current.burstiness.toFixed(3)}`,
  };

  // 8. Chain depth distribution
  const chainScore = cosineSimilarity(
    padToSameLength(baseline.chainDepthDistribution, current.chainDepthDistribution)[0],
    padToSameLength(baseline.chainDepthDistribution, current.chainDepthDistribution)[1],
  );
  scores.push(chainScore);
  dimensionScores['chainDepth'] = {
    name: 'Chain Depth',
    similarity: chainScore,
    isAnomaly: chainScore < 1 - opts.driftThreshold,
    detail: `Cosine similarity: ${(chainScore * 100).toFixed(1)}%`,
  };

  // 9. New resources (resources in current not in baseline)
  const baselineResources = new Set(baseline.resourceAccessPattern);
  const newResources = current.resourceAccessPattern.filter((r) => !baselineResources.has(r));
  if (newResources.length > 0) {
    const newResourceRatio = newResources.length / Math.max(current.resourceAccessPattern.length, 1);
    if (newResourceRatio > 0.3) {
      anomalies.push({
        dimension: 'resourceAccessPattern',
        description: `${newResources.length} new resources accessed that were not in baseline: ${newResources.slice(0, 5).join(', ')}${newResources.length > 5 ? '...' : ''}`,
        severity: newResourceRatio > 0.5 ? 'high' : 'medium',
        baselineValue: baseline.resourceAccessPattern.length,
        currentValue: current.resourceAccessPattern.length,
        deviation: newResourceRatio * 5,
      });
    }
  }

  // Calculate overall similarity (weighted average)
  const weights = [1.5, 1.2, 1.0, 1.5, 0.8, 1.3, 0.7, 0.8]; // Higher weight for action frequency, decision distribution
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const similarity = scores.reduce((sum, score, i) => sum + score * weights[i], 0) / totalWeight;

  const driftScore = 1 - similarity;

  // Determine verdict
  let verdict: 'normal' | 'drift' | 'compromised';
  if (driftScore >= opts.compromisedThreshold) {
    verdict = 'compromised';
  } else if (driftScore >= opts.driftThreshold) {
    verdict = 'drift';
  } else {
    verdict = 'normal';
  }

  // Sort anomalies by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    similarity: Math.round(similarity * 1000) / 1000,
    driftScore: Math.round(driftScore * 1000) / 1000,
    anomalies,
    verdict,
    dimensionScores,
  };
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 1;
  if (a.length !== b.length) {
    const maxLen = Math.max(a.length, b.length);
    a = [...a, ...new Array(maxLen - a.length).fill(0)];
    b = [...b, ...new Array(maxLen - b.length).fill(0)];
  }

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return magA === 0 && magB === 0 ? 1 : 0;

  return Math.round((dotProduct / (magA * magB)) * 1000) / 1000;
}

/**
 * Compare two record-based distributions using cosine similarity.
 */
function compareDistributions(
  baseline: Record<string, number>,
  current: Record<string, number>,
  dimension: string,
  anomalies: FingerprintAnomaly[],
  thresholdSigma: number,
): number {
  const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  if (allKeys.size === 0) return 1;

  const keysArray = [...allKeys];
  const baselineVec = keysArray.map((k) => baseline[k] ?? 0);
  const currentVec = keysArray.map((k) => current[k] ?? 0);

  // Check for specific deviations
  for (const key of keysArray) {
    const bVal = baseline[key] ?? 0;
    const cVal = current[key] ?? 0;

    if (bVal === 0 && cVal > 0) {
      // New activity
      anomalies.push({
        dimension,
        description: `New ${dimension} key '${key}' appeared (value: ${cVal.toFixed(3)}) with no baseline.`,
        severity: cVal > 1 ? 'medium' : 'low',
        baselineValue: 0,
        currentValue: cVal,
        deviation: Infinity,
      });
    } else if (bVal > 0) {
      const ratio = cVal / bVal;
      if (ratio > 1 + thresholdSigma || ratio < 1 / (1 + thresholdSigma)) {
        anomalies.push({
          dimension,
          description: `${dimension} '${key}' changed significantly: ${bVal.toFixed(3)} -> ${cVal.toFixed(3)} (${ratio.toFixed(1)}x).`,
          severity: ratio > 5 || ratio < 0.2 ? 'high' : 'medium',
          baselineValue: bVal,
          currentValue: cVal,
          deviation: Math.abs(ratio - 1),
        });
      }
    }
  }

  return cosineSimilarity(baselineVec, currentVec);
}

/**
 * Compare two scalar values.
 */
function compareScalar(
  baseline: number,
  current: number,
  dimension: string,
  label: string,
  anomalies: FingerprintAnomaly[],
  thresholdSigma: number,
): number {
  if (baseline === 0 && current === 0) return 1;
  if (baseline === 0) {
    anomalies.push({
      dimension,
      description: `${label} was 0 in baseline but is now ${current.toFixed(3)}.`,
      severity: 'medium',
      baselineValue: 0,
      currentValue: current,
      deviation: Infinity,
    });
    return 0;
  }

  const ratio = current / baseline;
  const deviation = Math.abs(ratio - 1);

  if (deviation > thresholdSigma) {
    anomalies.push({
      dimension,
      description: `${label} changed: ${baseline.toFixed(3)} -> ${current.toFixed(3)} (${ratio.toFixed(1)}x baseline).`,
      severity: deviation > 3 ? 'high' : 'medium',
      baselineValue: baseline,
      currentValue: current,
      deviation,
    });
  }

  // Similarity: 1 when identical, approaches 0 as ratio diverges
  return Math.round((1 / (1 + deviation)) * 1000) / 1000;
}

/**
 * Detect specific temporal pattern anomalies.
 */
function detectTemporalAnomalies(
  baseline: number[],
  current: number[],
  anomalies: FingerprintAnomaly[],
): void {
  // Check for activity in hours that had zero baseline activity
  for (let hour = 0; hour < 24; hour++) {
    if (baseline[hour] === 0 && current[hour] > 0.3) {
      anomalies.push({
        dimension: 'temporalPattern',
        description: `Agent active at hour ${hour}:00 UTC (${(current[hour] * 100).toFixed(0)}% activity) with no baseline activity at that hour.`,
        severity: current[hour] > 0.5 ? 'high' : 'medium',
        baselineValue: 0,
        currentValue: current[hour],
        deviation: current[hour] * 10,
      });
    }
  }
}

/**
 * Pad two arrays to the same length with zeros.
 */
function padToSameLength(a: number[], b: number[]): [number[], number[]] {
  const maxLen = Math.max(a.length, b.length);
  const paddedA = [...a, ...new Array(maxLen - a.length).fill(0)];
  const paddedB = [...b, ...new Array(maxLen - b.length).fill(0)];
  return [paddedA, paddedB];
}

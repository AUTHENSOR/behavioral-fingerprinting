/**
 * Detector — Real-time behavioral drift detection.
 *
 * Uses EWMA for spike detection and CUSUM for gradual drift detection.
 * Compares incoming actions against a baseline fingerprint in real time.
 */

import { EWMA } from './ewma.js';
import { CUSUM } from './cusum.js';
import {
  AgentAction,
  BehavioralFingerprint,
  DetectionResult,
  FingerprintAnomaly,
} from './types.js';
import { updateFingerprint } from './fingerprint.js';
import { compareFingerprints } from './comparator.js';

/** Metrics tracked by the detector. */
type MetricKey =
  | 'action_rate'
  | 'error_rate'
  | 'latency'
  | 'burstiness'
  | 'new_resource_rate';

/**
 * Real-time behavioral drift detector.
 *
 * Maintains a rolling fingerprint and compares it against a baseline
 * using both instantaneous checks (EWMA) and drift detection (CUSUM).
 */
export class BehavioralDetector {
  private baseline: BehavioralFingerprint;
  private current: BehavioralFingerprint;
  private sensitivity: number;

  // EWMA trackers for each metric
  private ewma: Map<MetricKey, EWMA> = new Map();

  // CUSUM trackers for each metric
  private cusum: Map<MetricKey, CUSUM> = new Map();

  // Action counting
  private observationCount: number = 0;
  private windowActions: Array<{ timestamp: number; outcome: string }> = [];
  private windowMs: number = 5 * 60 * 1000; // 5 minute window

  // Last action timestamp for inter-action time tracking
  private lastActionTimestamp: number | null = null;
  private interActionTimes: number[] = [];

  // Known resources from baseline
  private baselineResources: Set<string>;
  private newResourceCount: number = 0;

  constructor(baseline: BehavioralFingerprint, sensitivity: number = 1.0) {
    this.baseline = structuredClone(baseline);
    this.current = structuredClone(baseline);
    this.sensitivity = Math.max(0.1, Math.min(3.0, sensitivity));

    // Initialize resource set
    this.baselineResources = new Set(baseline.resourceAccessPattern);

    // Initialize EWMA/CUSUM trackers
    const metrics: MetricKey[] = [
      'action_rate',
      'error_rate',
      'latency',
      'burstiness',
      'new_resource_rate',
    ];

    const alpha = 0.2 + 0.1 * sensitivity; // Higher sensitivity = more responsive
    const cusumSlack = 0.5 / sensitivity;
    const cusumThreshold = 5 / sensitivity;

    for (const metric of metrics) {
      this.ewma.set(metric, new EWMA(alpha));
      this.cusum.set(metric, new CUSUM({ slack: cusumSlack, threshold: cusumThreshold }));
    }

    // Seed EWMA/CUSUM with baseline values
    this.seedFromBaseline();
  }

  /**
   * Observe a new agent action and check for behavioral drift.
   */
  observe(action: AgentAction): DetectionResult {
    this.observationCount++;
    const anomalies: FingerprintAnomaly[] = [];
    const now = new Date(action.timestamp).getTime();

    // Update rolling window
    this.windowActions.push({ timestamp: now, outcome: action.outcome });
    this.pruneWindow(now);

    // Track inter-action time
    if (this.lastActionTimestamp !== null) {
      const interActionTime = now - this.lastActionTimestamp;
      this.interActionTimes.push(interActionTime);
      if (this.interActionTimes.length > 100) {
        this.interActionTimes = this.interActionTimes.slice(-50);
      }
    }
    this.lastActionTimestamp = now;

    // Update current fingerprint incrementally
    this.current = updateFingerprint(this.current, action);

    // --- Check individual metrics ---

    // 1. Latency check
    const latencyEwma = this.ewma.get('latency')!;
    const latencyCusum = this.cusum.get('latency')!;
    const latencyAnomaly = latencyEwma.isAnomaly(action.evaluation_time_ms, 3 / this.sensitivity);

    if (latencyAnomaly.isAnomaly) {
      anomalies.push({
        dimension: 'latency',
        description: `Evaluation time ${action.evaluation_time_ms}ms is ${latencyAnomaly.deviation.toFixed(1)} sigma from mean (${latencyEwma.getMean().toFixed(1)}ms).`,
        severity: latencyAnomaly.deviation > 5 ? 'high' : 'medium',
        baselineValue: this.baseline.averageLatency,
        currentValue: action.evaluation_time_ms,
        deviation: latencyAnomaly.deviation,
      });
    }
    latencyEwma.update(action.evaluation_time_ms);
    latencyCusum.update(action.evaluation_time_ms);

    const latencyCusumResult = latencyCusum.isAnomaly();
    if (latencyCusumResult.isAnomaly) {
      anomalies.push({
        dimension: 'latency',
        description: `Latency drift detected (CUSUM ${latencyCusumResult.direction}): sustained change from baseline.`,
        severity: 'medium',
        baselineValue: this.baseline.averageLatency,
        currentValue: latencyEwma.getMean(),
        deviation: Math.max(latencyCusumResult.sHigh, latencyCusumResult.sLow),
      });
    }

    // 2. Error rate check
    const windowErrors = this.windowActions.filter(
      (a) => a.outcome === 'deny' || a.outcome === 'rate_limited',
    ).length;
    const windowErrorRate = this.windowActions.length > 0 ? windowErrors / this.windowActions.length : 0;

    const errorEwma = this.ewma.get('error_rate')!;
    const errorCusum = this.cusum.get('error_rate')!;
    const errorAnomaly = errorEwma.isAnomaly(windowErrorRate, 3 / this.sensitivity);

    if (errorAnomaly.isAnomaly) {
      anomalies.push({
        dimension: 'errorRate',
        description: `Error rate ${(windowErrorRate * 100).toFixed(1)}% is ${errorAnomaly.deviation.toFixed(1)} sigma from mean (baseline: ${(this.baseline.errorRate * 100).toFixed(1)}%).`,
        severity: windowErrorRate > 0.5 ? 'critical' : 'high',
        baselineValue: this.baseline.errorRate,
        currentValue: windowErrorRate,
        deviation: errorAnomaly.deviation,
      });
    }
    errorEwma.update(windowErrorRate);
    errorCusum.update(windowErrorRate);

    // 3. New resource detection
    if (!this.baselineResources.has(action.resource)) {
      this.newResourceCount++;
      const newResourceRate = this.newResourceCount / this.observationCount;

      if (newResourceRate > 0.3 / this.sensitivity) {
        anomalies.push({
          dimension: 'resourceAccessPattern',
          description: `New resource '${action.resource}' not in baseline. ${this.newResourceCount} new resources out of ${this.observationCount} actions.`,
          severity: newResourceRate > 0.5 ? 'high' : 'medium',
          baselineValue: 0,
          currentValue: this.newResourceCount,
          deviation: newResourceRate * 10,
        });
      }
    }

    // 4. Action type check
    const baselineFreq = this.baseline.actionFrequency[action.action_type];
    if (baselineFreq === undefined) {
      anomalies.push({
        dimension: 'actionFrequency',
        description: `Action type '${action.action_type}' not seen in baseline fingerprint.`,
        severity: 'medium',
        baselineValue: 0,
        currentValue: 1,
        deviation: Infinity,
      });
    }

    // 5. Burstiness check (if we have enough data)
    if (this.interActionTimes.length >= 10) {
      const mean = this.interActionTimes.reduce((a, b) => a + b, 0) / this.interActionTimes.length;
      if (mean > 0) {
        const variance = this.interActionTimes.reduce((a, b) => a + (b - mean) ** 2, 0) / this.interActionTimes.length;
        const cv = Math.sqrt(variance) / mean;

        const burstEwma = this.ewma.get('burstiness')!;
        const burstAnomaly = burstEwma.isAnomaly(cv, 3 / this.sensitivity);
        if (burstAnomaly.isAnomaly) {
          anomalies.push({
            dimension: 'burstiness',
            description: `Burstiness coefficient ${cv.toFixed(3)} is ${burstAnomaly.deviation.toFixed(1)} sigma from mean (baseline: ${this.baseline.burstiness.toFixed(3)}).`,
            severity: 'medium',
            baselineValue: this.baseline.burstiness,
            currentValue: cv,
            deviation: burstAnomaly.deviation,
          });
        }
        burstEwma.update(cv);
      }
    }

    // Calculate overall drift score
    const driftScore = this.getDriftScore();

    // Determine verdict
    const driftThreshold = 0.3 / this.sensitivity;
    const compromisedThreshold = 0.6 / this.sensitivity;

    let verdict: 'normal' | 'drift' | 'compromised';
    if (driftScore >= compromisedThreshold || anomalies.some((a) => a.severity === 'critical')) {
      verdict = 'compromised';
    } else if (driftScore >= driftThreshold || anomalies.some((a) => a.severity === 'high')) {
      verdict = 'drift';
    } else {
      verdict = 'normal';
    }

    // Sort anomalies by severity
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      isAnomaly: anomalies.length > 0,
      driftScore: Math.round(driftScore * 1000) / 1000,
      anomalies,
      verdict,
      observationCount: this.observationCount,
    };
  }

  /**
   * Get the current behavioral fingerprint.
   */
  getFingerprint(): BehavioralFingerprint {
    return structuredClone(this.current);
  }

  /**
   * Get the current drift score relative to baseline.
   */
  getDriftScore(): number {
    if (this.observationCount < 5) return 0;

    const comparison = compareFingerprints(this.baseline, this.current);
    return comparison.driftScore;
  }

  /**
   * Get the baseline fingerprint.
   */
  getBaseline(): BehavioralFingerprint {
    return structuredClone(this.baseline);
  }

  /**
   * Get the observation count.
   */
  getObservationCount(): number {
    return this.observationCount;
  }

  /**
   * Seed EWMA/CUSUM trackers with baseline values so they have
   * a reasonable starting point for anomaly detection.
   */
  private seedFromBaseline(): void {
    // Seed latency
    const latencyEwma = this.ewma.get('latency')!;
    const latencyCusum = this.cusum.get('latency')!;
    for (let i = 0; i < 15; i++) {
      const jitter = this.baseline.averageLatency * (0.9 + Math.random() * 0.2);
      latencyEwma.update(jitter);
      latencyCusum.update(jitter);
    }

    // Seed error rate
    const errorEwma = this.ewma.get('error_rate')!;
    const errorCusum = this.cusum.get('error_rate')!;
    for (let i = 0; i < 15; i++) {
      const jitter = this.baseline.errorRate * (0.9 + Math.random() * 0.2);
      errorEwma.update(jitter);
      errorCusum.update(jitter);
    }

    // Seed burstiness
    const burstEwma = this.ewma.get('burstiness')!;
    const burstCusum = this.cusum.get('burstiness')!;
    for (let i = 0; i < 15; i++) {
      const jitter = this.baseline.burstiness * (0.9 + Math.random() * 0.2);
      burstEwma.update(jitter);
      burstCusum.update(jitter);
    }
  }

  /**
   * Remove actions outside the rolling window.
   */
  private pruneWindow(now: number): void {
    const cutoff = now - this.windowMs;
    if (this.windowActions.length > 500) {
      this.windowActions = this.windowActions.filter((a) => a.timestamp > cutoff);
    }
  }
}

/**
 * Behavioral Fingerprinting -- Type definitions
 */

/** An observed agent action (compatible with Authensor receipt format). */
export interface AgentAction {
  id: string;
  timestamp: string;
  agent_id: string;
  action_type: string;
  resource: string;
  operation: string;
  outcome: 'allow' | 'deny' | 'require_approval' | 'rate_limited';
  evaluation_time_ms: number;
  parent_action_id?: string;
  parameters?: Record<string, unknown>;
}

/** A behavioral fingerprint built from a stream of agent actions. */
export interface BehavioralFingerprint {
  /** Identifier of the agent this fingerprint describes. */
  agentId: string;

  /** Time window over which the fingerprint was observed. */
  observationWindow: { start: string; end: string };

  /** Action type frequency: action type -> count per hour. */
  actionFrequency: Record<string, number>;

  /** Tool/resource usage preferences: resource -> usage percentage (0-1). */
  toolPreferences: Record<string, number>;

  /** 24-hour activity histogram (24 buckets, one per hour, normalized 0-1). */
  temporalPattern: number[];

  /** Most accessed resources, ordered by frequency. */
  resourceAccessPattern: string[];

  /** Decision outcome distribution: outcome -> ratio (0-1). */
  decisionDistribution: Record<string, number>;

  /** Mean evaluation time in milliseconds. */
  averageLatency: number;

  /** Chain depth distribution histogram (index = depth, value = count). */
  chainDepthDistribution: number[];

  /** Error rate: (deny + rate_limited) / total. */
  errorRate: number;

  /** Burstiness: coefficient of variation of inter-action times. */
  burstiness: number;

  /** Total number of actions observed. */
  totalActions: number;
}

/** Result of comparing two fingerprints. */
export interface ComparisonResult {
  /** Cosine similarity between fingerprints (0-1, higher = more similar). */
  similarity: number;

  /** Drift score (0-1, higher = more drift from baseline). */
  driftScore: number;

  /** Specific anomalous deviations detected. */
  anomalies: FingerprintAnomaly[];

  /** Overall verdict. */
  verdict: 'normal' | 'drift' | 'compromised';

  /** Per-dimension breakdown. */
  dimensionScores: Record<string, DimensionScore>;
}

/** A specific anomaly detected in a fingerprint comparison. */
export interface FingerprintAnomaly {
  /** Which dimension changed. */
  dimension: string;

  /** Human-readable description. */
  description: string;

  /** Severity level. */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Baseline value. */
  baselineValue: number;

  /** Current value. */
  currentValue: number;

  /** How many standard deviations from baseline. */
  deviation: number;
}

/** Score for a single comparison dimension. */
export interface DimensionScore {
  /** Dimension name. */
  name: string;

  /** Similarity for this dimension (0-1). */
  similarity: number;

  /** Whether this dimension is anomalous. */
  isAnomaly: boolean;

  /** Details about the deviation. */
  detail: string;
}

/** Result from the real-time behavioral detector. */
export interface DetectionResult {
  /** Whether this action is anomalous relative to baseline. */
  isAnomaly: boolean;

  /** Current drift score (0-1). */
  driftScore: number;

  /** Specific anomalies triggered by this action. */
  anomalies: FingerprintAnomaly[];

  /** Current verdict. */
  verdict: 'normal' | 'drift' | 'compromised';

  /** Number of actions observed since detector creation. */
  observationCount: number;
}

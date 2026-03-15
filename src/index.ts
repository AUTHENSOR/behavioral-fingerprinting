/**
 * Behavioral Fingerprinting
 *
 * Every agent has a behavioral signature. Detect when it changes.
 *
 * @packageDocumentation
 */

export type {
  AgentAction,
  BehavioralFingerprint,
  ComparisonResult,
  FingerprintAnomaly,
  DimensionScore,
  DetectionResult,
} from './types.js';

export {
  buildFingerprint,
  updateFingerprint,
} from './fingerprint.js';

export {
  compareFingerprints,
  cosineSimilarity,
} from './comparator.js';

export { BehavioralDetector } from './detector.js';

export {
  renderFingerprint,
  renderComparison,
  renderMonitorStatus,
} from './visualizer.js';

export { EWMA } from './ewma.js';
export { CUSUM } from './cusum.js';

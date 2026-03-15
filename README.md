# Behavioral Fingerprinting

**Every agent has a behavioral signature. Detect when it changes.**

From [15 Research Lab](https://github.com/AUTHENSOR)

---

Behavioral Fingerprinting builds statistical profiles of AI agent behavior and detects when an agent's behavior drifts from its baseline. Uses EWMA (spike detection) and CUSUM (gradual drift detection) — the same statistical methods used in [Authensor Sentinel](https://github.com/AUTHENSOR/authensor), extracted into a standalone research library.

## Install

```bash
npm install behavioral-fingerprinting
```

Or run directly:

```bash
npx behavioral-fingerprint build --receipts ./receipts.json --agent agent-001
```

## Usage

### CLI

```bash
# Build a fingerprint from receipts
npx behavioral-fingerprint build --receipts ./receipts.json --agent agent-001

# Compare two fingerprints
npx behavioral-fingerprint compare --baseline ./baseline.json --current ./current.json

# Monitor live actions against a baseline
npx behavioral-fingerprint monitor --baseline ./baseline.json --input ./live-actions.jsonl
```

### Library

```typescript
import {
  buildFingerprint,
  compareFingerprints,
  BehavioralDetector,
  renderFingerprint,
  renderComparison,
} from 'behavioral-fingerprinting';

// Build a fingerprint from agent actions
const fingerprint = buildFingerprint(actions, 'agent-001');
console.log(renderFingerprint(fingerprint));

// Compare two fingerprints
const result = compareFingerprints(baseline, current);
console.log(renderComparison(baseline, current, result));
// result.similarity  → 0-1 (cosine similarity)
// result.driftScore  → 0-1 (higher = more drift)
// result.verdict     → 'normal' | 'drift' | 'compromised'
// result.anomalies   → specific deviations

// Real-time monitoring
const detector = new BehavioralDetector(baseline, 1.0);

for (const action of liveActions) {
  const result = detector.observe(action);
  if (result.verdict !== 'normal') {
    console.warn(`Drift detected: ${result.driftScore}`);
    for (const anomaly of result.anomalies) {
      console.warn(`  [${anomaly.severity}] ${anomaly.description}`);
    }
  }
}
```

## What's in a Fingerprint?

A behavioral fingerprint captures the statistical signature of how an agent behaves:

```typescript
interface BehavioralFingerprint {
  agentId: string;
  observationWindow: { start: string; end: string };
  actionFrequency: Record<string, number>;        // action type → count per hour
  toolPreferences: Record<string, number>;         // resource → usage percentage
  temporalPattern: number[];                       // 24-hour activity histogram
  resourceAccessPattern: string[];                 // most accessed resources
  decisionDistribution: Record<string, number>;    // allow/deny/review ratios
  averageLatency: number;                          // mean evaluation time
  chainDepthDistribution: number[];                // delegation depth histogram
  errorRate: number;                               // deny + rate_limited / total
  burstiness: number;                              // coefficient of variation
  totalActions: number;
}
```

## Comparison Dimensions

When comparing two fingerprints, the library evaluates these dimensions:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Action Frequency | 1.5x | Distribution of action types over time |
| Decision Distribution | 1.5x | Ratio of allow/deny/review outcomes |
| Error Rate | 1.3x | Proportion of denied or rate-limited actions |
| Tool Preferences | 1.2x | Which resources the agent uses most |
| Temporal Pattern | 1.0x | 24-hour activity histogram |
| Average Latency | 0.8x | Mean evaluation time |
| Chain Depth | 0.8x | Depth of delegation chains |
| Burstiness | 0.7x | Regularity of action timing |

## Detection Methods

### EWMA (Exponentially Weighted Moving Average)
Detects sudden spikes. Good for catching the moment behavior changes.

### CUSUM (Cumulative Sum)
Detects gradual drift that EWMA adapts to and misses. Good for catching slow behavioral shifts over time.

Both methods are O(1) per update and store minimal state.

## Verdicts

| Verdict | Drift Score | Meaning |
|---------|------------|---------|
| `normal` | < 0.3 | Agent behaving within baseline |
| `drift` | 0.3 - 0.6 | Statistically significant behavioral change |
| `compromised` | > 0.6 | Major behavioral deviation, possible compromise |

## Part of the Authensor Ecosystem

This project is part of the [Authensor](https://github.com/AUTHENSOR/AUTHENSOR) open-source AI safety ecosystem, built by [15 Research Lab](https://github.com/AUTHENSOR).

| Project | Description |
|---------|-------------|
| [Authensor](https://github.com/AUTHENSOR/AUTHENSOR) | The open-source safety stack for AI agents |
| [Prompt Injection Benchmark](https://github.com/AUTHENSOR/prompt-injection-benchmark) | Standardized benchmark for safety scanners |
| [AI SecLists](https://github.com/AUTHENSOR/ai-seclists) | Security wordlists and payloads for AI/LLM testing |
| [ATT&CK ↔ Alignment Rosetta](https://github.com/AUTHENSOR/attack-alignment-rosetta) | Maps MITRE ATT&CK to AI alignment concepts |
| [Agent Forensics](https://github.com/AUTHENSOR/agent-forensics) | Post-incident analysis for receipt chains |

## Design

- **Zero runtime dependencies** — only Node.js built-ins
- **TypeScript, ESM, strict mode**
- **O(1) per observation** — EWMA and CUSUM are constant-time
- **Composable** — use fingerprint building, comparison, and detection independently
- **Compatible with Authensor** — reads receipt format directly

## License

MIT

#!/usr/bin/env node

/**
 * Behavioral Fingerprinting CLI
 *
 * Usage:
 *   behavioral-fingerprint build    --receipts <file> --agent <id>
 *   behavioral-fingerprint compare  --baseline <file> --current <file>
 *   behavioral-fingerprint monitor  --baseline <file> --input <file>
 */

import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { AgentAction, BehavioralFingerprint } from './types.js';
import { buildFingerprint } from './fingerprint.js';
import { compareFingerprints } from './comparator.js';
import { BehavioralDetector } from './detector.js';
import { renderFingerprint, renderComparison, renderMonitorStatus } from './visualizer.js';

const VERSION = '0.1.0';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function printUsage(): void {
  console.log(`
${C.bold}${C.cyan}Behavioral Fingerprinting${C.reset} v${VERSION}
${C.dim}Every agent has a behavioral signature. Detect when it changes.${C.reset}

${C.bold}USAGE:${C.reset}
  behavioral-fingerprint <command> [options]

${C.bold}COMMANDS:${C.reset}
  build       Build a fingerprint from receipts/actions
  compare     Compare two fingerprints
  monitor     Monitor live actions against a baseline

${C.bold}OPTIONS:${C.reset}
  --receipts <file>   Path to receipts/actions JSON file
  --agent <id>        Agent ID to filter by
  --baseline <file>   Path to baseline fingerprint JSON
  --current <file>    Path to current fingerprint JSON
  --input <file>      Path to live actions JSONL file (or - for stdin)
  --sensitivity <n>   Detection sensitivity 0.1-3.0 (default: 1.0)
  --output <file>     Write fingerprint JSON to file
  --version           Show version
  --help              Show this help message

${C.bold}EXAMPLES:${C.reset}
  ${C.dim}# Build a fingerprint from receipts${C.reset}
  npx behavioral-fingerprint build --receipts ./receipts.json --agent agent-001

  ${C.dim}# Compare two fingerprints${C.reset}
  npx behavioral-fingerprint compare --baseline ./baseline.json --current ./current.json

  ${C.dim}# Monitor live actions${C.reset}
  npx behavioral-fingerprint monitor --baseline ./baseline.json --input ./live.jsonl
`);
}

interface ParsedArgs {
  command?: string;
  receiptsPath?: string;
  agentId?: string;
  baselinePath?: string;
  currentPath?: string;
  inputPath?: string;
  sensitivity?: number;
  outputPath?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, version: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help': case '-h':
        result.help = true;
        break;
      case '--version': case '-v':
        result.version = true;
        break;
      case '--receipts': case '-r':
        result.receiptsPath = args[++i];
        break;
      case '--agent': case '-a':
        result.agentId = args[++i];
        break;
      case '--baseline': case '-b':
        result.baselinePath = args[++i];
        break;
      case '--current': case '-c':
        result.currentPath = args[++i];
        break;
      case '--input': case '-i':
        result.inputPath = args[++i];
        break;
      case '--sensitivity': case '-s':
        result.sensitivity = parseFloat(args[++i]);
        break;
      case '--output': case '-o':
        result.outputPath = args[++i];
        break;
      default:
        if (!arg.startsWith('-')) {
          result.command = arg;
        }
    }
  }

  return result;
}

function loadJson<T>(path: string): T {
  try {
    const absPath = resolve(path);
    const content = readFileSync(absPath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${C.red}Error reading file: ${message}${C.reset}`);
    process.exit(1);
  }
}

/**
 * Convert Authensor receipt format to AgentAction format.
 */
function receiptToAction(receipt: Record<string, unknown>): AgentAction {
  const action = receipt.action as Record<string, unknown> | undefined;
  const principal = receipt.principal as Record<string, unknown> | undefined;
  const decision = receipt.decision as Record<string, unknown> | undefined;

  return {
    id: receipt.id as string,
    timestamp: receipt.timestamp as string,
    agent_id: (principal?.id as string) ?? 'unknown',
    action_type: (action?.type as string) ?? 'unknown',
    resource: (action?.resource as string) ?? 'unknown',
    operation: (action?.operation as string) ?? 'unknown',
    outcome: (decision?.outcome as AgentAction['outcome']) ?? 'allow',
    evaluation_time_ms: (receipt.evaluation_time_ms as number) ?? 0,
    parent_action_id: receipt.parent_receipt_id as string | undefined,
    parameters: action?.parameters as Record<string, unknown> | undefined,
  };
}

// ─── Commands ───────────────────────────────────────────────────────────────────

function cmdBuild(receiptsPath: string, agentId?: string, outputPath?: string): void {
  const data = loadJson<unknown[]>(receiptsPath);

  // Auto-detect format: if it has 'action' and 'principal' fields, it's Authensor receipt format
  let actions: AgentAction[];
  if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const sample = data[0] as Record<string, unknown>;
    if ('action' in sample && 'principal' in sample && 'decision' in sample) {
      // Authensor receipt format
      actions = data.map((r) => receiptToAction(r as Record<string, unknown>));
    } else {
      actions = data as AgentAction[];
    }
  } else {
    actions = data as AgentAction[];
  }

  const fingerprint = buildFingerprint(actions, agentId);

  // Display
  console.log(renderFingerprint(fingerprint));

  // Optionally write to file
  if (outputPath) {
    writeFileSync(resolve(outputPath), JSON.stringify(fingerprint, null, 2));
    console.log(`${C.green}Fingerprint written to ${outputPath}${C.reset}`);
  } else {
    // Output JSON to stdout as well for piping
    console.log(`${C.dim}--- JSON ---${C.reset}`);
    console.log(JSON.stringify(fingerprint, null, 2));
  }
}

function cmdCompare(baselinePath: string, currentPath: string): void {
  const baseline = loadJson<BehavioralFingerprint>(baselinePath);
  const current = loadJson<BehavioralFingerprint>(currentPath);

  const result = compareFingerprints(baseline, current);
  console.log(renderComparison(baseline, current, result));

  // Also output JSON
  console.log(`${C.dim}--- JSON ---${C.reset}`);
  console.log(JSON.stringify(result, null, 2));

  // Exit with non-zero if drift or compromised
  if (result.verdict !== 'normal') {
    process.exit(1);
  }
}

async function cmdMonitor(
  baselinePath: string,
  inputPath: string,
  sensitivity: number,
): Promise<void> {
  const baseline = loadJson<BehavioralFingerprint>(baselinePath);
  const detector = new BehavioralDetector(baseline, sensitivity);

  console.log('');
  console.log(`${C.bold}${C.cyan}Behavioral Fingerprint Monitor${C.reset}`);
  console.log(`${C.dim}\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501${C.reset}`);
  console.log(`${C.bold}Baseline:${C.reset}    ${baseline.agentId} (${baseline.totalActions} actions)`);
  console.log(`${C.bold}Sensitivity:${C.reset} ${sensitivity}`);
  console.log(`${C.bold}Input:${C.reset}       ${inputPath}`);
  console.log('');

  const stream = inputPath === '-'
    ? process.stdin
    : createReadStream(resolve(inputPath), 'utf-8');

  const rl = createInterface({ input: stream });
  let totalAnomalies = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;

      // Auto-detect format
      let action: AgentAction;
      if ('action' in raw && 'principal' in raw) {
        action = receiptToAction(raw);
      } else {
        action = raw as unknown as AgentAction;
      }

      const result = detector.observe(action);
      totalAnomalies += result.anomalies.length;

      // Print status line
      console.log(renderMonitorStatus(result.driftScore, result.verdict, result.observationCount, totalAnomalies));

      // Print anomalies inline
      for (const anomaly of result.anomalies) {
        const severityColor =
          anomaly.severity === 'critical' ? C.red :
          anomaly.severity === 'high' ? C.red :
          anomaly.severity === 'medium' ? C.yellow :
          C.dim;
        console.log(`  ${severityColor}[${anomaly.severity.toUpperCase()}] ${anomaly.description}${C.reset}`);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Final summary
  console.log('');
  const finalDrift = detector.getDriftScore();
  const finalFp = detector.getFingerprint();

  console.log(`${C.bold}Final Summary:${C.reset}`);
  console.log(`  Actions observed: ${detector.getObservationCount()}`);
  console.log(`  Final drift score: ${(finalDrift * 100).toFixed(1)}%`);
  console.log(`  Total anomalies: ${totalAnomalies}`);

  if (totalAnomalies > 0) {
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(`behavioral-fingerprint v${VERSION}`);
    return;
  }

  if (args.help || !args.command) {
    printUsage();
    return;
  }

  switch (args.command) {
    case 'build':
      if (!args.receiptsPath) {
        console.error(`${C.red}Error: --receipts <file> is required${C.reset}`);
        process.exit(1);
      }
      cmdBuild(args.receiptsPath, args.agentId, args.outputPath);
      break;

    case 'compare':
      if (!args.baselinePath || !args.currentPath) {
        console.error(`${C.red}Error: --baseline and --current are required${C.reset}`);
        process.exit(1);
      }
      cmdCompare(args.baselinePath, args.currentPath);
      break;

    case 'monitor':
      if (!args.baselinePath) {
        console.error(`${C.red}Error: --baseline <file> is required${C.reset}`);
        process.exit(1);
      }
      if (!args.inputPath) {
        console.error(`${C.red}Error: --input <file> is required${C.reset}`);
        process.exit(1);
      }
      await cmdMonitor(args.baselinePath, args.inputPath, args.sensitivity ?? 1.0);
      break;

    default:
      console.error(`${C.red}Unknown command: ${args.command}${C.reset}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${C.red}Fatal error: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
  process.exit(1);
});

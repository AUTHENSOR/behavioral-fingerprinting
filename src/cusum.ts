/**
 * CUSUM -- Cumulative Sum control chart
 *
 * Standalone implementation for behavioral fingerprinting.
 * Detects gradual drift that EWMA adapts to and misses.
 * Tracks both upward and downward cumulative sums.
 * O(1) per update.
 *
 * Inspired by Authensor Sentinel's CUSUM implementation.
 */
export class CUSUM {
  private target: number = 0;
  private sHigh: number = 0;
  private sLow: number = 0;
  private count: number = 0;
  private slack: number;
  private threshold: number;
  private targetSet: boolean;

  constructor(options?: { slack?: number; threshold?: number; target?: number }) {
    this.slack = options?.slack ?? 0.5;
    this.threshold = options?.threshold ?? 5;
    this.targetSet = options?.target !== undefined;
    if (this.targetSet) this.target = options!.target!;
  }

  update(value: number): void {
    this.count++;
    if (this.count === 1 && !this.targetSet) {
      this.target = value;
      this.targetSet = true;
      return;
    }

    this.sHigh = Math.max(0, this.sHigh + (value - this.target) - this.slack);
    this.sLow = Math.max(0, this.sLow - (value - this.target) - this.slack);
  }

  isAnomaly(): { isAnomaly: boolean; direction: 'up' | 'down' | 'none'; sHigh: number; sLow: number } {
    if (this.count < 10) {
      return { isAnomaly: false, direction: 'none', sHigh: this.sHigh, sLow: this.sLow };
    }

    if (this.sHigh > this.threshold) {
      return { isAnomaly: true, direction: 'up', sHigh: this.sHigh, sLow: this.sLow };
    }
    if (this.sLow > this.threshold) {
      return { isAnomaly: true, direction: 'down', sHigh: this.sHigh, sLow: this.sLow };
    }
    return { isAnomaly: false, direction: 'none', sHigh: this.sHigh, sLow: this.sLow };
  }

  reset(): void {
    this.sHigh = 0;
    this.sLow = 0;
  }

  getCount(): number {
    return this.count;
  }

  toJSON(): { target: number; sHigh: number; sLow: number; count: number; slack: number; threshold: number } {
    return {
      target: this.target,
      sHigh: this.sHigh,
      sLow: this.sLow,
      count: this.count,
      slack: this.slack,
      threshold: this.threshold,
    };
  }

  static fromJSON(data: { target: number; sHigh: number; sLow: number; count: number; slack: number; threshold: number }): CUSUM {
    const c = new CUSUM({ slack: data.slack, threshold: data.threshold, target: data.target });
    c.sHigh = data.sHigh;
    c.sLow = data.sLow;
    c.count = data.count;
    return c;
  }
}

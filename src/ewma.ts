/**
 * EWMA — Exponentially Weighted Moving Average
 *
 * Standalone implementation for behavioral fingerprinting.
 * Tracks a running mean and variance for a metric.
 * O(1) per update, stores only mean + variance.
 *
 * Inspired by Authensor Sentinel's EWMA implementation.
 */
export class EWMA {
  private mean: number = 0;
  private variance: number = 0;
  private count: number = 0;
  private alpha: number;

  constructor(alpha: number = 0.3) {
    this.alpha = Math.max(0.01, Math.min(0.99, alpha));
  }

  update(value: number): void {
    this.count++;
    if (this.count === 1) {
      this.mean = value;
      this.variance = 0;
      return;
    }
    const diff = value - this.mean;
    this.mean += this.alpha * diff;
    this.variance = (1 - this.alpha) * (this.variance + this.alpha * diff * diff);
  }

  getMean(): number {
    return this.mean;
  }

  getStdDev(): number {
    return Math.sqrt(this.variance);
  }

  getCount(): number {
    return this.count;
  }

  isAnomaly(value: number, thresholdSigma: number = 3): { isAnomaly: boolean; deviation: number } {
    if (this.count < 10) return { isAnomaly: false, deviation: 0 };
    const stdDev = this.getStdDev();
    if (stdDev === 0) {
      return {
        isAnomaly: value !== this.mean,
        deviation: value !== this.mean ? Infinity : 0,
      };
    }
    const deviation = Math.abs(value - this.mean) / stdDev;
    return { isAnomaly: deviation > thresholdSigma, deviation };
  }

  toJSON(): { mean: number; variance: number; count: number; alpha: number } {
    return { mean: this.mean, variance: this.variance, count: this.count, alpha: this.alpha };
  }

  static fromJSON(data: { mean: number; variance: number; count: number; alpha: number }): EWMA {
    const ewma = new EWMA(data.alpha);
    ewma.mean = data.mean;
    ewma.variance = data.variance;
    ewma.count = data.count;
    return ewma;
  }
}

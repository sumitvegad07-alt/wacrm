export class MetricsCollector {
  private latencies: number[] = [];
  private startTime: number = 0;
  private endTime: number = 0;
  private memoryGrowthBytes: number = 0;
  private startMemory: number = 0;
  
  public startRun() {
    this.startTime = performance.now();
    this.latencies = [];
    if (typeof process !== 'undefined' && process.memoryUsage) {
      this.startMemory = process.memoryUsage().heapUsed;
    }
  }

  public endRun() {
    this.endTime = performance.now();
    if (typeof process !== 'undefined' && process.memoryUsage) {
      this.memoryGrowthBytes = process.memoryUsage().heapUsed - this.startMemory;
    }
  }

  public recordLatency(ms: number) {
    this.latencies.push(ms);
  }

  public getReport(totalOps: number) {
    const durationMs = this.endTime - this.startTime;
    const throughput = (totalOps / durationMs) * 1000;
    
    // Calculate P95, P99
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
    const avg = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);

    return {
      durationMs,
      throughputOpsPerSec: throughput,
      avgLatencyMs: avg,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      memoryGrowthMB: this.memoryGrowthBytes / 1024 / 1024
    };
  }
}

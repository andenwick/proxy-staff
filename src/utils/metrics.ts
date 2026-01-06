type LabelValue = string | number | boolean;
type Labels = Record<string, LabelValue>;

interface TimingStat {
  count: number;
  totalMs: number;
}

const counters = new Map<string, number>();
const timings = new Map<string, TimingStat>();
const gauges = new Map<string, number>();

function formatLabels(labels?: Labels): string {
  if (!labels) {
    return '';
  }

  const entries = Object.entries(labels)
    .map(([key, value]) => [key, String(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  return entries.map(([key, value]) => `${key}=${value}`).join(',');
}

function keyWithLabels(name: string, labels?: Labels): string {
  const labelString = formatLabels(labels);
  return labelString ? `${name}|${labelString}` : name;
}

export function incrementCounter(name: string, labels?: Labels, amount: number = 1): void {
  const key = keyWithLabels(name, labels);
  const current = counters.get(key) ?? 0;
  counters.set(key, current + amount);
}

export function recordTiming(name: string, durationMs: number, labels?: Labels): void {
  const key = keyWithLabels(name, labels);
  const current = timings.get(key) ?? { count: 0, totalMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  timings.set(key, current);
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  const key = keyWithLabels(name, labels);
  gauges.set(key, value);
}

export function snapshotMetrics(): {
  timestamp: string;
  counters: Record<string, number>;
  timings: Record<string, { count: number; totalMs: number; avgMs: number }>;
  gauges: Record<string, number>;
} {
  const countersObj: Record<string, number> = {};
  for (const [key, value] of counters.entries()) {
    countersObj[key] = value;
  }

  const timingsObj: Record<string, { count: number; totalMs: number; avgMs: number }> = {};
  for (const [key, value] of timings.entries()) {
    timingsObj[key] = {
      count: value.count,
      totalMs: value.totalMs,
      avgMs: value.count > 0 ? value.totalMs / value.count : 0,
    };
  }

  const gaugesObj: Record<string, number> = {};
  for (const [key, value] of gauges.entries()) {
    gaugesObj[key] = value;
  }

  return {
    timestamp: new Date().toISOString(),
    counters: countersObj,
    timings: timingsObj,
    gauges: gaugesObj,
  };
}

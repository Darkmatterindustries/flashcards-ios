export type UsageDays = Record<string, number>;
export type UsageDevice = { platform: string; days: UsageDays };
export const usageDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function addUsage(days: UsageDays, start: number, end: number) {
  const result = { ...days };
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return result;
  while (start < end) {
    const date = new Date(start);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const next = Math.min(midnight, end);
    const key = usageDay(date);
    result[key] = (result[key] || 0) + next - start;
    start = next;
  }
  return result;
}
export function mergeUsage(a: UsageDays, b: UsageDays): UsageDays {
  const result: UsageDays = {};
  for (const source of [a, b]) for (const [day, value] of Object.entries(source || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(value) && value >= 0) result[day] = Math.max(result[day] || 0, value);
  }
  return result;
}
export function formatUsage(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

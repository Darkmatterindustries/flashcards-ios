import { expect, it } from 'vitest';
import { addUsage, mergeUsage, usageDay, formatUsage } from '../src/usage-core';
it('splits app time at local midnight', () => {
  const start = new Date(2026, 8, 14, 23, 59, 58).getTime();
  const next = new Date(2026, 8, 15, 0, 0, 3).getTime();
  expect(addUsage({}, start, next)).toEqual({ '2026-09-14': 2000, '2026-09-15': 3000 });
});
it('merges repeated or stale device uploads without doubling or losing time', () => {
  expect(mergeUsage({ '2026-09-14': 60000 }, { '2026-09-14': 20000, '2026-09-15': 5000 })).toEqual({ '2026-09-14': 60000, '2026-09-15': 5000 });
  expect(mergeUsage({}, { bad: 10, '2026-09-14': -10 })).toEqual({});
});
it('ignores backward clock intervals and formats totals', () => {
  expect(addUsage({}, 2000, 1000)).toEqual({});
  expect(formatUsage(3665000)).toBe('1h 1m');
  expect(usageDay(new Date(2026, 0, 2))).toBe('2026-01-02');
});

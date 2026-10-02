import { test, expect } from '@playwright/test';
test('daily time persists across reload and pauses when hidden', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 14, 12, 0, 0) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const history = page.locator('[data-usage-history]');
  await expect(history).toContainText('2026-09-14');
  await page.clock.runFor(10000);
  await expect(history).toContainText('Web: 10s');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(60000);
  await expect(history).toContainText('Web: 10s');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(5000);
  await expect(history).toContainText('Web: 15s');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(history).toContainText('Web: 15s');
});

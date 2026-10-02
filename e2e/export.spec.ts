import { test, expect } from '@playwright/test';

test('deck menu offers to export a deck as .apkg', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tile-icon-button[aria-label^="More options"]').click();
  await page.getByRole('button', { name: 'Export deck' }).click();
  await expect(page.getByText(/Export .*as an \.apkg file/)).toBeVisible();
  // Without a native file share sheet, desktop browsers receive a download.
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('German Vocabulary.apkg');
  expect(await download.failure()).toBeNull();
});

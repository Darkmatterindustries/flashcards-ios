import { test, expect } from '@playwright/test';

test('deck menu offers to export a deck as .apkg', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tile-icon-button[aria-label^="More options"]').click();
  await page.getByRole('button', { name: 'Export deck' }).click();
  await expect(page.getByText(/Export .*as an \.apkg file/)).toBeVisible();
  // Headless Chromium/WebKit don't implement navigator.share with files, so
  // exporting should fall back to a clear message instead of hanging or erroring.
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText(/Sharing files isn.t available|could not be exported/)).toBeVisible({ timeout: 10000 });
});

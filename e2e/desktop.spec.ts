import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 1100, height: 820 }, isMobile: false, hasTouch: false });
test('desktop study buttons move and restore cards with a mouse', async ({ page }) => {
  await page.goto('/');
  await page.locator('.deck-tile-main').first().click();
  const memorize = page.getByRole('button', { name: 'Move card to Memorized deck', exact: true });
  await expect(memorize).toBeVisible();
  await memorize.click();
  await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await page.getByRole('button', { name: 'Undo last swipe', exact: true }).click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await page.getByRole('button', { name: 'Return to your decks', exact: true }).click();
  await expect(page.locator('.library-overview')).toBeVisible();
});

import { test, expect } from '@playwright/test';

test('flipped card has four case examples and can scroll to its pro-tip', async ({ page }) => {
  await page.goto('/');
  await page.locator('.deck-tile').first().click();
  await page.locator('.card').click();
  await expect(page.locator('.card')).toHaveClass(/flipped/);
  const content = page.locator('.back .card-content');
  await expect(content.locator('.grammar-case')).toHaveCount(4);
  await expect(content.locator('.grammar-english')).toHaveCount(4);
  expect(await content.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(content.locator('.grammar-tip')).toBeInViewport();
  await page.locator('.card').click();
  await expect(page.locator('.card')).not.toHaveClass(/flipped/);
});

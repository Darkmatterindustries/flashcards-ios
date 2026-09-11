import { test, expect, type Page } from '@playwright/test';
import { fixture } from '../tests/fixture';

async function drag(page: Page, direction: 'left' | 'right' | 'down') {
  const x = 220, y = 450;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + (direction === 'left' ? -160 : direction === 'right' ? 160 : 0), y + (direction === 'down' ? 180 : 0), { steps: 12 });
  await page.mouse.up();
}

test('PDF study flow, tap flip, A/B loop, downward exit and session reset', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.deck-tile')).toHaveCount(1);
  await expect(page.locator('.deck-count')).toHaveText('3 cards');
  await page.locator('.deck-tile').click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  expect(await page.locator('.study button').evaluateAll(buttons => buttons.every(button => {
    const parent = button.closest('.sr-only');
    return !!parent && getComputedStyle(parent).clip === 'rect(0px, 0px, 0px, 0px)';
  }))).toBe(true);
  await page.locator('.card').tap();
  await expect(page.locator('.card')).toHaveClass(/flipped/);
  await expect(page.locator('.back')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('.card').tap();
  await expect(page.locator('.card')).not.toHaveClass(/flipped/);
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('3 / 3');
  await drag(page, 'right'); await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await drag(page, 'down'); await expect(page.locator('h1')).toHaveText('Your decks');
  await expect(page.locator('.reviewed')).toHaveText('3 reviewed');
  await page.reload(); await page.locator('.deck-tile').click();
  for (const count of ['2 / 3', '3 / 3']) { await drag(page, 'right'); await expect(page.locator('.card-counter')).toHaveText(count); }
  await drag(page, 'right'); await expect(page.locator('h1')).toHaveText('All clear.');
  await page.getByRole('button', { name: 'Study again' }).click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
});

for (const modern of [false, true]) test(`imports ${modern ? 'modern' : 'legacy'} apkg and persists media offline`, async ({ page, context }) => {
  await page.goto('/');
  const bytes = Buffer.from(await fixture(modern));
  await page.locator('input[type=file]').setInputFiles({ name: 'test.apkg', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('.notice')).toContainText('Imported 4 cards', { timeout: 20000 });
  await expect(page.locator('.deck-tile')).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Imported Basics,/ })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: /^Imported Basics,/ }).click();
  await page.locator('.card').tap();
  await expect(page.locator('.back img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => page.locator('.back img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await drag(page, 'down');
  await context.setOffline(false);
  await page.locator('input[type=file]').setInputFiles({ name: 'renamed.apkg', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('.notice')).toHaveText('This package is already in your library.');
  await expect(page.locator('.deck-tile')).toHaveCount(3);
});

test('invalid import leaves library usable', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.apkg', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
  await expect(page.locator('.notice.error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import deck' })).toBeEnabled();
  await page.locator('.deck-tile').click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
});

test('screens at iPhone 16 Pro Max size', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.deck-tile')).toBeVisible();
  await page.screenshot({ path: 'docs/library-preview.png' });
  await page.locator('.deck-tile').click();
  await page.screenshot({ path: 'docs/front-preview.png' });
  await page.locator('.card').tap();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'docs/back-preview.png' });
});

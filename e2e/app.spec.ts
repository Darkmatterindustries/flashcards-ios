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
  await expect(page.locator('.library-overview')).toHaveText('3 cards ready0 reviewed');
  await expect(page.locator('.deck-cta')).toHaveText('Start studying');
  await page.locator('.deck-tile').click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  // Every study-screen button is visually hidden, with one deliberate exception:
  // the pronunciation icon is a real, visible button by design.
  expect(await page.locator('.study button').evaluateAll(buttons => buttons.every(button => {
    if (button.classList.contains('speak-button') || button.classList.contains('toast-undo')) return true;
    const parent = button.closest('.sr-only');
    return !!parent && getComputedStyle(parent).clip === 'rect(0px, 0px, 0px, 0px)';
  }))).toBe(true);
  // Some Playwright WebKit builds omit the Speech Synthesis API that real
  // Safari/iOS ships, so the icon is only expected where it's supported.
  if (await page.evaluate(() => 'speechSynthesis' in window)) {
    await expect(page.locator('.speak-button')).toBeVisible();
  }
  await page.locator('.card').tap();
  await expect(page.locator('.card')).toHaveClass(/flipped/);
  await expect(page.locator('.back')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('.card').tap();
  await expect(page.locator('.card')).not.toHaveClass(/flipped/);
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('3 / 3');
  // Swiping right permanently relocates the card to its "Memorized" companion
  // deck; the session queue itself still behaves exactly as it did before.
  await drag(page, 'right'); await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await drag(page, 'left'); await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await drag(page, 'down'); await expect(page.locator('h1')).toHaveText('Your decks');
  await expect(page.locator('.deck-tile')).toHaveCount(2);
  const original = page.getByRole('button', { name: /^German Vocabulary,/ });
  const memorized = page.getByRole('button', { name: /^German Vocabulary — Memorized,/ });
  await expect(original.locator('.deck-count')).toHaveText('2 cards');
  await expect(original.locator('.reviewed')).toHaveText('2 reviewed');
  await expect(memorized.locator('.deck-count')).toHaveText('1 cards');
  await page.reload();
  await page.getByRole('button', { name: /^German Vocabulary,/ }).click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 2');
  await drag(page, 'right'); await expect(page.locator('.card-counter')).toHaveText('2 / 2');
  await drag(page, 'right'); await expect(page.locator('h1')).toHaveText('All clear.');
  await page.getByRole('button', { name: 'Your decks' }).click();
  await expect(page.locator('.deck-tile')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^German Vocabulary,/ }).locator('.deck-count')).toHaveText('0 cards');
  await expect(memorized.locator('.deck-count')).toHaveText('3 cards');
});

for (const modern of [false, true]) test(`imports ${modern ? 'modern' : 'legacy'} apkg and persists media offline`, async ({ page, context }) => {
  await page.goto('/');
  const bytes = Buffer.from(await fixture(modern));
  await page.locator('input[type=file]').setInputFiles({ name: 'test.apkg', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.panel-hint')).toContainText('4 cards total');
  await page.getByRole('button', { name: /^Import 4 cards$/ }).click();
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
  await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /^Import 4 cards$/ }).click();
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

test('undo restores an accidentally swiped card', async ({ page }) => {
  await page.goto('/');
  await page.locator('.deck-tile').click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await drag(page, 'right');
  await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await expect(page.locator('.toast-undo')).toBeVisible();
  await page.locator('.toast-undo').click();
  await expect(page.locator('.card-counter')).toHaveText('1 / 3');
  await drag(page, 'down');
  const original = page.getByRole('button', { name: /^German Vocabulary,/ });
  await expect(original.locator('.deck-count')).toHaveText('3 cards');
  await expect(original.locator('.reviewed')).toHaveText('0 reviewed');
});

test('resuming a deck continues the same queue', async ({ page }) => {
  await page.goto('/');
  await page.locator('.deck-tile').click();
  await drag(page, 'left');
  await expect(page.locator('.card-counter')).toHaveText('2 / 3');
  await drag(page, 'down');
  await page.reload();
  await page.locator('.deck-tile').click();
  await expect(page.locator('.card-counter')).toHaveText('2 / 3');
});

test('search filters the deck list', async ({ page }) => {
  await page.goto('/');
  await page.locator('.search-input').fill('zzz-no-match');
  await expect(page.locator('.deck-tile')).toHaveCount(0);
  await expect(page.getByText('No decks match your search.')).toBeVisible();
  await page.locator('.search-input').fill('German');
  await expect(page.locator('.deck-tile')).toHaveCount(1);
});

test('shuffle toggle persists across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tile-icon-button[aria-label^="Enable shuffle"]').click();
  await expect(page.locator('.tile-icon-button.shuffle-active')).toBeVisible();
  await page.reload();
  await expect(page.locator('.tile-icon-button.shuffle-active')).toBeVisible();
});

test('renaming and deleting a deck from its menu', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tile-icon-button[aria-label^="More options"]').click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.locator('.sheet-input').fill('Renamed Deck');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
  await expect(page.locator('.deck-row h2')).toHaveText('Renamed Deck');
  await page.locator('.tile-icon-button[aria-label^="More options"]').click();
  await page.getByRole('button', { name: 'Delete deck' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.deck-tile')).toHaveCount(0);
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

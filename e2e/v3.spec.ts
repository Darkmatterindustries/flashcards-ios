import { test, expect } from '@playwright/test';

test('3.0 scheduled review persists ratings without moving cards to Memorized', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Study hub', exact: true }).click();
  await page.getByRole('button', { name: /^Scheduled review/ }).click();
  await expect(page.getByRole('heading', { name: 'Scheduled review' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Good/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
  await page.getByRole('button', { name: 'Good · 1d', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.daily-dashboard')).toContainText('1 / 20 reviews today');
  await expect(page.locator('.deck-tile')).toHaveCount(1);
  await expect(page.locator('.deck-count')).toHaveText('3 cards');
  await page.reload();
  await expect(page.locator('.daily-dashboard')).toContainText('0 due · 2 new');
});

test('3.0 card editor, difficult filter, reverse practice and daily goal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Study hub', exact: true }).click();
  await page.getByLabel('Daily review goal').fill('7');
  await page.getByRole('button', { name: 'Save daily goal' }).click();
  await expect(page.getByRole('status')).toContainText('Daily goal saved');
  await page.getByRole('button', { name: 'Browse and edit cards' }).click();
  await page.getByRole('button', { name: /^der Entwurf/ }).click();
  await page.getByLabel('Meaning', { exact: true }).fill('the draft — edited');
  await page.getByLabel('Example sentence').fill('Das ist mein erster Entwurf.');
  await page.getByLabel('Tags (comma separated)').fill('writing, noun');
  await page.getByLabel('Mark as difficult').check();
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit cards' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Difficult words/ }).click();
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
  await expect(page.locator('.practice-card')).toContainText('the draft — edited');
  await expect(page.locator('.practice-card')).toContainText('Das ist mein erster Entwurf.');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^English → German/ }).click();
  await expect(page.locator('.practice-card')).toContainText('the draft — edited');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.daily-dashboard')).toContainText('0 / 7 reviews today');
});

test('3.0 downloads audio and plays the local copy without another MP3 request', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Study hub', exact: true }).click();
  await page.getByRole('button', { name: 'Download available audio' }).click();
  await expect(page.locator('.storage-summary')).toContainText('3 / 3 unique clips downloaded', { timeout: 30000 });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.deck-tile-main').click();
  let requests = 0;
  await page.route('**/pronunciation/*.mp3', route => { requests++; return route.abort(); });
  const playback = page.waitForEvent('request', { predicate: request => request.url().startsWith('blob:'), timeout: 3000 }).catch(() => undefined);
  if (await page.getByRole('button', { name: 'Hear pronunciation' }).count()) {
    await page.getByRole('button', { name: 'Hear pronunciation' }).click();
    await playback;
  }
  expect(requests).toBe(0);
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('flashcards-audio'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return new Promise<number>((resolve, reject) => { const request = db.transaction('clips').objectStore('clips').count(); request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error); });
  });
  expect(saved).toBe(3);
});

import { openDB } from 'idb';
import { Capacitor } from '@capacitor/core';
import { addUsage, formatUsage, mergeUsage, usageDay, type UsageDays, type UsageDevice } from './usage-core';
import { syncUsageDevice } from './cloud';

type RecordData = { deviceId: string; days: UsageDays; lastEnd: number; others: Record<string, UsageDevice> };
const db = openDB('flashcards-usage', 1, { upgrade(db) { db.createObjectStore('records'); } });
const platform = Capacitor.getPlatform() === 'ios' ? 'iOS' : Capacitor.getPlatform() === 'android' ? 'Android' : location.hostname === 'flashcards.example' ? 'Windows' : 'Web';
let scope = 'guest', user: string | null = null, last = Date.now(), active = !document.hidden && document.hasFocus();
let queue: Promise<unknown> = Promise.resolve();
let syncing: Promise<void> | undefined;
let syncMessage = 'Saved on this device. Sign in to sync time.';
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const job = queue.then(fn); queue = job.catch(() => {}); return job;
};
const fresh = (): RecordData => ({ deviceId: crypto.randomUUID(), days: {}, lastEnd: 0, others: {} });
async function recordInterval(key: string, start: number, end: number) {
  const tx = (await db).transaction('records', 'readwrite');
  const data: RecordData = await tx.store.get(key) || fresh();
  data.days = addUsage(data.days, Math.max(start, data.lastEnd), end);
  data.lastEnd = Math.max(data.lastEnd, end);
  await tx.store.put(data, key); await tx.done;
}
function checkpoint() {
  const now = Date.now(), start = last; last = now;
  // Ignore timer gaps caused by OS sleep or suspended webviews.
  if (!active || now - start > 15000 || now <= start) return Promise.resolve();
  const key = scope;
  return enqueue(() => recordInterval(key, start, now));
}
export async function setUsageUser(uid: string | null) {
  await checkpoint();
  await enqueue(async () => {
    scope = uid || 'guest'; user = uid;
    if (uid) {
      const tx = (await db).transaction('records', 'readwrite');
      const guest: RecordData | undefined = await tx.store.get('guest');
      const data: RecordData = await tx.store.get(uid) || fresh();
      if (guest) {
        for (const [day, value] of Object.entries(guest.days)) data.days[day] = (data.days[day] || 0) + value;
        data.lastEnd = Math.max(data.lastEnd, guest.lastEnd);
        await tx.store.delete('guest');
      }
      await tx.store.put(data, uid); await tx.done;
    }
    syncMessage = uid ? 'Time sync pending…' : 'Saved on this device. Sign in to sync time.';
  });
  if (uid) void syncUsage().catch(() => {});
  void renderUsage();
}
export async function syncUsage() {
  await checkpoint(); await queue;
  if (!user) return;
  if (syncing) return syncing;
  const uid = user;
  syncing = (async () => {
    const database = await db;
    const data: RecordData = await database.get('records', uid) || fresh();
    const others = await syncUsageDevice(uid, data.deviceId, { platform, days: data.days });
    await enqueue(async () => {
      const tx = database.transaction('records', 'readwrite');
      const latest: RecordData = await tx.store.get(uid) || data;
      latest.days = mergeUsage(latest.days, others[latest.deviceId]?.days || {});
      latest.others = others;
      await tx.store.put(latest, uid); await tx.done;
    });
    if (user === uid) syncMessage = `Time synced at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  })().catch(error => {
    if (user === uid) syncMessage = 'Time saved locally. Cloud sync failed; it will retry while the app is open.';
    throw error;
  }).finally(() => { syncing = undefined; void renderUsage(); });
  return syncing;
}
async function renderUsage() {
  const key = scope;
  const data: RecordData = await (await db).get('records', key) || fresh();
  if (scope !== key) return;
  const devices = { ...data.others, [data.deviceId]: { platform, days: data.days } };
  const dates = new Set([usageDay(new Date()), ...Object.values(devices).flatMap(d => Object.keys(d.days))]);
  for (const target of document.querySelectorAll<HTMLElement>('[data-usage-history]')) {
    target.replaceChildren();
    for (const date of [...dates].sort().reverse()) {
      const parts: Record<string, number> = {};
      for (const device of Object.values(devices)) parts[device.platform] = (parts[device.platform] || 0) + (device.days[date] || 0);
      const row = document.createElement('p'); row.className = 'usage-row';
      const heading = document.createElement('strong'); heading.textContent = `${date} · ${formatUsage(Object.values(parts).reduce((sum, value) => sum + value, 0))}`;
      const detail = document.createElement('span'); detail.textContent = Object.entries(parts).filter(([, ms]) => ms > 0).map(([name, ms]) => `${name}: ${formatUsage(ms)}`).join(' · ') || 'No time recorded yet';
      row.append(heading, detail); target.append(row);
    }
  }
  document.querySelectorAll('[data-usage-status]').forEach(node => { node.textContent = syncMessage; });
}
export function usagePanel() {
  const panel = document.createElement('div'); panel.className = 'settings-group';
  const title = document.createElement('h2'); title.className = 'settings-label'; title.textContent = 'Daily app time';
  const hint = document.createElement('p'); hint.className = 'settings-about';
  hint.textContent = 'Time with the app visible and focused, starting from this update. Dates use each device’s local time. Signed-in totals combine iOS, Android, Windows and Web; simultaneous use adds each device’s time.';
  const status = document.createElement('p'); status.className = 'settings-about'; status.dataset.usageStatus = '';
  const history = document.createElement('div'); history.dataset.usageHistory = ''; history.className = 'usage-history';
  const sync = document.createElement('button'); sync.type = 'button'; sync.className = 'text-button'; sync.textContent = 'Sync app time';
  sync.onclick = async () => { sync.disabled = true; try { await syncUsage(); } catch {} finally { sync.disabled = false; void renderUsage(); } };
  panel.append(title, hint, history, status, sync);
  void checkpoint().then(renderUsage).catch(() => { status.textContent = 'App time could not be saved. Check device storage.'; });
  return panel;
}
export function startUsageTracking() {
  const update = () => {
    void checkpoint().catch(() => {});
    active = !document.hidden && document.hasFocus(); last = Date.now();
    if (!active) void syncUsage().catch(() => {});
  };
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update); window.addEventListener('blur', update);
  window.addEventListener('pagehide', () => { void checkpoint().catch(() => {}); active = false; void syncUsage().catch(() => {}); });
  window.addEventListener('pageshow', update);
  window.addEventListener('online', () => { void syncUsage().catch(() => {}); });
  setInterval(() => { void checkpoint().then(renderUsage).catch(() => {}); }, 5000);
  setInterval(() => { if (active) void syncUsage().catch(() => {}); }, 60000);
}

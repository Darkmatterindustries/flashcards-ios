import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ docs: {} as Record<string, any> }));
vi.mock('../src/firebase-config', () => ({ firebaseConfig: {}, isFirebaseConfigured: () => true }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  doc: (...args: any[]) => args.slice(1).join('/'),
  collection: (...args: any[]) => args.slice(1).join('/'),
  runTransaction: async (_: any, fn: any) => fn({ get: async (ref: string) => ({ data: () => state.docs[ref] }), set: (ref: string, data: any) => { state.docs[ref] = data; } }),
  getDocsFromServer: async (prefix: string) => ({ docs: Object.entries(state.docs).filter(([key]) => key.startsWith(prefix + '/')).map(([key, data]) => ({ id: key.split('/').pop(), data: () => data })) }),
}));
import { syncUsageDevice } from '../src/cloud';
it('keeps separate platform totals and rejects stale overwrites on repeated sync', async () => {
  await syncUsageDevice('alice', 'phone', { platform: 'iOS', days: { '2026-09-14': 60000 } });
  await syncUsageDevice('alice', 'pc', { platform: 'Windows', days: { '2026-09-14': 120000 } });
  const totals = await syncUsageDevice('alice', 'phone', { platform: 'iOS', days: { '2026-09-14': 5000 } });
  expect(totals.phone.days['2026-09-14']).toBe(60000);
  expect(totals.pc.days['2026-09-14']).toBe(120000);
  expect(await syncUsageDevice('bob', 'phone', { platform: 'Android', days: {} })).toEqual({ phone: { platform: 'Android', days: {} } });
});

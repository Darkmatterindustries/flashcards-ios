// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ write: vi.fn(), share: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: native.write }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));
import { shareDeckFile } from '../src/share-deck';
beforeEach(() => { vi.resetAllMocks(); native.write.mockResolvedValue({ uri: 'file:///cache/exports/Deck.apkg' }); });
it('shares a binary deck from the Android cache without corrupting its bytes', async () => {
  await shareDeckFile(new File([new Uint8Array([0, 128, 255])], 'Deck.apkg'), 'Deck');
  expect(native.write).toHaveBeenCalledWith({ path: 'exports/Deck.apkg', directory: 'CACHE', data: 'AID/', recursive: true });
  expect(native.share).toHaveBeenCalledWith({ title: 'Deck', files: ['file:///cache/exports/Deck.apkg'], dialogTitle: 'Export deck' });
});
it('does not open the share sheet when writing the export fails', async () => {
  native.write.mockRejectedValue(new Error('Storage full'));
  await expect(shareDeckFile(new File(['abc'], 'Deck.apkg'), 'Deck')).rejects.toThrow('Storage full');
  expect(native.share).not.toHaveBeenCalled();
});

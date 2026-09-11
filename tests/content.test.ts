// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cardContent } from '../src/content';

it('strips executable content, remote images, styles and app class names', () => {
  const rendered = cardContent('<script>alert(1)</script><div class="study cloze" style="position:fixed">Text</div><img src="https://example.com/tracker.png" onerror="alert(1)"><iframe src="https://example.com"></iframe>', new Map());
  expect(rendered.html).not.toMatch(/script|iframe|onerror|https:|position|study/);
  expect(rendered.html).toContain('cloze');
  expect(rendered.html).toContain('Image unavailable');
});
it('resolves bundled images and audio without adding study controls', () => {
  const rendered = cardContent('<img src="my%20image.png">[sound:word.mp3]', new Map([['my image.png', 'blob:image'], ['word.mp3', 'blob:sound']]));
  expect(rendered.html).toContain('blob:image'); expect(rendered.sounds).toEqual(['blob:sound']);
  expect(rendered.html).not.toMatch(/button|controls/);
});

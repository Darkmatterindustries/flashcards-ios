import { expect, it } from 'vitest';
import { localDay, nextSchedule, studyTotals } from '../src/review';
import { starterDeck } from '../src/model';
it('schedules Again soon and grows successful intervals without losing history', () => {
  const now = 1000000;
  const good = nextSchedule(undefined, 'good', now);
  expect(good.due).toBe(now + 86400000);
  const easy = nextSchedule(good, 'easy', now);
  expect(easy.intervalDays).toBe(4);
  expect(easy.reviews).toBe(2);
  const again = nextSchedule(easy, 'again', now);
  expect(again.due).toBe(now + 60000);
  expect(again.lapses).toBe(1);
  expect(nextSchedule(undefined, 'hard', now).intervalDays).toBe(1);
});
it('counts due/new cards separately, excludes Memorized and includes their activity', () => {
  const deck = starterDeck();
  const now = Date.now();
  deck.cards[0].schedule = nextSchedule(undefined, 'again', now - 60001);
  deck.cards[1].schedule = nextSchedule(undefined, 'good', now);
  deck.activity = { [localDay()]: 2 };
  const memorized = { ...starterDeck(), memorizedFor: 'starter', activity: { [localDay()]: 1 } };
  expect(studyTotals([deck, memorized], now)).toEqual({ due: 1, fresh: 1, today: 3 });
});

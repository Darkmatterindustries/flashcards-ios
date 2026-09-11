import type { Card, Deck } from './model';
export type Rating = 'again' | 'hard' | 'good' | 'easy';
const DAY = 86400000;
/** A simple interval scheduler, independent of Quick Review. */
export function nextSchedule(previous: Card['schedule'], rating: Rating, now = Date.now()): NonNullable<Card['schedule']> {
  const old = previous?.intervalDays ?? 0;
  const intervalDays = rating === 'again' ? 0 : rating === 'hard' ? Math.max(1, Math.round(old * 1.2)) : rating === 'good' ? Math.max(1, Math.round(old * 2.5)) : Math.max(4, Math.round(old * 3.5));
  return { due: now + (rating === 'again' ? 60000 : intervalDays * DAY), intervalDays, reviews: (previous?.reviews ?? 0) + 1, lapses: (previous?.lapses ?? 0) + Number(rating === 'again'), lastReviewed: now };
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function studyTotals(decks: Deck[], now = Date.now()) {
  let due = 0, fresh = 0, today = 0;
  const day = localDay(new Date(now));
  for (const deck of decks) {
    today += deck.activity?.[day] ?? 0;
    if (deck.memorizedFor) continue;
    for (const card of deck.cards) {
      if (!card.schedule) fresh++;
      else if (card.schedule.due <= now) due++;
    }
  }
  return { due, fresh, today };
}

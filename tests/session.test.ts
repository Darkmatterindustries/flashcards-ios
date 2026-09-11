import { describe, it, expect } from 'vitest';
import { StudySession } from '../src/session';
const cards = ['A', 'B', 'C'].map(id => ({ id, front: id, back: id.toLowerCase() }));
describe('PDF queue acceptance criteria', () => {
  it('loops A/B/C, removes C, and continues A/B forever', () => {
    const session = new StudySession(cards);
    session.swipe('left'); expect(session.ids).toEqual(['B', 'C', 'A']);
    session.swipe('left'); expect(session.ids).toEqual(['C', 'A', 'B']);
    session.swipe('right'); expect(session.ids).toEqual(['A', 'B']);
    for (let i = 0; i < 20; i++) { expect(session.current.id).toBe(i % 2 ? 'B' : 'A'); session.swipe('left'); }
    expect(cards.map(c => c.id)).toEqual(['A', 'B', 'C']);
    expect(new StudySession(cards).ids).toEqual(['A', 'B', 'C']);
  });
  it('loops a single card and ends when it is dismissed', () => {
    const session = new StudySession(cards.slice(0, 1));
    session.swipe('left'); expect(session.current.id).toBe('A');
    session.swipe('right'); expect(session.remaining).toBe(0);
    session.swipe('left'); expect(session.current).toBeUndefined();
  });
  it('keeps the original ordinal and counts unique reviewed cards', () => {
    const session = new StudySession(cards);
    for (let i = 0; i < 8; i++) session.swipe('left');
    expect(session.position).toBe(3); expect(session.total).toBe(3); expect(session.reviewed.size).toBe(3);
  });
});

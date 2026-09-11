import type { Card } from './model';

/** A session owns its queue. Dismissal never deletes a card from its deck. */
export class StudySession {
  private queue: Card[];
  readonly reviewed = new Set<string>();
  private positions: Map<string, number>;
  readonly total: number;

  constructor(cards: Card[]) {
    this.queue = [...cards];
    this.total = cards.length;
    this.positions = new Map(cards.map((card, index) => [card.id, index + 1]));
  }

  get current() { return this.queue[0]; }
  get remaining() { return this.queue.length; }
  get position() { return this.current ? this.positions.get(this.current.id)! : 0; }
  get ids() { return this.queue.map(card => card.id); }

  swipe(direction: 'left' | 'right') {
    const card = this.queue.shift();
    if (!card) return;
    this.reviewed.add(card.id);
    if (direction === 'left') this.queue.push(card);
  }
}

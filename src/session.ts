import type { Card, SessionSnapshot } from './model';

/** A session owns its queue. Dismissal never deletes a card from its deck. */
export class StudySession {
  private queue: Card[];
  readonly reviewed: Set<string>;
  private positions: Map<string, number>;
  private order: string[];
  readonly total: number;

  constructor(cards: Card[], snapshot?: SessionSnapshot) {
    const byId = new Map(cards.map(card => [card.id, card]));
    this.order = snapshot ? snapshot.order.filter(id => byId.has(id)) : cards.map(card => card.id);
    const queueIds = snapshot ? snapshot.queue.filter(id => byId.has(id)) : this.order;
    this.queue = queueIds.map(id => byId.get(id)!);
    this.reviewed = new Set(snapshot ? snapshot.reviewed.filter(id => byId.has(id)) : []);
    this.total = this.order.length;
    this.positions = new Map(this.order.map((id, index) => [id, index + 1]));
  }

  get current() { return this.queue[0]; }
  get remaining() { return this.queue.length; }
  get position() { return this.current ? this.positions.get(this.current.id)! : 0; }
  get ids() { return this.queue.map(card => card.id); }
  get snapshot(): SessionSnapshot { return { order: this.order, queue: this.queue.map(card => card.id), reviewed: [...this.reviewed] }; }

  swipe(direction: 'left' | 'right') {
    const card = this.queue.shift();
    if (!card) return;
    this.reviewed.add(card.id);
    if (direction === 'left') this.queue.push(card);
  }

  /** Reverses one swipe: puts the card back at the front of the queue and drops its reviewed mark. */
  undoLast(card: Card, direction: 'left' | 'right') {
    this.reviewed.delete(card.id);
    if (direction === 'left') {
      const index = this.queue.lastIndexOf(card);
      if (index !== -1) this.queue.splice(index, 1);
    }
    this.queue.unshift(card);
  }
}

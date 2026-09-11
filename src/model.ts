export interface Card {
  id: string;
  front: string;
  back: string;
}

export interface Deck {
  id: string;
  name: string;
  cards: Card[];
  reviewed: string[];
  importedAt: number;
  packageId?: string;
  /** Id of the deck this one collects memorized (swiped-right) cards from, if any. */
  memorizedFor?: string;
}

export interface MediaFile { id: string; packageId: string; name: string; data: ArrayBuffer; mime: string }
export interface ImportResult { decks: Deck[]; media: MediaFile[]; warnings: string[]; packageId: string }

export function starterDeck(): Deck {
  return {
    id: 'starter', name: 'German Vocabulary', importedAt: 0, reviewed: [],
    cards: [
      { id: 'sample-1', front: 'der<br>Entwurf', back: 'the draft<p class="explanation">A preliminary version of a document, design, or plan.</p>' },
      { id: 'sample-2', front: 'die<br>Erinnerung', back: 'the memory<p class="explanation">Something you remember from the past.</p>' },
      { id: 'sample-3', front: 'verstehen', back: 'to understand<p class="explanation">To know the meaning of something.</p>' },
    ],
  };
}

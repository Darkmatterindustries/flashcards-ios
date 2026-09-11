import './style.css';
import { loadDecks, saveImport, saveReviewed, mediaForDeck } from './storage';
import type { Deck } from './model';
import { StudySession } from './session';
import { cardContent } from './content';
import { importFile } from './import/client';

const app = document.querySelector<HTMLElement>('#app')!;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let cleanup = () => {};
let pendingNotice = '';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

function button(text: string, className: string, action: () => void) {
  const result = element('button', className, text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}

function setScreen(screen: HTMLElement) {
  cleanup(); cleanup = () => {};
  app.replaceChildren(screen);
}

async function library() {
  try {
    const decks = await loadDecks();
    const screen = element('section', 'library');
    const header = element('header', 'library-header');
    header.append(element('p', 'eyebrow', 'Ready to study'), element('h1', '', 'Your decks'));
    const picker = element('input', 'sr-only');
    picker.type = 'file';
    // Generic data allows Files to select .apkg even if another app has not
    // registered Anki's extension. Validate the selected filename ourselves.
    picker.accept = '.apkg,application/octet-stream,application/zip';
    picker.tabIndex = -1;
    picker.setAttribute('aria-label', 'Choose an Anki package');
    const importButton = button('Import deck', 'import-button', () => picker.click());
    header.append(importButton, picker);
    const list = element('div', 'deck-list');
    for (const deck of decks) {
      const tile = button('', 'deck-tile', () => void study(deck));
      const row = element('div', 'deck-row');
      row.append(element('h2', '', deck.name), element('span', 'deck-count', `${deck.cards.length} cards`));
      const reviewed = Math.min(deck.reviewed.length, deck.cards.length);
      const track = element('div', 'progress-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = element('div', 'progress-fill');
      fill.style.width = `${deck.cards.length ? reviewed / deck.cards.length * 100 : 0}%`;
      track.append(fill);
      tile.append(row, element('p', 'reviewed', `${reviewed} reviewed`), track);
      tile.setAttribute('aria-label', `${deck.name}, ${deck.cards.length} cards, ${reviewed} reviewed. Start studying.`);
      list.append(tile);
    }
    const hint = element('p', 'library-hint', 'Tap to flip. Left to repeat. Right to remove.\nSwipe down to return to your decks.');
    const notice = element('p', 'notice', pendingNotice);
    notice.setAttribute('role', 'status');
    pendingNotice = '';
    screen.append(header, list, hint, notice);
    setScreen(screen);
    let active = true;
    cleanup = () => { active = false; };
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      importButton.disabled = true;
      list.querySelectorAll('button').forEach(tile => tile.disabled = true);
      importButton.textContent = 'Importing…';
      screen.setAttribute('aria-busy', 'true');
      notice.textContent = 'Reading your deck…';
      try {
        const result = await importFile(file);
        const saved = await saveImport(result);
        if (!active) return;
        const count = result.decks.reduce((total, deck) => total + deck.cards.length, 0);
        pendingNotice = saved ? `Imported ${count} cards in ${result.decks.length} deck${result.decks.length === 1 ? '' : 's'}.${result.warnings.length ? '\n' + result.warnings.join('\n') : ''}` : 'This package is already in your library.';
        void library();
      } catch (error) {
        if (!active) return;
        notice.textContent = error instanceof DOMException
          ? (error.name === 'QuotaExceededError' ? 'There isn’t enough space for this deck. Free up some storage and try again.' : 'The deck could not be saved. Please reopen the app and try again.')
          : error instanceof Error ? error.message : 'The deck could not be saved. Please try again.';
        notice.classList.add('error');
        importButton.disabled = false;
        list.querySelectorAll('button').forEach(tile => tile.disabled = false);
        importButton.textContent = 'Import deck';
        screen.removeAttribute('aria-busy');
        picker.value = '';
      }
    });
  } catch {
    const screen = element('section', 'completion');
    screen.append(element('h1', '', 'Your library couldn’t open'), element('p', '', 'Please close and reopen the app. Your saved decks have not been changed.'), button('Try again', 'primary-button', () => void library()));
    setScreen(screen);
  }
}

async function study(deck: Deck) {
  const session = new StudySession(deck.cards);
  const screen = element('section', 'study');
  const shell = element('div', 'card-shell');
  const card = element('div', 'card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-roledescription', 'flashcard');
  card.setAttribute('aria-describedby', 'study-instructions');
  const front = element('div', 'card-face front');
  const back = element('div', 'card-face back');
  const frontContent = element('div', 'card-content');
  const backContent = element('div', 'card-content');
  front.append(element('span', 'face-label', 'Front'), frontContent);
  back.append(element('span', 'face-label', 'Back'), backContent);
  card.append(front, back);
  const count = element('span', 'card-counter');
  count.setAttribute('aria-hidden', 'true');
  shell.append(card, count);
  const instructions = element('p', 'sr-only', 'Tap to flip. Swipe left to repeat, right to remove, or down to return to your decks. With a keyboard, use Enter to flip, arrow keys to sort, and Escape to leave.');
  instructions.id = 'study-instructions';
  const accessibleActions = element('div', 'sr-only');
  accessibleActions.append(
    button('Keep card in loop', '', () => void swipe('left')),
    button('Remove card from this session', '', () => void swipe('right')),
    button('Return to your decks', '', () => void leave()),
  );
  screen.append(shell, instructions, accessibleActions);
  setScreen(screen);
  let disposed = false, busy = false, flipped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let media = new Map<string, string>();
  let sounds: { front: string[]; back: string[] } = { front: [], back: [] };
  let playing: HTMLAudioElement[] = [];
  const stopAudio = () => { playing.forEach(audio => { audio.pause(); audio.src = ''; }); playing = []; };
  const playAudio = () => {
    stopAudio();
    const urls = sounds[flipped ? 'back' : 'front'];
    const next = (index: number) => {
      if (disposed || !urls[index]) return;
      const audio = new Audio(urls[index]); playing.push(audio);
      audio.addEventListener('ended', () => next(index + 1), { once: true });
      void audio.play().catch(() => { /* WebKit can require a fresh user gesture. */ });
    };
    next(0);
  };
  const refreshAccessibility = () => {
    front.setAttribute('aria-hidden', String(flipped));
    back.setAttribute('aria-hidden', String(!flipped));
    card.setAttribute('aria-label', `${flipped ? 'Back' : 'Front'}. ${(flipped ? backContent : frontContent).textContent}. Card ${session.position} of ${session.total}.`);
  };
  const render = (reset = true) => {
    if (!session.current) return;
    if (reset) { flipped = false; card.classList.remove('flipped'); }
    const a = cardContent(session.current.front, media), b = cardContent(session.current.back, media);
    frontContent.innerHTML = `<div class="card-body">${a.html}</div>`;
    backContent.innerHTML = `<div class="card-body">${b.html}</div>`;
    sounds = { front: a.sounds, back: b.sounds };
    for (const content of [frontContent, backContent]) {
      const length = content.textContent?.length || 0;
      content.classList.toggle('long-content', length > 110);
      content.scrollTop = 0;
    }
    count.textContent = `${session.position} / ${session.total}`;
    refreshAccessibility();
    playAudio();
  };
  function flip() {
    if (busy || disposed) return;
    flipped = !flipped;
    card.classList.toggle('flipped', flipped);
    refreshAccessibility();
    playAudio();
  }
  const persist = async () => {
    try { await saveReviewed(deck.id, session.reviewed); }
    catch { pendingNotice = 'Review progress could not be saved. Your cards are still in the library.'; }
  };
  async function leave() {
    if (busy || disposed) return;
    busy = true;
    await persist();
    if (!disposed) void library();
  }
  async function swipe(direction: 'left' | 'right') {
    if (busy || disposed || !session.current) return;
    busy = true;
    stopAudio();
    shell.style.transition = reduceMotion.matches ? 'none' : 'transform 180ms ease-out, opacity 180ms ease-out';
    shell.style.transform = `translateX(${direction === 'left' ? '-110' : '110'}vw) rotate(${direction === 'left' ? '-8' : '8'}deg)`;
    shell.style.opacity = '0';
    timer = setTimeout(() => {
      if (disposed) return;
      session.swipe(direction);
      void persist();
      if (!session.remaining) { void complete(); return; }
      card.classList.add('no-motion');
      render();
      shell.style.transition = 'none';
      shell.style.transform = 'none';
      shell.style.opacity = '1';
      // Commit the front face before re-enabling flip transitions.
      void card.offsetWidth;
      card.classList.remove('no-motion');
      busy = false;
    }, reduceMotion.matches ? 0 : 180);
  }
  async function complete() {
    await persist();
    if (disposed) return;
    const screen = element('section', 'completion');
    screen.append(element('p', 'eyebrow', 'Session complete'), element('h1', '', 'All clear.'), element('p', '', `You’ve finished all ${session.total} cards in ${deck.name}.`), button('Study again', 'primary-button', () => void study(deck)), button('Your decks', 'text-button', () => void library()));
    setScreen(screen);
  }
  type Gesture = { id: number; x: number; y: number; dx: number; dy: number; atTop: boolean; scrollTop: number; moved: boolean };
  let gesture: Gesture | undefined;
  const resetShell = () => {
    shell.style.transition = reduceMotion.matches ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out';
    shell.style.transform = 'none'; shell.style.opacity = '1';
  };
  card.addEventListener('pointerdown', event => {
    if (busy || !event.isPrimary || event.button !== 0) return;
    const content = flipped ? backContent : frontContent;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, atTop: content.scrollTop < 1, scrollTop: content.scrollTop, moved: false };
    card.setPointerCapture(event.pointerId);
    shell.style.transition = 'none';
  });
  card.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId || busy) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    gesture.dx = dx; gesture.dy = dy;
    if (Math.hypot(dx, dy) > 10) gesture.moved = true;
    if (Math.abs(dx) > Math.abs(dy) * 1.2) {
      shell.style.transform = `translateX(${dx}px) rotate(${dx / 35}deg)`;
      shell.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 650));
    } else if (dy > 0 && gesture.atTop) {
      shell.style.transform = `translateY(${dy * 0.4}px)`;
    } else {
      (flipped ? backContent : frontContent).scrollTop = gesture.scrollTop - dy;
    }
  });
  card.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const current = gesture; gesture = undefined;
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
    if (Math.abs(current.dx) >= Math.min(96, innerWidth * 0.23) && Math.abs(current.dx) > Math.abs(current.dy) * 1.2) {
      void swipe(current.dx < 0 ? 'left' : 'right');
    } else if (current.dy > 120 && current.atTop && current.dy > Math.abs(current.dx) * 1.4) {
      void leave();
    } else { resetShell(); if (!current.moved) flip(); }
  });
  card.addEventListener('pointercancel', () => { gesture = undefined; resetShell(); });
  card.addEventListener('lostpointercapture', () => { if (gesture) { gesture = undefined; resetShell(); } });
  card.addEventListener('click', event => { if (event.detail === 0) flip(); });
  const keydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLButtonElement) return;
    if (['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'Escape', 'ArrowDown'].includes(event.key)) event.preventDefault();
    if (event.repeat) return;
    if (event.key === 'Enter' || event.key === ' ') flip();
    else if (event.key === 'ArrowLeft') void swipe('left');
    else if (event.key === 'ArrowRight') void swipe('right');
    else if (event.key === 'Escape' || event.key === 'ArrowDown') void leave();
  };
  window.addEventListener('keydown', keydown);
  cleanup = () => {
    disposed = true; clearTimeout(timer); stopAudio();
    media.clear();
    window.removeEventListener('keydown', keydown);
  };
  render();
  card.focus({ preventScroll: true });
  try {
    const files = await mediaForDeck(deck);
    if (disposed) return;
    // Embedded media avoids WebKit's offline Blob-URL loading path. Keep bytes
    // in storage, and create data URLs only for the deck being studied.
    media = new Map(files.map(file => {
      const bytes = new Uint8Array(file.data);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      return [file.name, `data:${file.mime};base64,${btoa(binary)}`];
    }));
    if (files.length && !busy) render(false);
  } catch { pendingNotice = 'Some images or audio could not be loaded. Try reopening this deck.'; }
}

void library();

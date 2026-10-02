import type { Card, Deck, AppSettings } from './model';
import { loadDecks, loadSettings, editCard, rateCard, recordActivity, mediaForDeck } from './storage';
import { studyTotals, localDay, nextSchedule, type Rating } from './review';
import { plainText } from './speech-text';
import { grammarPanel } from './grammar';
import { cardContent } from './content';
import { pronounce, stopPronunciation, pronunciationSource } from './pronunciation';
import { audioCoverage, downloadDeckAudio, warmAudio } from './offline-audio';

type Host = { show: (screen: HTMLElement, dispose?: () => void) => void; back: () => void; quick: (deck: Deck) => void; settingsChanged: (settings: AppSettings) => Promise<void>; changed: () => void };
type Entry = { deck: Deck; card: Card };
type Mode = 'scheduled' | 'difficult' | 'reverse' | 'listening';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function action(text: string, fn: () => void, cls = 'text-button') {
  const b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b;
}
function panel(title: string, back: () => void) {
  const screen = el('section', 'panel v3-panel');
  const header = el('header', 'panel-header');
  header.append(action('Back', back, 'back-button'), el('h1', '', title)); screen.append(header); return screen;
}
export function dailyDashboard(decks: Deck[], settings: AppSettings, open: () => void) {
  const totals = studyTotals(decks);
  const goal = settings.dailyGoal ?? 20;
  const box = el('section', 'daily-dashboard');
  box.setAttribute('aria-label', 'Today’s study');
  box.append(el('p', 'eyebrow', 'TODAY · FLASHCARDS 3.0'), el('h2', '', `${totals.due} due · ${totals.fresh} new`));
  const progress = el('progress', 'cloud-meter-bar'); progress.max = goal; progress.value = Math.min(totals.today, goal);
  progress.setAttribute('aria-label', 'Daily review goal');
  box.append(el('p', 'settings-about', `${totals.today} / ${goal} reviews today`), progress);
  const calendar = el('div', 'study-calendar');
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(); date.setDate(date.getDate() - offset);
    const count = decks.reduce((n, d) => n + (d.activity?.[localDay(date)] ?? 0), 0);
    const day = el('span', `calendar-day${count ? ' studied' : ''}`, date.toLocaleDateString(undefined, { weekday: 'narrow' }));
    day.title = `${localDay(date)}: ${count} reviews`; day.setAttribute('aria-label', day.title);
    calendar.append(day);
  }
  box.append(calendar, action('Study hub', open, 'primary-button'));
  return box;
}

export async function studyHub(host: Host, selectedDeckId = '') {
  const [decks, settings] = await Promise.all([loadDecks(), loadSettings()]);
  const screen = panel('Study hub', host.back);
  const notice = el('p', 'notice'); notice.setAttribute('role', 'status');
  const select = el('select', 'settings-select'); select.setAttribute('aria-label', 'Study deck');
  const all = el('option', '', 'All active decks'); all.value = ''; select.append(all);
  for (const deck of decks) { const option = el('option', '', deck.name); option.value = deck.id; select.append(option); }
  select.value = selectedDeckId;
  const chosen = () => select.value ? decks.filter(d => d.id === select.value) : decks.filter(d => !d.memorizedFor);
  screen.append(el('p', 'panel-hint', 'Tap a deck on Home for your original swipe review. Choose an optional mode here.'), select);
  const modes: [Mode, string, string][] = [
    ['scheduled', 'Scheduled review', 'Due cards first, then up to 20 new cards. Rate recall to set the next review.'],
    ['difficult', 'Difficult words', 'Practice cards you marked as difficult.'],
    ['reverse', 'English → German', 'Recall the German word from its translation.'],
    ['listening', 'Listening practice', 'Hear the German first, then reveal the word and meaning.'],
  ];
  for (const [mode, title, description] of modes) {
    const b = action('', () => { void practice(host, chosen(), mode).catch(() => { notice.textContent = 'Study could not open. Your cards are unchanged.'; }); }, 'mode-tile');
    b.append(el('strong', '', title), el('span', '', description)); screen.append(b);
  }
  screen.append(action('Browse and edit cards', () => void browseCards(host, chosen()), 'primary-button'));
  const audioBox = el('section', 'storage-summary');
  audioBox.append(el('h2', 'settings-label', 'Deck audio'));
  const coverage = el('p', 'settings-about', 'Checking audio…');
  const progress = el('progress', 'cloud-meter-bar'); progress.max = 1; progress.value = 0; progress.setAttribute('aria-label', 'Audio download progress');
  let controller: AbortController | undefined;
  let disposed = false;
  let check = 0;
  const updateCoverage = async () => {
    const token = ++check;
    const cards = chosen().flatMap(d => d.cards);
    const data = await audioCoverage(cards);
    if (disposed || token !== check) return;
    coverage.textContent = `${data.coveredCards} / ${cards.length} cards have generated audio. ${data.downloaded} / ${data.available} unique clips downloaded (${(data.bytes / 1048576).toFixed(1)} MB).`;
    progress.max = Math.max(1, data.available); progress.value = data.downloaded;
  };
  const download = action('Download available audio', () => void (async () => {
    download.disabled = true; select.disabled = true; cancel.hidden = false;
    controller = new AbortController();
    try {
      await downloadDeckAudio(chosen().flatMap(d => d.cards), (done, total) => { progress.max = Math.max(1, total); progress.value = done; coverage.textContent = `${done} / ${total} clips saved`; }, controller.signal);
      coverage.textContent = 'Download complete.';
    } catch (error) { notice.textContent = controller.signal.aborted ? 'Download paused. Completed clips are kept; tap Download to resume.' : 'Download stopped. Check connection or available storage, then resume.'; }
    finally { download.disabled = false; select.disabled = false; cancel.hidden = true; await updateCoverage().catch(() => {}); }
  })(), 'text-button');
  const cancel = action('Pause download', () => controller?.abort()); cancel.hidden = true;
  select.onchange = () => void updateCoverage().catch(() => { coverage.textContent = 'Audio storage is unavailable.'; });
  audioBox.append(coverage, progress, download, cancel, el('p', 'settings-about', 'Only existing clips are downloaded. Missing words use the device voice. Downloads stay on this device and are not cloud backups. Live preview still needs the computer to open; the installed offline build works without it.'));
  screen.append(audioBox);
  const goalLabel = el('label', 'settings-label', 'Daily review goal'); goalLabel.htmlFor = 'daily-goal';
  const goal = el('input', 'settings-select'); goal.id = 'daily-goal'; goal.type = 'number'; goal.min = '1'; goal.max = '500'; goal.value = String(settings.dailyGoal ?? 20);
  screen.append(goalLabel, goal, action('Save daily goal', () => {
    const value = Number(goal.value);
    if (!Number.isInteger(value) || value < 1 || value > 500) { notice.textContent = 'Choose a goal from 1 to 500.'; return; }
    void (async () => { const latest = await loadSettings(); await host.settingsChanged({ ...latest, dailyGoal: value }); notice.textContent = 'Daily goal saved.'; })().catch(() => { notice.textContent = 'Goal could not be saved.'; });
  }), notice);
  host.show(screen, () => { disposed = true; controller?.abort(); });
  void updateCoverage().catch(() => { coverage.textContent = 'Audio storage is unavailable.'; });
}

async function practice(host: Host, decks: Deck[], mode: Mode) {
  const settings = await loadSettings();
  let entries = decks.flatMap(deck => deck.cards.map(card => ({ deck, card })));
  const now = Date.now();
  if (mode === 'scheduled') {
    entries = entries.filter(e => !e.deck.memorizedFor);
    entries = [...entries.filter(e => e.card.schedule && e.card.schedule.due <= now).sort((a, b) => a.card.schedule!.due - b.card.schedule!.due), ...entries.filter(e => !e.card.schedule).slice(0, 20)];
  } else if (mode === 'difficult') entries = entries.filter(e => e.card.difficult);
  const title = { scheduled: 'Scheduled review', difficult: 'Difficult words', reverse: 'English → German', listening: 'Listening practice' }[mode];
  const screen = panel(title, () => void studyHub(host));
  const status = el('p', 'panel-hint');
  const face = el('button', 'practice-card'); face.type = 'button'; face.setAttribute('aria-label', 'Study card, tap to reveal');
  const reveal = action('Reveal answer', () => { revealed = true; render(); }, 'primary-button');
  const sourceLabel = el('p', 'settings-about');
  sourceLabel.setAttribute('aria-live', 'polite');
  const hear = action('Hear German', () => { if (entries[index]) pronounce(plainText(entries[index].card.front), settings, source => { sourceLabel.textContent = source; }); });
  const ratings = el('div', 'rating-grid');
  const error = el('p', 'notice'); error.setAttribute('role', 'status');
  let index = 0, revealed = false, busy = false, disposed = false;
  const media = new Map<string, Map<string, string>>();
  const mediaUrls: string[] = [];
  const advance = async (rating?: Rating) => {
    if (busy || !entries[index]) return;
    busy = true; screen.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const entry = entries[index];
    try {
      if (rating) entry.card.schedule = await rateCard(entry.deck.id, entry.card.id, rating);
      else await recordActivity(entry.deck.id);
      host.changed(); stopPronunciation(); index++; revealed = false;
      if (!disposed) render();
    } catch { error.textContent = 'This review could not be saved. Try again.'; }
    finally { busy = false; screen.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  };
  face.onclick = () => { if (!busy) { revealed = true; render(); } };
  function render() {
    const entry = entries[index]; ratings.replaceChildren();
    if (!entry) {
      status.textContent = entries.length ? `Completed ${entries.length} reviews. “Again” cards return after one minute.` : 'No matching cards right now. New and due cards exclude Memorized decks; mark difficult cards in the editor.';
      face.hidden = true; reveal.hidden = true; hear.hidden = true; sourceLabel.hidden = true;
      ratings.append(action('Back to study hub', () => void studyHub(host), 'primary-button')); return;
    }
    status.textContent = `${index + 1} / ${entries.length} · ${entry.deck.name}`;
    const question = mode === 'reverse' ? entry.card.back : entry.card.front;
    sourceLabel.textContent = pronunciationSource(plainText(entry.card.front), settings);
    const answer = mode === 'reverse' ? entry.card.front : entry.card.back;
    face.replaceChildren();
    if (!revealed && mode === 'listening') face.append(el('p', '', 'Listen, then reveal'));
    else {
      const content = el('div'); content.innerHTML = cardContent(revealed ? answer : question, media.get(entry.deck.id) ?? new Map()).html; face.append(content);
      if (revealed) {
        face.append(el('p', 'practice-question', plainText(question)));
        if (entry.card.example) face.append(el('p', 'practice-example', entry.card.example));
        const grammar = grammarPanel(entry.card.front);
        if (grammar) face.append(grammar);
        if (entry.card.tags?.length) face.append(el('p', 'settings-about', entry.card.tags.join(' · ')));
      }
    }
    reveal.hidden = revealed;
    if (revealed && mode === 'scheduled') for (const [value, label] of [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']] as [Rating, string][]) {
      const schedule = nextSchedule(entry.card.schedule, value);
      ratings.append(action(`${label} · ${value === 'again' ? '1 min' : `${schedule.intervalDays}d`}`, () => void advance(value), `rating rating-${value}`));
    }
    else if (revealed) ratings.append(action('Next card', () => void advance(), 'primary-button'));
  }
  screen.append(status, face, hear, sourceLabel, reveal, ratings, error, el('p', 'settings-about', 'This mode keeps cards in their decks. Use Home for left-to-repeat / right-to-Memorized swipe review.'));
  host.show(screen, () => { disposed = true; stopPronunciation(); mediaUrls.forEach(url => URL.revokeObjectURL(url)); }); render();
  void warmAudio(entries.map(e => e.card)).catch(() => {});
  void (async () => {
    for (const deck of decks) {
      const files = await mediaForDeck(deck);
      if (disposed) return;
      media.set(deck.id, new Map(files.map(file => {
        const url = URL.createObjectURL(new Blob([file.data], { type: file.mime })); mediaUrls.push(url); return [file.name, url];
      })));
    }
    if (!disposed && !busy) render();
  })().catch(() => {});
}

async function browseCards(host: Host, chosen: Deck[]) {
  const ids = new Set(chosen.map(d => d.id));
  const decks = (await loadDecks()).filter(d => ids.has(d.id));
  const screen = panel('Edit cards', () => void studyHub(host));
  const search = el('input', 'settings-select'); search.type = 'search'; search.placeholder = 'Search words, translations or tags'; search.setAttribute('aria-label', 'Search cards');
  const list = el('div', 'card-editor-list');
  let limit = 50;
  const entries = decks.flatMap(deck => deck.cards.map(card => ({ deck, card })));
  const render = () => {
    const query = search.value.toLocaleLowerCase();
    const matches = entries.filter(e => `${plainText(e.card.front)} ${plainText(e.card.back)} ${e.card.tags?.join(' ') ?? ''}`.toLocaleLowerCase().includes(query));
    list.replaceChildren(el('p', 'settings-about', `${matches.length} matching cards`));
    for (const entry of matches.slice(0, limit)) {
      const b = action('', () => editEntry(host, entry, () => void browseCards(host, chosen)), 'mode-tile');
      b.append(el('strong', '', `${entry.card.difficult ? '★ ' : ''}${plainText(entry.card.front)}`), el('span', '', plainText(entry.card.back).slice(0, 160))); list.append(b);
    }
    if (matches.length > limit) list.append(action('Show 50 more', () => { limit += 50; render(); }));
  };
  search.oninput = () => { limit = 50; render(); };
  screen.append(search, list); host.show(screen); render();
}
function editEntry(host: Host, entry: Entry, back: () => void) {
  const screen = panel('Edit card', back);
  const form = el('form');
  const field = (title: string, value: string) => {
    const label = el('label', 'editor-field', title);
    const input = el('textarea', 'feedback-input'); input.value = value; input.maxLength = 12000;
    label.append(input); form.append(label); return input;
  };
  const front = field('German', plainText(entry.card.front));
  const backText = field('Meaning', plainText(entry.card.back));
  const example = field('Example sentence', entry.card.example ?? '');
  const tags = field('Tags (comma separated)', entry.card.tags?.join(', ') ?? '');
  const difficult = el('input'); difficult.type = 'checkbox'; difficult.checked = !!entry.card.difficult;
  const label = el('label', 'audio-preference'); label.append(difficult, document.createTextNode('Mark as difficult')); form.append(label);
  const status = el('p', 'notice'); status.setAttribute('role', 'status');
  const save = action('Save card', () => form.requestSubmit(), 'primary-button');
  const escape = (text: string) => { const div = el('div', '', text); return div.innerHTML.replace(/\n/g, '<br>'); };
  form.onsubmit = event => {
    event.preventDefault();
    if (!front.value.trim() || !backText.value.trim()) { status.textContent = 'German and meaning cannot be empty.'; return; }
    save.disabled = true;
    void editCard(entry.deck.id, entry.card.id, {
      front: front.value === plainText(entry.card.front) ? entry.card.front : escape(front.value.trim()),
      back: backText.value === plainText(entry.card.back) ? entry.card.back : escape(backText.value.trim()),
      example: example.value.trim(), tags: [...new Set(tags.value.split(',').map(s => s.trim()).filter(Boolean))].slice(0, 30), difficult: difficult.checked,
    }).then(() => { host.changed(); back(); }).catch(() => { save.disabled = false; status.textContent = 'Card could not be saved. Try again.'; });
  };
  screen.append(el('p', 'panel-hint', 'Editing a text field replaces its formatting with plain text. Unchanged fields keep their formatting and media. Changing German text may use the device voice until new audio is generated.'), form, save, status);
  host.show(screen);
}

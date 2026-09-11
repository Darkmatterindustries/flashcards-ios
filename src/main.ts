import './style.css';
import {
  loadDecks, saveImport, saveReviewed, mediaForDeck, moveToMemorized, moveBackFromMemorized, unmarkReviewed,
  saveSessionState, setDeckShuffle, renameDeck, deleteDeck, loadSettings, saveSettings, resetProgress, wipeAllDecks,
  replaceAllDecks,
} from './storage';
import { defaultSettings, type AppSettings, type Card, type Deck, type ImportResult, type ThemePreference } from './model';
import { StudySession } from './session';
import { cardContent } from './content';
import { importFile } from './import/client';
import {
  cloudAvailable, onAuthChange, signUp, signIn, signOutUser, pushAllDecks, pushSettings,
  removeDeckFromCloud, clearAllCloudDecks, pullAll, type User,
} from './cloud';

const APP_VERSION = '1.0 (1)';
const app = document.querySelector<HTMLElement>('#app')!;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let cleanup = () => {};
let pendingNotice = '';
let currentSettings: AppSettings = defaultSettings;
let currentUser: User | null = null;

async function syncAllToCloud() {
  if (!currentUser) return;
  try {
    await currentUser.getIdToken();
    const decks = await loadDecks();
    await pushAllDecks(currentUser.uid, decks);
    await pushSettings(currentUser.uid, currentSettings);
  } catch { /* best-effort background sync */ }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

function button(text: string, className: string, action: (event: MouseEvent) => void) {
  const result = element('button', className, text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}

function setScreen(screen: HTMLElement) {
  cleanup(); cleanup = () => {};
  app.replaceChildren(screen);
}

/** Strips markup from a card face so it can be spoken; never inserted into the page. */
function plainText(html: string) {
  const holder = document.createElement('div');
  holder.innerHTML = html.replace(/<br\s*\/?>/gi, ' ');
  return (holder.textContent || '').replace(/\s+/g, ' ').trim();
}

function speak(text: string) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = currentSettings.speechRate;
  const voice = currentSettings.voiceURI
    ? speechSynthesis.getVoices().find(candidate => candidate.voiceURI === currentSettings.voiceURI)
    : undefined;
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function applyTheme(theme: ThemePreference) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A small bottom sheet for renaming or deleting one deck; closes on backdrop tap. */
function openDeckMenu(deck: Deck, onChanged: () => void) {
  const backdrop = element('div', 'sheet-backdrop');
  const sheet = element('div', 'sheet');
  backdrop.append(sheet);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  document.body.append(backdrop);
  function close() { backdrop.remove(); }
  function showMenu() {
    sheet.replaceChildren(
      element('p', 'sheet-title', deck.name),
      button('Rename', 'sheet-action', showRenameForm),
      button('Delete deck', 'sheet-action danger', showDeleteConfirm),
      button('Cancel', 'sheet-action cancel', close),
    );
  }
  function showRenameForm() {
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'sheet-input'; input.maxLength = 120; input.value = deck.name;
    sheet.replaceChildren(
      element('p', 'sheet-title', 'Rename deck'),
      input,
      button('Save', 'sheet-action', async () => {
        const name = input.value.trim();
        if (name && name !== deck.name) { await renameDeck(deck.id, name); onChanged(); }
        close();
      }),
      button('Cancel', 'sheet-action cancel', showMenu),
    );
    input.focus(); input.select();
  }
  function showDeleteConfirm() {
    sheet.replaceChildren(
      element('p', 'sheet-title', `Delete “${deck.name}”? This can’t be undone.`),
      button('Delete', 'sheet-action danger', async () => {
        await deleteDeck(deck.id);
        if (currentUser) {
          void removeDeckFromCloud(currentUser.uid, deck.id).catch(() => {});
          void removeDeckFromCloud(currentUser.uid, `${deck.id}::memorized`).catch(() => {});
        }
        onChanged(); close();
      }),
      button('Cancel', 'sheet-action cancel', showMenu),
    );
  }
  showMenu();
}

function navButton(label: string, icon: string, active: boolean, action: () => void) {
  const result = button('', `nav-button${active ? ' active' : ''}`, action);
  result.innerHTML = `${icon}<span>${label}</span>`;
  result.setAttribute('aria-current', active ? 'page' : 'false');
  return result;
}

const ICONS = {
  feedback: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h5v-5h2v5h5v-9"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7M18.1 18.1l-1.7-1.7M7.6 7.6 5.9 5.9"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17h3l9-11h4"/><path d="M4 7h3l2.5 3"/><path d="M14.5 14 16 15.8"/><path d="M17 4l3 2-3 2"/><path d="M17 16l3 2-3 2"/></svg>',
};

function navBar(active: 'home' | 'settings') {
  const nav = element('nav', 'nav-bar');
  nav.setAttribute('aria-label', 'Main');
  nav.append(
    navButton('Feedback', ICONS.feedback, false, () => void feedbackScreen()),
    navButton('Home', ICONS.home, active === 'home', () => { if (active !== 'home') void library(); }),
    navButton('Settings', ICONS.settings, active === 'settings', () => { if (active !== 'settings') void settingsScreen(); }),
  );
  return nav;
}

async function feedbackScreen() {
  const screen = element('section', 'panel');
  const header = element('header', 'panel-header');
  header.append(button('Back', 'back-button', () => void library()), element('h1', '', 'Feedback'));
  const hint = element('p', 'panel-hint', 'Tell us what to fix or add. This opens your Mail app with your note ready to send.');
  const input = document.createElement('textarea');
  input.className = 'feedback-input';
  input.rows = 8;
  input.placeholder = 'What should we improve?';
  const send = button('Open in Mail', 'primary-button', () => {
    const subject = encodeURIComponent('Flashcards App Feedback');
    const body = encodeURIComponent(input.value.trim());
    location.href = `mailto:?subject=${subject}&body=${body}`;
  });
  screen.append(header, hint, input, send);
  setScreen(screen);
  cleanup = () => {};
}

async function settingsScreen() {
  currentSettings = await loadSettings();
  const screen = element('section', 'panel');
  const header = element('header', 'panel-header');
  header.append(button('Back', 'back-button', () => void library()), element('h1', '', 'Settings'));
  screen.append(header);

  const voiceGroup = element('div', 'settings-group');
  voiceGroup.append(element('h2', 'settings-label', 'Pronunciation'));
  const speechSupported = 'speechSynthesis' in window;
  let populateVoices = () => {};
  if (speechSupported) {
    const voiceSelect = document.createElement('select');
    voiceSelect.className = 'settings-select';
    populateVoices = () => {
      const voices = speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('de'));
      const selected = currentSettings.voiceURI;
      voiceSelect.replaceChildren();
      const auto = document.createElement('option');
      auto.value = ''; auto.textContent = 'Automatic (system default)';
      voiceSelect.append(auto);
      for (const voice of voices) {
        const option = document.createElement('option');
        option.value = voice.voiceURI; option.textContent = voice.name;
        voiceSelect.append(option);
      }
      voiceSelect.value = voices.some(voice => voice.voiceURI === selected) ? selected : '';
    };
    populateVoices();
    speechSynthesis.addEventListener('voiceschanged', populateVoices);
    voiceSelect.addEventListener('change', () => {
      currentSettings = { ...currentSettings, voiceURI: voiceSelect.value };
      void saveSettings(currentSettings);
    });
    const rateLabel = element('p', 'settings-rate-label', 'Speaking speed');
    const rateInput = document.createElement('input');
    rateInput.type = 'range'; rateInput.className = 'settings-range';
    rateInput.min = '0.6'; rateInput.max = '1.4'; rateInput.step = '0.05';
    rateInput.value = String(currentSettings.speechRate);
    rateInput.addEventListener('change', () => {
      currentSettings = { ...currentSettings, speechRate: Number(rateInput.value) };
      void saveSettings(currentSettings);
    });
    const test = button('Test voice', 'text-button', () => speak('der Entwurf'));
    voiceGroup.append(voiceSelect, rateLabel, rateInput, test);
  } else {
    voiceGroup.append(element('p', 'settings-about', 'Pronunciation isn’t supported in this browser preview, but it works on your iPhone.'));
  }

  const themeGroup = element('div', 'settings-group');
  themeGroup.append(element('h2', 'settings-label', 'Appearance'));
  const themeRow = element('div', 'segmented');
  const themeOptions: [ThemePreference, string][] = [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];
  for (const [value, label] of themeOptions) {
    const segment = button(label, `segment${currentSettings.theme === value ? ' active' : ''}`, () => {
      currentSettings = { ...currentSettings, theme: value };
      void saveSettings(currentSettings);
      applyTheme(value);
      themeRow.querySelectorAll('.segment').forEach(el => el.classList.remove('active'));
      segment.classList.add('active');
    });
    themeRow.append(segment);
  }
  themeGroup.append(themeRow);

  const dataGroup = element('div', 'settings-group');
  dataGroup.append(element('h2', 'settings-label', 'Data'));
  const confirmThenRun = (target: HTMLButtonElement, label: string, run: () => Promise<void>) => {
    if (target.dataset.confirm === '1') {
      target.disabled = true; target.textContent = 'Working…';
      void run().then(() => { pendingNotice = `${label} — done.`; void library(); })
        .catch(() => { target.disabled = false; target.textContent = label; delete target.dataset.confirm; target.classList.remove('confirming'); });
      return;
    }
    target.dataset.confirm = '1';
    target.textContent = 'Tap again to confirm';
    target.classList.add('confirming');
    setTimeout(() => {
      if (target.dataset.confirm === '1') { delete target.dataset.confirm; target.textContent = label; target.classList.remove('confirming'); }
    }, 3000);
  };
  const resetLabel = 'Reset study progress';
  const resetButton = button(resetLabel, 'danger-button', () => confirmThenRun(resetButton, resetLabel, resetProgress));
  const wipeLabel = 'Delete all decks';
  const wipeButton = button(wipeLabel, 'danger-button', () => confirmThenRun(wipeButton, wipeLabel, async () => {
    await wipeAllDecks();
    if (currentUser) void clearAllCloudDecks(currentUser.uid).catch(() => {});
  }));
  dataGroup.append(resetButton, wipeButton);

  const accountGroup = element('div', 'settings-group');
  accountGroup.append(element('h2', 'settings-label', 'Account & backup'));
  if (!cloudAvailable()) {
    accountGroup.append(element('p', 'settings-about', 'Cloud backup isn’t set up for this build yet.'));
  } else if (currentUser) {
    const status = element('p', 'settings-about', `Signed in as ${currentUser.email}\nYour decks and progress back up automatically.`);
    const syncButton = button('Sync now', 'text-button', async () => {
      syncButton.disabled = true; syncButton.textContent = 'Syncing…';
      await syncAllToCloud();
      syncButton.disabled = false; syncButton.textContent = 'Sync now';
    });
    const signOutButton = button('Sign out', 'danger-button', async () => { await signOutUser(); void settingsScreen(); });
    accountGroup.append(status, syncButton, signOutButton);
  } else {
    const emailInput = document.createElement('input');
    emailInput.type = 'email'; emailInput.className = 'settings-select'; emailInput.placeholder = 'Email'; emailInput.autocomplete = 'email';
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password'; passwordInput.className = 'settings-select'; passwordInput.placeholder = 'Password (6+ characters)'; passwordInput.autocomplete = 'current-password';
    const status = element('p', 'settings-about', '');
    const attempt = (run: (email: string, password: string) => Promise<void>) => async () => {
      status.textContent = 'Working…';
      try { await run(emailInput.value.trim(), passwordInput.value); status.textContent = ''; void settingsScreen(); }
      catch (error) { status.textContent = error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
    };
    const loginButton = button('Log in', 'primary-button', attempt(async (email, password) => { await signIn(email, password); await resolveSignIn(); }));
    const signupButton = button('Create account', 'text-button', attempt(async (email, password) => { await signUp(email, password); await resolveSignIn(); }));
    accountGroup.append(
      element('p', 'settings-about', 'Sign in to back up your decks and progress, and restore them after reinstalling.'),
      emailInput, passwordInput, loginButton, signupButton, status,
    );
  }

  const aboutGroup = element('div', 'settings-group');
  aboutGroup.append(element('h2', 'settings-label', 'About'), element('p', 'settings-about', `Flashcards — version ${APP_VERSION}\nImport-only vocabulary study, built for iPhone.`));

  screen.append(voiceGroup, themeGroup, dataGroup, accountGroup, aboutGroup);
  setScreen(screen);
  if (speechSupported) cleanup = () => speechSynthesis.removeEventListener('voiceschanged', populateVoices);
}

/** After sign-in: silently restore an empty device from the cloud, otherwise ask which copy to keep. */
async function resolveSignIn() {
  if (!currentUser) return;
  const uid = currentUser.uid;
  // Right after sign-in/sign-up, Firestore's first request can race the auth
  // token becoming available and get rejected even with correct rules.
  // Forcing a fresh token first ensures it's actually attached.
  await currentUser.getIdToken();
  const [localDecks, cloud] = await Promise.all([loadDecks(), pullAll(uid)]);
  if (!cloud.decks.length) { void syncAllToCloud(); return; }
  const applyCloud = async () => {
    await replaceAllDecks(cloud.decks as Deck[]);
    if (cloud.settings) { currentSettings = cloud.settings; await saveSettings(currentSettings); applyTheme(currentSettings.theme); }
    pendingNotice = 'Restored your decks and progress from the cloud.';
    void library();
  };
  const localIsFresh = localDecks.length === 1 && localDecks[0].id === 'starter' && localDecks[0].reviewed.length === 0;
  if (localIsFresh) { await applyCloud(); return; }
  openConflictSheet(() => void syncAllToCloud(), () => void applyCloud());
}

function openConflictSheet(keepLocal: () => void, useCloud: () => void) {
  const backdrop = element('div', 'sheet-backdrop');
  const sheet = element('div', 'sheet');
  sheet.append(
    element('p', 'sheet-title', 'This account already has a backup, and this device also has its own decks. Which should we keep?'),
    button('Use the cloud backup', 'sheet-action danger', () => { backdrop.remove(); useCloud(); }),
    button('Keep this device’s decks', 'sheet-action', () => { backdrop.remove(); keepLocal(); }),
  );
  backdrop.append(sheet);
  document.body.append(backdrop);
}

function deckTile(deck: Deck) {
  const tile = element('div', 'deck-tile');
  const main = button('', 'deck-tile-main', () => void study(deck));
  const row = element('div', 'deck-row');
  row.append(element('h2', '', deck.name), element('span', 'deck-count', `${deck.cards.length} cards`));
  const reviewed = Math.min(deck.reviewed.length, deck.cards.length);
  const track = element('div', 'progress-track');
  track.setAttribute('aria-hidden', 'true');
  const fill = element('div', 'progress-fill');
  fill.style.width = `${deck.cards.length ? reviewed / deck.cards.length * 100 : 0}%`;
  track.append(fill);
  const resumeNote = deck.activeSession ? element('p', 'resume-note', 'Tap to resume') : undefined;
  main.append(row, element('p', 'reviewed', `${reviewed} reviewed`), track);
  if (resumeNote) main.append(resumeNote);
  main.setAttribute('aria-label', `${deck.name}, ${deck.cards.length} cards, ${reviewed} reviewed${deck.activeSession ? ', session in progress' : ''}. Start studying.`);
  const controls = element('div', 'tile-controls');
  const shuffleButton = button('', `tile-icon-button${deck.shuffle ? ' shuffle-active' : ''}`, event => {
    event.stopPropagation();
    void setDeckShuffle(deck.id, !deck.shuffle).then(() => void library());
  });
  shuffleButton.innerHTML = ICONS.shuffle;
  shuffleButton.setAttribute('aria-pressed', String(!!deck.shuffle));
  shuffleButton.setAttribute('aria-label', `${deck.shuffle ? 'Disable' : 'Enable'} shuffle for ${deck.name}`);
  const menuButton = button('', 'tile-icon-button', event => { event.stopPropagation(); openDeckMenu(deck, () => void library()); });
  menuButton.innerHTML = ICONS.menu;
  menuButton.setAttribute('aria-label', `More options for ${deck.name}`);
  controls.append(shuffleButton, menuButton);
  tile.append(main, controls);
  return tile;
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
    const search = document.createElement('input');
    search.type = 'search'; search.className = 'search-input'; search.placeholder = 'Search decks';
    search.setAttribute('aria-label', 'Search decks');
    const list = element('div', 'deck-list');
    const empty = element('p', 'library-hint', 'No decks match your search.');
    const renderList = (query: string) => {
      const needle = query.trim().toLowerCase();
      const matches = needle ? decks.filter(deck => deck.name.toLowerCase().includes(needle)) : decks;
      list.replaceChildren(...matches.map(deckTile));
      empty.textContent = decks.length === 0 ? 'No decks yet. Import one to get started.' : 'No decks match your search.';
      empty.style.display = matches.length ? 'none' : '';
    };
    renderList('');
    search.addEventListener('input', () => renderList(search.value));
    const hint = element('p', 'library-hint', 'Tap to flip. Left to repeat. Right to memorize.\nSwipe down to return to your decks.');
    const notice = element('p', 'notice', pendingNotice);
    notice.setAttribute('role', 'status');
    pendingNotice = '';
    screen.append(header, search, list, empty, hint, notice, navBar('home'));
    setScreen(screen);
    if (currentUser) void syncAllToCloud();
    let active = true;
    cleanup = () => { active = false; };
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      importButton.disabled = true;
      list.querySelectorAll('button').forEach(tile => tile.disabled = true);
      importButton.textContent = 'Reading…';
      screen.setAttribute('aria-busy', 'true');
      notice.textContent = 'Reading your deck…';
      try {
        const result = await importFile(file);
        if (!active) return;
        void importPreview(result);
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

async function importPreview(result: ImportResult) {
  const screen = element('section', 'panel');
  const header = element('header', 'panel-header');
  header.append(button('Cancel', 'back-button', () => void library()), element('h1', '', 'Import preview'));
  const totalCards = result.decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const hint = element('p', 'panel-hint', `${result.decks.length} deck${result.decks.length === 1 ? '' : 's'}, ${totalCards} card${totalCards === 1 ? '' : 's'} total.`);
  const deckList = element('div', 'preview-deck-list');
  for (const deck of result.decks) {
    const row = element('div', 'preview-deck-row');
    row.append(element('span', '', deck.name), element('span', 'deck-count', `${deck.cards.length} cards`));
    deckList.append(row);
  }
  screen.append(header, hint, deckList);
  if (result.warnings.length) {
    const warnGroup = element('div', 'settings-group');
    warnGroup.append(element('h2', 'settings-label', 'Compatibility notes'));
    const warnList = element('ul', 'preview-warnings');
    for (const warning of result.warnings) warnList.append(element('li', '', warning));
    warnGroup.append(warnList);
    screen.append(warnGroup);
  }
  const confirm = button(`Import ${totalCards} card${totalCards === 1 ? '' : 's'}`, 'primary-button', async () => {
    confirm.disabled = true; confirm.textContent = 'Importing…';
    try {
      const saved = await saveImport(result);
      pendingNotice = saved
        ? `Imported ${totalCards} cards in ${result.decks.length} deck${result.decks.length === 1 ? '' : 's'}.`
        : 'This package is already in your library.';
    } catch (error) {
      pendingNotice = error instanceof DOMException
        ? (error.name === 'QuotaExceededError' ? 'There isn’t enough space for this deck. Free up some storage and try again.' : 'The deck could not be saved. Please reopen the app and try again.')
        : error instanceof Error ? error.message : 'The deck could not be saved. Please try again.';
    }
    void library();
  });
  screen.append(confirm, button('Cancel', 'text-button', () => void library()));
  setScreen(screen);
}

async function study(deck: Deck) {
  // A fresh session locks in shuffle order immediately (persisted below) so
  // resuming later never reshuffles; a resumed session reuses its saved order.
  const orderedCards = deck.activeSession ? deck.cards : (deck.shuffle ? shuffle([...deck.cards]) : deck.cards);
  const session = new StudySession(orderedCards, deck.activeSession);
  // A "Memorized" companion deck just studies normally; only a primary deck
  // relocates swiped-right cards into its companion.
  const isMemorizedDeck = !!deck.memorizedFor;
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
  const speechSupported = 'speechSynthesis' in window;
  const speakButton = speechSupported ? element('button', 'speak-button', '') : undefined;
  if (speakButton) {
    speakButton.type = 'button';
    speakButton.setAttribute('aria-label', 'Hear pronunciation');
    speakButton.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3z"/><path d="M16.3 12c0-1.5-.8-2.8-2-3.4v6.8c1.2-.6 2-1.9 2-3.4z"/><path d="M14.3 4.6v2.1c2.3.8 4 3 4 5.3s-1.7 4.5-4 5.3v2.1c3.4-.9 6-4 6-7.4s-2.6-6.5-6-7.4z"/></svg>';
  }
  shell.append(card, count);
  if (speakButton) shell.append(speakButton);
  const rightSwipeLabel = isMemorizedDeck ? 'Remove card from this session' : 'Move card to Memorized deck';
  const instructions = element('p', 'sr-only', `Tap to flip. Swipe left to repeat, right to ${isMemorizedDeck ? 'remove' : 'memorize'}, or down to return to your decks. With a keyboard, use Enter to flip, arrow keys to sort, and Escape to leave.`);
  instructions.id = 'study-instructions';
  const accessibleActions = element('div', 'sr-only');
  const toast = element('div', 'toast');
  const toastMessage = element('span', 'toast-message');
  const toastUndo = button('Undo', 'toast-undo', () => performUndo());
  toast.append(toastMessage, toastUndo);
  accessibleActions.append(
    button('Keep card in loop', '', () => void swipe('left')),
    button(rightSwipeLabel, '', () => void swipe('right')),
    button('Undo last swipe', '', () => performUndo()),
    button('Return to your decks', '', () => void leave()),
  );
  screen.append(shell, instructions, accessibleActions, toast);
  setScreen(screen);
  let disposed = false, busy = false, flipped = false;
  let pendingUndo: { card: Card; direction: 'left' | 'right'; movedToMemorized: boolean } | undefined;
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
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
  speakButton?.addEventListener('pointerdown', event => event.stopPropagation());
  speakButton?.addEventListener('click', event => {
    event.stopPropagation();
    if (busy || disposed || !session.current) return;
    speak(plainText(session.current.front));
  });
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
  const persistSession = async () => {
    try { await saveSessionState(deck.id, session.remaining ? session.snapshot : undefined); }
    catch { /* resume state is best-effort */ }
  };
  function hideUndo() {
    clearTimeout(undoTimer);
    pendingUndo = undefined;
    toast.classList.remove('visible');
  }
  function showUndo(card: Card, direction: 'left' | 'right', movedToMemorized: boolean) {
    clearTimeout(undoTimer);
    pendingUndo = { card, direction, movedToMemorized };
    toastMessage.textContent = direction === 'left' ? 'Card requeued.' : movedToMemorized ? 'Card memorized.' : 'Card removed from this session.';
    toast.classList.add('visible');
    undoTimer = setTimeout(hideUndo, 4000);
  }
  function performUndo() {
    if (!pendingUndo || disposed) return;
    const { card: swipedCard, direction, movedToMemorized } = pendingUndo;
    hideUndo();
    session.undoLast(swipedCard, direction);
    void persistSession();
    void unmarkReviewed(deck.id, swipedCard.id).catch(() => {});
    if (movedToMemorized) void moveBackFromMemorized(deck.id, swipedCard.id).catch(() => { pendingNotice = 'That card could not be restored. Please try again.'; });
    busy = false;
    card.classList.add('no-motion');
    render();
    shell.style.transition = 'none';
    shell.style.transform = 'none';
    shell.style.opacity = '1';
    void card.offsetWidth;
    card.classList.remove('no-motion');
  }
  async function leave() {
    if (busy || disposed) return;
    busy = true;
    await persist();
    if (!disposed) void library();
  }
  async function swipe(direction: 'left' | 'right') {
    if (busy || disposed || !session.current) return;
    busy = true;
    hideUndo();
    stopAudio();
    if (speechSupported) speechSynthesis.cancel();
    shell.style.transition = reduceMotion.matches ? 'none' : 'transform 180ms ease-out, opacity 180ms ease-out';
    shell.style.transform = `translateX(${direction === 'left' ? '-110' : '110'}vw) rotate(${direction === 'left' ? '-8' : '8'}deg)`;
    shell.style.opacity = '0';
    timer = setTimeout(() => {
      if (disposed) return;
      const swiped = session.current!;
      session.swipe(direction);
      void persist();
      void persistSession();
      const movedToMemorized = direction === 'right' && !isMemorizedDeck;
      if (movedToMemorized) void moveToMemorized(deck.id, swiped.id).catch(() => { pendingNotice = 'That card could not be moved to your Memorized deck. Please try again.'; });
      if (!session.remaining) { void complete(); return; }
      showUndo(swiped, direction, movedToMemorized);
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); performUndo(); return; }
    if (event.repeat) return;
    if (event.key === 'Enter' || event.key === ' ') flip();
    else if (event.key === 'ArrowLeft') void swipe('left');
    else if (event.key === 'ArrowRight') void swipe('right');
    else if (event.key === 'Escape' || event.key === 'ArrowDown') void leave();
  };
  window.addEventListener('keydown', keydown);
  cleanup = () => {
    disposed = true; clearTimeout(timer); clearTimeout(undoTimer); stopAudio();
    if (speechSupported) speechSynthesis.cancel();
    media.clear();
    window.removeEventListener('keydown', keydown);
  };
  render();
  void persistSession();
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

async function bootstrap() {
  currentSettings = await loadSettings();
  applyTheme(currentSettings.theme);
  onAuthChange(user => { currentUser = user; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncAllToCloud();
  });
  await library();
}
void bootstrap();

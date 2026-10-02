import './style.css';
import { Capacitor } from '@capacitor/core';
import {
  loadDecks, saveImport, saveReviewed, mediaForDeck, moveToMemorized, moveBackFromMemorized, unmarkReviewed,
  saveSessionState, setDeckShuffle, renameDeck, deleteDeck, loadSettings, saveSettings, resetProgress, wipeAllDecks,
  replaceAllDecks, storageSummary, loadBackupStatus, saveBackupStatus, getLastModified, recordActivity,
} from './storage';
import { defaultSettings, type AppSettings, type BackgroundPreference, type Card, type Deck, type ImportResult, type ThemePreference } from './model';
import { StudySession } from './session';
import { cardContent } from './content';
import { importFile } from './import/client';
import { pronounce, stopPronunciation, recordingCount, pronunciationSource } from './pronunciation';
import { plainText } from './speech-text';
import { grammarPanel } from './grammar';
import { ambientScene } from './ambient';
import { exportDeckToApkg, apkgFileName } from './export';
import { shareDeckFile } from './share-deck';
import { startUsageTracking, setUsageUser, syncUsage, usagePanel } from './usage';
import { dailyDashboard, studyHub } from './v3';
import { warmAudio } from './offline-audio';
import generatedAudioSummary from './generated-audio-summary.json';
import {
  cloudAvailable, onAuthChange, signUp, signIn, signOutUser, pushAllDecks, pushSettings,
  removeDeckFromCloud, clearAllCloudDecks, pullAll, cloudStorageUsage, type User,
} from './cloud';

const APP_VERSION = '3.0';
const app = document.querySelector<HTMLElement>('#app')!;
if (Capacitor.getPlatform() === 'android') {
  void import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
    const sheet = document.querySelector<HTMLElement>('.sheet-backdrop');
    if (sheet) sheet.click();
    else if (document.querySelector('.study')) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else {
      const back = app.querySelector<HTMLButtonElement>('.back-button');
      if (back) back.click();
      else void App.minimizeApp();
    }
  }));
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let cleanup = () => {};
let pendingNotice = '';
let currentSettings: AppSettings = defaultSettings;
let currentUser: User | null = null;
let preferenceStatus = '';
let cloudUsageCache: { uid: string; usage: Awaited<ReturnType<typeof cloudStorageUsage>> } | undefined;
let preferenceQueue: Promise<void> = Promise.resolve();
let backupInFlight: Promise<string> | undefined;
function reportPreferences(message: string) {
  preferenceStatus = message;
  document.querySelectorAll('.preference-sync-status').forEach(el => { el.textContent = message; });
}
function persistPreferences() {
  const settings = { ...currentSettings };
  const user = currentUser;
  reportPreferences('Saving settings…');
  preferenceQueue = preferenceQueue.then(async () => {
    try { await saveSettings(settings); }
    catch { reportPreferences('Settings could not be saved on this device. Check available storage.'); return; }
    if (!user) { reportPreferences('Settings saved on this device. Sign in for cloud backup.'); return; }
    try {
      await pushSettings(user.uid, settings);
      reportPreferences('Settings saved on this device and backed up to the cloud.');
    } catch { reportPreferences('Settings saved on this device. Cloud backup failed—check your connection and try Sync now.'); }
  });
  return preferenceQueue;
}

function syncAllToCloud(): Promise<string> {
  return backupInFlight ??= performCloudBackup().finally(() => { backupInFlight = undefined; });
}
async function performCloudBackup() {
  if (!currentUser) return 'Sign in to back up your data.';
  const user = currentUser;
  const syncedThrough = await getLastModified();
  await saveBackupStatus({ ...(await loadBackupStatus()), lastAttemptAt: Date.now() });
  try {
    await user.getIdToken();
    const decks = await loadDecks();
    await pushAllDecks(user.uid, decks);
    await preferenceQueue;
    await pushSettings(user.uid, currentSettings);
    await syncUsage();
    const now = Date.now();
    await saveBackupStatus({ lastSuccessAt: now, lastAttemptAt: now, lastError: undefined, syncedThrough, userId: user.uid });
    return `Backup completed at ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Decks, progress and settings were uploaded.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup failed';
    await saveBackupStatus({ ...(await loadBackupStatus()), lastAttemptAt: Date.now(), lastError: message });
    return 'Backup did not complete. Check your connection and try again. Your local data is still available.';
  }
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
  stopPronunciation();
  cleanup(); cleanup = () => {};
  app.replaceChildren(screen);
  screen.querySelectorAll('.card-face').forEach(face => face.prepend(ambientScene()));
}

function speak(text: string) {
  pronounce(text, currentSettings);
}

function applyTheme(theme: ThemePreference) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.dataset.background = currentSettings.background ?? 'none';
  document.documentElement.dataset.backgroundMotion = currentSettings.backgroundMotion === false ? 'off' : 'on';
  if (!document.body.querySelector(':scope > .ambient-scene')) document.body.prepend(ambientScene());
  const intensity = currentSettings.backgroundIntensity;
  document.documentElement.style.setProperty('--wallpaper-opacity', String(typeof intensity === 'number' && Number.isFinite(intensity) ? Math.max(0.2, Math.min(1, intensity)) : 0.6));
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
      button('Study modes & card editor', 'sheet-action', () => { close(); openStudyHub(deck.id); }),
      button('Rename', 'sheet-action', showRenameForm),
      button('Export deck', 'sheet-action', showExportConfirm),
      button('Delete deck', 'sheet-action danger', showDeleteConfirm),
      button('Cancel', 'sheet-action cancel', close),
    );
  }
  function showExportConfirm() {
    const status = element('p', 'sheet-title', `Export “${deck.name}” as an .apkg file you can share or re-import elsewhere. Bundled images/audio aren’t included.`);
    const exportButton = button('Export', 'sheet-action', async () => {
      exportButton.disabled = true; exportButton.textContent = 'Preparing…';
      try {
        const blob = await exportDeckToApkg(deck);
        const file = new File([blob], apkgFileName(deck.name), { type: 'application/octet-stream' });
        await shareDeckFile(file, deck.name);
        close();
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') { close(); return; }
        status.textContent = 'This deck could not be exported. Please try again.';
      }
      exportButton.disabled = false; exportButton.textContent = 'Export';
    });
    sheet.replaceChildren(status, exportButton, button('Cancel', 'sheet-action cancel', showMenu));
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
  voiceGroup.append(element('p', 'settings-about', recordingCount
    ? `${recordingCount} saved pronunciations. Other words use your device voice.`
    : 'Your device voice is active. ElevenLabs audio will appear here once it has been generated.'));
  const recordedLabel = element('label', 'audio-preference');
  const recordedInput = element('input');
  recordedInput.type = 'checkbox'; recordedInput.checked = currentSettings.preferRecordedAudio !== false;
  recordedInput.addEventListener('change', () => {
    stopPronunciation();
    currentSettings = { ...currentSettings, preferRecordedAudio: recordedInput.checked };
    void persistPreferences();
  });
  recordedLabel.append(recordedInput, document.createTextNode('Use saved audio when available'));
  voiceGroup.append(recordedLabel);
  const speechSupported = 'speechSynthesis' in window;
  let populateVoices = () => {};
  if (speechSupported) {
    const voiceSelect = document.createElement('select');
    voiceSelect.className = 'settings-select';
    voiceSelect.setAttribute('aria-label', 'Device voice');
    populateVoices = () => {
      const voices = speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('de'));
      const selected = currentSettings.voiceURI;
      voiceSelect.replaceChildren();
      const auto = document.createElement('option');
      auto.value = ''; auto.textContent = 'Automatic (prefer Premium / Enhanced)';
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
      void persistPreferences();
    });
    const rateLabel = element('label', 'settings-rate-label', `Speaking speed · ${currentSettings.speechRate.toFixed(2)}×`);
    rateLabel.htmlFor = 'speech-rate';
    const rateInput = document.createElement('input');
    rateInput.type = 'range'; rateInput.className = 'settings-range';
    rateInput.id = 'speech-rate';
    rateInput.min = '0.6'; rateInput.max = '1.4'; rateInput.step = '0.05';
    rateInput.value = String(currentSettings.speechRate);
    rateInput.addEventListener('input', () => {
      currentSettings = { ...currentSettings, speechRate: Number(rateInput.value) };
      rateLabel.textContent = `Speaking speed · ${currentSettings.speechRate.toFixed(2)}×`;
    });
    rateInput.addEventListener('change', () => {
      void persistPreferences();
    });
    const test = button('Test voice', 'text-button', () => speak('der Entwurf'));
    voiceGroup.append(voiceSelect, rateLabel, rateInput, test);
  } else {
    voiceGroup.append(element('p', 'settings-about', 'Pronunciation isn’t supported in this browser preview, but it works on your iPhone.'));
  }

  voiceGroup.append(element('h3', 'settings-label', 'Azure voice samples'));
  voiceGroup.append(element('p', 'settings-about', 'Compare Katja and Conrad saying “der Entwurf”. These samples use Azure; the dropdown above selects your device voice.'));
  for (const [name, file] of [
    ['Katja', '7e0ec90b564c079382fd7bdde5a3c042c2d4b5f85cd3c1553a4c1dea44d67daf.mp3'],
    ['Conrad', 'd18997e45b91b7f8f13573520c9fe66a98a7cd399e64acec614bb7d814f72f90.mp3'],
  ]) {
    const sample = document.createElement('audio');
    sample.controls = true; sample.preload = 'none'; sample.style.width = '100%';
    sample.src = `${import.meta.env.BASE_URL}voice-samples/${file}`;
    sample.setAttribute('aria-label', `${name} Azure voice sample`);
    voiceGroup.append(element('p', 'settings-about', name), sample);
  }
  const samplesLink = element('a', 'text-button', 'All Azure samples');
  samplesLink.href = `${import.meta.env.BASE_URL}voice-samples/index.html`;
  voiceGroup.append(samplesLink);

  const themeGroup = element('div', 'settings-group');
  themeGroup.append(element('h2', 'settings-label', 'Appearance'));
  const themeRow = element('div', 'theme-grid');
  themeRow.setAttribute('aria-label', 'Appearance');
  const themeOptions: [ThemePreference, string][] = [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark'], ['paper', 'Warm paper'], ['midnight', 'Midnight blue'], ['forest', 'Forest'], ['rose', 'Rose'], ['ocean', 'Ocean'], ['sunset', 'Sunset'], ['lavender', 'Lavender'], ['slate', 'Slate'], ['amber', 'Amber'], ['nova', 'Nova'], ['candy', 'Candy']];
  for (const [value, label] of themeOptions) {
    const segment = button(label, `segment${currentSettings.theme === value ? ' active' : ''}`, () => {
      currentSettings = { ...currentSettings, theme: value };
      void persistPreferences();
      applyTheme(value);
      themeRow.querySelectorAll('.segment').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-pressed', 'false'); });
      segment.classList.add('active');
      segment.setAttribute('aria-pressed', 'true');
    });
    segment.dataset.palette = value;
    segment.setAttribute('aria-pressed', String(currentSettings.theme === value));
    const swatch = element('span', 'theme-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    segment.prepend(swatch);
    themeRow.append(segment);
  }
  themeGroup.append(themeRow);
  const backgroundHeading = element('h3', 'background-heading', 'Background');
  const backgroundHint = element('p', 'settings-about', 'A little atmosphere for your library and study cards. Works with every theme.');
  const backgroundGrid = element('div', 'background-grid');
  backgroundGrid.setAttribute('role', 'group');
  backgroundGrid.setAttribute('aria-label', 'Background');
  const backgroundOptions: [BackgroundPreference, string, string][] = [
    ['none', 'Plain', 'Clean and quiet'],
    ['aurora', 'Soft glow', 'Blended gradients'],
    ['paper', 'Paper texture', 'Subtle woven grain'],
    ['stars', 'Starlight', 'A scatter of stars'],
    ['cubes', 'Floating glass', 'Slowly turning 3D cubes'],
    ['orbits', 'Orbital glow', 'Luminous rings in motion'],
    ['prism', 'Flowing glass', 'Soft color blobs, always drifting'],
    ['rings', 'Liquid waves', 'Warm blobs in slow motion'],
  ];
  const intensityLabel = element('label', 'settings-rate-label background-intensity-label');
  intensityLabel.htmlFor = 'background-intensity';
  const intensityInput = element('input', 'settings-range');
  intensityInput.type = 'range'; intensityInput.id = 'background-intensity';
  intensityInput.min = '0.2'; intensityInput.max = '1'; intensityInput.step = '0.1';
  intensityInput.value = String(currentSettings.backgroundIntensity ?? 0.6);
  const updateBackgroundControls = () => {
    const selected = currentSettings.background ?? 'none';
    backgroundGrid.querySelectorAll<HTMLButtonElement>('button').forEach(choice => {
      choice.setAttribute('aria-pressed', String(choice.dataset.wallpaper === selected));
    });
    intensityInput.disabled = selected === 'none';
    intensityLabel.textContent = `Background intensity · ${Math.round(Number(intensityInput.value) * 100)}%`;
  };
  for (const [value, label, description] of backgroundOptions) {
    const choice = button('', 'background-choice', () => {
      currentSettings = { ...currentSettings, background: value };
      applyTheme(currentSettings.theme);
      updateBackgroundControls();
      void persistPreferences();
    });
    choice.dataset.wallpaper = value;
    choice.setAttribute('aria-label', label);
    const preview = element('span', 'background-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.append(element('span', 'background-preview-card', 'Aa'));
    choice.append(preview, element('span', 'background-name', label), element('span', 'background-description', description));
    backgroundGrid.append(choice);
  }
  intensityInput.addEventListener('input', () => {
    currentSettings = { ...currentSettings, backgroundIntensity: Number(intensityInput.value) };
    applyTheme(currentSettings.theme);
    updateBackgroundControls();
  });
  intensityInput.addEventListener('change', () => void persistPreferences());
  updateBackgroundControls();
  themeGroup.append(backgroundHeading, backgroundHint, backgroundGrid, intensityLabel, intensityInput);
  const motionLabel = element('label', 'audio-preference');
  const motionInput = element('input');
  motionInput.type = 'checkbox'; motionInput.checked = currentSettings.backgroundMotion !== false;
  motionInput.addEventListener('change', () => {
    currentSettings = { ...currentSettings, backgroundMotion: motionInput.checked };
    applyTheme(currentSettings.theme);
    void persistPreferences();
  });
  motionLabel.append(motionInput, document.createTextNode('Animate 3D backgrounds'));
  themeGroup.append(motionLabel, element('p', 'settings-about', 'Motion stays gentle and pauses when Reduce Motion is enabled.'));

  const dataGroup = element('div', 'settings-group');
  dataGroup.append(element('h2', 'settings-label', 'Data'));
  const storageInfo = element('div', 'storage-summary');
  const storageStatus = element('p', 'settings-about', 'Calculating storage…');
  storageInfo.append(storageStatus);
  const refreshStorage = async () => {
    try {
      const summary = await storageSummary();
      const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      const lines = [
        `${summary.decks} decks · ${summary.cards.toLocaleString()} cards`,
        `Decks, progress and settings: approximately ${size(summary.textBytes)}`,
        `Imported media: ${size(summary.mediaBytes)} (${summary.mediaCount} files)`,
        `Pronunciation audio supplied with this build: ${size(generatedAudioSummary.bytes)} (${generatedAudioSummary.files.toLocaleString()} files). Live preview streams these from your computer; the normal IPA includes them.`,
      ];
      const { usage, quota } = summary.estimate ?? {};
      if (typeof usage === 'number' && typeof quota === 'number' && quota > 0) {
        lines.push(`Browser storage estimate: ${size(usage)} used of ${size(quota)} allowed.`, `Estimated available: ${size(Math.max(0, quota - usage))}.`);
      } else lines.push('Storage allowance: not reported by this browser.');
      lines.push('Content sizes exclude app files, generated pronunciation audio and database overhead. Browser estimates may include caches; they are not your iPhone’s total free space.');
      storageStatus.textContent = lines.join('\n');
    } catch { storageStatus.textContent = 'Storage information is unavailable right now.'; }
  };
  storageInfo.append(button('Refresh storage', 'text-button', () => void refreshStorage()));
  dataGroup.append(storageInfo, element('p', 'settings-about storage-limits', 'Import limits per file: 100 MB package, 300 MB expanded content, 50,000 cards. There is no fixed total deck limit in the app; available device storage still applies.'));
  void refreshStorage();
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
  accountGroup.append(element('p', 'settings-about', 'Backed up: daily app time, decks, card text, progress, study sessions and preferences—including theme, background, intensity, animation and voice settings.\nNot backed up: imported images/audio or generated pronunciation files. Generated audio comes with the app build; Live loads it from the computer.\nThis is backup and restore, not live merging between devices. Cloud storage and service quota usage are not available in this app.'));
  const preferenceNotice = element('p', 'settings-about preference-sync-status', preferenceStatus);
  preferenceNotice.setAttribute('aria-live', 'polite');
  accountGroup.append(preferenceNotice);
  if (!cloudAvailable()) {
    accountGroup.append(element('p', 'settings-about', 'Cloud backup isn’t set up for this build yet.'));
  } else if (currentUser) {
    const meterUser = currentUser;
    const cloudMeter = element('div', 'storage-summary cloud-storage-meter');
    cloudMeter.append(element('h3', 'cloud-meter-title', 'Cloud backup size'));
    const meterNumbers = element('p', 'cloud-meter-numbers', 'Checking saved cloud data…');
    meterNumbers.setAttribute('aria-live', 'polite');
    const meterBar = element('progress', 'cloud-meter-bar');
    const freeStorageReference = 1024 ** 3;
    meterBar.max = freeStorageReference;
    meterBar.setAttribute('aria-label', 'Estimated backup content compared with the 1 GiB free storage reference');
    const meterDetail = element('p', 'settings-about');
    const refreshMeter = button('Refresh cloud usage', 'text-button', () => void updateCloudMeter(true));
    async function updateCloudMeter(force = false) {
      refreshMeter.disabled = true;
      try {
        const cached = cloudUsageCache;
        const usage = !force && cached?.uid === meterUser.uid && Date.now() - cached.usage.checkedAt < 300000
          ? cached.usage : await cloudStorageUsage(meterUser.uid);
        if (currentUser?.uid !== meterUser.uid) return;
        cloudUsageCache = { uid: meterUser.uid, usage };
        meterBar.value = Math.min(usage.bytes, freeStorageReference);
        const percent = usage.bytes / freeStorageReference * 100;
        const used = usage.bytes === 0 ? '0 KB' : usage.bytes < 1024 ** 2 ? `${(usage.bytes / 1024).toFixed(1)} KB` : `${(usage.bytes / 1024 ** 2).toFixed(2)} MiB`;
        const percentLabel = percent > 0 && percent < 0.01 ? '<0.01' : percent.toFixed(2);
        meterNumbers.textContent = `${used} / 1,024 MiB reference · ${percentLabel}%`;
        meterBar.setAttribute('aria-valuetext', meterNumbers.textContent);
        meterDetail.textContent = `${usage.decks} cloud decks · ${usage.cards.toLocaleString()} cloud cards\nChecked ${new Date(usage.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Estimated content size; excludes indexes, document overhead and other users. The 1 GiB free allowance is shared by the project, not reserved for your account. Paid plans can exceed it. Exact project usage and plan limits are available in Firebase Console.`;
      } catch {
        meterBar.hidden = true;
        meterNumbers.textContent = 'Cloud usage could not be checked.';
        meterDetail.textContent = 'Check your connection and try again. An unavailable reading does not mean your backup is empty.';
      } finally { refreshMeter.disabled = false; }
    }
    refreshMeter.addEventListener('click', () => { meterBar.hidden = false; });
    cloudMeter.append(meterNumbers, meterBar, meterDetail, refreshMeter);
    accountGroup.append(cloudMeter);
    void updateCloudMeter();
    const status = element('p', 'settings-about', `Signed in as ${currentUser.email}`);
    const formatWhen = (at: number) => {
      const date = new Date(at);
      const sameDay = date.toDateString() === new Date().toDateString();
      return sameDay ? `today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    async function refreshBackupStatusLine() {
      const [savedStatus, lastModified] = await Promise.all([loadBackupStatus(), getLastModified()]);
      const backupStatus = savedStatus.userId && savedStatus.userId !== currentUser?.uid ? {} : savedStatus;
      const lines = [`Signed in as ${currentUser?.email ?? ''}`];
      if (backupStatus.lastError) lines.push(`Backup failed: ${backupStatus.lastError}`);
      else if (backupStatus.lastSuccessAt) lines.push(`Last backed up ${formatWhen(backupStatus.lastSuccessAt)}.`);
      else lines.push('Never backed up yet.');
      if (lastModified > (backupStatus.syncedThrough ?? backupStatus.lastSuccessAt ?? 0)) lines.push('Changes pending sync.');
      status.textContent = lines.join('\n');
    }
    void refreshBackupStatusLine();
    const syncButton = button('Sync now', 'text-button', async () => {
      syncButton.disabled = true; syncButton.textContent = 'Syncing…';
      await syncAllToCloud();
      await refreshBackupStatusLine();
      await updateCloudMeter(true);
      syncButton.disabled = false; syncButton.textContent = 'Sync now';
    });
    const restoreButton = button('Restore from backup…', 'text-button', async () => {
      restoreButton.disabled = true;
      try {
        const cloud = await pullAll(meterUser.uid);
        if (!cloud.decks.length) { status.textContent = 'No cloud backup found for this account yet.'; return; }
        openRestorePreviewSheet(cloud, () => void (async () => {
          await replaceAllDecks(cloud.decks as Deck[]);
          if (cloud.settings) { currentSettings = { ...defaultSettings, ...cloud.settings }; await saveSettings(currentSettings); applyTheme(currentSettings.theme); }
          await saveBackupStatus({ ...(await loadBackupStatus()), lastSuccessAt: Date.now() });
          pendingNotice = 'Restored your decks and progress from the cloud.';
          void library();
        })());
      } catch { status.textContent = 'Could not check your cloud backup. Check your connection and try again.'; }
      finally { restoreButton.disabled = false; }
    });
    const signOutButton = button('Sign out', 'danger-button', async () => { await signOutUser(); void settingsScreen(); });
    accountGroup.append(status, syncButton, restoreButton, signOutButton);
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

  screen.append(usagePanel(), voiceGroup, themeGroup, dataGroup, accountGroup, aboutGroup);
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
    if (cloud.settings) { currentSettings = { ...defaultSettings, ...cloud.settings }; await saveSettings(currentSettings); applyTheme(currentSettings.theme); }
    await saveBackupStatus({ ...(await loadBackupStatus()), lastSuccessAt: Date.now() });
    pendingNotice = 'Restored your decks and progress from the cloud.';
    void library();
  };
  const localIsFresh = localDecks.length === 1 && localDecks[0].id === 'starter' && localDecks[0].reviewed.length === 0;
  if (localIsFresh) { await applyCloud(); return; }
  openConflictSheet(() => void syncAllToCloud(), () => openRestorePreviewSheet(cloud, () => void applyCloud()));
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

/** Shows what a restore would replace before committing to it. */
function openRestorePreviewSheet(cloud: Awaited<ReturnType<typeof pullAll>>, onConfirm: () => void) {
  const backdrop = element('div', 'sheet-backdrop');
  const sheet = element('div', 'sheet');
  const cardCount = cloud.decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  sheet.append(
    element('p', 'sheet-title', `This backup has ${cloud.decks.length} deck${cloud.decks.length === 1 ? '' : 's'} and ${cardCount} card${cardCount === 1 ? '' : 's'}. Restoring will replace everything currently on this device.`),
    button('Restore this backup', 'sheet-action danger', () => { backdrop.remove(); onConfirm(); }),
    button('Cancel', 'sheet-action cancel', () => backdrop.remove()),
  );
  backdrop.append(sheet);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); });
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
  main.append(row, element('p', 'reviewed', `${reviewed} reviewed`), track, element('span', 'deck-cta', deck.activeSession ? 'Resume session' : 'Start studying'));
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

function openStudyHub(deckId?: string) {
  void studyHub({
    show: (screen, dispose) => { setScreen(screen); cleanup = dispose ?? (() => {}); },
    back: () => void library(),
    quick: deck => void study(deck),
    settingsChanged: async settings => {
      currentSettings = settings;
      applyTheme(settings.theme);
      await persistPreferences();
    },
    changed: () => {},
  }, deckId);
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
    const totalCards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
    const reviewedCards = decks.reduce((sum, deck) => sum + Math.min(deck.reviewed.length, deck.cards.length), 0);
    const overview = element('div', 'library-overview');
    overview.append(
      element('strong', '', `${totalCards} card${totalCards === 1 ? '' : 's'} ready`),
      element('span', '', `${reviewedCards} reviewed`),
    );
    const dashboard = dailyDashboard(decks, currentSettings, () => openStudyHub());
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
    screen.append(header, overview, dashboard, search, list, empty, hint, notice, navBar('home'));
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
  await warmAudio(deck.cards).catch(() => {});
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
  const speakButton = speechSupported || recordingCount > 0 ? element('button', 'speak-button', '') : undefined;
  if (speakButton) {
    speakButton.type = 'button';
    speakButton.setAttribute('aria-label', 'Hear pronunciation');
    speakButton.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3z"/><path d="M16.3 12c0-1.5-.8-2.8-2-3.4v6.8c1.2-.6 2-1.9 2-3.4z"/><path d="M14.3 4.6v2.1c2.3.8 4 3 4 5.3s-1.7 4.5-4 5.3v2.1c3.4-.9 6-4 6-7.4s-2.6-6.5-6-7.4z"/></svg>';
  }
  shell.append(card, count);
  const sourceLabel = element('p', 'settings-about pronunciation-source');
  sourceLabel.setAttribute('aria-live', 'polite');
  if (speakButton) shell.append(speakButton);
  const rightSwipeLabel = isMemorizedDeck ? 'Remove card from this session' : 'Move card to Memorized deck';
  const instructions = element('p', 'sr-only', `Tap to flip. Swipe left to repeat, right to ${isMemorizedDeck ? 'remove' : 'memorize'}, or down to return to your decks. With a keyboard, use Enter to flip, arrow keys to sort, and Escape to leave.`);
  instructions.id = 'study-instructions';
  const accessibleActions = element('div', 'sr-only study-actions');
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
  screen.append(shell, sourceLabel, instructions, accessibleActions, toast);
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
    stopPronunciation();
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
    stopAudio();
    pronounce(plainText(session.current.front), currentSettings, source => { sourceLabel.textContent = source; });
  });
  const refreshAccessibility = () => {
    front.setAttribute('aria-hidden', String(flipped));
    back.setAttribute('aria-hidden', String(!flipped));
    card.setAttribute('aria-label', `${flipped ? 'Back' : 'Front'}. ${(flipped ? backContent : frontContent).textContent}. Card ${session.position} of ${session.total}.`);
  };
  const render = (reset = true) => {
    if (!session.current) return;
    sourceLabel.textContent = pronunciationSource(plainText(session.current.front), currentSettings);
    if (reset) { flipped = false; card.classList.remove('flipped'); }
    const a = cardContent(session.current.front, media), b = cardContent(session.current.back, media);
    frontContent.innerHTML = `<div class="card-body">${a.html}</div>`;
    backContent.innerHTML = `<div class="card-body">${b.html}</div>`;
    if (session.current.example) backContent.append(element('p', 'explanation', session.current.example));
    const grammar = grammarPanel(session.current.front, sentenceText => {
      stopAudio();
      pronounce(sentenceText, currentSettings, source => { sourceLabel.textContent = source; });
    });
    backContent.classList.toggle('has-grammar', !!grammar);
    if (grammar) backContent.append(grammar);
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
    void recordActivity(deck.id, -1).catch(() => {});
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
    stopPronunciation();
    shell.style.transition = reduceMotion.matches ? 'none' : 'transform 180ms ease-out, opacity 180ms ease-out';
    shell.style.transform = `translateX(${direction === 'left' ? '-110' : '110'}vw) rotate(${direction === 'left' ? '-8' : '8'}deg)`;
    shell.style.opacity = '0';
    timer = setTimeout(() => {
      if (disposed) return;
      const swiped = session.current!;
      void recordActivity(deck.id).catch(() => {});
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
    stopPronunciation();
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
  startUsageTracking();
  onAuthChange(user => { currentUser = user; void setUsageUser(user?.uid || null).catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    document.documentElement.dataset.pageHidden = String(document.hidden);
    if (document.visibilityState === 'hidden') { stopPronunciation(); void syncAllToCloud(); }
  });
  await library();
}
void bootstrap();

import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
const state = async (stage, detail = '') => writeFile('artifacts/platform-refresh-status.json', JSON.stringify({ stage, detail, updatedAt: new Date().toISOString() }, null, 2));
const run = args => new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...args], { windowsHide: true, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Platform build exited ${code}`)));
});
try {
  await state('waiting-for-audio');
  for (;;) {
    const status = await readFile('artifacts/katja-rebuild-status.json', 'utf8').then(JSON.parse).catch(() => ({ stage: 'updating' }));
    if (status.stage === 'complete') break;
    if (status.stage === 'failed') await state('waiting-for-audio-resume', 'Resume Katja generation; platform refresh will continue after it completes.');
    await delay(30000);
  }
  await state('building');
  await run(['scripts/packaging/build-windows.ps1', '-OutputName', `Flashcards-Windows-Audio-${Date.now()}`]);
  await run(['scripts/packaging/build-android.ps1', '-SkipWebBuild']);
  await state('complete', 'Windows ZIP and Android APK include the complete Katja catalog.');
} catch (error) {
  await state('failed', error.message);
  console.error(error.message); process.exitCode = 1;
}

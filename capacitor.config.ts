import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.maaz.flashcards',
  appName: 'Flashcards',
  webDir: 'dist',
  backgroundColor: '#f4f4fa',
  ios: { contentInset: 'never', backgroundColor: '#f4f4fa', preferredContentMode: 'mobile' },
};
export default config;

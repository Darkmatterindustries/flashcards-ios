/**
 * Fill these in from your Firebase project: console.firebase.google.com →
 * Project settings → General → "Your apps" → the web (</>) app you registered.
 * These values are safe to ship in the client; Firestore security rules (not
 * this file) are what actually protect user data.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyAZrDvOonkU2PePBU3ZNlK1VM8BnQyHavE',
  authDomain: 'flashy-10fba.firebaseapp.com',
  projectId: 'flashy-10fba',
  storageBucket: 'flashy-10fba.firebasestorage.app',
  messagingSenderId: '168703843927',
  appId: '1:168703843927:web:b1a142ff9d8f2478540d12',
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

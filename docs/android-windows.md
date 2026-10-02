# Android and Windows previews

The app stays in TypeScript. Android uses Capacitor's system WebView; Windows uses a small C# WinForms host with Microsoft's WebView2 runtime. No application logic is rewritten in C# or Java. Neither platform requires the iPhone or Live server to study offline.

## Windows

Run `npm.cmd run windows:build`. Extract the entire `artifacts/Flashcards-Windows-3.0.zip`, then open `Flashcards.exe`. Requires Windows x64, .NET Framework 4.7.2+ and WebView2 Runtime. This is an unsigned portable preview, not a signed installer or Store submission.

The build uses Windows' .NET Framework compiler and the Microsoft.Web.WebView2 1.0.4191.47 NuGet package extracted under `.tools/platforms/webview2`. The native wrapper maps only bundled web assets to a fixed HTTPS origin, disables host objects and denies permission requests. IndexedDB data persists in `%LOCALAPPDATA%/MaazFlashcards/WebView2`, separate from application updates.

## Android

Run `npm.cmd run android:build`. The build uses a local Java 21 JDK in `.tools/platforms/jdk`, Android SDK in `.tools/platforms/android-sdk`, and Gradle cache in `.tools/platforms/gradle-cache`. Required SDK packages are platform-tools, platforms;android-36 and build-tools;36.0.0. The Google Android SDK license must be accepted during setup.

Copy `artifacts/Flashcards-Android-3.0.apk` to the phone to install. This APK is debug-signed for testing. A Play release requires a separately managed release/upload signing key and AAB; do not publish this debug build. Preserve the debug signing key for install-over updates during testing.

Android's Back button returns from study or panels, then minimizes from Home. Windows users have study buttons as well as the existing keyboard shortcuts.

## Data and audio

Each installation has its own local decks and settings. Existing cloud backup and restore can transfer supported data after signing in. It does not perform automatic merging, and media is not included in cloud backups. Packaged pronunciation audio works offline. Each build includes the audio generated at build time; rebuild after Katja conversion finishes to include the complete catalog.

Before release, test import/export, audio, backup and restore on a physical Android device and Windows, and verify signing, branding, privacy disclosures and deck/audio redistribution permissions.

param([switch]$SkipWebBuild)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $workspace
$jdk = Get-ChildItem -LiteralPath '.tools/platforms/jdk' -Directory | Select-Object -First 1
if (-not $jdk) { throw 'Java 21 is missing from .tools/platforms/jdk' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $workspace '.tools/platforms/android-sdk'
$env:GRADLE_USER_HOME = Join-Path $workspace '.tools/platforms/gradle-cache'
if (-not $SkipWebBuild) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
}
& npx.cmd cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Android sync failed' }
Push-Location -LiteralPath android
try {
    & .\gradlew.bat --no-daemon --max-workers=2 assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android compilation failed' }
} finally { Pop-Location }
Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination 'artifacts/Flashcards-Android-4.0.apk' -Force
Write-Output 'Prepared artifacts/Flashcards-Android-4.0.apk (debug-signed preview)'

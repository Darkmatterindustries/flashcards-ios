param([ValidatePattern('^Flashcards-Windows(?:-[A-Za-z0-9-]+)?$')][string]$OutputName = 'Flashcards-Windows')
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $workspace
$sdk = Join-Path $workspace '.tools/platforms/webview2'
if (-not (Test-Path -LiteralPath $sdk)) { Expand-Archive -LiteralPath '.tools/platforms/webview2.zip' -DestinationPath $sdk }
$output = Join-Path $workspace "artifacts/$OutputName"
New-Item -ItemType Directory -Path $output -Force | Out-Null
$core = Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe /platform:x64 /win32manifest:"$workspace/windows/app.manifest" /out:"$output/Flashcards.exe" /reference:"$core" /reference:"$forms" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $workspace 'windows\Flashcards.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows compilation failed' }
Copy-Item -LiteralPath $core,$forms -Destination $output
Copy-Item -LiteralPath 'windows/Flashcards.exe.config' -Destination $output
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $output
# Mirror only generated assets inside this dedicated packaging directory.
& robocopy (Join-Path $workspace 'dist') (Join-Path $output 'www') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Copying Windows assets failed' }
Copy-Item -LiteralPath 'windows/README.txt' -Destination $output
& 'C:/Users/maazl/AppData/Local/Python/pythoncore-3.14-64/python.exe' scripts/packaging/package-windows.py $output
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }


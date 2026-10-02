"""Bundle built web assets into an existing unsigned Capacitor shell on Windows.
No native code is compiled. Sign the resulting IPA with Sideloadly.
"""
import json
import plistlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path('artifacts/Flashcards-unsigned.ipa')
output = Path('artifacts/Flashcards-4.0-unsigned.ipa')
web = Path('dist')
if not (web / 'index.html').exists():
    raise SystemExit('Run npm.cmd run build first.')
with ZipFile(source) as original:
    roots = [n for n in original.namelist() if n.startswith('Payload/') and n.endswith('.app/Info.plist') and n.count('/') == 2]
    if len(roots) != 1:
        raise SystemExit('Expected one app bundle.')
    root = roots[0].removesuffix('Info.plist')
    info = plistlib.loads(original.read(roots[0]))
    info['CFBundleShortVersionString'] = '4.0'
    info['CFBundleVersion'] = '4'
    config_path = root + 'capacitor.config.json'
    config = json.loads(original.read(config_path))
    config.pop('server', None)
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for entry in original.infolist():
            relative = entry.filename.removeprefix(root + 'public/')
            native_bridge = relative in ('cordova.js', 'cordova_plugins.js') or relative.startswith('plugins/')
            if (entry.filename.startswith(root + 'public/') and not native_bridge) or '/_CodeSignature/' in entry.filename or entry.filename.endswith('/embedded.mobileprovision'):
                continue
            data = original.read(entry)
            if entry.filename == roots[0]:
                data = plistlib.dumps(info, fmt=plistlib.FMT_BINARY)
            elif entry.filename == config_path:
                data = json.dumps(config, indent=2).encode()
            archive.writestr(entry, data)
        for file in web.rglob('*'):
            if file.is_file():
                archive.write(file, root + 'public/' + file.relative_to(web).as_posix())
with ZipFile(source) as original, ZipFile(output) as archive:
    assert archive.testzip() is None
    assert original.read(root + 'App') == archive.read(root + 'App')
    assert 'server' not in json.loads(archive.read(config_path))
    assert len([n for n in archive.namelist() if n.endswith('.mp3')]) > 0
print(f'Prepared {output.resolve()} ({output.stat().st_size / 1048576:.1f} MB). Sign with Sideloadly.')

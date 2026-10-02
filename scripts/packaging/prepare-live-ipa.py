"""Prepare a separate, unsigned LAN preview from an existing Capacitor IPA.

Usage: python scripts/packaging/prepare-live-ipa.py http://192.168.0.197:5173
Sign the output with Sideloadly before installing. Requires Python 3.
"""
import argparse
import ipaddress
import json
import plistlib
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--source', default='artifacts/Flashcards-unsigned.ipa')
    parser.add_argument('--output', default='artifacts/Flashcards-Live-unsigned.ipa')
    args = parser.parse_args()
    url = urlsplit(args.url)
    try:
        address = ipaddress.IPv4Address(url.hostname)
    except (ValueError, TypeError):
        parser.error('Use the computer LAN IPv4 address, such as http://192.168.0.197:5173')
    lan_ranges = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
    if not any(address in ipaddress.ip_network(net) for net in lan_ranges):
        parser.error('Use a private LAN address for this development build')
    if (url.scheme != 'http' or url.port != 5173 or url.path not in ('', '/')
            or url.query or url.fragment or url.username or url.password):
        parser.error('Expected http://LAN-IP:5173 with no path or credentials')
    source, output = Path(args.source).resolve(), Path(args.output).resolve()
    if source == output:
        parser.error('Output must differ from the original IPA')
    with ZipFile(source) as original:
        roots = [n for n in original.namelist()
                 if n.startswith('Payload/') and n.endswith('.app/Info.plist') and n.count('/') == 2]
        if len(roots) != 1:
            parser.error('Expected exactly one app in Payload')
        root = roots[0].removesuffix('Info.plist')
        config_path = root + 'capacitor.config.json'
        config = json.loads(original.read(config_path))
        config.update(appId='com.maaz.flashcards.live', appName='Flashcards Live')
        config['server'] = {'url': args.url.rstrip('/'), 'cleartext': True}
        info = plistlib.loads(original.read(roots[0]))
        info['CFBundleIdentifier'] = 'com.maaz.flashcards.live'
        info['CFBundleDisplayName'] = 'Flashcards Live'
        info['CFBundleName'] = 'Flashcards Live'
        info['NSLocalNetworkUsageDescription'] = 'Connect to your computer to preview Flashcards changes live.'
        ats = info.setdefault('NSAppTransportSecurity', {})
        ats['NSAllowsLocalNetworking'] = True
        ats['NSAllowsArbitraryLoadsInWebContent'] = True
        replacements = {
            config_path: json.dumps(config, indent=2).encode(),
            roots[0]: plistlib.dumps(info, fmt=plistlib.FMT_BINARY),
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, 'w') as preview:
            for entry in original.infolist():
                # Resource changes invalidate signatures; Sideloadly signs again.
                if '/_CodeSignature/' in entry.filename or entry.filename.endswith('/embedded.mobileprovision'):
                    continue
                preview.writestr(entry, replacements.get(entry.filename, original.read(entry)))
    print(f'Prepared {output}\nServer: {config["server"]["url"]}\nInstall with Sideloadly as com.maaz.flashcards.live.')


if __name__ == '__main__':
    main()

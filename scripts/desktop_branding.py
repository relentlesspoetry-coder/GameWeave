#!/usr/bin/env python3
"""Check visible desktop branding without changing the stable package identity."""
from configparser import ConfigParser
from pathlib import Path
import subprocess
import sys
import tempfile


def check_desktop(root):
    applications = root / 'usr/share/applications'
    # Keep the existing desktop-file ID for installed launchers and pinned icons.
    entry = applications / 'Proton Medic.desktop'
    config = ConfigParser(interpolation=None)
    with entry.open(encoding='utf-8') as stream:
        config.read_file(stream)
    metadata = config['Desktop Entry']
    assert metadata['Name'] == 'GameWeave', 'Launcher must show the GameWeave name'
    assert metadata['Exec'] == 'proton-medic', 'Launcher must keep the existing executable'
    assert metadata['Icon'] == 'proton-medic', 'Launcher must reference the installed app icon'
    assert metadata['StartupWMClass'] == 'proton-medic', 'Keep existing shell/dock window matching'
    icons_dir = root / 'usr/share/icons/hicolor'
    source_icons = Path(__file__).resolve().parents[1] / 'src-tauri/icons'
    expected = {'32x32': '32x32.png', '128x128': '128x128.png',
                '256x256@2': '128x128@2x.png', '512x512': 'icon.png'}
    for size, source in expected.items():
        icon = icons_dir / size / 'apps/proton-medic.png'
        assert icon.read_bytes() == (source_icons / source).read_bytes(), f'Stale or wrong packaged icon: {size}'
    assert (root / 'usr/bin/proton-medic').is_file(), 'Existing executable is missing'
    print('PASS: GameWeave launcher name and icon with the existing desktop ID')


def check_deb(package):
    name = subprocess.check_output(['dpkg-deb', '-f', package, 'Package'], text=True).strip()
    assert name == 'proton-medic', f'DEB package identity changed: {name}'
    with tempfile.TemporaryDirectory(prefix='gameweave-deb-branding-') as directory:
        subprocess.run(['dpkg-deb', '-x', package, directory], check=True)
        check_desktop(Path(directory))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: desktop_branding.py PACKAGE.deb')
    check_deb(sys.argv[1])

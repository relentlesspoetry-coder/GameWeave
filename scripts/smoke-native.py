#!/usr/bin/env python3
"""Optional native GUI smoke capture; run under Xvfb/dbus-run-session.

Requires xdotool and Pillow. Only a temporary Steam fixture is exposed through
HOME. Does not launch a game, enable auto-selection, or invoke repairs.
Requires a committed UI ready receipt in addition to a titled native window.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from PIL import ImageGrab

parser = argparse.ArgumentParser()
parser.add_argument('binary', type=Path)
parser.add_argument('screenshot', type=Path)
args = parser.parse_args()
binary = args.binary.resolve()
version = json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text())['version']
args.screenshot.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='proton-medic-native-smoke-') as tmp:
    home = Path(tmp)
    launch_tmp = home / 'tmp'
    launch_tmp.mkdir()
    receipt_dir = launch_tmp / ('gameweave-reopen-' + secrets.token_hex(16))
    receipt_dir.mkdir(mode=0o700)
    receipt = receipt_dir / 'ready'
    steam = home / '.local/share/Steam'
    apps = steam / 'steamapps'
    (apps / 'common/Native Fixture Adventure').mkdir(parents=True)
    (apps / 'appmanifest_98765.acf').write_text(
        '"AppState" { "appid" "98765" "name" "Native Fixture Adventure" '
        '"installdir" "Native Fixture Adventure" }')
    (apps / 'libraryfolders.vdf').write_text(
        '"libraryfolders" { "0" { "path" "' + str(steam) + '" } }')
    env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home/'config'),
               XDG_DATA_HOME=str(home/'.local/share'), XDG_CACHE_HOME=str(home/'cache'),
               TMPDIR=str(launch_tmp), GAMEWEAVE_UPDATE_READY=str(receipt),
               GDK_BACKEND='x11', LIBGL_ALWAYS_SOFTWARE='1')
    process = subprocess.Popen([str(binary)], env=env)
    try:
        deadline = time.monotonic() + 30
        window = None
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f'Native process exited early: {process.returncode}')
            found = subprocess.run(['xdotool', 'search', '--onlyvisible', '--name', '^GameWeave$'],
                                   capture_output=True, text=True)
            if found.returncode == 0:
                window = found.stdout.splitlines()[0]
                if receipt.exists() and receipt.read_text() == version + '\n':
                    break
            time.sleep(0.25)
        if window is None:
            raise RuntimeError('No visible GameWeave window within 30 seconds')
        if not receipt.exists() or receipt.read_text() != version + '\n':
            raise RuntimeError('No matching GameWeave UI readiness receipt within 30 seconds')
        time.sleep(5)
        if process.poll() is not None:
            raise RuntimeError('Native process exited before capture')
        ImageGrab.grab(xdisplay=os.environ['DISPLAY']).save(args.screenshot)
        print(f'PASS: GameWeave {version} UI ready; visible window {window}; capture {args.screenshot}')
        print('Inspect screenshot for rendered UI and discovered disposable fixture.')
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

#!/usr/bin/env python3
"""Build an ad-hoc-signed DMG and clean source ZIP for a GitHub release."""
import argparse
import hashlib
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--skip-build', action='store_true', help='Package the existing normal build')
parser.add_argument('--overwrite', action='store_true', help='Replace generated assets for this version')
args = parser.parse_args()
if not args.skip_build:
    subprocess.run([sys.executable, str(ROOT/'macOS/build.py')], check=True)
version = (ROOT/'VERSION').read_text().strip()
app = ROOT/'macOS/dist/Chroma Console.app'
info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
if info.get('ChromaStartInSimulator') or info.get('ChromaReleaseVersion') != version:
    raise SystemExit('Build the normal app for the current VERSION before packaging.')
if info.get('CFBundleVersion') != (ROOT/'BUILD_NUMBER').read_text().strip():
    raise SystemExit('Build number mismatch. Rebuild before packaging.')
subprocess.run(['lipo',str(app/'Contents/MacOS/ChromaConsole'),'-verify_arch','arm64'], check=True)
output = ROOT/'dist'
output.mkdir(exist_ok=True)
dmg = output/f'Chroma-Console-{version}-macOS-arm64.dmg'
source = output/f'Chroma-Console-{version}-source.zip'
if not args.overwrite and (dmg.exists() or source.exists()):
    raise SystemExit('Release assets already exist. Use --overwrite to regenerate them.')

with tempfile.TemporaryDirectory(prefix='chroma-package-') as temporary:
    work = pathlib.Path(temporary)
    stage = work/'volume'
    stage.mkdir()
    shutil.copytree(app, stage/app.name, copy_function=shutil.copy)
    # Copy content without Desktop/iCloud Finder metadata, then verify the
    # exact bundle that will ship. No signature is changed during packaging.
    subprocess.run(['codesign','--verify','--deep','--strict',str(stage/app.name)], check=True)
    (stage/'Applications').symlink_to('/Applications', target_is_directory=True)
    shutil.copyfile(ROOT/'INSTALL.txt', stage/'READ ME FIRST.txt')
    if (ROOT/'LICENSE').exists(): shutil.copyfile(ROOT/'LICENSE', stage/'LICENSE.txt')
    image = work/dmg.name
    subprocess.run(['hdiutil','create','-volname','Chroma Console','-fs','HFS+',
                    '-srcfolder',str(stage),'-format','UDZO','-ov',str(image)], check=True)
    subprocess.run(['hdiutil','verify',str(image)], check=True)
    shutil.move(image, dmg)

# Explicit source allowlist prevents presets, backups, credentials and build
# output from slipping into the public archive, even if the folder grows later.
names = ['VERSION','BUILD_NUMBER','.gitignore','README.md','INSTALL.txt','CHANGELOG.md',
         'RELEASING.md','index.html','style.css','app.mjs','desktop.mjs',
         'protocol.mjs','server.py','Open Chroma Editor.command',
         'Stop Chroma Editor.command','macOS/build.py','macOS/test.py',
         'macOS/package.py','macOS/README.md','tests/index.html',
         'tests/tests.mjs','tests/live-ui.mjs']
names += ['docs/screenshots/'+name for name in
          ['README.md','sound.jpg','output.jpg','presets.jpg',
           'performance.jpg','midi-activity.jpg','preset-saving.jpg']]
for folder in ['macOS/Sources','macOS/Tests','macOS/Resources']:
    names += [str(path.relative_to(ROOT)) for path in (ROOT/folder).rglob('*.swift')]
if (ROOT/'LICENSE').exists(): names.append('LICENSE')
with zipfile.ZipFile(source, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(names):
        archive.write(ROOT/name, f'chroma-console-studio/{name}')
checksums = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in [dmg,source])
(output/'SHA256SUMS.txt').write_text(checksums)
for path in [dmg,source,output/'SHA256SUMS.txt']:
    print(f'{path} ({path.stat().st_size:,} bytes)')
print('Ad-hoc signed, not Apple-notarized. See INSTALL.txt for first-launch instructions.')

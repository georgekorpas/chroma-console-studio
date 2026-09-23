#!/usr/bin/env python3
"""Build a self-contained, locally signed Mac app with the installed Apple SDK."""
import pathlib, plistlib, re, shutil, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = (ROOT / 'VERSION').read_text().strip()
if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', VERSION):
    raise SystemExit('VERSION must be a semantic version, for example 1.0.0-beta.1')
BUILD = ROOT / 'macOS' / '.build'
APP = ROOT / 'macOS' / 'dist' / 'Chroma Console.app'
BUILD.mkdir(parents=True, exist_ok=True)
binary = BUILD / 'ChromaConsole'
sources = sorted((ROOT / 'macOS' / 'Sources').glob('*.swift'))
subprocess.run(['xcrun','swiftc','-swift-version','5','-parse-as-library','-O','-target','arm64-apple-macos13.0',*[str(p) for p in sources],'-framework','AppKit','-framework','WebKit','-framework','CoreMIDI','-o',str(binary)],check=True)
contents = APP / 'Contents'
for folder in [contents / 'MacOS', contents / 'Resources' / 'Web' / 'tests']:
    folder.mkdir(parents=True,exist_ok=True)
shutil.copyfile(binary,contents / 'MacOS' / 'ChromaConsole')
(contents / 'MacOS' / 'ChromaConsole').chmod(0o755)
for name in ['index.html','style.css','app.mjs','protocol.mjs','desktop.mjs','tests/index.html','tests/tests.mjs','tests/live-ui.mjs']:
    shutil.copyfile(ROOT / name,contents / 'Resources' / 'Web' / name)
with (contents / 'Info.plist').open('wb') as file:
    plistlib.dump({'ChromaStartInSimulator':'--simulator' in sys.argv,'CFBundleIdentifier':'local.chroma.console.studio','CFBundleName':'Chroma Console','CFBundleDisplayName':'Chroma Console','CFBundleExecutable':'ChromaConsole','CFBundlePackageType':'APPL','CFBundleShortVersionString':VERSION.split('-')[0],'CFBundleVersion':'1','ChromaReleaseVersion':VERSION,'CFBundleIconFile':'AppIcon','LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,'NSPrincipalClass':'NSApplication','NSHumanReadableCopyright':'Independent editor. Not affiliated with Hologram Electronics.','LSApplicationCategoryType':'public.app-category.music'},file)
iconset = BUILD / 'AppIcon.iconset'
subprocess.run(['xcrun','swift',str(ROOT/'macOS'/'Resources'/'Icon.swift'),str(iconset)],check=True)
subprocess.run(['iconutil','-c','icns',str(iconset),'-o',str(contents/'Resources'/'AppIcon.icns')],check=True)
subprocess.run(['xattr','-cr',str(APP)],check=True)
subprocess.run(['codesign','--force','--sign','-','--options','runtime',str(APP)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(APP)],check=True)
print(APP)

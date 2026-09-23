#!/usr/bin/env python3
"""Compile and run native validation and an isolated CoreMIDI loopback test."""
import pathlib, subprocess
ROOT = pathlib.Path(__file__).resolve().parent
BUILD = ROOT / '.build'
BUILD.mkdir(exist_ok=True)
for name, sources in [
    ('NativeTests', ['Sources/Safety.swift','Sources/Store.swift','Sources/MIDIService.swift','Tests/SafetyTests.swift']),
    ('TransportTests', ['Sources/Safety.swift','Sources/MIDIService.swift','Tests/TransportTests.swift'])
]:
    output = BUILD/name
    subprocess.run(['xcrun','swiftc','-swift-version','5','-parse-as-library','-O',*[str(ROOT/p) for p in sources],'-framework','CoreMIDI','-o',str(output)],check=True)
    subprocess.run([str(output)],check=True)

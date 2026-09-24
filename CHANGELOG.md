# Changelog

## 1.0.0-beta.5 · build 5

- Display the full version in the native window title and app header.
- Keep About, build metadata, source version and release filenames consistent.
- Include the clearer preset bank layout and step-by-step saving guide from the previous local build.

## 1.0.0-beta.4

- Clearer separation between saving editor settings on the Mac, applying a sound, and saving it into pedal memory.
- Numbered physical-pedal saving instructions, destination checks, completion lights and cancellation steps.
- Show all 80 slots as four module banks, each with five labelled colour groups of four slots.
- Explain the 500-preset library limit and dependencies on existing pedal slots.

## 1.0.0-beta.3

- Enlarged effect descriptions to 14 px at every window size, with brighter text and more spacing.
- Added a screenshot walkthrough of the Sound, Presets, Performance and MIDI activity pages to the README.

## 1.0.0-beta.2

- Removed the "Independent Mac app" label from the app sidebar.

## 1.0.0-beta.1

Initial community beta for Apple Silicon Macs.

- Standalone AppKit/WebKit app with native USB MIDI control.
- Effect selection, primary/secondary parameters, Engage, performance controls and pedal preset recall.
- Local preset library with import/export and automatic editing-session storage.
- Documented-command validation at both the UI and native transport boundaries.
- MIDI activity monitoring with separate clock diagnostics.
- Stable Apply behavior during live edits and clearer module hints.
- Simulator, protocol tests and interface regression checks.

Known limitations: no documented pedal preset readback or remote slot saving; no physical-knob parameter feedback observed. Intel Macs are not supported by this build. The app is not Apple-notarized.

# Chroma Console Studio

A standalone macOS MIDI editor for the **Hologram Electronics Chroma Console**. Control the pedal over USB from a desktop app, with a local preset library and a dark interface.

Independent community software. Not affiliated with or endorsed by Hologram Electronics.

## Download and install

Get the `.dmg` from [Releases](https://github.com/georgekorpas/chroma-console-studio/releases). Open it, drag **Chroma Console.app** into **Applications**, then eject the disk image.

**Requirements:** Apple Silicon Mac (M1 or later), macOS 13 or later, a powered Chroma Console and a USB data cable. This release does not support Intel Macs. Runtime testing has been on macOS 26.1; earlier supported versions have not yet been independently tested. No browser, Python installation or developer tools are needed to run the app.

**This beta is ad-hoc signed and is not Apple-notarized.** macOS may block its first launch. If you trust this project's download, first try opening the installed app, then use **System Settings → Privacy & Security → Open Anyway** if macOS offers that option. Confirm the app-specific prompt. See [Apple's instructions](https://support.apple.com/en-us/102445). An organization-managed Mac may restrict this option. The installer does not change macOS security settings.

`SHA256SUMS.txt` is included with each release to check download integrity. In the download folder, run `shasum -a 256 -c SHA256SUMS.txt` after downloading both release assets named in that file.

## Connect and play

1. Power Chroma Console normally and connect it to your Mac by USB.
2. Launch the app. A single connected Chroma Console is selected automatically.
3. Match the MIDI channel to the pedal; channel 1 is the default.
4. Choose an effect, move a parameter or use the Engage toggle. Changes send immediately while connected.

USB carries MIDI control, not audio. Listen through the pedal's audio connections. Engage/Bypass controls the effects; it does not switch the pedal's electrical power.

## Features

- All 20 effects and module Off choices, with the pedal's effect colours.
- Primary and secondary parameter controls, Filter style and Capture routing.
- Engage/bypass, tap tempo, Capture and Gesture commands.
- Recall of 80 pedal preset slots, A01–D20.
- Named local presets with notes, search, JSON import/export and removal undo.
- Automatic saving of the current editing session.
- MIDI activity monitoring, with clock separated from control messages.
- An isolated simulator and built-in diagnostics.

Live control starts when the pedal connects. Starting, reconnecting and restoring the editor session do **not** replay saved settings. **Apply unsent edits** explicitly sends prepared settings. Loading a local preset prepares its values; **Apply loaded preset** sends its saved controls and optional base-preset recall.

## What the pedal can and cannot report

The app follows supported incoming CC and Program Change messages. In hands-on testing, physical knob changes did **not** produce parameter feedback from the pedal. Full two-way knob synchronization and reading the pedal's current sound are therefore unavailable in the tested setup.

Local presets store known parameter overrides, optionally based on a pedal slot. They are **not full pedal backups**. The published MIDI interface does not provide remote internal-slot saving, preset dumps/readback, module reordering, expression assignment or dual-bypass group assignment. Configure these on the pedal. Captured audio, Gesture recordings, tapped tempo, calibration and bypass state are excluded from local presets.

Dedicated module bypass is an opt-in compatibility feature for existing pedal firmware that supports it. The editor does not query or update firmware. The effect list's **Off** choice is available independently.

## Device access

The app sends only allowlisted documented MIDI CC messages and Program Changes 0–79. Both JavaScript and native Swift validate the outgoing commands. There is no raw MIDI output operation, SysEx, WebUSB, updater, firmware query, bootloader operation or reset command.

The app uses native CoreMIDI and bundled WebKit assets. It has no accounts, analytics, cloud storage or continuous outgoing MIDI clock. Hologram's default MIDI routing can forward USB commands to downstream DIN MIDI devices on the same channel.

## Data and shortcuts

Presets and session data are stored in `~/Library/Application Support/Chroma Console Studio/`. Use **File → Show Preset Files** to find them, and export your library to keep a backup. Replacing the app during an update leaves this data separate from the app bundle.

- `⌘S`: open the preset-save form.
- `⌘O` / `⌘E`: import / export a preset library.
- `⌘1`–`⌘5`: navigate the workspace.
- `⌘R`: refresh MIDI ports.
- `⌘,`: settings and help.

## Build, test and package

Building requires macOS, Python 3, and an installed Apple SDK/Swift toolchain. The reference build uses Xcode 26.3. There are no third-party runtime dependencies.

```sh
python3 macOS/test.py
python3 macOS/package.py
```

The package command builds the app, verifies its local signature, creates a compressed DMG, verifies the image, and writes a clean source ZIP and SHA-256 checksums into `dist/`. It does not contact Apple or access the pedal.

**Help → Protocol Diagnostics** runs the protocol suite without hardware access. Its **Run interface checks (simulated)** link tests rapid slider edits and Apply behavior in an isolated view. See [the developer guide](macOS/README.md) and [release instructions](RELEASING.md).

The browser edition remains available for development: run `python3 server.py` and visit `http://127.0.0.1:8765` in a browser with Web MIDI support. Add `?demo=1` for the simulator, or `?demo=1&test=ui` for interface checks.

## Feedback

This is an initial public beta. When reporting a problem, include the app version, macOS version, Mac model and steps to reproduce it. Describe whether the issue happens with the simulator or the physical pedal. Avoid including personal preset libraries unless you intend to share them.

Protocol reference: [official Chroma Console manual](https://www.hologramelectronics.com/pages/chroma-console-manual).

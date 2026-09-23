# macOS development

The app embeds the shared HTML/CSS/JavaScript interface in WebKit and transports MIDI through CoreMIDI. No external runtime is required by users.

## Commands

```sh
python3 macOS/build.py          # Normal app in macOS/dist/
python3 macOS/build.py --simulator
python3 macOS/test.py           # Native validation/storage and isolated transport tests
python3 macOS/package.py        # Normal build, DMG, source ZIP and checksums
```

`VERSION` controls release filenames and the app's displayed release version. The build targets `arm64-apple-macos13.0`. It applies a local ad-hoc signature with the hardened runtime. It does not sign with Developer ID or perform notarization.

The package script rejects a simulator build and checks the app version and architecture before packaging. Outputs are in `dist/`; they are excluded from Git. Rebuilding the same version requires `--overwrite` to replace existing release files.

## Boundaries

The native WebKit bridge accepts requests only from the bundled main page. The only outgoing hardware operations are typed CC and Program Change requests. Swift independently validates command values and the selected normal Chroma MIDI endpoint. There is no arbitrary byte, SysEx, USB, reset or updater operation.

Library/session files are schema-validated and stored atomically in Application Support. Native simulator storage is separate from the real session. Diagnostics opens a separate WebKit view without the native bridge.

Sleep and MIDI endpoint changes invalidate the transport generation. Deferred live edits are cancelled on editor/connection changes. Successful native sends are recorded only after the CoreMIDI call succeeds; this is not an acknowledgement from the pedal.

## Tests

- `macOS/test.py`: native command/schema validation, storage round trips, and three MIDI messages to a temporary virtual test destination. It does not send to a physical pedal.
- **Help → Protocol Diagnostics**: 20 JavaScript checks, including exhaustive CC/PC validation and deferred-send behavior.
- **Run interface checks (simulated)** inside diagnostics: four checks that exercise real UI events, delayed simulated sends, Apply visibility, Clear positioning, quiet status and hint styling.

The browser equivalent is `http://127.0.0.1:8765/?demo=1&test=ui` after running `python3 server.py`.

The beta has been exercised on an Apple Silicon Mac running macOS 26.1 with a real Chroma Console. Earlier OS versions, Intel architecture and all pedal firmware variants have not been validated. Transport lifecycle boundaries have automated coverage; this is not a claim of exhaustive hardware testing.

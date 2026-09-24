# Publishing a GitHub release

This project distributes community builds without Apple Developer ID signing or notarization. Keep that fact visible in the release notes.

1. Update `VERSION` and `CHANGELOG.md`.
2. Run `python3 macOS/test.py` and the app's protocol/interface diagnostics.
3. Run `python3 macOS/package.py`.
4. Open the DMG, confirm it contains the app, Applications shortcut and installation notes, and check its contents before publishing.
5. Push the source repository to GitHub. Do not commit `dist/`, `macOS/.build/`, `macOS/dist/`, local preset/session files or signing credentials.
6. Create a GitHub Release with the matching tag, such as `v1.0.0-beta.1`, and mark beta versions as **pre-release**.
7. Attach the DMG, source ZIP and `SHA256SUMS.txt` from `dist/` as release assets. Use the matching changelog entry and include the first-launch note below.

## First-launch release note

> Apple Silicon only; macOS 13 or later. This beta is ad-hoc signed and not Apple-notarized. macOS may block its first launch. If you trust this download, try opening the installed app, then use System Settings → Privacy & Security → Open Anyway if offered. See the included installation notes and [Apple's guidance](https://support.apple.com/en-us/102445).

Keep a backup of presets when replacing the installed app. The public source ZIP uses an explicit allowlist and contains no personal preset library or session.

The local code-signature and disk-image integrity checks do not imply approval by Apple or an accepted Gatekeeper assessment. No security setting changes or quarantine-removal scripts are included.

GitHub instructions: [Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Version consistency

`VERSION` holds the full release version (including beta suffix), and `BUILD_NUMBER` is an increasing integer for macOS. Update both before distributing a new build. The native title, header and About panel read the bundled metadata generated from these files. Keep the README version, changelog, GitHub tag (`v` + `VERSION`) and release asset names aligned. Packaging rejects mismatched release or build metadata.

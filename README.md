# FlowClicker

FlowClicker’s shipped Desktop Playback records click-only flows and replays them using the **physical OS mouse**. A separate Windows-first Browser Playback direction is now in scope as a disposable WebView2 experiment; it does not alter Desktop Playback and will not enter the main app until Gate 4 has live Windows evidence.

See [`experiments/webview2-input-poc`](experiments/webview2-input-poc/README.md) for the active Gates 0–4 experiment. All live gates are currently **NOT RUN**.

## Download a portable release

Each [GitHub release](https://github.com/iamdevlinph/flow-clicker/releases/latest)
provides a Windows x64 executable, a Linux x64 AppImage, and an Apple Silicon
macOS app archive. No installer is required.

- Windows: download `flowclicker.exe` and run it. Windows may show an
  unknown-publisher warning because the executable is not code-signed.
- Linux: download `FlowClicker_<version>_amd64.AppImage`, make it executable
  with `chmod +x`, and run it from an X11 session.
- macOS: extract `FlowClicker_<version>_aarch64.app.tar.gz`, move the app to
  Applications, and open it. The build is ad-hoc signed rather than notarized,
  so macOS may require approval in Privacy & Security. Accessibility permission
  is required for recording, playback, and global hotkeys.

## What is included

- One Tauri/Rust project for Windows and macOS development.
- Framework-free frontend (`HTML + CSS + TypeScript`) compiled to browser JavaScript with plain `tsc`.
- Node.js 24+ and pnpm 10.15.1 are required for strict TypeScript 7 checks, Vitest tests, and builds.
- Physical mouse playback through the cross-platform Rust `enigo` crate.
- Global click observation and hotkeys through `rdev`.
- Windows foreground-window-relative coordinates.
- macOS and Linux screen-coordinate playback paths already share the recorder/playback code; window-relative tracking is a later platform module.

## Core features

- Flow library showing every recorded flow.
- Search and select flows from the left-side list.
- Check multiple flows to combine them.
- Checkbox **selection order is the combine order** and is shown with numbered badges.
- Combining creates a brand-new flow and leaves every source flow unchanged.
- Import Actions editor: choose another flow, select individual actions, and import at the beginning, end, or after the currently selected action.
- Imported actions are independent copies with fresh IDs; the source flow is never modified.
- Named click and delay steps.
- Click-only recording with delay before every click.
- Explicit delay actions.
- Manual click/delay steps.
- Duplicate, delete, and move actions.
- Repeat by count, for a duration, until a local time, or continuously.
- Playback speed multiplier.
- Configurable mouse settle and hold timing.
- Configurable global record/play hotkeys.
- Optional cursor restoration after playback.
- Optional focusing of the recorded target window.
- Passive click-map overlay and interactive draggable-point overlay.
- Local JSON persistence only.

## Build the Windows executable from WSL or macOS

Prerequisites:

1. Either Ubuntu running under WSL with `sudo`, or macOS with
   [Homebrew](https://brew.sh/) installed.
2. Network access for toolchain and dependency downloads.
3. Microsoft Edge WebView2 Runtime on the destination Windows system (normally
   already installed on current Windows 10/11).

The build script installs missing Ubuntu packages under WSL or Homebrew LLVM on
macOS, plus Rust stable, the `x86_64-pc-windows-msvc` target, and `cargo-xwin` as
needed. It downloads the Microsoft CRT and Windows SDK files required for the
MSVC build under Microsoft's license. You do **not** need Visual Studio.

Then run:

```bash
./scripts/build-windows-wsl.sh
```

The raw executable will be:

```text
src-tauri/target/x86_64-pc-windows-msvc/release/flowclicker.exe
```

The build script also copies it to:

```text
dist/FlowClicker.exe
```

The first Cargo build downloads the Rust crates listed in `src-tauri/Cargo.toml`; end users do not need those packages installed separately.

## Linux (Ubuntu-family x86_64)

Build on Ubuntu, Lubuntu, or an Ubuntu-family derivative (including an Ubuntu
WSL host) with an x86_64 kernel:

```bash
./scripts/build-linux.sh
```

The script installs only missing Tauri/X11 build packages and installs Rust
stable and Tauri CLI 2 when they are not already available. It writes unsigned
local artifacts to `dist/`:

```text
dist/FlowClicker.AppImage
dist/FlowClicker.deb
```

To run the AppImage without installing it:

```bash
chmod +x FlowClicker.AppImage
./FlowClicker.AppImage
```

If Lubuntu opens it as an archive, use the terminal commands above instead of
double-clicking it.

To install and launch the Debian package:

```bash
sudo apt install ./FlowClicker.deb
flowclicker
```

If APT says the download is being performed unsandboxed because `_apt` cannot
access the file, copy it to `/tmp` and install it from there:

```bash
cp FlowClicker.deb /tmp/
sudo apt install /tmp/FlowClicker.deb
```

That message is only a warning if installation otherwise completes.

Linux physical recording, playback, and global hotkeys currently require an
X11 session. Linux playback is screen-coordinate-only; Wayland input support
and Linux window-relative tracking are not included yet.

## macOS

The same Tauri app and the same recorder/playback engine are intended to build on macOS. `rdev` and `enigo` both require macOS Accessibility permission for global input observation/control. The current v1.0.0 platform layer uses screen coordinates on macOS; Windows-style window-relative tracking is isolated in `src-tauri/src/platform.rs` so a Quartz/CGWindow implementation can be added without rewriting the flow engine or UI.

Build the unsigned Apple Silicon application bundle with:

```bash
./scripts/build-macos.sh
```

The bundle is written to `dist/FlowClicker.app`. Open it in Finder to run FlowClicker without a Terminal window. macOS may require Accessibility permission for recording, playback, and global hotkeys.

Signing, notarization, and DMG packaging are not included. Use Tauri's macOS distribution workflow when preparing the app for other Macs.

## Coordinate behavior

Each Windows recording stores both:

- absolute screen coordinates; and
- coordinates relative to the foreground window plus its title.

During playback FlowClicker tries to find the recorded window by title and applies the relative coordinates to its current position. If it cannot resolve that window it falls back to the recorded absolute screen coordinates.

This allows the target window to move between recording and playback in common cases. A future improvement should match by process executable/window metadata rather than title alone.

## Source layout

```text
src/                          static Tauri frontend
  index.html
  styles.css
  app.ts (emits app.js)
  overlay.html
  overlay.css
  overlay.ts (emits overlay.js)

src-tauri/
  Cargo.toml
  tauri.conf.json
  src/
    main.rs                   Tauri commands and overlay window
    input.rs                  rdev recorder/hotkeys + enigo playback
    models.rs                 serialized action/playback models
    platform.rs               Windows window-relative layer; macOS fallback
    storage.rs                local JSON persistence

AGENTS.md                     Codex-oriented continuation notes
```

## Safety / behavior

Physical playback controls the real pointer. Keep the intended target visible and avoid interacting with the mouse while a flow is running. If another application covers the target coordinate, that other application can receive the click.

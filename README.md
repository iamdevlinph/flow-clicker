# FlowClicker Tauri v2.0.0

FlowClicker has been redesigned as a cross-platform Tauri desktop app that records click-only flows and replays them using the **physical OS mouse**. Browser background-tab clicking is intentionally out of scope for this version.

## What is included

- One Tauri/Rust project for Windows and macOS development.
- Framework-free frontend (`HTML + CSS + JavaScript`) — **no Node/npm frontend toolchain is required**.
- Physical mouse playback through the cross-platform Rust `enigo` crate.
- Global click observation and hotkeys through `rdev`.
- Windows foreground-window-relative coordinates.
- macOS screen-coordinate path already shares the recorder/playback code; window-relative tracking is a later platform module.
- A prebuilt Windows x64 **FlowClickerWindowsProbe.exe** so native mouse behavior can be tested immediately.

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
- Repeat by cycles, total clicks, duration, or continuously.
- Playback speed multiplier.
- Configurable mouse settle and hold timing.
- Configurable global record/play hotkeys.
- Optional cursor restoration after playback.
- Optional focusing of the recorded target window.
- Passive click-map overlay and interactive draggable-point overlay.
- Local JSON persistence only.

## Immediate Windows test — no Rust required

Open:

```text
prebuilt/windows/FlowClickerWindowsProbe.exe
```

The probe is intentionally small and dependency-free at runtime. It is not the full UI; it verifies the most important new assumption: **does physical Windows mouse input work with the target?**

Controls:

```text
F8          start / stop recording
F9          replay with the physical mouse
F10         clear the captured flow
Ctrl+Alt+Q  exit
```

Record a short sequence with F8, stop it with F8, return the target to its starting state, and press F9. The cursor will physically move and click.

## Build the full Tauri app on Windows

Prerequisites:

1. Rust stable via rustup.
2. Microsoft Visual Studio Build Tools with **Desktop development with C++**.
3. Microsoft Edge WebView2 Runtime (normally already installed on current Windows 10/11).

You do **not** need Node/npm for this repository.

Then run:

```bat
scripts\build-windows.bat
```

or directly:

```bat
cargo build --release --manifest-path src-tauri\Cargo.toml
```

The raw executable will be:

```text
src-tauri\target\release\flowclicker.exe
```

The build script also copies it to:

```text
dist\FlowClicker.exe
```

The first Cargo build downloads the Rust crates listed in `src-tauri/Cargo.toml`; end users do not need those packages installed separately.

## macOS

The same Tauri app and the same recorder/playback engine are intended to build on macOS. `rdev` and `enigo` both require macOS Accessibility permission for global input observation/control. The current v2.0.0 platform layer uses screen coordinates on macOS; Windows-style window-relative tracking is isolated in `src-tauri/src/platform.rs` so a Quartz/CGWindow implementation can be added without rewriting the flow engine or UI.

Build the raw macOS executable with:

```bash
./scripts/build-macos.sh
```

For a normal signed/notarized `.app`, use Tauri's normal macOS bundling/signing workflow on a Mac.

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
  app.js
  overlay.html
  overlay.css
  overlay.js

src-tauri/
  Cargo.toml
  tauri.conf.json
  src/
    main.rs                   Tauri commands and overlay window
    input.rs                  rdev recorder/hotkeys + enigo playback
    models.rs                 serialized action/playback models
    platform.rs               Windows window-relative layer; macOS fallback
    storage.rs                local JSON persistence

prebuilt/windows/
  FlowClickerWindowsProbe.exe
  probe_source/main.go

AGENTS.md                     Codex-oriented continuation notes
```

## Safety / behavior

Physical playback controls the real pointer. Keep the intended target visible and avoid interacting with the mouse while a flow is running. If another application covers the target coordinate, that other application can receive the click.

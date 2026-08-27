# WebView2 trusted-input proof of concept

Disposable Stage A experiment for FlowClicker. It compares a physical click
with a WebView2 CDP replay without using `SendInput`, `enigo`, `rdev`, DOM
dispatch, or `.click()` playback.

## Run (Windows)

Install Rust, the WebView2 Evergreen Runtime, and Tauri's Windows prerequisites,
then from this directory run:

```text
cargo tauri dev --manifest-path src-tauri/Cargo.toml
```

To cross-build the executable from WSL, run from the repository root:

```text
./scripts/build-webview2-poc-windows-wsl.sh
```

This writes `dist/FlowClicker-WebView2-Input-POC.exe`. Prerequisites:

```text
sudo apt install clang lld llvm file
cargo install --locked cargo-xwin
```

Rust must be installed through `rustup`.

The `game` window starts at `about:blank`, installs diagnostics, then navigates
only to `https://pockieninja.online/` (including subdomains). Its persistent
profile is `%LOCALAPPDATA%\FlowClicker\webview-profile`.

## Gate

This is Stage A only. Arm capture, physically activate a resettable game
control, reset it without moving the target, then replay with hands off the
mouse. Record the ordered trusted pointer/mouse sequence, equal cursor
snapshots, and actual game activation in this file. Do not add flows, storage,
hooks, scheduling, hotkeys, or a successor app until a Windows PASS exists.

Live result: **NOT RUN** (requires a Windows WebView2 runtime and explicit
physical-input approval).

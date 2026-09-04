# WebView2 trusted-input proof of concept

Disposable Gates 0–4 experiment for FlowClicker. It compares a physical click
with a WebView2 CDP replay without using `SendInput`, `enigo`, `rdev`, DOM
dispatch, or `.click()` playback.

## Run (Windows)

Install Node.js 24+, pnpm 10.15.1, Rust, the WebView2 Evergreen Runtime, and Tauri's Windows prerequisites,
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

The single taskbar window is a decorated, non-resizable host with an exact
1600×900 CSS game viewport. Native minimize and close remain available while
maximize is disabled. A separate 460×752 FlowClicker child WebView floats
inside it, starts at (20,20), and can only be dragged within the host. The
transparent click-map overlay is an implementation-only top-level window;
interactive map mode temporarily hides and then restores the child panel.

The game WebView starts at `about:blank`, installs diagnostics, then navigates
to `https://pockieninja.online/` (including subdomains). The FlowClicker child
WebView is the only local control surface; there is no target-switch or bundled
controlled page. Its persistent profile is `%LOCALAPPDATA%\FlowClicker\webview-profile`.

## Live gates

Run Gate 0 on the game and record hover, button/link/canvas, pointer/mouse
events, scrolling, keyboard input, host bounds/styles, foreground HWND, cursor,
`WindowFromPoint`, and ancestors. Gate 1 must report `1+1 = 2` and a distinct
invalid-CDP error. Gate 2 proves one browser-local click sequence while cursor
snapshots match. Gate 3 requires operator confirmation of a resettable game-state
change. After Gate 3, Gate 4 repeats the same click while
foreground, unfocused-visible, partially covered, and fully covered. Stop must
leave the browser open. Never record secrets or unsanitized query strings.

- Gate 0 game: **NOT RUN**
- Gate 1: **NOT RUN**
- Gate 2: **NOT RUN**
- Gate 3: **NOT RUN**
- Gate 4 foreground/unfocused/partially covered/fully covered: **NOT RUN**

Paste one sanitized block after each run:

```text
Date / Windows / WebView2 runtime:
Gate / target / visibility:
Sanitized URL / viewport / DPR / zoom:
Host diagnostics:
Cursor and foreground HWND before / after:
Physical sequence / replay sequence:
Activation result:
Operator result: PASS | FAIL
Notes:
```

Live verification requires Windows WebView2 and explicit physical-input approval.

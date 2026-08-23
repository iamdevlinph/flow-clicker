FlowClickerWindowsProbe.exe
===========================

This prebuilt executable is a Windows x64 physical-mouse smoke test produced from the Go source in probe_source/main.go.
It is NOT the full Tauri UI. It exists so you can verify immediately whether OS-level mouse playback works with your target before installing Rust/Tauri build prerequisites.

Controls:
  F8         Start / stop click-only recording
  F9         Replay the captured clicks using the real Windows cursor
  F10        Clear the in-memory click flow
  Ctrl+Alt+Q Exit

The recorded delay before each click is preserved.

Safety:
Playback physically moves and clicks the mouse. Keep the target visible and do not use the mouse while playback is running.
The probe stores nothing on disk and makes no network connections.

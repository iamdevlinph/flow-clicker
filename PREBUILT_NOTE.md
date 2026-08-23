# About the included Windows EXE

`prebuilt/windows/FlowClickerWindowsProbe.exe` is a native Windows x64 smoke-test executable, not the full Tauri GUI.

The current build environment is Linux and does not have the Windows Tauri/MSVC/WebView2 build toolchain, so a trustworthy full Tauri `.exe` cannot be produced here. Rather than provide an untested or mislabeled binary, the repository includes a Windows executable cross-compiled from the dependency-free Go source beside it.

The probe implements the critical behavior needed for the next test:
- global F8 click-only recording;
- delay-before-click retention;
- F9 physical mouse playback;
- F10 clear;
- Ctrl+Alt+Q exit.

If the probe succeeds on the target, build the full GUI on Windows with `scripts/build-windows.bat`.

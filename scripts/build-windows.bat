@echo off
setlocal
cd /d "%~dp0\.."
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo was not found.
  echo Install Rust from https://rustup.rs and Microsoft C++ Build Tools, then run this file again.
  exit /b 1
)
if not exist dist mkdir dist
echo Building FlowClicker release executable...
cargo build --release --manifest-path src-tauri\Cargo.toml
if errorlevel 1 exit /b 1
copy /Y src-tauri\target\release\flowclicker.exe dist\FlowClicker.exe >nul
echo.
echo Built: %CD%\dist\FlowClicker.exe

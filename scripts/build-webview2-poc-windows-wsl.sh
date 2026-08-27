#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${WSL_INTEROP:-}" ]] && ! grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  echo "This script requires WSL." >&2
  exit 1
fi

command -v cargo >/dev/null || { echo "Rust/Cargo is required: https://rustup.rs" >&2; exit 1; }
command -v rustup >/dev/null || { echo "rustup is required: https://rustup.rs" >&2; exit 1; }
command -v cargo-xwin >/dev/null || { echo "cargo-xwin is required: cargo install --locked cargo-xwin" >&2; exit 1; }
command -v file >/dev/null || { echo "The file command is required." >&2; exit 1; }
for tool in clang lld llvm-rc; do
  command -v "$tool" >/dev/null || { echo "$tool is required: sudo apt install clang lld llvm" >&2; exit 1; }
done

target=x86_64-pc-windows-msvc
manifest=experiments/webview2-input-poc/src-tauri/Cargo.toml
artifact=experiments/webview2-input-poc/src-tauri/target/$target/release/webview2-input-poc.exe
output=dist/FlowClicker-WebView2-Input-POC.exe

rustup target add "$target"
cargo xwin build --release --target "$target" --manifest-path "$manifest"
mkdir -p dist
cp "$artifact" "$output"

description=$(file -b "$output")
case "$description" in
  *PE32+*x86-64*"for MS Windows"*) ;;
  *) echo "Expected a 64-bit Windows executable: $description" >&2; exit 1 ;;
esac

printf '\nBuilt: %s/%s\n' "$PWD" "$output"

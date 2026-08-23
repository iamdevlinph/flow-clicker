#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null || { echo "Rust/Cargo is required: https://rustup.rs"; exit 1; }
mkdir -p dist
cargo build --release --manifest-path src-tauri/Cargo.toml
cp src-tauri/target/release/flowclicker dist/FlowClicker
printf '\nBuilt: %s/dist/FlowClicker\n' "$PWD"
printf 'For a signed .app bundle, install tauri-cli and run: cargo tauri build\n'

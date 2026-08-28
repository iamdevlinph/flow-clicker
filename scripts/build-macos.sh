#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v pnpm >/dev/null || { echo "pnpm 10.15.1 is required: https://pnpm.io/installation" >&2; exit 1; }
pnpm install --frozen-lockfile
pnpm build

if ! command -v cargo >/dev/null && [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

command -v cargo >/dev/null || { echo "Rust/Cargo is required: https://rustup.rs" >&2; exit 1; }
command -v cargo-tauri >/dev/null || {
  echo 'Tauri CLI 2 is required: cargo install tauri-cli --version "^2.0.0" --locked' >&2
  exit 1
}

cargo tauri build --bundles app
mkdir -p dist
rm -rf dist/FlowClicker.app
rm -f dist/FlowClicker
cp -R src-tauri/target/release/bundle/macos/FlowClicker.app dist/FlowClicker.app
printf '\nBuilt: %s/dist/FlowClicker.app\n' "$PWD"

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

command -v pnpm >/dev/null || { echo "pnpm 10.15.1 is required: https://pnpm.io/installation" >&2; exit 1; }
pnpm install --frozen-lockfile
pnpm build

if [[ "$(uname -s)" != Linux* || ! -f /etc/os-release ]] ||
  ! grep -q '^ID=ubuntu' /etc/os-release ||
  [[ -z "${WSL_INTEROP:-}" ]] && ! grep -qi microsoft /proc/sys/kernel/osrelease; then
  echo "This script requires Ubuntu under WSL." >&2
  exit 1
fi

packages=(build-essential curl clang lld llvm file)
missing=()
for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' || missing+=("$package")
done
if ((${#missing[@]})); then
  sudo apt-get update
  sudo apt-get install -y "${missing[@]}"
fi

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
if ! command -v cargo >/dev/null 2>&1; then
  source "${CARGO_HOME:-$HOME/.cargo}/env"
fi
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

rustup target add x86_64-pc-windows-msvc
if ! command -v cargo-xwin >/dev/null 2>&1; then
  cargo install --locked cargo-xwin
fi

target=x86_64-pc-windows-msvc
cargo_artifact="src-tauri/target/$target/release/flowclicker.exe"
dist_artifact="dist/FlowClicker.exe"

echo "Building FlowClicker Windows release executable..."
cargo xwin build --release --target "$target" --manifest-path src-tauri/Cargo.toml
mkdir -p dist
cp "$cargo_artifact" "$dist_artifact"

for artifact in "$cargo_artifact" "$dist_artifact"; do
  [[ -f "$artifact" ]] || { echo "Missing build artifact: $artifact" >&2; exit 1; }
  description=$(file -b "$artifact")
  case "$description" in
    *PE32+*x86-64*"for MS Windows"*)
      printf 'Windows PE artifact: %s (%s)\n' "$artifact" "$description"
      ;;
    *)
      echo "Expected a 64-bit Windows PE executable: $artifact ($description)" >&2
      exit 1
      ;;
  esac
done

printf '\nBuilt: %s/%s\n' "$PWD" "$dist_artifact"

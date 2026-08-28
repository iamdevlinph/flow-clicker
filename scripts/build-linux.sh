#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

command -v pnpm >/dev/null || { echo "pnpm 10.15.1 is required: https://pnpm.io/installation" >&2; exit 1; }
pnpm install --frozen-lockfile
pnpm build

die() {
  echo "Linux build failed: $*" >&2
  exit 1
}

[[ "$(uname -s)" == Linux* ]] || die "this script requires Linux"
[[ "$(uname -m)" == x86_64 ]] || die "this script requires Ubuntu-family x86_64"
[[ -r /etc/os-release ]] || die "cannot identify the Linux distribution"

# Lubuntu reports ID=ubuntu on current releases; ID_LIKE covers Ubuntu-family derivatives.
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == ubuntu || "${ID:-}" == lubuntu || " ${ID_LIKE:-} " =~ [[:space:]]ubuntu[[:space:]] ]] ||
  die "this script requires Ubuntu-family Linux (found ${ID:-unknown})"

packages=(
  build-essential
  curl
  file
  libssl-dev
  libwebkit2gtk-4.1-dev
  libx11-dev
  libxdo-dev
  libxi-dev
  libxkbcommon-dev
  libxrandr-dev
  libxtst-dev
  libayatana-appindicator3-dev
  librsvg2-dev
  pkg-config
  wget
)
missing=()
for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' || missing+=("$package")
done
if ((${#missing[@]})); then
  command -v sudo >/dev/null 2>&1 || die "sudo is required to install missing packages: ${missing[*]}"
  sudo apt-get update
  sudo apt-get install -y "${missing[@]}"
fi

if ! command -v cargo >/dev/null 2>&1; then
  if ! command -v rustup >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  fi
  source "${CARGO_HOME:-$HOME/.cargo}/env"
fi
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
command -v cargo >/dev/null 2>&1 || die "Rust/Cargo is required"

if ! command -v cargo-tauri >/dev/null 2>&1 || [[ "$(cargo tauri --version)" != "tauri-cli 2."* ]]; then
  cargo install tauri-cli --version '^2.0.0' --locked
fi
[[ "$(cargo tauri --version)" == "tauri-cli 2."* ]] || die "Tauri CLI 2 is required"

echo "Building FlowClicker Linux release bundles..."
bundle_dir=src-tauri/target/release/bundle
rm -rf "$bundle_dir/appimage" "$bundle_dir/deb"
cargo tauri build --bundles appimage,deb

shopt -s nullglob
appimages=("$bundle_dir/appimage"/*.AppImage)
debs=("$bundle_dir/deb"/*.deb)
((${#appimages[@]} == 1)) || die "expected one AppImage in $bundle_dir/appimage"
((${#debs[@]} == 1)) || die "expected one Debian package in $bundle_dir/deb"

appimage=${appimages[0]}
deb=${debs[0]}
appimage_description=$(file -b "$appimage")
case "$appimage_description" in
  *"ELF 64-bit"*"x86-64"*) ;;
  *) die "expected an x86_64 AppImage ($appimage_description)" ;;
esac

[[ -f "$deb" ]] || die "missing Debian package: $deb"
[[ "$(dpkg-deb --field "$deb" Architecture)" == amd64 ]] ||
  die "expected an amd64 Debian package"

mkdir -p dist
cp "$appimage" dist/FlowClicker.AppImage
cp "$deb" dist/FlowClicker.deb
chmod +x dist/FlowClicker.AppImage

[[ -x dist/FlowClicker.AppImage ]] || die "AppImage is not executable: dist/FlowClicker.AppImage"
file -b dist/FlowClicker.AppImage | grep -q 'ELF 64-bit.*x86-64' ||
  die "invalid AppImage: dist/FlowClicker.AppImage"
[[ "$(dpkg-deb --field dist/FlowClicker.deb Architecture)" == amd64 ]] ||
  die "invalid Debian package: dist/FlowClicker.deb"

printf '\nBuilt:\n  %s/dist/FlowClicker.AppImage\n  %s/dist/FlowClicker.deb\n' "$PWD" "$PWD"

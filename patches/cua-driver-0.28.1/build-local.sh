#!/usr/bin/env bash
# Build and stage an isolated local app. Does not install, launch, reset TCC,
# alter provider settings, or stop either driver daemon.
set -euo pipefail

patch_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir="${1:-$patch_dir/source}"
base_commit=d8028a7943087ee258dc1b4d19dc12a7cd27669c
patch_file="$patch_dir/single-window-recording.patch"
output_dir="$patch_dir/build"

if [[ ! -d "$source_dir/.git" ]]; then
  git clone --depth 1 --branch cua-driver-rs-v0.28.1 https://github.com/trycua/cua.git "$source_dir"
fi
if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$base_commit" ]]; then
  echo "Expected Cua Driver v0.28.1 ($base_commit); refusing to patch another revision." >&2
  exit 1
fi
if git -C "$source_dir" apply --reverse --check "$patch_file" 2>/dev/null; then
  echo "Patch already applied."
else
  git -C "$source_dir" apply --check "$patch_file"
  git -C "$source_dir" apply "$patch_file"
fi

manifest="$source_dir/libs/cua-driver/rust/Cargo.toml"
cargo test --locked --manifest-path "$manifest" -p cua-driver-core \
  --test recording_video_target --test observation_projection --test recording_capture_authorization
cargo test --locked --manifest-path "$manifest" -p platform-macos --lib video_sckit
cargo build --locked --release --manifest-path "$manifest" -p cua-driver

app="$output_dir/CuaDriverLocal.app"
if [[ -e "$app" ]]; then
  echo "$app already exists. Move it aside explicitly before staging another signed build." >&2
  exit 1
fi
mkdir -p "$app/Contents/MacOS"
cp -R "$source_dir/libs/cua-driver/rust/scripts/CuaDriverBundle/Contents/." "$app/Contents/"
cp "$source_dir/libs/cua-driver/rust/target/release/cua-driver" "$app/Contents/MacOS/cua-driver-local"
rm -f "$app/Contents/MacOS/.gitkeep"
chmod +x "$app/Contents/MacOS/cua-driver-local"
plist="$app/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleIdentifier -string com.trycua.driver.local "$plist"
/usr/bin/plutil -replace CFBundleExecutable -string cua-driver-local "$plist"
/usr/bin/plutil -replace CFBundleName -string 'Cua Driver Local' "$plist"
/usr/bin/plutil -replace CFBundleDisplayName -string 'Cua Driver Local' "$plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string 0.28.1-local-window1 "$plist"
/usr/bin/plutil -replace CFBundleVersion -string 2026091901 "$plist"
# The build is intentionally a different identity from the official Developer ID app.
/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --deep --strict "$app"
shasum -a 256 "$app/Contents/MacOS/cua-driver-local" > "$output_dir/SHA256SUMS"
echo "Staged $app"
echo "Local app permissions must be granted separately before native recording can be validated."

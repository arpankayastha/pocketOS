#!/usr/bin/env bash
# Builds the signed GRANDXGAMER APK into ../public/download/ (served at grandxgamer.vercel.app/download/).
#   GX_KEYSTORE_PASSWORD=… ./build-release.sh
# Needs the Android SDK (sdk.dir in local.properties or ANDROID_HOME) and JDK 17+.
# Bump gx.versionCode / versionName in gradle.properties first, so phones see the update.
set -euo pipefail
cd "$(dirname "$0")"
: "${GX_KEYSTORE_PASSWORD:?Set GX_KEYSTORE_PASSWORD - the owner keeps it in the GRANDXGAMER Vault}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in release.keystore.enc -out "$tmp/release.jks" -pass env:GX_KEYSTORE_PASSWORD
export GX_KEYSTORE="$tmp/release.jks"
./gradlew --console=plain -q testDebugUnitTest assembleRelease
code=$(grep '^gx.versionCode=' gradle.properties | cut -d= -f2)
name=$(grep '^gx.versionName=' gradle.properties | cut -d= -f2)
out=../public/download
mkdir -p "$out"
cp app/build/outputs/apk/release/app-release.apk "$out/grandxgamer.apk"
size=$(stat -c %s "$out/grandxgamer.apk")
sha=$(sha256sum "$out/grandxgamer.apk" | cut -d' ' -f1)
printf '{ "versionCode": %s, "versionName": "%s", "size": %s, "sha256": "%s", "date": "%s" }\n' "$code" "$name" "$size" "$sha" "$(date +%F)" > "$out/version.json"
echo "Built GRANDXGAMER $name ($code): $out/grandxgamer.apk"

#!/usr/bin/env bash
# Builds the signed eChopdo APK into ../public/download/ (served at echopdo.vercel.app/download/).
#   ECHOPDO_KEYSTORE_PASSWORD=… ./build-release.sh
# Needs the Android SDK (sdk.dir in local.properties or ANDROID_HOME) and JDK 17+.
# Bump echopdo.versionCode / versionName in gradle.properties first, so phones see the update.
set -euo pipefail
cd "$(dirname "$0")"
: "${ECHOPDO_KEYSTORE_PASSWORD:?Set ECHOPDO_KEYSTORE_PASSWORD - it is kept in the eChopdo Vault}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in release.keystore.enc -out "$tmp/release.jks" -pass env:ECHOPDO_KEYSTORE_PASSWORD
export ECHOPDO_KEYSTORE="$tmp/release.jks"
./gradlew --console=plain -q testDebugUnitTest assembleRelease
code=$(grep '^echopdo.versionCode=' gradle.properties | cut -d= -f2)
name=$(grep '^echopdo.versionName=' gradle.properties | cut -d= -f2)
out=../public/download
mkdir -p "$out"
cp app/build/outputs/apk/release/app-release.apk "$out/echopdo.apk"
size=$(stat -c %s "$out/echopdo.apk")
sha=$(sha256sum "$out/echopdo.apk" | cut -d' ' -f1)
printf '{ "versionCode": %s, "versionName": "%s", "size": %s, "sha256": "%s", "date": "%s" }\n' "$code" "$name" "$size" "$sha" "$(date +%F)" > "$out/version.json"
echo "Built eChopdo $name ($code): $out/echopdo.apk"

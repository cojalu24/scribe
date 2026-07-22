#!/usr/bin/env bash
# Builds the self-contained Scribe Mac app: compiles the web app, bundles it
# into the Electron shell, ad-hoc signs it (required to run on Apple Silicon),
# and zips it for distribution.
set -e
cd "$(dirname "$0")"

# 1. Build the web app (one level up).
(cd .. && npm install && npm run build)

# 2. Bundle the built site into the desktop app.
rm -rf dist && cp -R ../dist dist && rm -f dist/_headers

# 3. Package, sign, zip.
npm install
npx @electron/packager . "Scribe" \
  --platform=darwin --arch=arm64 \
  --icon=icon.icns --extend-info=extend.plist \
  --extra-resource=./dist --ignore="^/dist($|/)" \
  --overwrite --out=build

codesign --force --deep --sign - "build/Scribe-darwin-arm64/Scribe.app"
(cd build/Scribe-darwin-arm64 && ditto -c -k --keepParent "Scribe.app" ../../Scribe-mac.zip)

echo "Built desktop/Scribe-mac.zip"

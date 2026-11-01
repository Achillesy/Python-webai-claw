#!/bin/bash
# Build a Chrome Web Store-ready zip from extension/.
# - Strips the dev-only "key" field so the store assigns its own extension ID.
# - Validates that the manifest references only files included in the package.
# - Does not modify the repository's extension/ directory.
# Usage: bash store/build.sh   (run from the repository root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension"
VER="$(python3 -c "import json;print(json.load(open('$SRC/manifest.json'))['version'])")"
TMP="$(mktemp -d)"
OUT="$ROOT/store/webai-claw-store-$VER.zip"

rm -rf "$TMP/build"
mkdir -p "$TMP/build"
cp -r "$SRC/." "$TMP/build/"

python3 - "$TMP/build/manifest.json" <<'EOF'
import json
import sys

path = sys.argv[1]
manifest = json.load(open(path, encoding="utf-8"))
manifest.pop("key", None)
json.dump(manifest, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open(path, "a", encoding="utf-8").write("\n")
print("store manifest: key stripped, version", manifest["version"])
EOF

python3 - "$TMP/build" <<'EOF'
import json
import os
import sys

build = sys.argv[1]
manifest = json.load(open(os.path.join(build, "manifest.json"), encoding="utf-8"))
refs = set()
for content_script in manifest.get("content_scripts", []):
    refs.update(content_script.get("js", []))
for name in ("default_popup",):
    value = manifest.get("action", {}).get(name)
    if value:
        refs.add(value)
service_worker = manifest.get("background", {}).get("service_worker")
if service_worker:
    refs.add(service_worker)
refs.update(manifest.get("icons", {}).values())
for rel in sorted(refs):
    path = os.path.join(build, rel)
    if not os.path.isfile(path):
        sys.exit("ERROR: manifest references missing file: %s" % rel)
print("manifest check OK: %d referenced files present" % len(refs))
EOF

find "$TMP/build" -name '*.bak' -delete

rm -f "$OUT"
(cd "$TMP/build" && zip -qr "$OUT" .)
rm -rf "$TMP"
echo "built: $OUT"
echo "Upload this zip in the Chrome Web Store developer dashboard."

#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

python3 -m unittest discover -s tests -v
node tests/test_protocol_parser.js
node tests/test_background_split.js

python3 -m py_compile \
  native-host/host.py \
  native-host/hostlib/constants.py \
  native-host/hostlib/skills.py \
  native-host/install.py \
  native-host/uninstall.py

for f in \
  extension/protocol.js \
  extension/background.js \
  extension/background-ui.js \
  extension/content.js \
  extension/popup.js \
  extension/onboarding.js \
  extension/adapters/deepseek.js \
  extension/adapters/muse.js
do
  node --check "$f"
done

echo "all tests passed"

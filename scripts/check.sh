#!/bin/bash
# Validate the manifest, run the Node tests, and lint the QML against the
# installed Omarchy shell so `qs.Commons` / `qs.Ui` actually resolve.
#
#   scripts/check.sh            # all checks
#   QMLLINT=/path/to/qmllint scripts/check.sh

set -euo pipefail

cd "$(dirname "$0")/.."

OMARCHY_PATH="${OMARCHY_PATH:-/usr/share/omarchy}"
QMLLINT="${QMLLINT:-$(command -v qmllint || echo /usr/lib/qt6/bin/qmllint)}"
status=0

echo "== omarchy plugin validate"
omarchy plugin validate . || status=1

echo "== node --test"
if command -v node >/dev/null; then
  node --test tests/ || status=1
else
  echo "node not found; skipping tests" >&2
  status=1
fi

echo "== qmllint"
if [[ ! -x $QMLLINT ]]; then
  echo "qmllint not found (install qt6-declarative); skipping" >&2
  exit 1
fi

# Quickshell maps the `qs` import prefix to the shell root at runtime. Recreate
# that mapping in a throwaway import dir (outside the plugin tree, which must
# stay symlink-free).
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
ln -s "$OMARCHY_PATH/shell" "$root/qs"

out=$("$QMLLINT" -I "$root" -I /usr/lib/qt6/qml *.qml 2>&1) || status=1
printf '%s\n' "$out"
# qmllint exits 0 on warnings; treat unresolved imports as failures so a broken
# import path cannot pass silently.
if grep -Eq 'Failed to import|\[(import|unresolved-type|inheritance-cycle)\]' <<<"$out"; then
  echo "qmllint: unresolved imports or types" >&2
  status=1
fi

exit $status

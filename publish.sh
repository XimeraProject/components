#!/usr/bin/env bash
#
# Publish the Ximera packages to npm.
#
#   ./publish.sh --list      show what would be published (no packing, no publish)
#   ./publish.sh --dry-run   run `npm publish --dry-run` for each (packs, but does not upload)
#   ./publish.sh             publish for real
#
# Packages are published in dependency order so the scoped `*` cross-deps
# (@ximera/choice, @ximera/core, @ximera/foldable) already exist on the
# registry by the time their dependents go up. Any package whose exact
# name@version is already on the registry is skipped, so re-running after a
# mid-list failure is safe.
#
# Notes:
#  - Scoped packages publish public via each package.json's
#    publishConfig.access — no --access flag needed.
#  - @ximera/core runs `npm run build:latex` in its `prepare` script, so
#    pdflatex/make/tex4ht must be on PATH when publishing (and on --dry-run,
#    which also packs).
#  - If your npm 2FA level is "auth and publish", npm will prompt for a
#    one-time code per package. Codes expire every ~30s, so either lower the
#    level to "auth only" or be ready to type a fresh code each time.

set -euo pipefail

# Dependency order: leaves first, dependents after. tex4npm is unscoped.
PACKAGES=(
  core            # @ximera/core     — no ximera deps
  choice          # @ximera/choice   — no ximera deps
  foldable        # peer: core
  proof
  verbatim
  video
  xkcd
  dialogue
  chrome
  answer          # peer: core
  free-response   # peer: core
  hint            # peer: core, foldable
  multiple-choice # dep: choice ; peer: core
  select-all      # dep: choice ; peer: core
  word-choice     # dep: choice ; peer: core
  tex4npm         # unscoped build tool
)

MODE="publish"
case "${1:-}" in
  --list)    MODE="list" ;;
  --dry-run) MODE="dry-run" ;;
  "")        MODE="publish" ;;
  *) echo "usage: $0 [--list | --dry-run]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Confirm we're authenticated before doing anything (skipped for --list).
if [[ "$MODE" != "list" ]]; then
  if ! whoami_out="$(npm whoami 2>/dev/null)"; then
    echo "Not logged in to npm (npm whoami failed)." >&2
    echo "Check the _authToken line in your ~/.npmrc, or run: npm login" >&2
    exit 1
  fi
  echo "npm user: $whoami_out"
fi

published=0
skipped=0
for dir in "${PACKAGES[@]}"; do
  name="$(node -p "require('./$dir/package.json').name")"
  version="$(node -p "require('./$dir/package.json').version")"

  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip    $name@$version  (already on registry)"
    skipped=$((skipped + 1))
    continue
  fi

  case "$MODE" in
    list)
      echo "publish $name@$version  (from $dir/)"
      ;;
    dry-run)
      echo "== dry-run $name@$version =="
      ( cd "$dir" && npm publish --dry-run )
      published=$((published + 1))
      ;;
    publish)
      echo "== publishing $name@$version =="
      ( cd "$dir" && npm publish )
      published=$((published + 1))
      ;;
  esac
done

echo "----"
if [[ "$MODE" == "list" ]]; then
  echo "planned: $((${#PACKAGES[@]} - skipped)) to publish, $skipped already on registry"
else
  echo "done: $published published, $skipped skipped"
fi

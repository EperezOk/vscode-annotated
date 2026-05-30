#!/usr/bin/env bash
# Install the annotated-agent skill into a Claude Code skills directory.
#
# Usage:
#   ./install.sh                 # symlink into ~/.claude/skills/annotated-agent (global)
#   ./install.sh --copy          # copy instead of symlink
#   ./install.sh --repo <path>   # install into <path>/.claude/skills/annotated-agent
#   ./install.sh --help
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
NAME="annotated-agent"
MODE="symlink"
DEST_ROOT="$HOME/.claude/skills"

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy"; shift ;;
    --repo) DEST_ROOT="${2:?--repo needs a path}/.claude/skills"; shift 2 ;;
    --help|-h)
      sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

DEST="$DEST_ROOT/$NAME"
mkdir -p "$DEST_ROOT"
rm -rf "$DEST"
if [ "$MODE" = "copy" ]; then
  cp -R "$SRC" "$DEST"
  echo "Copied $NAME -> $DEST"
else
  ln -s "$SRC" "$DEST"
  echo "Symlinked $NAME -> $DEST"
fi

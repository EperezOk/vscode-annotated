#!/usr/bin/env bash
#
# release.sh — cut a new vscode-annotated release.
#
# Bumps the version, gathers CHANGELOG notes, runs the gate, commits, tags,
# builds the .vsix, and pushes the branch + tag to origin (after a confirmation).
#
# Usage:
#   scripts/release.sh <patch|minor|major|X.Y.Z> [options]
#
# Options:
#   --skip-tests   Skip the gate (check-types + test:unit). Not recommended.
#   --no-package   Don't build the .vsix (just bump + commit + tag).
#   --no-push      Don't push; print the push commands instead.
#   --yes, -y      Push without the interactive confirmation.
#   --dry-run      Print what would happen; change nothing.
#   -h, --help     Show this help.
#
# Flow:
#   1. Require a clean working tree (only CHANGELOG.md may be modified).
#   2. Compute the target version from the argument.
#   3. If CHANGELOG.md has no "## [<version>]" section, insert a dated scaffold
#      pre-filled with the commit subjects since the last tag, then stop so you
#      can edit it. Re-run the same command to release.
#   4. Run the gate, bump package.json + lockfile, commit "chore(release): <v>",
#      create annotated tag v<v>, and build the .vsix (keeping only the new one).
#   5. Push <branch> + v<v> to origin (confirm first; skip with --no-push).
set -euo pipefail

usage() { sed -n '3,27p' "$0" | sed 's/^#\( \|$\)//'; }
die() { printf 'release: %s\n' "$1" >&2; exit 1; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not in a git repository"
cd "$ROOT"

BUMP=""; SKIP_TESTS=0; NO_PACKAGE=0; NO_PUSH=0; ASSUME_YES=0; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1 ;;
    --no-package) NO_PACKAGE=1 ;;
    --no-push)    NO_PUSH=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    -h|--help)    usage; exit 0 ;;
    -*)           die "unknown option: $1 (see --help)" ;;
    *) [ -z "$BUMP" ] || die "unexpected argument: $1"; BUMP="$1" ;;
  esac
  shift
done
[ -n "$BUMP" ] || { usage; exit 2; }

# 1. Working tree must be clean except for CHANGELOG.md (the scaffold/edit step).
#    A dry run only previews, so it warns instead of blocking.
OTHER_DIRTY=$(git status --porcelain | cut -c4- | grep -vx 'CHANGELOG.md' || true)
if [ -n "$OTHER_DIRTY" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    printf 'release: [dry-run] note — a real run needs a clean tree; these are uncommitted:\n%s\n' "$OTHER_DIRTY"
  else
    die "uncommitted changes besides CHANGELOG.md — commit or stash first:
$OTHER_DIRTY"
  fi
fi

# 2. Compute target version.
CURRENT=$(node -p "require('./package.json').version")
case "$BUMP" in
  major|minor|patch)
    TARGET=$(node -e '
      const [maj,min,pat] = process.argv[1].split(".").map(Number);
      const t = process.argv[2];
      const v = t === "major" ? [maj+1,0,0] : t === "minor" ? [maj,min+1,0] : [maj,min,pat+1];
      process.stdout.write(v.join("."));
    ' "$CURRENT" "$BUMP") ;;
  [0-9]*.[0-9]*.[0-9]*) TARGET="$BUMP" ;;
  *) die "invalid version '$BUMP' (expected patch|minor|major|X.Y.Z)" ;;
esac
[ "$TARGET" != "$CURRENT" ] || die "target $TARGET equals current version — nothing to bump"
TAG="v$TARGET"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then die "tag $TAG already exists"; fi

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -n "$LAST_TAG" ]; then RANGE="$LAST_TAG..HEAD"; SINCE="since $LAST_TAG"; else RANGE="HEAD"; SINCE="(full history)"; fi
printf 'release: %s → %s  (notes %s)\n' "$CURRENT" "$TARGET" "$SINCE"

# 3. CHANGELOG section: scaffold-and-stop if missing.
if ! grep -qF "## [$TARGET]" CHANGELOG.md 2>/dev/null; then
  DATE=$(date +%F)
  COMMITS=$(git log $RANGE --no-merges --pretty='- %s' | grep -v '^- chore(release):' || true)
  [ -n "$COMMITS" ] || COMMITS="- (no commits $SINCE)"
  if [ "$DRY_RUN" = 1 ]; then
    printf 'release: [dry-run] would insert into CHANGELOG.md:\n\n## [%s] — %s\n\n### Added / Changed / Fixed\n\n%s\n' "$TARGET" "$DATE" "$COMMITS"
    exit 0
  fi
  COMMITS_B64=$(printf '%s' "$COMMITS" | base64)
  node -e '
    const fs = require("fs");
    const [target, date, commitsB64] = process.argv.slice(1);
    const commits = Buffer.from(commitsB64, "base64").toString("utf8");
    const section = `## [${target}] — ${date}\n\n### Added / Changed / Fixed\n\n${commits}\n`;
    const path = "CHANGELOG.md";
    let doc = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "# Changelog\n\n";
    const m = doc.search(/^## \[/m);
    doc = m >= 0 ? doc.slice(0, m) + section + "\n" + doc.slice(m)
                 : doc.replace(/\s*$/, "\n\n") + section;
    fs.writeFileSync(path, doc);
  ' "$TARGET" "$DATE" "$COMMITS_B64"
  printf 'release: inserted "## [%s] — %s" scaffold into CHANGELOG.md (%s).\n  Edit & trim it, then re-run:  scripts/release.sh %s\n' "$TARGET" "$DATE" "$SINCE" "$BUMP"
  exit 1
fi

# 4. Release.
if [ "$DRY_RUN" = 1 ]; then
  printf 'release: [dry-run] CHANGELOG section present; would:\n'
  printf '  • gate: check-types + test:unit%s\n' "$([ "$SKIP_TESTS" = 1 ] && echo ' (SKIPPED)')"
  printf '  • bump package.json + lockfile to %s (format-preserving)\n' "$TARGET"
  printf '  • git commit "chore(release): %s"  (package.json, package-lock.json, CHANGELOG.md)\n' "$TARGET"
  printf '  • git tag -a %s -m %s\n' "$TAG" "$TAG"
  printf '  • %s\n' "$([ "$NO_PACKAGE" = 1 ] && echo 'skip vsix' || echo "vsce package → vscode-annotated-$TARGET.vsix")"
  printf '  • %s\n' "$([ "$NO_PUSH" = 1 ] && echo 'skip push (--no-push)' || echo "push $(git rev-parse --abbrev-ref HEAD) + $TAG to origin$([ "$ASSUME_YES" = 1 ] || echo ' (confirm first)')")"
  exit 0
fi

if [ "$SKIP_TESTS" = 1 ]; then
  echo "release: skipping gate (--skip-tests)"
else
  echo "release: gate — check-types + test:unit…"
  npm run check-types
  npm run test:unit
fi

# Bump the version in package.json + lockfile with a targeted line edit. (npm
# version re-serializes package.json and would flatten its hand-compacted JSON.)
node -e '
  const fs = require("fs");
  const [cur, next] = process.argv.slice(1);
  const re = new RegExp("(\"version\"\\s*:\\s*\")" + cur.replace(/\./g, "\\.") + "(\")", "g");
  const bump = (file, max) => {
    if (!fs.existsSync(file)) return 0;
    let n = 0;
    const out = fs.readFileSync(file, "utf8").replace(re, (m, a, b) => (n++ < max ? a + next + b : m));
    fs.writeFileSync(file, out);
    return n;
  };
  if (bump("package.json", 1) < 1) { console.error("release: package version not found in package.json"); process.exit(1); }
  bump("package-lock.json", 2);
' "$CURRENT" "$TARGET"
echo "release: bumped to $TARGET"

git add package.json package-lock.json CHANGELOG.md
git commit -q -m "chore(release): $TARGET"
git tag -a "$TAG" -m "$TAG"
echo "release: committed + annotated tag $TAG"

if [ "$NO_PACKAGE" = 1 ]; then
  echo "release: skipping vsix (--no-package)"
else
  echo "release: building vsix…"
  npx --yes @vscode/vsce package --no-dependencies
  find . -maxdepth 1 -name '*.vsix' ! -name "vscode-annotated-$TARGET.vsix" -delete
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
push_hint() { printf 'release: push when ready:\n    git push origin %s\n    git push origin %s\n' "$BRANCH" "$TAG"; }

if [ "$NO_PUSH" = 1 ]; then
  printf '\nrelease: %s ready locally (not pushed, --no-push).\n' "$TARGET"
  push_hint
  exit 0
fi

if [ "$ASSUME_YES" != 1 ]; then
  printf '\nrelease: push %s + %s to origin? [y/N] ' "$BRANCH" "$TAG"
  read -r reply </dev/tty 2>/dev/null || reply=""
  case "$reply" in
    y|Y|yes|YES) ;;
    *) printf 'release: %s ready locally (not pushed).\n' "$TARGET"; push_hint; exit 0 ;;
  esac
fi

git push origin "$BRANCH"
git push origin "$TAG"
printf 'release: pushed %s + %s to origin.\n' "$BRANCH" "$TAG"

#!/usr/bin/env bash
set -euo pipefail

branch="${1:-$(git branch --show-current)}"

if [[ -z "${branch}" ]]; then
  echo "Could not determine current branch. Pass one explicitly: scripts/publish.sh main" >&2
  exit 1
fi

git diff --quiet
git diff --cached --quiet

git push origin "${branch}"
git push origin --tags

if git remote get-url gitcode >/dev/null 2>&1; then
  if [[ -n "${GITCODE_TOKEN:-}" ]]; then
    askpass="$(mktemp)"
    cleanup() {
      rm -f "${askpass}"
    }
    trap cleanup EXIT
    cat >"${askpass}" <<'ASKPASS'
#!/usr/bin/env sh
case "$1" in
  *Username*) echo "${GITCODE_USER:-huqi}" ;;
  *) echo "${GITCODE_TOKEN}" ;;
esac
ASKPASS
    chmod 700 "${askpass}"
    GIT_ASKPASS="${askpass}" GIT_TERMINAL_PROMPT=0 git push gitcode "${branch}"
    GIT_ASKPASS="${askpass}" GIT_TERMINAL_PROMPT=0 git push gitcode --tags
  else
    git push gitcode "${branch}"
    git push gitcode --tags
  fi
else
  echo "Remote 'gitcode' not configured; skipped GitCode push." >&2
fi

echo "Published ${branch} to origin and gitcode."

#!/usr/bin/env bash
set -euo pipefail

export NPM_CONFIG_PROVENANCE="true"

echo "Publish attempt 1/2: npm trusted publishing (OIDC)."
if pnpm run release:publish; then
  echo "Publish succeeded with OIDC."
  exit 0
fi

oidc_exit=$?

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "::error::OIDC publish failed and NPM_TOKEN is not configured."
  echo "::error::Set repository secret NPM_TOKEN to enable fallback publish."
  exit "${oidc_exit}"
fi

echo "::warning::OIDC publish failed (known npm/cli issue path, e.g. npm/cli#8730)."
echo "::warning::Falling back to NPM_TOKEN for publish."

rm -f "$HOME/.npmrc" .npmrc
printf "//registry.npmjs.org/:_authToken=%s\n" "$NPM_TOKEN" > "$HOME/.npmrc"
npm config set registry https://registry.npmjs.org/

echo "Publish attempt 2/2: NPM_TOKEN fallback."
pnpm run release:publish

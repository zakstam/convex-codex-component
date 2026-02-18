#!/usr/bin/env bash
set -euo pipefail

export NPM_CONFIG_PROVENANCE="true"

# Keep OIDC publish clean by removing any pre-existing npm auth config.
rm -f "$HOME/.npmrc" .npmrc
npm config set registry https://registry.npmjs.org/
npm config delete always-auth || true

echo "Publish attempt 1/2: npm trusted publishing (OIDC)."
set +e
pnpm run release:publish
oidc_exit=$?
set -e

if [ "${oidc_exit}" -eq 0 ]; then
  echo "Publish succeeded with OIDC."
  exit 0
fi

if [ -z "${FALLBACK_NPM_TOKEN:-}" ]; then
  echo "::error::OIDC publish failed and FALLBACK_NPM_TOKEN is not configured."
  echo "::error::Set repository secret NPM_TOKEN (wired to FALLBACK_NPM_TOKEN) to enable fallback publish."
  exit "${oidc_exit}"
fi

echo "::warning::OIDC publish failed (known npm/cli issue path, e.g. npm/cli#8730)."
echo "::warning::Falling back to NPM_TOKEN for publish."

rm -f "$HOME/.npmrc" .npmrc
printf "//registry.npmjs.org/:_authToken=%s\n" "$FALLBACK_NPM_TOKEN" > "$HOME/.npmrc"
npm config set registry https://registry.npmjs.org/

echo "Publish attempt 2/2: NPM_TOKEN fallback."
pnpm run release:publish

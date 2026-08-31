#!/usr/bin/env bash
# Reproduces the deterministic checks from .github/workflows/ci.yml, so they
# can fail here instead of on the PR. Run this through bin/ci, not directly —
# that script wires up isolated volumes for deps/_build/assets/node_modules.
# lazy_html has a C extension, which this container compiles for Linux; if
# those directories were bind-mounted from the host they'd collide with
# whatever platform your host already built them for.
set -euo pipefail
cd "$(dirname "$0")/.."

# MIX_ENV=test is scoped to individual commands below, matching
# ci.yml exactly — not exported, because the browser suite further down
# shells out to `mix dev`, which needs the default :dev env (dev/ isn't on
# the :test elixirc_paths, so an inherited MIX_ENV=test breaks it there).

echo "==> mix deps.get"
mix deps.get

echo "==> mix format --check-formatted"
mix format --check-formatted

echo "==> mix deps.unlock --check-unused"
mix deps.unlock --check-unused

echo "==> mix compile --warnings-as-errors"
MIX_ENV=test mix compile --warnings-as-errors

echo "==> mix test --cover"
MIX_ENV=test mix test --cover

# In :dev, matching ci.yml: dev/ is on the :dev elixirc_paths, so the playground
# is checked too. The first run builds the PLT into _build/plts, which bin/ci
# keeps in a volume — later runs cost a couple of seconds.
echo "==> mix dialyzer"
mix dialyzer

echo "==> npm ci (assets)"
npm ci --prefix assets

echo "==> npm test (assets)"
npm test --prefix assets

echo "==> npm run build (assets) — checking priv/static is up to date"
npm run build --prefix assets
if ! git diff --quiet -- priv/static; then
  echo "priv/static is out of date. Run 'mix assets.build' and commit the result." >&2
  git diff --stat -- priv/static
  exit 1
fi

if [ "${SKIP_BROWSER:-0}" = "1" ]; then
  echo "==> Skipping browser suite (SKIP_BROWSER=1)"
else
  echo "==> Browser suite (Playwright)"
  npx --prefix assets playwright install chromium --with-deps
  npm run test:browser --prefix assets
fi

echo "All checks passed."

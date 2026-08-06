# Toolchain only. Source is bind-mounted at runtime by bin/ci, so this image
# rarely needs rebuilding — only when the toolchain itself changes. Matches
# the strictest leg of .github/workflows/ci.yml (elixir 1.19.5 / otp 28.1 /
# node 22): the one that runs formatting, unused-deps, and lint checks.
#
# Node is copied from the official node image rather than installed via a
# curl-piped setup script, so nothing here executes an arbitrary remote
# script to get a toolchain in place.
FROM node:22-bookworm-slim AS node

FROM elixir:1.19.5-otp-28

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN mix local.hex --force && mix local.rebar --force

WORKDIR /app

CMD ["bash", "docker/checks.sh"]

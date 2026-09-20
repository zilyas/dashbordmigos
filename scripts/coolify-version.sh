#!/usr/bin/env bash
#
# Compare the running Coolify instance against the latest published release.
#
# Coolify has no unauthenticated version endpoint — /api/health answers a bare
# "OK" with no version in it — so this needs a token with the `read` ability.
# A `deploy`-only token will not work: Coolify's token UI makes `deploy`
# mutually exclusive with every other ability.
#
#   COOLIFY_URL=http://194.163.143.60:8000 COOLIFY_TOKEN=... scripts/coolify-version.sh
#
# ponytail: prints the upgrade command rather than running it. Upgrading is a
# root-shell action on the host that restarts the whole control plane, so it
# stays a deliberate, human-run step. Automate it only if you also automate
# the instance backup that Coolify's docs ask for first.
set -euo pipefail

: "${COOLIFY_URL:?set COOLIFY_URL, e.g. http://194.163.143.60:8000}"
: "${COOLIFY_TOKEN:?set COOLIFY_TOKEN (an API token with the read ability)}"

base="${COOLIFY_URL%/}"

# Plain text, not JSON: the endpoint returns the bare version string.
current=$(curl --fail-with-body --silent --show-error --location \
  --header "Authorization: Bearer $COOLIFY_TOKEN" \
  "$base/api/v1/version")

# The CDN file is what upgrade.sh itself reads, so it is the same notion of
# "latest" the upgrade would install — not a GitHub release-tag guess.
# tr first: the file is pretty-printed, so "v4" and its "version" key sit on
# different lines and a line-oriented sed never sees them together.
latest=$(curl --fail --silent --show-error --location \
  https://cdn.coollabs.io/coolify/versions.json | tr -d '\n\r ' |
  sed -nE 's/.*"v4":\{"version":"([^"]+)".*/\1/p')

echo "running: $current"
echo "latest:  ${latest:-unknown}"

if [ -z "$latest" ]; then
  echo "Could not read the latest version from the CDN; nothing to compare."
  exit 0
fi

if [ "$current" = "$latest" ]; then
  echo "Up to date."
  exit 0
fi

cat <<MSG

An upgrade is available: $current -> $latest

Before upgrading:
  1. Back up the instance: Settings > Configuration > Backup.
  2. Read the release notes: https://github.com/coollabsio/coolify/releases
  3. Let any running deployment finish.

Then, as root on the Coolify host:
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash

The same script installs and upgrades. Note that it passes SKIP_BACKUP=true to
upgrade.sh, so it does NOT back anything up for you — step 1 is the backup.
MSG
exit 1

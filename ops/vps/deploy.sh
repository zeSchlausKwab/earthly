#!/usr/bin/env bash
# Build and deploy the current Earthly worktree as a staged VPS release.

set -euo pipefail

mode="${1:-}"
if [[ -n "$mode" && "$mode" != "--check" ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

deploy_env="${EARTHLY_DEPLOY_ENV:-.env.deploy}"
if [[ ! -f "$deploy_env" && "$deploy_env" == ".env.deploy" && -f .env ]]; then
  echo "Warning: using VPS_* values from legacy .env; copy .env.deploy.example to .env.deploy" >&2
  deploy_env=".env"
fi
[[ -f "$deploy_env" ]] || {
  echo "Deployment target not found. Copy .env.deploy.example to .env.deploy" >&2
  exit 1
}
[[ -f .env.production ]] || {
  echo "Production configuration not found. Copy .env.production.example to .env.production" >&2
  exit 1
}

# shellcheck disable=SC1090
source "$deploy_env"
: "${VPS_HOST:?VPS_HOST is required in $deploy_env}"
: "${VPS_USER:?VPS_USER is required in $deploy_env}"
: "${VPS_PATH:?VPS_PATH is required in $deploy_env}"

if [[ ! "$VPS_USER" =~ ^[A-Za-z0-9._-]+$ ]] ||
   [[ ! "$VPS_HOST" =~ ^[A-Za-z0-9._:-]+$ ]] ||
   [[ ! "$VPS_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
   [[ "$VPS_PATH" == "/" || "$VPS_PATH" == *"//"* ||
      "$VPS_PATH" == *"/../"* || "$VPS_PATH" == *"/.." ||
      "$VPS_PATH" == *"/./"* || "$VPS_PATH" == *"/." ]]; then
  echo "VPS_USER, VPS_HOST, or VPS_PATH contains unsupported shell characters" >&2
  exit 1
fi

for command_name in bun git ssh scp tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required deployment command is missing: $command_name" >&2
    exit 1
  }
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "A SHA-256 checksum command (sha256sum or shasum) is required" >&2
  exit 1
fi

echo "Validating production identities, URLs, and persistence..."
(
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
  bun scripts/validate-production-env.ts
)

if [[ "$mode" == "--check" ]]; then
  bash -n \
    ops/vps/deploy.sh \
    ops/vps/activate.sh \
    ops/vps/runtime.sh \
    ops/vps/rollback.sh \
    ops/vps/searxng.sh \
    ops/vps/setup.sh \
    ops/vps/start-cordn.sh \
    scripts/build-production.sh \
    scripts/ensure-pmtiles.sh
  echo "Deployment configuration and shell scripts are valid; no build, upload, or restart was performed."
  exit 0
fi

echo "Building the production browser bundle..."
bash scripts/build-production.sh

package_version="$(bun -p 'require("./package.json").version')"
git_commit="$(git rev-parse --short=12 HEAD)"
release_time="$(date -u +%Y%m%dT%H%M%SZ)"
release_suffix=""
runtime_paths=(
  contextvm
  ops/vps/activate.sh
  ops/vps/runtime.sh
  ops/vps/rollback.sh
  ops/vps/searxng.sh
  ops/vps/searxng
  ops/vps/services.config.cjs
  ops/vps/start-cordn.sh
  public
  relay
  scripts/ensure-pmtiles.sh
  scripts/validate-production-env.ts
  src
  bun.lock
  package.json
  tsconfig.json
)
if [[ -n "$(git status --porcelain --untracked-files=normal -- "${runtime_paths[@]}")" ]]; then
  release_suffix="-dirty"
fi
release_id="${package_version}-${release_time}-${git_commit}${release_suffix}"
if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Generated release identifier is unsafe: $release_id" >&2
  exit 1
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/earthly-deploy.XXXXXX")"
if [[ -z "$temporary_root" || ! -d "$temporary_root" ]]; then
  echo "Could not create deployment staging directory" >&2
  exit 1
fi
cleanup_local_release() {
  rm -rf -- "${temporary_root:?}"
}
trap cleanup_local_release EXIT

stage_dir="$temporary_root/release"
archive="$temporary_root/$release_id.tar.gz"
tracked_manifest="$temporary_root/runtime-files"
mkdir -p "$stage_dir"

git ls-files --cached --others --exclude-standard -z -- "${runtime_paths[@]}" > "$tracked_manifest"
while IFS= read -r -d '' relative_path; do
  case "$relative_path" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*_test.go|*/__tests__/*)
      continue
      ;;
  esac
  [[ -f "$relative_path" || -L "$relative_path" ]] || continue
  destination_dir="$stage_dir/$(dirname "$relative_path")"
  mkdir -p "$destination_dir"
  cp -pP "$relative_path" "$stage_dir/$relative_path"
done < "$tracked_manifest"
cp -pR dist "$stage_dir/dist"

RELEASE_ID="$release_id" PACKAGE_VERSION="$package_version" GIT_COMMIT="$git_commit" \
  bun -e '
    console.log(JSON.stringify({
      releaseId: process.env.RELEASE_ID,
      packageVersion: process.env.PACKAGE_VERSION,
      gitCommit: process.env.GIT_COMMIT,
      createdAt: new Date().toISOString(),
    }, null, 2))
  ' > "$stage_dir/release-manifest.json"

if find "$stage_dir" -type f \( -name '.env' -o -name '.env.*' \) -print -quit | grep -q .; then
  echo "Release staging unexpectedly contains an environment file" >&2
  exit 1
fi
if [[ -e "$stage_dir/relay/bin" || -e "$stage_dir/relay/data" ]]; then
  echo "Release staging unexpectedly contains ignored relay output" >&2
  exit 1
fi
if find "$stage_dir" -type l -print -quit | grep -q .; then
  echo "Release staging unexpectedly contains a symbolic link" >&2
  exit 1
fi
[[ -s "$stage_dir/dist/index.html" ]] || {
  echo "Production build did not emit dist/index.html" >&2
  exit 1
}

echo "Creating release $release_id..."
tar_args=(-czf "$archive")
if tar --version 2>&1 | grep -qi '^bsdtar'; then
  tar_args=(--no-xattrs --no-acls --no-fflags --no-mac-metadata "${tar_args[@]}")
else
  for metadata_flag in --no-xattrs --no-acls --no-fflags --no-mac-metadata; do
    if tar --help 2>&1 | grep -q -- "$metadata_flag"; then
      tar_args=("$metadata_flag" "${tar_args[@]}")
    fi
  done
fi
COPYFILE_DISABLE=1 tar "${tar_args[@]}" -C "$stage_dir" .

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

archive_sha256="$(sha256_file "$archive")"
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Could not calculate the release checksum" >&2
  exit 1
}

remote="${VPS_USER}@${VPS_HOST}"
remote_archive=".$release_id.tar.gz.next"
remote_checksum=".$release_id.sha256.next"
remote_environment=".$release_id.env.next"
remote_mapnolia=".$release_id.mapnolia.next"
remote_activator=".$release_id.activate.sh"

echo "Uploading release to ${remote}:${VPS_PATH}..."
ssh "$remote" "mkdir -p '$VPS_PATH'"
scp "$archive" "$remote:$VPS_PATH/$remote_archive"
ssh "$remote" "umask 077 && cat > '$VPS_PATH/$remote_environment'" < .env.production
mapnolia_argument="-"
if [[ -f mapnolia.config.json ]]; then
  ssh "$remote" "umask 077 && cat > '$VPS_PATH/$remote_mapnolia'" < mapnolia.config.json
  mapnolia_argument="$remote_mapnolia"
else
  echo "No local mapnolia.config.json; the previous VPS configuration will be retained"
fi
scp ops/vps/activate.sh "$remote:$VPS_PATH/$remote_activator"

checksum_entries="$(printf '%s  %s\n%s  %s\n%s  %s\n' \
  "$archive_sha256" "$remote_archive" \
  "$(sha256_file .env.production)" "$remote_environment" \
  "$(sha256_file ops/vps/activate.sh)" "$remote_activator")"
if [[ -f mapnolia.config.json ]]; then
  checksum_entries="$checksum_entries
$(printf '%s  %s' "$(sha256_file mapnolia.config.json)" "$remote_mapnolia")"
fi
printf '%s\n' "$checksum_entries" | \
  ssh "$remote" "umask 077 && cat > '$VPS_PATH/$remote_checksum'"

echo "Activating release on the VPS..."
ssh "$remote" \
  "cd '$VPS_PATH' && sha256sum -c '$remote_checksum' && chmod 700 '$remote_activator' && bash '$remote_activator' '$release_id' '$remote_archive' '$remote_checksum' '$remote_environment' '$mapnolia_argument'"

echo
echo "Deployment complete: $release_id"
echo "Status: ssh $remote 'cd $VPS_PATH/current && bash ops/vps/runtime.sh status'"
echo "Logs: ssh $remote 'pm2 logs'"

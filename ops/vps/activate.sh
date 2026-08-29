#!/usr/bin/env bash
# Verify, prepare, activate, and (on failure) roll back one uploaded release.

set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "Usage: $0 RELEASE_ID ARCHIVE CHECKSUM ENVIRONMENT MAPNOLIA_CONFIG_OR_DASH" >&2
  exit 1
fi

release_id="$1"
archive_name="$2"
checksum_name="$3"
environment_name="$4"
mapnolia_name="$5"

for upload_name in "$release_id" "$archive_name" "$checksum_name" "$environment_name"; do
  if [[ ! "$upload_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Unsafe release argument: $upload_name" >&2
    exit 1
  fi
done
if [[ "$mapnolia_name" != "-" && ! "$mapnolia_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Unsafe Mapnolia configuration argument" >&2
  exit 1
fi

app_root="$(pwd -P)"
if [[ "$app_root" == "/" || "$app_root" == "$HOME" ]]; then
  echo "Refusing to activate from a broad application root: $app_root" >&2
  exit 1
fi
release_root="$app_root/releases"
shared_dir="$app_root/shared"
new_release="$release_root/$release_id"
archive_path="$app_root/$archive_name"
checksum_path="$app_root/$checksum_name"
environment_path="$app_root/$environment_name"
mapnolia_path=""
[[ "$mapnolia_name" == "-" ]] || mapnolia_path="$app_root/$mapnolia_name"

if [[ "$new_release" != "$release_root/"* ]]; then
  echo "Release path escaped its root" >&2
  exit 1
fi
for required_upload in "$archive_path" "$checksum_path" "$environment_path"; do
  [[ -f "$required_upload" && ! -L "$required_upload" ]] || {
    echo "Required uploaded file is missing or unsafe: $required_upload" >&2
    exit 1
  }
done
if [[ -n "$mapnolia_path" && ( ! -f "$mapnolia_path" || -L "$mapnolia_path" ) ]]; then
  echo "Uploaded Mapnolia configuration is missing or unsafe" >&2
  exit 1
fi

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:/usr/local/go/bin:$PATH"
for command_name in bun go pm2 curl tar sha256sum install docker; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required deployment command is missing: $command_name" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  echo "The Docker Compose plugin is required" >&2
  exit 1
}

activation_complete=false
release_created=false
release_removable=true
temporary_dir=""
cleanup_activation() {
  rm -f -- "$archive_path" "$checksum_path" "$environment_path"
  [[ -z "$mapnolia_path" ]] || rm -f -- "$mapnolia_path"
  rm -f -- "$app_root/.$release_id.activate.sh"
  if [[ -n "$temporary_dir" ]]; then rm -rf -- "${temporary_dir:?}"; fi
  if [[ "$activation_complete" != "true" && "$release_created" == "true" && \
        "$release_removable" == "true" && \
        -d "$new_release" && ! -L "$new_release" && "$new_release" == "$release_root/"* ]]; then
    rm -rf -- "$new_release"
  fi
}
trap cleanup_activation EXIT

(cd "$app_root" && sha256sum -c "$checksum_name")
if tar -tzf "$archive_path" | grep -Eq '(^|/)\.\.(/|$)|^/'; then
  echo "Release archive contains an unsafe path" >&2
  exit 1
fi
if [[ -e "$new_release" || -L "$new_release" ]]; then
  echo "Release directory already exists: $new_release" >&2
  exit 1
fi

mkdir -p "$release_root" "$shared_dir/logs" "$shared_dir/data" \
  "$shared_dir/backups" "$shared_dir/bin"

migrate_persistent_item() {
  local target="$1"
  shift
  if [[ -L "$target" ]]; then
    echo "Persistent target is unexpectedly a symbolic link: $target" >&2
    exit 1
  fi
  local target_is_empty=false
  if [[ -d "$target" ]]; then
    if [[ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      return
    fi
    target_is_empty=true
  elif [[ -e "$target" ]]; then
    return
  fi
  local legacy_source staging_path
  for legacy_source in "$@"; do
    if [[ -e "$legacy_source" && ! -L "$legacy_source" ]]; then
      staging_path="$target.migrating-$release_id"
      if [[ -e "$staging_path" || -L "$staging_path" ]]; then
        echo "Incomplete persistent migration requires inspection: $staging_path" >&2
        exit 1
      fi
      cp -a -- "$legacy_source" "$staging_path"
      if [[ "$target_is_empty" == "true" ]]; then rmdir "$target"; fi
      mv "$staging_path" "$target"
      echo "Migrated persistent state: $legacy_source -> $target"
      return
    fi
  done
}

persistent_data_root="$shared_dir/data"
if [[ -d "$app_root/data" && ! -L "$app_root/data" ]]; then
  persistent_data_root="$app_root/data"
  echo "Referenced existing persistent relay and Cordn data without copying it"
elif [[ -e "$app_root/data" || -L "$app_root/data" ]]; then
  echo "Legacy application data path is not a safe directory: $app_root/data" >&2
  exit 1
else
  migrate_persistent_item "$shared_dir/data/events-lmdb" "$app_root/relay/data/events-lmdb"
  migrate_persistent_item "$shared_dir/data/large-event-content.db" \
    "$app_root/relay/data/large-event-content.db"
  migrate_persistent_item "$shared_dir/data/search" "$app_root/relay/data/search"
fi

persistent_backups_root="$shared_dir/backups"
if [[ -d "$app_root/backups" && ! -L "$app_root/backups" ]]; then
  persistent_backups_root="$app_root/backups"
  echo "Referenced existing persistent backups without copying them"
elif [[ -e "$app_root/backups" || -L "$app_root/backups" ]]; then
  echo "Legacy backup path is not a safe directory: $app_root/backups" >&2
  exit 1
fi

legacy_mapnolia_data="$app_root/mapnolia-data"
shared_mapnolia_data="$shared_dir/mapnolia-data"
if [[ -d "$legacy_mapnolia_data" && ! -L "$legacy_mapnolia_data" ]]; then
  if [[ -L "$shared_mapnolia_data" ]]; then
    [[ "$(readlink -f "$shared_mapnolia_data")" == "$legacy_mapnolia_data" ]] || {
      echo "Shared Mapnolia link points somewhere unexpected: $shared_mapnolia_data" >&2
      exit 1
    }
  elif [[ -d "$shared_mapnolia_data" ]]; then
    if [[ -n "$(find "$shared_mapnolia_data" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      echo "Both legacy and shared Mapnolia directories contain data; refusing to guess which is complete" >&2
      exit 1
    fi
    rmdir "$shared_mapnolia_data"
    ln -s "$legacy_mapnolia_data" "$shared_mapnolia_data"
    echo "Referenced existing persistent Mapnolia data without copying it"
  elif [[ -e "$shared_mapnolia_data" ]]; then
    echo "Shared Mapnolia path is not a directory: $shared_mapnolia_data" >&2
    exit 1
  else
    ln -s "$legacy_mapnolia_data" "$shared_mapnolia_data"
    echo "Referenced existing persistent Mapnolia data without copying it"
  fi
elif [[ -e "$legacy_mapnolia_data" || -L "$legacy_mapnolia_data" ]]; then
  echo "Legacy Mapnolia path is not a safe directory: $legacy_mapnolia_data" >&2
  exit 1
else
  mkdir -p "$shared_mapnolia_data"
fi

mkdir -p "$persistent_data_root/cordn" "$persistent_backups_root/cordn"
chmod 700 "$persistent_data_root/cordn" "$persistent_backups_root/cordn"
mkdir "$new_release"
release_created=true
tar -xzf "$archive_path" -C "$new_release"

[[ -s "$new_release/release-manifest.json" && -s "$new_release/dist/index.html" ]] || {
  echo "Release is missing its manifest or browser entrypoint" >&2
  exit 1
}
RELEASE_ID="$release_id" MANIFEST="$new_release/release-manifest.json" bun -e '
  const manifest = await Bun.file(process.env.MANIFEST).json()
  if (manifest.releaseId !== process.env.RELEASE_ID) process.exit(1)
' || {
  echo "Release manifest does not match the requested release" >&2
  exit 1
}

install -m 600 "$environment_path" "$new_release/.env"
if [[ -n "$mapnolia_path" ]]; then
  install -m 600 "$mapnolia_path" "$new_release/mapnolia.config.json"
elif [[ -L "$app_root/current" && -f "$app_root/current/mapnolia.config.json" ]]; then
  cp -p "$app_root/current/mapnolia.config.json" "$new_release/mapnolia.config.json"
elif [[ -f "$app_root/mapnolia.config.json" ]]; then
  cp -p "$app_root/mapnolia.config.json" "$new_release/mapnolia.config.json"
fi

link_shared() {
  local target="$1" link_path="$2"
  if [[ -e "$link_path" || -L "$link_path" ]]; then
    echo "Release path reserved for persistent state already exists: $link_path" >&2
    exit 1
  fi
  ln -s "$target" "$link_path"
}

mkdir -p "$new_release/relay" "$new_release/contextvm/bin" "$new_release/bin"
link_shared "$shared_dir/logs" "$new_release/logs"
link_shared "$persistent_data_root" "$new_release/data"
link_shared "$persistent_backups_root" "$new_release/backups"
link_shared "$shared_mapnolia_data" "$new_release/mapnolia-data"

legacy_searxng_env="$app_root/infra/searxng/.env"
if [[ ! -f "$shared_dir/searxng.env" && -f "$legacy_searxng_env" && ! -L "$legacy_searxng_env" ]]; then
  install -m 600 "$legacy_searxng_env" "$shared_dir/searxng.env"
fi

echo "Installing frozen production dependencies..."
(cd "$new_release" && bun install --frozen-lockfile --production)
(cd "$new_release" && bun --env-file=.env scripts/validate-production-env.ts)
(cd "$new_release" && bun -e "await import('./src/lib/og/index.ts')")

echo "Checking the production GeoCatalog snapshot..."
if ! (cd "$new_release" && bun --env-file=.env -e '
  const [{ serverConfig }, geoCatalog] = await Promise.all([
    import("./src/config/env.server.ts"),
    import("./contextvm/geocatalog/index.ts"),
  ])
  const summary = await geoCatalog.preflightGeoCatalog({
    catalog: geoCatalog.openSqliteGeoCatalog({ path: serverConfig.geoCatalogPath }),
    required: true,
  })
  if (!summary) throw new Error("Production GeoCatalog preflight returned no readiness result")
  console.log(`GeoCatalog ready: ${geoCatalog.formatGeoCatalogReadiness(summary)}`)
'); then
  echo "GeoCatalog production preflight failed; refusing to start release $release_id" >&2
  exit 1
fi

echo "Building the Earthly relay..."
(cd "$new_release/relay" && CGO_ENABLED=1 go build -o relay .)

echo "Installing the pinned PMTiles CLI..."
bash "$new_release/scripts/ensure-pmtiles.sh" "$shared_dir/bin/pmtiles-v1.29.1-$(uname -m)"
link_shared "$shared_dir/bin/pmtiles-v1.29.1-$(uname -m)" "$new_release/contextvm/bin/pmtiles"

temporary_dir="$(mktemp -d "$app_root/.earthly-downloads.XXXXXX")"
if [[ -z "$temporary_dir" || ! -d "$temporary_dir" ]]; then
  echo "Could not create a download staging directory" >&2
  exit 1
fi

install_verified_binary() {
  local url="$1" expected_sha256="$2" cache_path="$3"
  if [[ -x "$cache_path" ]]; then return; fi
  local download_path="$temporary_dir/$(basename "$cache_path")"
  curl -fSL "$url" -o "$download_path"
  echo "$expected_sha256  $download_path" | sha256sum -c -
  install -m 755 "$download_path" "$cache_path"
}

case "$(uname -m)" in
  x86_64)
    mapnolia_asset="mapnolia-server-linux-amd64"
    mapnolia_sha256="5ade60d5544bca604a83b9f21f45401ae7dd8ce1de8c3311ffcf73db2610b375"
    cordn_target="x86_64-unknown-linux-gnu"
    cordn_sha256="3f1775f6b32427a7b5e6ed6a880c2355ca3a73a0b79a8a0f766daa89aaf47b5f"
    ;;
  aarch64|arm64)
    mapnolia_asset="mapnolia-server-linux-arm64"
    mapnolia_sha256="b9a4fd3c93871908e30c04fd49533c966cdf9a30a241304258414a1885854fc8"
    cordn_target="aarch64-unknown-linux-gnu"
    cordn_sha256="96d0ca4749022f3ed2f2b23fdd7d17075e36c18d934462e9ce4bd274af100c56"
    ;;
  *)
    echo "No pinned server binaries are configured for $(uname -m)" >&2
    exit 1
    ;;
esac

mapnolia_version="v0.1.3"
mapnolia_cache="$shared_dir/bin/mapnolia-$mapnolia_version-${mapnolia_sha256:0:12}"
install_verified_binary \
  "https://github.com/zeSchlausKwab/mapnolia/releases/download/$mapnolia_version/$mapnolia_asset" \
  "$mapnolia_sha256" \
  "$mapnolia_cache"
link_shared "$mapnolia_cache" "$new_release/mapnolia-server"

cordn_version="v0.4.0"
cordn_cache="$shared_dir/bin/cordn-server-$cordn_version-${cordn_sha256:0:12}"
if [[ ! -x "$cordn_cache" ]]; then
  cordn_archive="$temporary_dir/cordn-server.tar.gz"
  curl -fSL \
    "https://github.com/Cordn-msg/cordn-rs/releases/download/$cordn_version/cordn-server-$cordn_target.tar.gz" \
    -o "$cordn_archive"
  echo "$cordn_sha256  $cordn_archive" | sha256sum -c -
  cordn_extract="$temporary_dir/cordn"
  mkdir "$cordn_extract"
  tar -xzf "$cordn_archive" -C "$cordn_extract"
  [[ -f "$cordn_extract/cordn-server" ]] || {
    echo "Verified Cordn archive did not contain cordn-server" >&2
    exit 1
  }
  install -m 755 "$cordn_extract/cordn-server" "$cordn_cache"
fi
link_shared "$cordn_cache" "$new_release/bin/cordn-server"

old_release=""
if [[ -L "$app_root/current" ]]; then
  old_release="$(readlink -f "$app_root/current" || true)"
  if [[ "$old_release" != "$release_root/"* || ! -d "$old_release" ]]; then
    echo "Current release link points outside the release root" >&2
    exit 1
  fi
fi

echo "Starting release $release_id..."
release_removable=false
if ! bash "$new_release/ops/vps/runtime.sh" restart "$new_release"; then
  echo "Release failed health checks; restoring the previous runtime" >&2
  if [[ -n "$old_release" ]]; then
    # Use the new release's runtime controller so rollback benefits from the
    # current PM2 recreation and release-verification logic as well.
    if bash "$new_release/ops/vps/runtime.sh" restart "$old_release"; then
      release_removable=true
    fi
  elif [[ -f "$app_root/scripts/restart-remote.sh" ]]; then
    if (cd "$app_root" && bash scripts/restart-remote.sh); then
      release_removable=true
    fi
  fi
  exit 1
fi

ln -sfn "$new_release" "$app_root/current"
activation_complete=true

while IFS= read -r -d '' candidate_release; do
  if [[ "$candidate_release" == "$new_release" || "$candidate_release" == "$old_release" ]]; then
    continue
  fi
  if [[ "$candidate_release" == "$release_root/"* && -d "$candidate_release" && ! -L "$candidate_release" ]]; then
    rm -rf -- "$candidate_release"
  fi
done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -print0)

echo "Release active: $release_id"
pm2 list

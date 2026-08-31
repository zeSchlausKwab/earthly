#!/usr/bin/env bash
# Install and start a corrected GeoCatalog worker without activating an app release.

set -euo pipefail

if [[ "$#" -lt 5 || "$#" -gt 6 ]]; then
  echo "Usage: $0 WORKER_ID ARCHIVE CHECKSUM INSTALLER OVERTURE_RELEASE [resume|activate]" >&2
  exit 1
fi

worker_id="$1"
archive_name="$2"
checksum_name="$3"
installer_name="$4"
overture_release="$5"
worker_action="${6:-resume}"

for upload_name in "$worker_id" "$archive_name" "$checksum_name" "$installer_name"; do
  if [[ ! "$upload_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Unsafe GeoCatalog resume argument: $upload_name" >&2
    exit 1
  fi
done
if [[ ! "$overture_release" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$ ]]; then
  echo "Overture release must use YYYY-MM-DD.N" >&2
  exit 1
fi
if [[ "$worker_action" != "resume" && "$worker_action" != "activate" ]]; then
  echo "GeoCatalog worker action must be resume or activate: $worker_action" >&2
  exit 1
fi

app_root="$(pwd -P)"
if [[ "$app_root" == "/" || "$app_root" == "$HOME" ]]; then
  echo "Refusing to resume GeoCatalog from a broad application root: $app_root" >&2
  exit 1
fi

archive_path="$app_root/$archive_name"
checksum_path="$app_root/$checksum_name"
installer_path="$app_root/$installer_name"
seed_dir="$app_root/.geocatalog-worker-seed-$worker_id"
shared_dir="$app_root/shared"

for required_upload in "$archive_path" "$checksum_path" "$installer_path"; do
  [[ -f "$required_upload" && ! -L "$required_upload" ]] || {
    echo "Required GeoCatalog resume upload is missing or unsafe: $required_upload" >&2
    exit 1
  }
done
if [[ "$seed_dir" != "$app_root/.geocatalog-worker-seed-"* ||
      -e "$seed_dir" || -L "$seed_dir" ]]; then
  echo "GeoCatalog worker seed path requires inspection: $seed_dir" >&2
  exit 1
fi

seed_created=false
cleanup_resume() {
  rm -f -- "$archive_path" "$checksum_path" "$installer_path"
  if [[ "$seed_created" == "true" && -d "$seed_dir" && ! -L "$seed_dir" &&
        "$seed_dir" == "$app_root/.geocatalog-worker-seed-"* ]]; then
    rm -rf -- "${seed_dir:?}"
  fi
}
trap cleanup_resume EXIT
(cd "$app_root" && sha256sum -c "$checksum_name")

current_release="$(readlink -f "$app_root/current" || true)"
if [[ "$current_release" != "$app_root/releases/"* || ! -d "$current_release" ]]; then
  echo "Current release is unavailable or escaped the release root" >&2
  exit 1
fi
for active_path in "$current_release/.env" "$current_release/node_modules" "$current_release/data"; do
  [[ -e "$active_path" ]] || {
    echo "Current release dependency is unavailable: $active_path" >&2
    exit 1
  }
done
[[ -f "$current_release/.env" && ! -L "$current_release/.env" ]] || {
  echo "Current production environment is missing or unsafe" >&2
  exit 1
}
node_modules_target="$(readlink -f "$current_release/node_modules" || true)"
data_target="$(readlink -f "$current_release/data" || true)"
[[ "$node_modules_target" == "$current_release/node_modules" && -d "$node_modules_target" ]] || {
  echo "Current release dependencies are not an owned directory" >&2
  exit 1
}
[[ ( "$data_target" == "$app_root/data" || "$data_target" == "$shared_dir/data" ) &&
    -d "$data_target" ]] || {
  echo "Current release data does not resolve to an owned persistent data root" >&2
  exit 1
}

mkdir "$seed_dir"
seed_created=true
archive_listing="$(tar -tzf "$archive_path")"
while IFS= read -r archive_entry; do
  case "$archive_entry" in
    /*|..|../*|*/..|*/../*)
      echo "GeoCatalog worker archive contains an unsafe path: $archive_entry" >&2
      exit 1
      ;;
  esac
done <<<"$archive_listing"
tar -xzf "$archive_path" -C "$seed_dir"
if find "$seed_dir" -type l -print -quit | grep -q .; then
  echo "GeoCatalog worker archive unexpectedly contains a symbolic link" >&2
  exit 1
fi
for required_worker_file in \
  ops/vps/geocatalog.sh \
  scripts/export-overture-planet-lite.py \
  scripts/build-geocatalog.ts \
  contextvm/geocatalog/index.ts \
  docs/legal/Apache-2.0.txt \
  src/config/env.server.ts \
  src/config/env.schema.ts; do
  [[ -f "$seed_dir/$required_worker_file" ]] || {
    echo "GeoCatalog worker archive is incomplete: $required_worker_file" >&2
    exit 1
  }
done

cp -p "$current_release/.env" "$seed_dir/.env"
ln -s "$node_modules_target" "$seed_dir/node_modules"
ln -s "$data_target" "$seed_dir/data"
chmod 700 "$seed_dir/ops/vps/geocatalog.sh"

manager_mode="update"
operation="resume"
if [[ "$worker_action" == "activate" ]]; then
  manager_mode="activate"
  operation="activation"
fi
echo "Starting GeoCatalog $operation worker $worker_id without changing the active release..."
bash "$seed_dir/ops/vps/geocatalog.sh" \
  "$manager_mode" "$shared_dir" "$seed_dir" "$overture_release"

if [[ "$worker_action" == "activate" ]]; then
  echo "GeoCatalog snapshot activation finished: $worker_id"
else
  echo "GeoCatalog worker resume queued: $worker_id"
fi

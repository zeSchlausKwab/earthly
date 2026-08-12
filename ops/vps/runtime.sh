#!/usr/bin/env bash
# One interface for starting, checking, and inspecting Earthly's VPS runtime.

set -euo pipefail

mode="${1:-restart}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_release="$(cd "$script_dir/../.." && pwd)"
release_dir="${2:-$default_release}"

if [[ "$release_dir" != /* || ! -d "$release_dir" ]]; then
  echo "Release directory must be an existing absolute path: $release_dir" >&2
  exit 1
fi

release_dir="$(cd "$release_dir" && pwd -P)"
app_root="$(cd "$release_dir/../.." 2>/dev/null && pwd -P || true)"
if [[ -z "$app_root" || ! -d "$app_root/shared" ]]; then
  app_root="$release_dir"
fi
shared_dir="${EARTHLY_SHARED_DIR:-$app_root/shared}"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:/usr/local/go/bin:$PATH"
export EARTHLY_RELEASE_DIR="$release_dir"
export EARTHLY_SHARED_DIR="$shared_dir"

release_services=(earthly-web earthly-contextvm earthly-mapnolia earthly-relay)
services=("${release_services[@]}" earthly-cordn)

require_runtime_commands() {
  local command_name
  for command_name in bun pm2 curl docker sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || {
      echo "Required runtime command is missing: $command_name" >&2
      exit 1
    }
  done
  docker compose version >/dev/null 2>&1 || {
    echo "The Docker Compose plugin is required" >&2
    exit 1
  }
}

pm2_uses_release() {
  pm2 jlist | \
    EARTHLY_EXPECTED_RELEASE="$release_dir" \
    EARTHLY_EXPECTED_BUN="$BUN_INSTALL/bin/bun" \
    bun -e '
    const expected = process.env.EARTHLY_EXPECTED_RELEASE
    const bun = process.env.EARTHLY_EXPECTED_BUN
    const scripts = new Map([
      ["earthly-web", [`${expected}/src/index.ts`, bun]],
      ["earthly-contextvm", [`${expected}/contextvm/server.ts`, bun]],
      ["earthly-mapnolia", [`${expected}/mapnolia-server`, "none"]],
      ["earthly-relay", [`${expected}/relay/relay`, "none"]],
    ])
    const processes = JSON.parse(await Bun.stdin.text())
    const valid = [...scripts].every(([name, [script, interpreter]]) => {
      const process = processes.find((entry) => entry.name === name)
      return process?.pm2_env?.status === "online" &&
        process.pm2_env.pm_cwd === expected &&
        process.pm2_env.pm_exec_path === script &&
        process.pm2_env.exec_interpreter === interpreter &&
        process.pm2_env.exec_mode === "fork_mode"
    })
    process.exit(valid ? 0 : 1)
  '
}

health_check() {
  local service service_pid observation_ready attempt ready_observations=0 served_index_sha
  local expected_index_sha
  expected_index_sha="$(sha256sum "$release_dir/dist/index.html" | awk '{print $1}')"
  for attempt in {1..20}; do
    observation_ready=true
    for service in "${services[@]}"; do
      service_pid="$(pm2 pid "$service" 2>/dev/null || true)"
      if [[ ! "$service_pid" =~ ^[1-9][0-9]*$ ]]; then
        observation_ready=false
        break
      fi
    done
    served_index_sha="$(curl -fsS --max-time 5 http://127.0.0.1:3000/ | sha256sum | awk '{print $1}' || true)"
    if [[ "$observation_ready" == "true" && "$served_index_sha" == "$expected_index_sha" ]] && \
       pm2_uses_release && \
       curl -fsS --max-time 5 'http://127.0.0.1:8888/search?q=earthly&format=json' >/dev/null; then
      ready_observations=$((ready_observations + 1))
      if [[ "$ready_observations" -ge 3 ]]; then
        echo "Earthly runtime is healthy"
        return 0
      fi
    else
      ready_observations=0
    fi
    [[ "$attempt" -eq 20 ]] || sleep 1
  done
  pm2 logs --nostream --lines 100 >&2 || true
  echo "Earthly runtime did not become healthy" >&2
  return 1
}

restart_runtime() {
  require_runtime_commands
  [[ -f "$release_dir/.env" ]] || {
    echo "Release environment is missing: $release_dir/.env" >&2
    exit 1
  }
  [[ -x "$release_dir/bin/cordn-server" ]] || {
    echo "Cordn binary is missing: $release_dir/bin/cordn-server" >&2
    exit 1
  }
  [[ -x "$release_dir/contextvm/bin/pmtiles" ]] || {
    echo "PMTiles binary is missing: $release_dir/contextvm/bin/pmtiles" >&2
    exit 1
  }

  mkdir -p "$shared_dir/logs"
  SEARXNG_ENV_FILE="$shared_dir/searxng.env" \
    bash "$release_dir/ops/vps/searxng.sh" start
  (
    cd "$release_dir"
    bash ops/vps/start-cordn.sh .env "$release_dir/bin/cordn-server"
  )
  # PM2 reloads retain an existing process's original absolute script and cwd.
  # Release directories are immutable, so switching releases must recreate these
  # process identities rather than reload them in place.
  for service in "${release_services[@]}"; do
    if pm2 describe "$service" >/dev/null 2>&1; then
      pm2 delete "$service"
    fi
  done
  pm2 start "$release_dir/ops/vps/services.config.cjs" --update-env
  health_check
  pm2 save
}

case "$mode" in
  restart)
    restart_runtime
    ;;
  health)
    require_runtime_commands
    health_check
    ;;
  status)
    require_runtime_commands
    pm2 list
    SEARXNG_ENV_FILE="$shared_dir/searxng.env" \
      bash "$release_dir/ops/vps/searxng.sh" status
    ;;
  *)
    echo "Usage: $0 [restart|health|status] [release-directory]" >&2
    exit 1
    ;;
esac

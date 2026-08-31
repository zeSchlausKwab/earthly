#!/usr/bin/env bash
# Manage Earthly's persistent, resumable GeoCatalog build on the VPS.

set -euo pipefail

mode="${1:-status}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_release="$(cd "$script_dir/../.." && pwd)"
shared_dir="${2:-${EARTHLY_SHARED_DIR:-}}"
release_dir="${3:-$default_release}"
requested_release="${4:-${GEOCATALOG_OVERTURE_RELEASE:-2026-08-19.0}}"
catalog_path_override="${5:-}"

PM2_NAME="earthly-geocatalog-build"
CONTEXTVM_NAME="earthly-contextvm"
POLICY_ID="earthly-overture-planet-lite-v2"
SOURCE_TYPES=(division_area division place water infrastructure)

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:/usr/local/go/bin:$PATH"

require_safe_absolute_path() {
  local value="$1" label="$2"
  if [[ "$value" != /* || "$value" == "/" || "$value" == "$HOME" ||
        "$value" == *"//"* || "$value" == *"/../"* || "$value" == *"/.." ||
        "$value" == *"/./"* || "$value" == *"/." ]]; then
    echo "$label must be a narrow absolute path: $value" >&2
    return 1
  fi
}

require_release() {
  [[ "$requested_release" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$ ]] || {
    echo "Overture release must use YYYY-MM-DD.N: $requested_release" >&2
    exit 1
  }
}

resolve_shared_dir() {
  if [[ -z "$shared_dir" ]]; then
    local app_root
    app_root="$(cd "$release_dir/../.." 2>/dev/null && pwd -P || true)"
    shared_dir="$app_root/shared"
  fi
  require_safe_absolute_path "$shared_dir" "Shared directory"
  mkdir -p "$shared_dir/bin" "$shared_dir/logs" "$shared_dir/geocatalog/workers"
  shared_dir="$(cd "$shared_dir" && pwd -P)"
  export PATH="$shared_dir/bin:$PATH"
}

configure_catalog_path() {
  local configured_path="$1" configured_parent
  require_safe_absolute_path "$configured_path" "GeoCatalog path"
  configured_parent="$(dirname "$configured_path")"
  mkdir -p "$configured_parent"
  configured_parent="$(cd "$configured_parent" && pwd -P)"
  catalog_path="$configured_parent/$(basename "$configured_path")"
  catalog_dir="$configured_parent"
  snapshot_dir="$catalog_dir/snapshots"
  jobs_dir="$catalog_dir/jobs"
  state_file="$catalog_dir/build-state.json"
  progress_file="$catalog_dir/build-progress.json"
  mkdir -p "$snapshot_dir" "$jobs_dir"
}

resolve_catalog_path() {
  require_safe_absolute_path "$release_dir" "Release directory"
  [[ -d "$release_dir" ]] || {
    echo "Release directory is unavailable: $release_dir" >&2
    exit 1
  }
  release_dir="$(cd "$release_dir" && pwd -P)"
  local configured_path
  configured_path="$(
    cd "$release_dir"
    bun --env-file=.env -e '
      import { resolve } from "node:path"
      const { serverConfig } = await import("./src/config/env.server.ts")
      console.log(resolve(serverConfig.geoCatalogPath))
    '
  )"
  configure_catalog_path "$configured_path"
  if [[ "$catalog_dir" == "$release_dir" || "$catalog_dir" == "$release_dir/"* ]]; then
    echo "GeoCatalog path resolves inside the immutable release and would be pruned: $catalog_path" >&2
    exit 1
  fi
}

catalog_state() {
  local path="$1" worker="$2"
  if [[ -L "$path" && ! -e "$path" ]]; then
    printf 'invalid\n'
    return
  fi
  if [[ ! -e "$path" ]]; then
    printf 'missing\n'
    return
  fi
  if GEOCATALOG_CHECK_PATH="$path" GEOCATALOG_WORKER_ROOT="$worker" bun -e '
    const geoCatalog = await import(
      `${process.env.GEOCATALOG_WORKER_ROOT}/contextvm/geocatalog/index.ts`,
    )
    await geoCatalog.preflightGeoCatalog({
      catalog: geoCatalog.openSqliteGeoCatalog({ path: process.env.GEOCATALOG_CHECK_PATH }),
      required: true,
    })
  ' >/dev/null 2>&1; then
    printf 'ready\n'
  else
    printf 'invalid\n'
  fi
}

verify_target_snapshot() {
  local path="$1" worker="$2"
  GEOCATALOG_CHECK_PATH="$path" \
    GEOCATALOG_WORKER_ROOT="$worker" \
    EXPECTED_SNAPSHOT_ID="$snapshot_id" \
    EXPECTED_RELEASE="$requested_release" \
    bun -e '
      const geoCatalog = await import(
        `${process.env.GEOCATALOG_WORKER_ROOT}/contextvm/geocatalog/index.ts`,
      )
      const summary = await geoCatalog.preflightGeoCatalog({
        catalog: geoCatalog.openSqliteGeoCatalog({ path: process.env.GEOCATALOG_CHECK_PATH }),
        required: true,
      })
      const snapshot = summary.snapshot
      const source = snapshot.sources?.[0]
      const expectedKinds = ["admin", "locality", "place", "waterway", "infrastructure"]
      const valid =
        snapshot.id === process.env.EXPECTED_SNAPSHOT_ID &&
        snapshot.coverage?.spatial?.scope === "global" &&
        JSON.stringify(snapshot.coverage?.kinds) === JSON.stringify(expectedKinds) &&
        snapshot.sources?.length === 1 &&
        source?.name === "Overture Maps" &&
        source?.release === process.env.EXPECTED_RELEASE
      if (!valid) {
        console.error(
          `GeoCatalog target identity, release, or coverage mismatch: expected ${process.env.EXPECTED_SNAPSHOT_ID} ` +
          `at Overture ${process.env.EXPECTED_RELEASE}, found ${snapshot.id} ` +
          `at ${source?.name || "unknown"}@${source?.release || "unknown"}`,
        )
        process.exit(1)
      }
    '
}

catalog_points_to() {
  local path="$1" target="$2"
  [[ -e "$path" && -e "$target" && "$path" -ef "$target" ]]
}

replace_catalog_link() {
  local link_target="$1" suffix="$2"
  local next_link="$catalog_dir/.current.sqlite.$suffix-$$"
  [[ ! -e "$next_link" && ! -L "$next_link" ]] || {
    echo "Temporary GeoCatalog link already exists: $next_link" >&2
    return 1
  }
  ln -s -- "$link_target" "$next_link"
  mv -Tf -- "$next_link" "$catalog_path"
}

contextvm_log_size() {
  CONTEXTVM_LOG="$shared_dir/logs/contextvm-out.log" bun -e '
    const file = Bun.file(process.env.CONTEXTVM_LOG)
    console.log(await file.exists() ? file.size : 0)
  '
}

contextvm_release_dir() {
  pm2 jlist | CONTEXTVM_NAME="$CONTEXTVM_NAME" bun -e '
    const processes = JSON.parse(await Bun.stdin.text())
    const matches = processes.filter((entry) => entry.name === process.env.CONTEXTVM_NAME)
    const release = matches.length === 1 ? matches[0]?.pm2_env?.pm_cwd : null
    if (typeof release !== "string" || !release.startsWith("/")) process.exit(1)
    console.log(release)
  '
}

require_contextvm_catalog_path() {
  local active_release="$1" configured_path configured_parent
  configured_path="$(
    cd "$active_release"
    bun --env-file=.env -e '
      import { resolve } from "node:path"
      const { serverConfig } = await import("./src/config/env.server.ts")
      console.log(resolve(serverConfig.geoCatalogPath))
    '
  )" || {
    echo "Cannot resolve GeoCatalog path from active ContextVM release $active_release" >&2
    return 1
  }
  require_safe_absolute_path "$configured_path" "Active ContextVM GeoCatalog path" || return 1
  configured_parent="$(dirname "$configured_path")"
  [[ -d "$configured_parent" ]] || {
    echo "Active ContextVM GeoCatalog parent is unavailable: $configured_parent" >&2
    return 1
  }
  configured_parent="$(cd "$configured_parent" && pwd -P)"
  configured_path="$configured_parent/$(basename "$configured_path")"
  if [[ "$configured_parent" == "$active_release" ||
        "$configured_parent" == "$active_release/"* ]]; then
    echo "Active ContextVM GeoCatalog path resolves inside its immutable release: $configured_path" >&2
    return 1
  fi
  [[ "$configured_path" == "$catalog_path" ]] || {
    echo "Active ContextVM is configured for $configured_path, not this job's $catalog_path; refusing GeoCatalog promotion or readiness" >&2
    return 1
  }
}

contextvm_healthy_observation() {
  local log_offset="$1" active_release="$2"
  pm2 jlist | \
    CONTEXTVM_LOG="$shared_dir/logs/contextvm-out.log" \
    CONTEXTVM_LOG_OFFSET="$log_offset" \
    CONTEXTVM_NAME="$CONTEXTVM_NAME" \
    CONTEXTVM_RELEASE="$active_release" \
    bun -e '
      const processes = JSON.parse(await Bun.stdin.text())
      const matches = processes.filter((entry) => entry.name === process.env.CONTEXTVM_NAME)
      if (matches.length !== 1) process.exit(1)
      const service = matches[0]
      if (service?.pm2_env?.status !== "online" || !Number.isSafeInteger(service.pid) || service.pid <= 0) {
        process.exit(1)
      }
      if (service.pm2_env.pm_cwd !== process.env.CONTEXTVM_RELEASE) process.exit(1)
      const log = Bun.file(process.env.CONTEXTVM_LOG)
      if (!(await log.exists())) process.exit(1)
      const offset = Number(process.env.CONTEXTVM_LOG_OFFSET)
      if (!Number.isSafeInteger(offset) || offset < 0 || log.size < offset) process.exit(1)
      const freshLog = await log.slice(offset).text()
      if (!freshLog.includes("Server is running and listening for requests on Nostr")) process.exit(1)
      console.log(`${service.pid}:${service.pm2_env.restart_time ?? "unknown"}`)
    '
}

contextvm_health_timeout_seconds() {
  local active_release="$1"
  (
    cd "$active_release"
    bun --env-file=.env -e '
      const raw = process.env.GEOCATALOG_CONTEXTVM_HEALTH_TIMEOUT_SECONDS || "120"
      const value = Number(raw)
      if (!Number.isSafeInteger(value) || value < 10 || value > 900) {
        console.error(
          "GEOCATALOG_CONTEXTVM_HEALTH_TIMEOUT_SECONDS must be an integer from 10 to 900",
        )
        process.exit(1)
      }
      console.log(value)
    '
  )
}

wait_for_contextvm_health() {
  local log_offset="$1" active_release="$2" timeout_seconds="${3:-}"
  local started_at deadline now
  if [[ -z "$timeout_seconds" ]]; then
    timeout_seconds="$(contextvm_health_timeout_seconds "$active_release")" || return 1
  fi
  started_at="$(date +%s)"
  deadline=$((started_at + timeout_seconds))

  local observation previous_observation="" ready_observations=0
  while true; do
    observation="$(contextvm_healthy_observation "$log_offset" "$active_release" 2>/dev/null || true)"
    if [[ -n "$observation" ]]; then
      if [[ "$observation" == "$previous_observation" ]]; then
        ready_observations=$((ready_observations + 1))
      else
        previous_observation="$observation"
        ready_observations=1
      fi
      if [[ "$ready_observations" -ge 3 ]]; then
        echo "ContextVM is online and healthy"
        return 0
      fi
    else
      previous_observation=""
      ready_observations=0
    fi
    now="$(date +%s)"
    [[ "$now" -ge "$deadline" ]] && break
    sleep 1
  done
  pm2 logs "$CONTEXTVM_NAME" --nostream --lines 100 >&2 || true
  echo "ContextVM did not become online and healthy within ${timeout_seconds}s after restart" >&2
  return 1
}

restart_contextvm_and_wait() {
  local expected_catalog_state="${1:-ready}"
  local prevalidated_timeout_seconds="${2:-}"
  local active_release log_offset observed_catalog_state timeout_seconds
  active_release="$(contextvm_release_dir)" || {
    echo "Cannot determine earthly-contextvm's active release from PM2" >&2
    return 1
  }
  require_safe_absolute_path "$active_release" "ContextVM release directory" || return 1
  [[ -d "$active_release" ]] || {
    echo "ContextVM release directory is unavailable: $active_release" >&2
    return 1
  }
  require_contextvm_catalog_path "$active_release" || return 1
  if [[ -n "$prevalidated_timeout_seconds" ]]; then
    timeout_seconds="$prevalidated_timeout_seconds"
  else
    timeout_seconds="$(contextvm_health_timeout_seconds "$active_release")" || return 1
  fi
  log_offset="$(contextvm_log_size)"
  pm2 restart "$CONTEXTVM_NAME" --update-env || return 1
  wait_for_contextvm_health "$log_offset" "$active_release" "$timeout_seconds" || return 1
  case "$expected_catalog_state" in
    target)
      verify_target_snapshot "$catalog_path" "$active_release"
      ;;
    ready|missing)
      observed_catalog_state="$(catalog_state "$catalog_path" "$active_release")"
      [[ "$observed_catalog_state" == "$expected_catalog_state" ]] || {
        echo "ContextVM release observed GeoCatalog $observed_catalog_state; expected $expected_catalog_state" >&2
        return 1
      }
      ;;
    *)
      echo "Unsupported post-restart GeoCatalog expectation: $expected_catalog_state" >&2
      return 1
      ;;
  esac
}

write_state() {
  local state="$1" phase="$2" message="${3:-}"
  STATE_FILE="$state_file" \
    STATE_VALUE="$state" \
    PHASE_VALUE="$phase" \
    MESSAGE_VALUE="$message" \
    JOB_ID_VALUE="${job_id:-}" \
    SNAPSHOT_ID_VALUE="${snapshot_id:-}" \
    OVERTURE_RELEASE_VALUE="${requested_release:-}" \
    POLICY_ID_VALUE="$POLICY_ID" \
    bun -e '
      import { existsSync, renameSync } from "node:fs"
      const path = process.env.STATE_FILE
      let current = {}
      if (existsSync(path)) {
        try { current = JSON.parse(await Bun.file(path).text()) } catch {}
      }
      const now = new Date().toISOString()
      const state = process.env.STATE_VALUE
      const isNewJob = state === "queued"
      const next = {
        ...current,
        schemaVersion: 1,
        jobId: process.env.JOB_ID_VALUE || current.jobId || null,
        snapshotId: process.env.SNAPSHOT_ID_VALUE || current.snapshotId || null,
        overtureRelease: process.env.OVERTURE_RELEASE_VALUE || current.overtureRelease || null,
        policyId: process.env.POLICY_ID_VALUE,
        state,
        phase: process.env.PHASE_VALUE,
        message: process.env.MESSAGE_VALUE || null,
        startedAt: isNewJob
          ? now
          : current.startedAt || (state === "running" ? now : null),
        updatedAt: now,
        finishedAt: state === "ready" || state === "failed" ? now : null,
      }
      const temporary = `${path}.next-${process.pid}-${Date.now()}`
      await Bun.write(temporary, JSON.stringify(next, null, 2) + "\n")
      renameSync(temporary, path)
    '
}

stage_worker_bundle() {
  local worker="$1" staging="$worker.next-$$"
  if [[ -d "$worker" ]]; then return; fi
  if [[ -e "$worker" || -L "$worker" || -e "$staging" || -L "$staging" ]]; then
    echo "GeoCatalog worker path requires inspection: $worker" >&2
    exit 1
  fi
  mkdir -p "$staging/ops/vps" "$staging/scripts" "$staging/contextvm" "$staging/docs/legal"
  cp -p "$release_dir/ops/vps/geocatalog.sh" "$staging/ops/vps/geocatalog.sh"
  cp -p "$release_dir/scripts/export-overture-planet-lite.py" "$staging/scripts/"
  cp -p "$release_dir/scripts/build-geocatalog.ts" "$staging/scripts/"
  cp -a "$release_dir/contextvm/geocatalog" "$staging/contextvm/geocatalog"
  cp -p "$release_dir/docs/legal/Apache-2.0.txt" "$staging/docs/legal/Apache-2.0.txt"
  chmod 700 "$staging/ops/vps/geocatalog.sh"
  mv "$staging" "$worker"
}

start_job() {
  local action="$1"
  resolve_shared_dir
  resolve_catalog_path
  require_release

  snapshot_id="overture-$requested_release-planet-lite-v2"
  job_id="$snapshot_id"

  local live_state
  live_state="$(catalog_state "$catalog_path" "$release_dir")"
  if [[ "$live_state" == "invalid" ]]; then
    echo "GeoCatalog exists but is invalid; refusing to hide corruption with a rebuild" >&2
    exit 1
  fi
  if [[ "$action" == "ensure" && "$live_state" == "ready" ]]; then
    echo "GeoCatalog is ready; no background build was requested"
    return
  fi

  local pm2_pid active_job active_state active_snapshot active_release active_policy
  pm2_pid="$(pm2 pid "$PM2_NAME" 2>/dev/null || true)"
  if [[ "$pm2_pid" =~ ^[1-9][0-9]*$ ]]; then
    [[ -f "$state_file" ]] || {
      echo "GeoCatalog worker is running without readable target state; refusing to replace it" >&2
      return 1
    }
    active_job="$({
      STATE_FILE="$state_file" bun -e '
        const state = await Bun.file(process.env.STATE_FILE).json()
        if (!["queued", "running"].includes(state.state)) process.exit(0)
        console.log([
          state.state || "unknown",
          state.snapshotId || "missing",
          state.overtureRelease || "missing",
          state.policyId || "missing",
        ].join("\t"))
      '
    })" || {
      echo "Cannot inspect the active GeoCatalog job target" >&2
      return 1
    }
    if [[ -n "$active_job" ]]; then
      IFS=$'\t' read -r active_state active_snapshot active_release active_policy <<<"$active_job"
      if [[ "$action" == "ensure" ]]; then
        echo "GeoCatalog build $active_snapshot is already $active_state (PM2 pid $pm2_pid)"
        return
      fi
      if [[ "$active_snapshot" == "$snapshot_id" &&
            "$active_release" == "$requested_release" &&
            "$active_policy" == "$POLICY_ID" ]]; then
        echo "GeoCatalog build for $snapshot_id is already $active_state (PM2 pid $pm2_pid)"
        return
      fi
      echo "GeoCatalog build $active_snapshot ($active_release, $active_policy) is already $active_state; refusing to discard requested target $snapshot_id ($requested_release, $POLICY_ID)" >&2
      return 1
    fi
  fi

  if [[ "$live_state" == "ready" ]] && \
    verify_target_snapshot "$catalog_path" "$release_dir" 2>/dev/null; then
    echo "GeoCatalog target $snapshot_id is already ready; no background build was requested"
    return
  fi

  local reserve_free_gib
  reserve_free_gib="$(
    cd "$release_dir"
    bun --env-file=.env -e '
      const raw = process.env.GEOCATALOG_RESERVE_FREE_GIB || "8"
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        console.error("GEOCATALOG_RESERVE_FREE_GIB must be a non-negative number")
        process.exit(1)
      }
      console.log(value)
    '
  )"

  local release_bundle
  release_bundle="$(basename "$release_dir")"
  local worker="$shared_dir/geocatalog/workers/$snapshot_id-$release_bundle"
  stage_worker_bundle "$worker"
  if [[ -f "$progress_file" ]]; then
    mv "$progress_file" "$progress_file.previous-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  fi
  write_state "queued" "queued" "Waiting for the persistent VPS worker"

  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 delete "$PM2_NAME" >/dev/null
  fi
  if ! GEOCATALOG_RESERVE_FREE_GIB="$reserve_free_gib" \
    pm2 start "$worker/ops/vps/geocatalog.sh" \
      --name "$PM2_NAME" \
      --interpreter bash \
      --cwd "$worker" \
      --time \
      --no-autorestart \
      --output "$shared_dir/logs/geocatalog-build-out.log" \
      --error "$shared_dir/logs/geocatalog-build-error.log" \
      -- run "$shared_dir" "$worker" "$requested_release" "$catalog_path"; then
    write_state "failed" "starting-worker" "PM2 could not start the persistent GeoCatalog worker"
    return 1
  fi
  if ! pm2 save >/dev/null; then
    local compensation_message="PM2 could not persist the GeoCatalog worker definition"
    if pm2 delete "$PM2_NAME" >/dev/null 2>&1; then
      compensation_message="$compensation_message; the newly started worker was stopped"
      if ! pm2 save >/dev/null 2>&1; then
        compensation_message="$compensation_message, but PM2 could not persist its removal"
      fi
    else
      compensation_message="$compensation_message, and PM2 could not stop the newly started worker"
    fi
    write_state "failed" "persisting-worker" "$compensation_message"
    echo "$compensation_message" >&2
    return 1
  fi
  echo "GeoCatalog $action queued: $snapshot_id"
  echo "Check: bash $release_dir/ops/vps/geocatalog.sh status '$shared_dir' '$release_dir'"
}

verify_checkpoint() {
  local source_type="$1" source_root="$2"
  CHECKPOINT_TYPE="$source_type" \
    CHECKPOINT_ROOT="$source_root" \
    EXPECTED_RELEASE="$requested_release" \
    EXPECTED_POLICY="$POLICY_ID" \
    bun -e '
      import { existsSync, lstatSync, statSync } from "node:fs"
      import { createHash } from "node:crypto"
      const root = process.env.CHECKPOINT_ROOT
      const type = process.env.CHECKPOINT_TYPE
      const reportPath = `${root}/export-report.json`
      const dataPath = `${root}/${type}.geojsonseq.gz`
      if (!existsSync(reportPath) || !existsSync(dataPath)) process.exit(1)
      const report = await Bun.file(reportPath).json()
      const source = report.sources?.[0]
      const exactSources = {
        division_area: ["divisions", "division_area"],
        division: ["divisions", "division"],
        place: ["places", "place"],
        water: ["base", "water"],
        infrastructure: ["base", "infrastructure"],
      }
      const expectedSource = exactSources[type]
      const expectedFile = `${type}.geojsonseq.gz`
      const expectedUri = expectedSource
        ? `s3://overturemaps-us-west-2/release/${process.env.EXPECTED_RELEASE}/theme=${expectedSource[0]}/type=${expectedSource[1]}/*.parquet`
        : null
      const sourceBytes = source?.outputBytes
      const selectedRecords = source?.selectedRecords
      if (
        report.schemaVersion !== 1 ||
        report.policyId !== process.env.EXPECTED_POLICY ||
        report.release !== process.env.EXPECTED_RELEASE ||
        report.dryRun !== false ||
        JSON.stringify(report.coverage) !== JSON.stringify({ scope: "global" }) ||
        report.outputDirectory !== root ||
        report.outputFormat !== "GeoJSONSeq+gzip" ||
        !Array.isArray(report.featureTypes) ||
        report.featureTypes.length !== 1 ||
        report.featureTypes[0] !== type ||
        !Array.isArray(report.sources) ||
        report.sources?.length !== 1 ||
        !expectedSource ||
        source?.featureType !== type ||
        source?.theme !== expectedSource[0] ||
        source?.type !== expectedSource[1] ||
        source?.uri !== expectedUri ||
        source?.outputFile !== expectedFile ||
        !Number.isSafeInteger(selectedRecords) ||
        selectedRecords <= 0 ||
        !Number.isSafeInteger(sourceBytes) ||
        sourceBytes <= 0 ||
        report.outputBytes !== sourceBytes ||
        !/^[a-f0-9]{64}$/.test(source?.sha256 || "") ||
        lstatSync(dataPath).isSymbolicLink() ||
        !statSync(dataPath).isFile() ||
        statSync(dataPath).size !== sourceBytes
      ) process.exit(1)
      const digest = createHash("sha256")
      for await (const chunk of Bun.file(dataPath).stream()) digest.update(chunk)
      process.exit(digest.digest("hex") === source.sha256 ? 0 : 1)
    '
}

activate_target_snapshot() {
  local target_snapshot="$1" worker="$2"
  local active_release health_timeout_seconds

  write_state "running" "validating" \
    "Validating the completed snapshot with the worker and active release before promotion"
  verify_target_snapshot "$target_snapshot" "$worker" || {
    echo "Built GeoCatalog snapshot failed worker identity, release, coverage, or query validation" >&2
    return 1
  }
  active_release="$(contextvm_release_dir)" || {
    echo "Cannot determine earthly-contextvm's active release from PM2" >&2
    return 1
  }
  require_safe_absolute_path "$active_release" "ContextVM release directory" || return 1
  [[ -d "$active_release" ]] || {
    echo "ContextVM release directory is unavailable: $active_release" >&2
    return 1
  }
  require_contextvm_catalog_path "$active_release" || return 1
  verify_target_snapshot "$target_snapshot" "$active_release" || {
    echo "Built GeoCatalog snapshot failed validation with the active ContextVM release" >&2
    return 1
  }
  health_timeout_seconds="$(contextvm_health_timeout_seconds "$active_release")" || return 1

  local previous_link="$catalog_dir/.previous.sqlite.next-$$"
  local old_target="" promoted="false" original_was_missing="false"
  if catalog_points_to "$catalog_path" "$target_snapshot"; then
    local retained_previous="$catalog_dir/previous.sqlite"
    if [[ ! -e "$retained_previous" && ! -L "$retained_previous" ]]; then
      original_was_missing="true"
    elif [[ -L "$retained_previous" && -e "$retained_previous" ]] && \
      ! catalog_points_to "$retained_previous" "$target_snapshot" && \
      [[ "$(catalog_state "$retained_previous" "$worker")" == "ready" ]]; then
      old_target="$(readlink -f "$retained_previous")"
    else
      echo "Target is already active but no distinct valid previous snapshot can compensate an interrupted promotion" >&2
      return 1
    fi
    promoted="true"
    echo "Target snapshot is already active; preserving the retained previous snapshot while resuming service verification"
  else
    if [[ -e "$catalog_path" || -L "$catalog_path" ]]; then
      [[ "$(catalog_state "$catalog_path" "$worker")" == "ready" ]] || {
        echo "Active GeoCatalog changed or became invalid before promotion" >&2
        return 1
      }
      if [[ -L "$catalog_path" ]]; then
        old_target="$(readlink -f "$catalog_path")"
      else
        old_target="$snapshot_dir/legacy-$(sha256sum "$catalog_path" | awk '{print $1}').sqlite"
        [[ -e "$old_target" ]] || ln "$catalog_path" "$old_target"
      fi
      ln -s -- "$old_target" "$previous_link"
      mv -Tf -- "$previous_link" "$catalog_dir/previous.sqlite"
    else
      original_was_missing="true"
    fi
    replace_catalog_link "snapshots/$snapshot_id.sqlite" "promote"
    promoted="true"
  fi

  write_state "running" "restarting-contextvm" \
    "Snapshot promoted; waiting for a fresh healthy geo service startup"
  if restart_contextvm_and_wait target "$health_timeout_seconds"; then
    write_state "ready" "ready" "Snapshot validated, promoted, and serving"
    return
  fi

  local failure_detail="ContextVM failed its post-promotion restart or health check"
  if [[ "$promoted" == "true" ]]; then
    if ! catalog_points_to "$catalog_path" "$target_snapshot"; then
      failure_detail="$failure_detail; the active link changed concurrently, so it was not overwritten"
    elif [[ -n "$old_target" ]]; then
      if [[ "$(catalog_state "$old_target" "$worker")" != "ready" ]]; then
        failure_detail="$failure_detail; the retained prior snapshot failed validation and was not restored"
      elif replace_catalog_link "$old_target" "promotion-compensation"; then
        if restart_contextvm_and_wait ready "$health_timeout_seconds"; then
          failure_detail="$failure_detail; the prior snapshot was restored and ContextVM recovered"
        else
          failure_detail="$failure_detail; the prior snapshot link was restored but ContextVM did not recover"
        fi
      else
        failure_detail="$failure_detail; the prior snapshot link could not be restored"
      fi
    elif [[ "$original_was_missing" == "true" && -L "$catalog_path" ]]; then
      if unlink -- "$catalog_path"; then
        if restart_contextvm_and_wait missing "$health_timeout_seconds"; then
          failure_detail="$failure_detail; the bootstrap link was removed and ContextVM recovered"
        else
          failure_detail="$failure_detail; the bootstrap link was removed but ContextVM did not recover"
        fi
      else
        failure_detail="$failure_detail; the bootstrap link could not be removed"
      fi
    else
      failure_detail="$failure_detail; the original catalog state could not be reconstructed"
    fi
  fi
  write_state "failed" "serving" "$failure_detail"
  echo "$failure_detail" >&2
  return 1
}

run_pipeline() {
  local worker="$1"
  job_id="$snapshot_id"
  local job_root="$jobs_dir/$snapshot_id"
  local source_parent="$job_root/sources"
  local temporary_root="$job_root/tmp"
  local target_snapshot="$snapshot_dir/$snapshot_id.sqlite"
  mkdir -p "$source_parent" "$temporary_root"

  write_state "running" "exporting" "Exporting five resumable Overture source slices"
  local source_type source_root invalid_root source_index=0
  local source_count="${#SOURCE_TYPES[@]}"
  for source_type in "${SOURCE_TYPES[@]}"; do
    source_index=$((source_index + 1))
    source_root="$source_parent/$source_type"
    if verify_checkpoint "$source_type" "$source_root"; then
      echo "Reusing verified $source_type checkpoint"
      continue
    fi
    if [[ -e "$source_root" || -L "$source_root" ]]; then
      invalid_root="$source_root.invalid-$(date -u +%Y%m%dT%H%M%SZ)-$$"
      mv "$source_root" "$invalid_root"
      echo "Moved incomplete $source_type checkpoint to $invalid_root"
    fi
    echo "Exporting $source_type from Overture $requested_release..."
    write_state "running" "exporting-$source_type" \
      "Exporting $source_type $source_index/$source_count; completed sources remain resumable"
    nice -n 10 ionice -c2 -n7 \
      uv run "$worker/scripts/export-overture-planet-lite.py" \
      --release "$requested_release" \
      --feature-type "$source_type" \
      --output-dir "$source_root" \
      --progress-file "$progress_file" \
      --reserve-free-gib "${GEOCATALOG_RESERVE_FREE_GIB:-8}"
    verify_checkpoint "$source_type" "$source_root" || {
      echo "Completed $source_type export did not pass checkpoint verification" >&2
      return 1
    }
  done

  if [[ -e "$target_snapshot" || -L "$target_snapshot" ]]; then
    if verify_target_snapshot "$target_snapshot" "$worker"; then
      echo "Reusing verified target snapshot $snapshot_id at Overture $requested_release"
    else
      if catalog_points_to "$catalog_path" "$target_snapshot"; then
        echo "Active target snapshot has the wrong identity or release; refusing to move the live file" >&2
        return 1
      fi
      local rejected_target
      rejected_target="$target_snapshot.rejected-$(date -u +%Y%m%dT%H%M%SZ)-$$"
      mv "$target_snapshot" "$rejected_target"
      echo "Moved invalid or mismatched target snapshot to $rejected_target"
    fi
  fi
  if [[ ! -e "$target_snapshot" && ! -L "$target_snapshot" ]]; then
    write_state "running" "building" "Building the immutable SQLite snapshot"
    nice -n 10 ionice -c2 -n7 \
      bun run "$worker/scripts/build-geocatalog.ts" \
      --release "$requested_release" \
      --snapshot-id "$snapshot_id" \
      --created-at "$created_at" \
      --output "$target_snapshot" \
      --coverage global \
      --corridor-source-fragments staging-only \
      --staging-directory-root "$temporary_root" \
      --progress-file "$progress_file" \
      --min-free-gib "${GEOCATALOG_RESERVE_FREE_GIB:-8}" \
      --input "division_area=$source_parent/division_area/division_area.geojsonseq.gz" \
      --input "division=$source_parent/division/division.geojsonseq.gz" \
      --input "place=$source_parent/place/place.geojsonseq.gz" \
      --input "water=$source_parent/water/water.geojsonseq.gz" \
      --input "infrastructure=$source_parent/infrastructure/infrastructure.geojsonseq.gz"
  fi

  activate_target_snapshot "$target_snapshot" "$worker"
}

run_worker() {
  resolve_shared_dir
  if [[ -n "$catalog_path_override" ]]; then
    configure_catalog_path "$catalog_path_override"
  else
    resolve_catalog_path
  fi
  require_release
  snapshot_id="overture-$requested_release-planet-lite-v2"
  job_id="$snapshot_id"
  if [[ -f "$state_file" ]] && \
    STATE_FILE="$state_file" \
    EXPECTED_SNAPSHOT_ID="$snapshot_id" \
    EXPECTED_RELEASE="$requested_release" \
    EXPECTED_POLICY="$POLICY_ID" \
    bun -e '
    const state = await Bun.file(process.env.STATE_FILE).json()
    process.exit(
      state.state === "ready" &&
      state.snapshotId === process.env.EXPECTED_SNAPSHOT_ID &&
      state.overtureRelease === process.env.EXPECTED_RELEASE &&
      state.policyId === process.env.EXPECTED_POLICY
        ? 0
        : 1,
    )
  '; then
    echo "GeoCatalog job $snapshot_id is already complete"
    return
  fi
  created_at="$(
    STATE_FILE="$state_file" bun -e '
      try {
        const state = await Bun.file(process.env.STATE_FILE).json()
        console.log(state.startedAt || new Date().toISOString())
      } catch {
        console.log(new Date().toISOString())
      }
    '
  )"
  local worker
  worker="$(cd "$script_dir/../.." && pwd -P)"

  exec 9>"$catalog_dir/build.lock"
  local exit_status=0
  if ! flock -n 9; then
    write_state "failed" "locked" "Another GeoCatalog worker owns the build lock"
    exit_status=1
  else
    # Do not invoke run_pipeline from an if/elif/! context: Bash disables
    # errexit throughout functions used as conditional tests. Capture the
    # top-level subshell status explicitly so an unhandled promotion or backup
    # failure cannot fall through to later mutation steps.
    set +e
    (set -e; run_pipeline "$worker")
    exit_status=$?
    set -e
    if [[ "$exit_status" -ne 0 ]]; then
      if ! STATE_FILE="$state_file" JOB_ID_VALUE="$job_id" bun -e '
        try {
          const state = await Bun.file(process.env.STATE_FILE).json()
          process.exit(state.state === "failed" && state.jobId === process.env.JOB_ID_VALUE ? 0 : 1)
        } catch {
          process.exit(1)
        }
      '; then
        local failure_message
        failure_message="$(PROGRESS_FILE="$progress_file" bun -e '
          try {
            const progress = await Bun.file(process.env.PROGRESS_FILE).json()
            if (progress.state === "failed" && typeof progress.message === "string") {
              console.log(progress.message)
            }
          } catch {}
        ')"
        write_state "failed" "failed" \
          "${failure_message:-The build stopped; completed source checkpoints were retained}"
      fi
    fi
  fi
  flock -u 9
  exec 9>&-
  return "$exit_status"
}

activate_catalog() {
  resolve_shared_dir
  if [[ -n "$catalog_path_override" ]]; then
    configure_catalog_path "$catalog_path_override"
  else
    resolve_catalog_path
  fi
  require_release
  snapshot_id="overture-$requested_release-planet-lite-v2"
  job_id="$snapshot_id"

  local worker target_snapshot exit_status=0
  worker="$(cd "$script_dir/../.." && pwd -P)"
  target_snapshot="$snapshot_dir/$snapshot_id.sqlite"
  [[ -f "$target_snapshot" && ! -L "$target_snapshot" ]] || {
    echo "Completed GeoCatalog target is unavailable or unsafe: $target_snapshot" >&2
    return 1
  }

  exec 9>"$catalog_dir/build.lock"
  if ! flock -n 9; then
    echo "A GeoCatalog build or activation owns the catalog lock; retry after it finishes" >&2
    exec 9>&-
    return 1
  fi

  set +e
  (set -e; activate_target_snapshot "$target_snapshot" "$worker")
  exit_status=$?
  set -e
  if [[ "$exit_status" -ne 0 ]]; then
    if ! STATE_FILE="$state_file" JOB_ID_VALUE="$job_id" bun -e '
      try {
        const state = await Bun.file(process.env.STATE_FILE).json()
        process.exit(state.state === "failed" && state.jobId === process.env.JOB_ID_VALUE ? 0 : 1)
      } catch {
        process.exit(1)
      }
    '; then
      write_state "failed" "activating" \
        "The completed snapshot could not be validated, promoted, or served"
    fi
  fi
  flock -u 9
  exec 9>&-
  return "$exit_status"
}

show_status() {
  resolve_shared_dir
  resolve_catalog_path
  local live_state pm2_pid
  live_state="$(catalog_state "$catalog_path" "$release_dir")"
  pm2_pid="$(pm2 pid "$PM2_NAME" 2>/dev/null || true)"
  printf 'GeoCatalog: %s\n' "$live_state"
  if [[ "$live_state" == "ready" ]]; then
    (
      cd "$release_dir"
      GEOCATALOG_CHECK_PATH="$catalog_path" bun -e '
        const geoCatalog = await import("./contextvm/geocatalog/index.ts")
        const summary = await geoCatalog.preflightGeoCatalog({
          catalog: geoCatalog.openSqliteGeoCatalog({ path: process.env.GEOCATALOG_CHECK_PATH }),
          required: true,
        })
        console.log(`Active snapshot: ${geoCatalog.formatGeoCatalogReadiness(summary)}`)
      '
    )
  fi
  printf 'Worker: %s\n' "$([[ "$pm2_pid" =~ ^[1-9][0-9]*$ ]] && printf 'online (pid %s)' "$pm2_pid" || printf 'not running')"
  if [[ -f "$state_file" ]]; then
    STATE_FILE="$state_file" PROGRESS_FILE="$progress_file" bun -e '
      const state = await Bun.file(process.env.STATE_FILE).json()
      let progress = null
      if (await Bun.file(process.env.PROGRESS_FILE).exists()) {
        try { progress = await Bun.file(process.env.PROGRESS_FILE).json() } catch {}
      }
      console.log(`Build: ${state.state} / ${state.phase}`)
      if (state.snapshotId) console.log(`Target: ${state.snapshotId}`)
      if (state.startedAt) {
        const startedAt = Date.parse(state.startedAt)
        const finishedAt = state.finishedAt ? Date.parse(state.finishedAt) : Date.now()
        if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
          const elapsedSeconds = Math.max(
            0,
            Math.floor((finishedAt - startedAt) / 1000),
          )
          const hours = Math.floor(elapsedSeconds / 3600)
          const minutes = Math.floor((elapsedSeconds % 3600) / 60)
          console.log(`Elapsed: ${hours}h ${minutes}m`)
        }
      }
      if (state.updatedAt) console.log(`Updated: ${state.updatedAt}`)
      if (state.finishedAt) console.log(`Finished: ${state.finishedAt}`)
      if (state.state === "failed") {
        const details = [state.message, progress?.state === "failed" ? progress.message : null]
          .filter((detail, index, all) =>
            typeof detail === "string" && detail.length > 0 && all.indexOf(detail) === index,
          )
        console.log(`Failure: ${details.join("; ") || "No failure detail was recorded"}`)
      } else if (state.message) {
        console.log(`Message: ${state.message}`)
      }
      if (progress) {
        const type = progress.featureType ? ` ${progress.featureType}` : ""
        const records = Number.isFinite(progress.records)
          ? ` · ${progress.records.toLocaleString()} records`
          : ""
        const bytes = Number.isFinite(progress.outputBytes)
          ? ` · ${(progress.outputBytes / 1024 / 1024).toFixed(1)} MiB`
          : ""
        console.log(`Progress: ${progress.state}${type}${records}${bytes}`)
        if (progress.updatedAt) console.log(`Progress updated: ${progress.updatedAt}`)
      }
    '
  else
    echo "Build: never started"
  fi
  df -h "$catalog_dir" | tail -n 1 | awk '{print "Disk: " $4 " free of " $2 " (" $5 " used)"}'
  echo "Logs: $shared_dir/logs/geocatalog-build-out.log"
}

show_logs() {
  resolve_shared_dir
  local follow="${1:-}"
  local files=(
    "$shared_dir/logs/geocatalog-build-out.log"
    "$shared_dir/logs/geocatalog-build-error.log"
  )
  if [[ "$follow" == "--follow" ]]; then
    tail -n 100 -F "${files[@]}"
  else
    tail -n 100 "${files[@]}" 2>/dev/null || echo "GeoCatalog build has not produced logs yet"
  fi
}

rollback_catalog() {
  resolve_shared_dir
  if [[ -n "$catalog_path_override" ]]; then
    configure_catalog_path "$catalog_path_override"
  else
    resolve_catalog_path
  fi
  exec 8>"$catalog_dir/build.lock"
  if ! flock -n 8; then
    echo "A GeoCatalog build is active; wait for it to finish before rolling back" >&2
    exec 8>&-
    return 1
  fi
  local previous="$catalog_dir/previous.sqlite" validation_release
  validation_release="$(contextvm_release_dir)" || {
    echo "Cannot determine earthly-contextvm's active release from PM2" >&2
    return 1
  }
  require_safe_absolute_path "$validation_release" "ContextVM release directory" || return 1
  [[ -d "$validation_release" ]] || {
    echo "ContextVM release directory is unavailable: $validation_release" >&2
    return 1
  }
  require_contextvm_catalog_path "$validation_release" || return 1
  [[ -L "$previous" && -e "$previous" ]] || {
    echo "No valid previous GeoCatalog snapshot is retained" >&2
    return 1
  }
  [[ "$(catalog_state "$previous" "$validation_release")" == "ready" ]] || {
    echo "Retained previous GeoCatalog snapshot failed production validation" >&2
    return 1
  }

  local previous_target original_kind="missing" original_link_target=""
  previous_target="$(readlink -f "$previous")"
  if [[ -L "$catalog_path" ]]; then
    original_kind="link"
    original_link_target="$(readlink "$catalog_path")"
  elif [[ -e "$catalog_path" ]]; then
    [[ -f "$catalog_path" ]] || {
      echo "Current GeoCatalog path is not a regular file or symbolic link" >&2
      return 1
    }
    original_kind="file"
    original_link_target="$snapshot_dir/rollback-origin-$(sha256sum "$catalog_path" | awk '{print $1}').sqlite"
    [[ -e "$original_link_target" ]] || ln "$catalog_path" "$original_link_target"
  fi

  replace_catalog_link "$(readlink "$previous")" "rollback"
  local rollback_catalog_state
  rollback_catalog_state="$(catalog_state "$catalog_path" "$validation_release")"
  if [[ "$rollback_catalog_state" == "ready" ]] && restart_contextvm_and_wait ready; then
    echo "Previous GeoCatalog snapshot restored and serving"
    return
  fi

  local compensation_detail
  if [[ "$rollback_catalog_state" == "ready" ]]; then
    compensation_detail="GeoCatalog rollback restart or health check failed"
  else
    compensation_detail="Previous GeoCatalog became invalid during rollback"
  fi
  if ! catalog_points_to "$catalog_path" "$previous_target"; then
    compensation_detail="$compensation_detail; the active link changed concurrently, so it was not overwritten"
  elif [[ "$original_kind" == "missing" ]]; then
    if unlink -- "$catalog_path"; then
      if restart_contextvm_and_wait missing; then
        compensation_detail="$compensation_detail; the original missing state was restored and ContextVM recovered"
      else
        compensation_detail="$compensation_detail; the original missing state was restored but ContextVM did not recover"
      fi
    else
      compensation_detail="$compensation_detail; the newly installed link could not be removed"
    fi
  elif replace_catalog_link "$original_link_target" "rollback-compensation"; then
    if restart_contextvm_and_wait ready; then
      compensation_detail="$compensation_detail; the original catalog link was restored and ContextVM recovered"
    else
      compensation_detail="$compensation_detail; the original catalog link was restored but ContextVM did not recover"
    fi
  else
    compensation_detail="$compensation_detail; the original catalog link could not be restored"
  fi
  echo "$compensation_detail" >&2
  return 1
}

case "$mode" in
  ensure)
    start_job ensure
    ;;
  update)
    start_job update
    ;;
  run)
    run_worker
    ;;
  activate)
    activate_catalog
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs "${4:-}"
    ;;
  rollback)
    rollback_catalog
    ;;
  *)
    echo "Usage: $0 [ensure|update|run|activate|status|logs|rollback] [shared-dir] [release-dir] [overture-release|--follow] [catalog-path]" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bash
#
# purge-old-seeds.sh — NIP-09 delete OLD seeded events authored by the dev
# fixture keys (src/lib/fixtures.ts) from one or more relays, via nak.
#
# Why: before the relay stage-isolation work (docs/RELAY_STAGES.md) seed/test
# events signed by the shared dev keys could reach public relays. The unified
# seeder now guards against that; this script cleans up what already leaked.
#
# Usage:
#   ./scripts/purge-old-seeds.sh [--dry-run] [--force] [relay ...]
#
#   --dry-run   enumerate matching events, publish nothing
#   --force     skip the confirmation prompt
#   relay       one or more relay URLs (default: wss://relay.earthly.city)
#
# Notes:
#   - Deletes CONTENT kinds + profiles authored by the five devUser keys:
#     0, 7, 37515–37522. Wallet kinds (17375/7375/7376) are NOT touched.
#   - Addressable kinds also get an `a`-tag deletion (kind:pubkey:d) so every
#     replaceable version dies, not just the fetched id (NIP-09).
#   - Deletion is a request — relays may or may not honor it.

set -euo pipefail

command -v nak >/dev/null || { echo "nak not found — install: https://github.com/fiatjaf/nak" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

# Dev fixture secret keys — MUST match src/lib/fixtures.ts (devUser1..devUser5).
DEV_SKS=(
	"5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0" # devUser1
	"08a475839723c79f2993ad000289670eb737d34bc9d72d43128f898713fc3fb3" # devUser2
)

# Append devUser3..5 by parsing fixtures.ts, so the script never drifts from it.
FIXTURES="$(dirname "$0")/../src/lib/fixtures.ts"
if [[ -f "$FIXTURES" ]]; then
	# Every `sk: '<64 hex>'` in the file; dedupe against the two above.
	while IFS= read -r sk; do
		[[ " ${DEV_SKS[*]} " == *" $sk "* ]] || DEV_SKS+=("$sk")
	done < <(grep -oE "sk: '[0-9a-f]{64}'" "$FIXTURES" | grep -oE '[0-9a-f]{64}')
fi

KINDS=(0 7 37515 37516 37517 37518 37519 37520 37521 37522)
BATCH_SIZE=40

DRY_RUN=0
FORCE=0
RELAYS=()
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--force) FORCE=1 ;;
		*) RELAYS+=("$arg") ;;
	esac
done
[[ ${#RELAYS[@]} -gt 0 ]] || RELAYS=("wss://relay.earthly.city")

KIND_ARGS=()
for k in "${KINDS[@]}"; do KIND_ARGS+=(-k "$k"); done

echo "Relays:  ${RELAYS[*]}"
echo "Keys:    ${#DEV_SKS[@]} dev fixture keys"
echo "Kinds:   ${KINDS[*]}"
[[ $DRY_RUN -eq 1 ]] && echo "Mode:    DRY RUN (nothing will be published)"
echo

if [[ $DRY_RUN -eq 0 && $FORCE -eq 0 ]]; then
	read -r -p "Publish NIP-09 delete events for ALL matching events? [y/N] " answer
	[[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Aborted."; exit 1; }
fi

total_found=0
total_deletes=0

for relay in "${RELAYS[@]}"; do
	for sk in "${DEV_SKS[@]}"; do
		pk="$(nak key public "$sk")"
		short="${pk:0:8}"

		events="$(nak req -a "$pk" "${KIND_ARGS[@]}" -l 500 "$relay" 2>/dev/null || true)"
		[[ -n "$events" ]] || { echo "[$relay] $short… — nothing found"; continue; }

		count="$(printf '%s\n' "$events" | wc -l | tr -d ' ')"
		total_found=$((total_found + count))
		echo "[$relay] $short… — $count event(s):"
		printf '%s\n' "$events" |
			jq -r '"    kind \(.kind)  \(.id[0:8])…  \((.tags | map(select(.[0]=="d"))[0][1]) // (.content | fromjson? | .title? // .name?) // (.content[0:40]))"' |
			sed 's/[[:cntrl:]]//g'

		[[ $DRY_RUN -eq 1 ]] && continue

		# Build delete args: -e <id> for every event; -t a=<coord> (+ -t k=<kind>)
		# for addressable kinds so all replaceable versions are covered.
		args=()
		batch_count=0
		flush() {
			[[ ${#args[@]} -gt 0 ]] || return 0
			nak event -k 5 -c "purge: old dev seed data (pre relay-isolation)" \
				"${args[@]}" --sec "$sk" "$relay" >/dev/null
			total_deletes=$((total_deletes + 1))
			args=()
			batch_count=0
		}
		while IFS=$'\t' read -r id kind dtag; do
			args+=(-e "$id" -t "k=$kind")
			if [[ "$kind" -ge 30000 && "$kind" -lt 40000 && -n "$dtag" ]]; then
				args+=(-t "a=$kind:$pk:$dtag")
			fi
			batch_count=$((batch_count + 1))
			[[ $batch_count -ge $BATCH_SIZE ]] && flush
		done < <(printf '%s\n' "$events" |
			jq -r '[.id, (.kind|tostring), ((.tags | map(select(.[0]=="d"))[0][1]) // "")] | @tsv')
		flush
		echo "    → delete events published"
	done
done

echo
if [[ $DRY_RUN -eq 1 ]]; then
	echo "Dry run complete: $total_found event(s) would be deleted."
else
	echo "Done: $total_found event(s) targeted across $total_deletes NIP-09 delete event(s)."
	echo "Relays may take a moment to process deletions (and are free to ignore them)."
fi

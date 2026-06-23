# Phase 1: Encrypted Settings Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 1-Encrypted Settings Persistence
**Areas discussed:** Configurable addresses & config model, Encryption scheme, Export/import

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable addresses | Per-provider address persistence; possibly multiple | ✓ |
| Remote-signer load UX | Loading/failed state for NIP-46 async decrypt | |
| Export/import format | The SET-03 escape hatch | (raised by Claude at end) |
| Encryption scheme | NIP-44/NIP-04 strictness | ✓ |

**User's choice:** Configurable addresses + Encryption scheme.
**Notes:** Free-text added: "Custom endpoint has to be persisted too. Maybe we can have multiple?" → drove the config-model questions.

---

## Configurable addresses & config model

| Option | Description | Selected |
|--------|-------------|----------|
| Named profiles (list) | Saved configs with names, quick-switch, management UI | |
| One config per provider type | Separate baseUrl+apiKey per provider type | |
| Keep flat, just persist all fields | Single active config; ensure all fields incl. addresses persist | ✓ |

**User's choice:** Keep flat, just persist all fields.
**Notes:** "Multiple named profiles" noted as a deferred idea.

### Follow-up: address remembering

| Option | Description | Selected |
|--------|-------------|----------|
| Per-type address override | Each provider type keeps its own baseUrl+apiKey, defaulting to localhost | ✓ |
| Single shared endpoint | One field for the active provider; switching loses prior address | |

**User's choice:** Per-type address override.
**Notes:** Required to satisfy SET-01's literal "LM Studio *and* Ollama addresses persist."

---

## Encryption scheme

| Option | Description | Selected |
|--------|-------------|----------|
| NIP-44 preferred, NIP-04 fallback (keep) | Current behavior; max signer compatibility | ✓ |
| NIP-44 only, fail visibly | Stronger crypto; blocks NIP-04-only signers | |
| NIP-44 only for new writes, still read NIP-04 | Migrate forward without data loss | |

**User's choice:** Keep current NIP-44 preferred / NIP-04 fallback.
**Notes:** Natural scheme upgrade on next save is acceptable.

---

## Export / import (raised by Claude — SET-03 is a hard success criterion)

| Option | Description | Selected |
|--------|-------------|----------|
| Plaintext JSON file (download/upload) | File backup including keys; user secures it | |
| Password-encrypted file | Passphrase-wrapped backup | |
| Copy to clipboard (plaintext JSON) | Plaintext payload via clipboard | ✓ |

**User's choice:** Copy to clipboard (plaintext JSON).
**Notes:** Import pastes, re-encrypts to current key, replaces. Warn that clipboard holds plaintext secrets. File download deferred.

---

## Claude's Discretion

- **Remote-signer load/failed UX (SET-02)** — not discussed; left to the planner, bound by the success criterion (visible loading + failed state, no silent data loss).

## Deferred Ideas

- Multiple named provider profiles (list + management UI + quick-switch).
- Plaintext-file export (download/upload) in addition to clipboard.
- Password-encrypted export (passphrase-wrapped backup).

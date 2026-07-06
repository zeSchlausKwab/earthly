# seed-legacy

The pre-unification seed scripts, archived when the unified seeder shipped
(`bun run seed <command>`, see `scripts/seed.ts` + `src/lib/seeder/`).

Kept for ONE release as a reference for the migration, then this directory —
together with the `src/lib/seed-relay/` NDK compat shim that only these
scripts still import — gets deleted.

| Old script | Replacement |
|---|---|
| `seed.ts` (kind-37518 map-context model, retired) | `bun run seed full` |
| `seed-entities.ts` | `bun run seed full` |
| `seed-sightings.ts` | `bun run seed sightings` |
| `seed_canonical_data.ts` | `bun run seed canonical` |
| `purge_canonical_data.ts` | `bun run seed purge` |
| `gen_geo_events.ts` / `gen_user.ts` / `seed/` | faker helpers used only by the legacy `seed.ts` |

Do not wire anything new to these scripts.

# Phase 11 (Temporal Sighting) — Browser UAT Playbook

**Audience:** an LLM agent with a browser (Claude-in-Chrome, Playwright agent, etc.).
**Goal:** execute each test against the running app, observe the result, and fill in
the **Report** section at the bottom (PASS / FAIL / BLOCKED + notes + screenshot refs).

Earthly is a Nostr app: data is read from a local relay over WebSocket, so allow a
moment after each action for events to round-trip. Render title/description as plain
text (no HTML). All seed data is centered on **Vienna**.

---

## 0. Preconditions & setup

Before testing, confirm (or perform) the following. These run in a terminal, not the browser.

1. **Dev server** is up: `http://localhost:3000` should load the app (title "Earthly — Collaborative Maps on Nostr"). If not: `bun dev`.
2. **Relay** is up on `ws://localhost:3334`. If not: `bun relay`.
3. **Seed data** present: run `bun run seed:sightings`. This publishes **12 Temporal Sightings** around Vienna — 4 **live**, 4 **upcoming**, 4 **past** — with distinct points, varied expiry, and mixed authorship. Several are authored by **devUser1** (the login key below) so owner-only actions are testable.

**Seeded sightings (for reference):**
- Live (amber markers): *Kingfisher at Donaukanal* (devUser1, never expires), *Street musicians — Stephansplatz*, *Food truck rally — MuseumsQuartier* (devUser1), *Red fox — Stadtpark* (area polygon, "Fades soon", no description).
- Upcoming (blue markers): *Mural unveiling — Gürtel* (devUser1), *Naschmarkt night market*, *Perseids viewing — Kahlenberg*, *Pop-up gallery — Karlsplatz* (no description).
- Past (grey markers): *Peregrine on Stephansdom*, *Beaver dam — Lobau* (devUser1, area polygon), *Ice formation — Donauinsel*, *Hedgehog crossing — Prater*.

---

## 1. Log in as the owner key (devUser1)

Owner-gated tests (edit / delete) need you signed in as **devUser1**, who authored
several seeded sightings and whose profile name is **"Earthly Curator"**.

**Steps:**
1. Open `http://localhost:3000`.
2. Find the account / login control (an account button or avatar in the sidebar — look for "Sign in", an account menu, or "Create or import a private key").
3. Choose the **import a private key** path (it may be labelled "import", "expert", or "advanced" — read the dialog and pick the option that accepts an existing key, not "generate new").
4. Paste this nsec and submit:
   ```
   nsec1tjqml75rqwaawunddfdpzu8naerdu2ka40hadfe4s3gkdtcp7hqq7ys228
   ```
   (This is the dev key `devUser1`, npub `npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah`.)
5. **Expected:** you are now logged in; the account control shows **"Earthly Curator"**.

If you cannot complete login, mark the owner-gated steps (Test 2, and the Edit/Delete parts) **BLOCKED** and still run everything else logged out.

---

## 2. Navigate to the seeded data (Vienna)

1. Open the left sidebar and select the **Sightings** rail/destination (eye / telescope icon, label "Sightings").
2. **Expected:** a list of sighting rows appears — each a compact card with a **title + state badge** (LIVE / Upcoming / a past date), an **author · time · "Fades in …"** line, and an inline action row (heart / lightning / comment / share on the left; zoom / open / edit / delete icons on the right).
3. Click the **zoom (target/crosshair) icon** on any row (e.g. *Kingfisher at Donaukanal*). **Expected:** the map flies to Vienna and centers on that sighting's marker. You should now see colored sighting dots on the map.

---

## TEST 1 — Map-first create flow (full walkthrough)

**Objective:** create a sighting from a map pin-drop and confirm it renders as a distinct, state-aware marker.

**Steps:**
1. In the **Sightings** rail, click the accent **New Sighting** button at the top.
2. **Expected:** the cursor/map arms for placement and a dismissible hint appears, roughly *"Click the map to drop your sighting"* with a Cancel affordance.
3. Click anywhere on the Vienna map.
4. **Expected:** a pin drops at the click point AND a compact **create form** opens in the right info panel containing:
   - a **Title** field (placeholder ~"What did you see?")
   - a **Description** field (placeholder ~"Add details…")
   - an **observation time** control defaulting to **"Observed now"** with an "Adjust time" affordance
   - a **NIP-40 expiry** preset group (After 1 day / 1 week / 1 month / Never / Custom) **defaulting to "After 1 month"**
   - an optional **Group attach** picker (Add to a Group)
   - a **Publish Sighting** button.
5. Enter a Title (e.g. `UAT test sighting`) and a short Description. Leave the time as "Observed now" and expiry at "After 1 month".
6. Click **Publish Sighting**.
7. **Expected:** the form closes; within a few seconds a **new marker** appears on the map at the dropped point, and a new row appears at/near the top of the Sightings list.
8. Confirm marker distinctness: live-now markers are **amber** and slightly larger/accented; upcoming are **blue**; past are **grey**. Your just-created sighting (observed now, no end) should render as a **live (amber)** marker.
9. Confirm **expired sightings are absent**: there should be no marker for any sighting whose NIP-40 expiry is in the past (all 12 seeds are unexpired, so this is a negative check — just confirm no "dead"/missing-data dots appear).

**Optional (area geometry, D-02):** repeat steps 1–4, and in the form use the **"Draw an area instead"** affordance, draw a polygon, then publish. **Expected:** the geometry is captured as an area and the sighting still renders with a single representative marker.

**PASS criteria:** pin-drop → form with all fields above → publish → distinct state-colored marker appears + new list row. Record any missing field, wrong default, marker that isn't visually distinct, or publish that doesn't produce a marker.

---

## TEST 2 — Sighting edit preserves Group attachments (CR-01) — *owner, requires login*

**Objective:** confirm editing a Group-attached sighting does NOT silently drop its Group `c`-tag (the CR-01 regression).

**Steps:**
1. Logged in as **Earthly Curator** (devUser1), create a NEW sighting via Test 1's flow, BUT in the create form use the **Group attach** picker to attach it to a Group (pick any available Group, e.g. one of the seeded "Vienna …" groups if present). Publish.
   - *If no Groups exist to attach to, run `bun run seed:entities` first to seed Groups, or mark this test BLOCKED with that reason.*
2. Open that sighting's detail (click its row or its map marker).
3. Click **Edit** (pencil) in the detail panel — visible because you own it.
4. In the edit form, **change only the title** (e.g. append " (edited)"). **Do NOT touch the Group attach picker.** Confirm the Group attach still shows the previously-attached Group.
5. Save / Publish changes.
6. **Expected:** the sighting updates in place with the new title AND **keeps its Group attachment** — the Group picker still shows the Group after re-opening edit, and the attachment is not lost.

**Verification aid (terminal, optional but conclusive):** after the edit, query the event and confirm a `c` tag is still present:
```
nak req -k 37522 ws://localhost:3334 | grep -i "edited" | head
```
The matching event's `tags` array must still contain a `["c", "37518:…"]` entry.

**PASS criteria:** the Group `c`-tag survives an edit that didn't touch the Group picker. FAIL if the attachment disappears after editing.

---

## TEST 3 — Comment + react on a Sighting (SIGHT-04)

**Objective:** confirm the discussion surface works on a kind-37522 sighting.

**Steps:**
1. Open any sighting's detail panel (click a row or a marker).
2. Scroll to the **Comments / Discussion** section. **Expected:** a comment composer ("Share your thoughts…") and a social action row (heart / lightning / share / comment).
3. Type a comment and **Post**. **Expected:** the comment appears threaded under the sighting within a few seconds, attributed to **Earthly Curator** (if logged in).
4. Click the **heart** (like). **Expected:** it fills/highlights (a kind-7 reaction is published). Click the **lightning** (zap) — **Expected:** a zap dialog opens (amount presets + invoice/QR). You do not need to complete a payment; just confirm the dialog opens.
5. **(Annotation sub-check — recently fixed)** In the comment composer, use the draw tools ("Draw a point, line, or polygon on the map to attach it to your comment"), draw a small shape, and Post the comment. The comment row should show a **"1 geometry"** chip with an **eye (visibility) toggle** and a **Zoom** button.
   - Toggle the **eye** ON → **Expected:** the comment's drawn geometry appears on the map. Toggle OFF → it disappears. (This was previously broken for sightings — verify it now works.)
   - Click **Zoom** on the geometry chip → **Expected:** the map flies to that annotation.

**PASS criteria:** comment posts and threads under the sighting; like fills; zap dialog opens; comment geometry annotation shows/hides on eye-toggle and zooms. Record any step that does nothing.

---

## TEST 4 — Inspect-panel "Zoom to" button (recently added, all entities)

**Objective:** confirm every entity inspect panel has a working Zoom-to button.

**Steps:**
1. Open a **Sighting** detail panel → click the **Zoom** button in the header. **Expected:** the map flies to and centers on that sighting's marker (lands ON the dot, not offset).
2. Open a **Story** detail (Stories rail → open a story) → **Zoom** in the header flies to the story's footprint. *(Run `bun run seed:entities` if no Stories/Groups exist.)*
3. Open a **Group/Context** detail → **Zoom** flies to the group's footprint.
4. (Reference) A **Dataset** inspect panel already had a Zoom button — confirm it still works.

**PASS criteria:** Zoom button present and accurate in Sighting, Story, and Group inspect panels. Note the earlier bug being checked: for an **area** sighting (e.g. *Red fox — Stadtpark* or *Beaver dam — Lobau*), Zoom must land on the marker, NOT southwest of it.

---

## TEST 5 — Map marker interaction (recently added)

**Objective:** confirm sighting markers are interactive (not "dead dots").

**Steps:**
1. **Hover** a sighting marker. **Expected:** a hover popup appears showing a state badge + title, author, description, observed date, and expiry countdown (the dataset-style hover popup).
2. **Click** a sighting marker. **Expected:** its detail panel opens (showing its content) AND the Sightings rail highlights + scrolls to that sighting's row (answering "where is it in the list?").
3. Confirm a **point** sighting and an **area** sighting (e.g. *Red fox — Stadtpark*) both behave correctly.

**PASS criteria:** hover shows a content popup; click opens detail + highlights the list row.

---

## Report

Fill this in. For each test: **PASS**, **FAIL**, or **BLOCKED**, plus a one-line note and a screenshot reference where useful. For any FAIL, describe exactly what happened vs. expected.

| # | Test | Result | Notes / evidence |
|---|------|--------|------------------|
| 1 | Map-first create flow | | |
| 2 | Edit preserves Group attach (CR-01) | | |
| 3 | Comment + react (+ annotation toggle) | | |
| 4 | Inspect-panel Zoom-to (all entities) | | |
| 5 | Map marker hover + click | | |

**Environment:** app URL, relay status, seed command(s) run, logged-in identity.

**Overall verdict:** (all pass / N failures / blocked items + reasons)

**Known non-issue (do not report as a bug):** a Sighting attached to a Group does **not** appear in that Group's "Community contributions" lane — this is a deliberate Phase-13 deferral (the Group lane currently renders only kind-37515 datasets). The `c`-tag is correctly emitted; only the Group-side rendering is deferred.

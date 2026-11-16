# TRIAGE-1 — Emberline (threejs-fps-01), reviewer round 1

**Verdict: NOT ready to submit. 7 blocking issues, 11 optional items.**
The entry is a genuinely complete game underneath, but its screenshots currently show a broken camera, not a game. The single most important finding is **B1**: the camera constructor is wrong, and it — not the palette — is the main cause of the "too dark" screenshots. The builder's known-defect #1 misdiagnosed the root cause. Fix B1 first, then re-judge everything visual.

**Scope of this review:** read kit `RULES.txt` (criteria confirmed as stated in the task) and all 12 modules + `index.html`; re-took all 4 staged screenshots; ran the game in headless Chromium (Playwright, SwiftShader) against the kit starter as a brightness control; drove the live sim deterministically (buy phase → live → rounds → match end) through a probe harness. **Nothing in the entry was modified.** All probing used a scratch copy in `/tmp/probe` (camera fix applied there only, for diagnosis). The entry's `screenshots/` still show the broken camera and must be retaken after the fixes.

**Method note — two probe artefacts I first misread, so the next session doesn't chase them:** (a) an early "20 shots, 0 damage" result was my staging error (I teleported a bot and fired before its mesh synced, at a strafing target); with a synced stationary target the gun works (see "Verified working"). (b) Early "player can't move/jump/stand" results were my staging error (I teleported the player *inside* the mid low-wall collider at (0, 0, 6.5)); on open ground movement/collision/crouch/jump all work.

---

## BLOCKING — fix before submitting

### B1. Camera constructed with wrong arguments — the game renders as a vertical sliver
- **Where:** `game/src/main.js:47`
  ```js
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth, window.innerHeight, 0.05, 160);
  ```
  `PerspectiveCamera` takes `(fov, aspect, near, far)` — 4 args. This passes 5, so `aspect = 1280`, `near = 720`, `far = 0.05`, and the intended `160` is ignored.
- **Evidence (measured, not guessed):** at runtime `camera.aspect === 1280`, `camera.near === 720`, `camera.far === 0.05`; projection matrix element `[0]` is `0.001` (correct: `0.746`), so the horizontal half-angle is ~0.03° — the camera sees a ~1 cm-wide slice of the world at 10 m. All 4 shipped screenshots are that sliver plus background colour (scene-centre mean luminance 10–32/255, <2% of pixels above 60). Painting the view-model meshes bright red `MeshBasicMaterial` in the probe still produced 0.01% red pixels — the gun is geometrically clipped out of the frustum, not merely dark. The kit starter (correct constructor) renders readably in the same headless environment (11.4% of pixels above 60), so this is the game's bug, not SwiftShader.
- **Why it matters:** criterion 1 (a first-person view; "screenshots and code must agree") and criterion 4 both fail on the evidence the judge actually sees. The top-5 team play-review would open the same broken view. Note the `resize` handler (`main.js:737`) sets the aspect correctly, so the bug silently heals itself on the first window resize — which is presumably why it survived unnoticed.
- **Fix (one line):**
  ```js
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
  ```
- **Good looks like:** `camera.aspect ≈ 1.78`, `near 0.05`, `far 160`; a `?shot=plant` frame like the one I captured with the fix in the probe — furnace glow, defusing bot, view-model rifle and HUD all visible in one frame. Re-take all 4 screenshots after this fix and re-check B3/B4 against them.

### B2. Spawn and hold facings are reversed — everyone spawns staring at their own wall
- **Where:** `game/src/player.js:23` (`yaw: Math.PI, // face north, toward the sites`), `game/src/main.js:415` (`player.reset(vSpawn, Math.PI)`), `game/src/bots.js:170` (Vanguard `bot.yaw = Math.PI`), `game/src/bots.js:182` (Warden `bot.yaw = 0`), `game/src/bots.js:321` (hold: `bot.yaw += (0 - bot.yaw) * …`).
- **Yaw convention (verified live):** `aimAt()` sets `yaw = atan2(-dx, -dz)`, so yaw `0` faces north (−z, toward the sites) and yaw `π` faces south (+z, toward the Vanguard spawn wall).
- **Evidence:** live probe shows `playerYaw = 3.14` at spawn and `W` moves the player south (`z 16.5 → 19.7`, toward the spawn wall). Vanguard bots spawn facing south, Wardens facing north — both away from the enemy, so no bot can see anyone on its first perception tick. The hold code lerps yaw toward `0` (north wall) while its own comment says "defenders look south toward mid/spawn" — holding Wardens stare at the north wall instead of watching the approaches.
- **Fix:** player + Vanguard spawn yaw `0`; Warden spawn yaw `π`; hold lerp target `π`. (Bots self-correct once they walk a route, since `moveToward` sets yaw — so the lasting damage is the player's first impression, the start/cover shot, and holders not watching lanes.)
- **Good looks like:** on spawn the player sees mid, the Crusher and both sites down the yard; the `?shot=start` frame shows the yard, not the spawn crates and south wall; a holding Warden's yaw sits near `π`.

### B3. Shot staging hides the action (re-stage after B1+B2)
- **Where:** `game/src/main.js` `runShot()` — combat ~`685–698`, buy ~`671–682`, start ~`665–668`.
- **Evidence:**
  - *Combat:* the target foe is staged at `(-1.5, 0, -3.5)`, directly behind the Crusher block (`world.js`, 4.5×2.6×4.5 at origin). The staged shot fires into the Crusher — the fixed-camera re-take shows impact sparks on the Crusher face and no visible enemy at the crosshair. A Vanguard mate (left) and a second Warden (right) are visible, but the aimed target is not.
  - *Buy:* mates are staged at `(-2.5, 0, 12)` / `(2.5, 0, 12.5)`, north of the player at `z = 16.5`, while the camera yaw is `π × 0.92` (facing south). Both mates are behind the camera; the fixed-camera re-take shows no bots.
  - *Start:* yaw `π` faces the south wall (see B2); the fixed-camera re-take shows spawn crates and wall.
- **Fix:** combat — stage the foe in an open lane with clear line of sight, e.g. `(5, 0, -6)` (east of the Crusher) or `(-5, 0, -6)`, aim at chest height, and verify in the re-taken frame that the foe is visible *and* the shot lands (ammo 30→29 is not enough — the foe must be in frame). Buy — set yaw `0` (after B2) so the mates and the yard are in frame. Start — yaw `0`.
- **Good looks like:** each screenshot shows what its name promises at a glance — combat: an enemy bot centred under the crosshair with the view-model rifle; buy: menu + two teammates + yard; start: title panel over the open yard.

### B4. Scene still too dark after the camera fix (palette + sun direction)
- **Where:** `game/src/palette.js` (floor `#23262b`, surface `#2e343c`, canvas `#17130f`), `game/src/world.js:177–198` (hemisphere 0.9 with near-black ground colour, sun 2.4 from the west `(-18, 16, 10)`, fill 0.5).
- **Evidence:** with the camera fixed in the probe, the re-taken shots improve (7–10% of pixels above 60, vs 0.7–1.7% before) but still read as brown murk except `plant`, which works because the furnace point light does the heavy lifting. Scene-centre mean luminance is 15–35 vs the starter's play shot at 31 with 11.4% bright pixels. Root causes: the sun comes from the west, so the south faces you see while looking north get almost no direct light; the hemisphere's ground colour is near-black, so vertical faces get ~half of a dim sky; every base material is very dark.
- **Fix (do after B1, then re-measure):** raise hemisphere intensity `0.9 → ~1.4` and lighten its ground colour (e.g. `#4a4238`); raise fill `0.5 → ~0.9`; move the sun so south faces catch light (e.g. `(-14, 20, 14)`) or raise it to ~3.0; lighten floor/surface palette values ~1.5×. Keep the dusk-amber identity — the goal is legibility, not daylight.
- **Good looks like:** re-taken `combat`/`buy` frames with scene-centre mean luminance ≥ ~45 and ≥15% of pixels above 60 (starter play shot is the floor to beat: 31 / 11.4%), floor and wall planes distinguishable from each other at a glance, bots readable as amber/teal figures against the yard.

### B5. The spike-status HUD line is destroyed by the money display
- **Where:** `game/index.html:171` (`<div id="money">$800<span id="spike-status">…</span></div>`) and `game/src/hud.js:118` (`setMoney(value) { setText(money, 'money', `$${value}`); }`).
- **Evidence:** `setText` assigns `textContent` on `#money`, which deletes its child `#spike-status` span on the first `syncHud()` call. Live probe: after the first money sync, `document.getElementById('spike-status')` is `null` and `#money` contains only `"$800"`. No screenshot shows a spike line. The planted/carried/dropped state is therefore only ever visible via a transient banner.
- **Fix:** give the number its own element — `<span id="money-num">$800</span><span id="spike-status">…</span>` — and have `setMoney` write to `#money-num` only.
- **Good looks like:** "You carry the spike" / "Spike planted — Site A · 32s" / "Spike dropped — pick it up" visible under the money at all times during live play.

### B6. Bots get stuck on obstacles that sit on their waypoint lines
- **Where:** `game/src/world.js:160` (crate `1.6×0.7×1.6` at `(0, 0.35, 14.5)`), `game/src/world.js:132` (Crusher pillar `1.0×3.4×1.0` at `(0, 1.7, -3.2)`), `game/src/bots.js` `moveToward`/`think` (straight-line node-to-node walking, no stuck detection, no detour).
- **Evidence (live sim):** Bramble (mid lane, spawn `(-1, 17.5)` → node 3 `(0, 10)`) sat at `(-0.8, 15.7)` for 45+ seconds of live play — its straight-line path crosses the `(0, 14.5)` crate and both movement axes stay blocked. Four Wardens investigating a mid `lastSeen` piled up at `(0, -4.1)`, 0.4 m from the Crusher pillar's north face, motionless for 20+ seconds — their route to node 13 `(0, -6)` runs straight through the pillar. (The pile-up later dispersed when new stimuli arrived; Bramble never moved.)
- **Fix (do at least one of):** (a) move the `(0, 14.5)` crate off the spawn→node-3 line (e.g. `x = ±3`) and shift node 13 off the pillar line (e.g. `(2, -6)`), or add flanking waypoints around both obstacles; (b) add stuck detection in `bots.step` — if a bot makes <0.2 m progress in 1.5 s while in `route`/`investigate`, sidestep perpendicular for 0.5 s or re-run BFS to the next route node.
- **Good looks like:** in a 30 s live sim, sample bot positions every 5 s — every bot has moved between samples except bots legitimately in `hold`; no bot sits on the same spot for 20 s.

### B7. No one fetches a dropped spike
- **Where:** `game/src/main.js` spike-pickup loop (bots only pick the spike up by walking within 1.2 m of it) and `game/src/bots.js` `think()` (no dropped-spike behaviour).
- **Evidence:** live sim — player died planting at site A, spike dropped at `(-18, -15)`; 20 s later the spike was still `dropped` and no Vanguard bot had routed toward it (nearest was ~24 m away, still on its lane route). If the carrier dies away from the team's routes, the round can only end by timeout.
- **Fix:** in `think()`, when `spike.state === 'dropped'` and the bot is Vanguard, alive, and has no visible enemy, the nearest such bot routes to the spike (`setRouteTo(bot, nearestNode(spike.pos.x, spike.pos.z))`); the existing pickup loop handles the rest.
- **Good looks like:** after a carrier death, a teammate recovers the spike within ~15 s (verify by killing the carrier in a probe and watching a Vanguard bot's route converge on the drop point).

---

## OPTIONAL polish

### O1. Hot-loop allocations contradict the "no new objects per frame" claim (criterion 5)
The dossier's code story says the hot loop never allocates; the judge reads the code and will find these:
- `main.js` `botApi.foesOf()` builds a fresh array plus a fresh object per foe, called per bot per think tick (~8 Hz × 9 bots).
- `main.js:149` `fireHitscan` does `shootables.concat(bots.hitMeshes())` — two array allocations per shot; `:156` clones the player-hit point; `:176` allocates `new THREE.Vector3(0, 1, 0)` as a fallback on every impact.
- `bots.js:241` allocates a target `Vector3` per foe per think; `:248`, `:397` allocate a `Vector3` per sighting / per damage event.
- `grenades.js:76` does `g.pos.clone().addScaledVector(...)` per live grenade per fixed step; `particles.js:79` clones the flash material on every explosion.
- Fix: pre-allocate and reuse (a module-level `tmpTarget` already exists in `bots.js` — use it in `think()`; cache the `hitMeshes` array and refresh it only when a bot dies; reuse one `Vector3` for the impact normal; integrate grenade velocity into the existing `pos` vector instead of cloning). Any three of these fixed makes the claim honest.

### O2. Dead code the judge can see (criterion 5: "no dead code")
- `weapons.js:177` `refillAmmo()` — no callers (only `refillAll()` is used).
- `state.js:141–142` exported `startRound` / `startLive` — only used internally; no external caller.
- `bots.js:433` `carrier()` — no callers (main.js reads the `bot.carrier` property).
- `input.js:64` `clearPressed()` — no callers.
- `hud.js:18` `COPY.roundEnd` — `showOverlay('roundEnd')` is never called.
- `weapons.js:10–43` `key` fields on every weapon/grenade — never read anywhere, and the values are wrong for the actual handling (all four primaries claim key `'1'`; grenades claim `'3'/'4'/'5'` while the buy menu uses keys 1–7). Delete the field or make it true.
- Fix: delete all of the above; re-run `node --input-type=module --check` per module.

### O3. Angle normalisation copy-pasted three times
`while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;` appears in `bots.js:237–238`, `bots.js:328–329` and `main.js:277–278`. Extract one `wrapAngle(diff)` helper (in `bots.js` or a shared spot) and use it in all three places.

### O4. Buy-menu keys are overloaded and the menu is dead-but-visible during live play
Digits 1–7 buy when the menu is open in the buy phase, but the same digits switch weapons (1–2) / grenades (3–5) otherwise — and `B` also opens the menu during `live`, where clicking a row does nothing (`buy()` gates on `phase === 'buy'`) with no feedback. Fix options: only allow `B` during the buy phase, or show bought/unavailable state on rows during live, or move buy keys to a dedicated row (e.g. `F1`–`F7` is worse; simplest is the phase gate). Small, but a play-reviewer will press B mid-round.

### O5. Two small HUD nits
- `syncHud()` passes `0` as the timer during `roundEnd`/`matchEnd`, so the top bar reads `0:00` for the 4 s round-end pause. Pass the round-end time remaining instead, or freeze the last live value.
- `hud.markBought(id, false)` adds the `poor` class when the player can't afford an item, but nothing ever removes it when money rises again. Clear `poor` in `syncHud()` or when money changes.

### O6. A 4–4 tie at round 9 awards the match to Warden
`state.js:79`: `matchWinner = score.vanguard > score.warden ? 'vanguard' : 'warden'` — a 4–4 tie after 9 rounds is decided for Warden by the `else` branch, with no overtime or draw rule. Make it explicit: either play a 10th deciding round or document the tie-break (e.g. "most rounds won, then Warden holds the yard"). One line either way.

### O7. Ammo refills free every round, so the economy only gates purchases
`main.js` `startRoundSetup()` calls `weapon.refillAll()`, resetting every weapon's mag + reserve each round. In CS-likes, ammo economy matters; here a player who never buys still gets a full rifle every round. Consider carrying reserve ammo across rounds (refill only the magazine, or charge for reserve top-ups). Economy depth is a criterion-3 differentiator; this is cheap to change.

### O8. The buy screenshot stages an unreachable economy state
`main.js:673` sets `game.state.money = 4700` for the `?shot=buy` frame, but the frame also says "Round 1" — round-1 money is capped at the $800 start (nothing can be earned before round 1). The judge's first criterion includes "screenshots and code must agree". Stage the buy shot as round 2+ (e.g. set `game.state.round = 2`, score `V 1 — 0 W`) or use a reachable round-1 amount. Same class of issue: the start shot shows a `1:39` timer while the game is still in the menu phase, where no timer runs — set the staged timer text to the buy-phase value or hide it for that shot.

### O9. No live indicator when a *bot* is planting/defusing
The channel progress bar (`hud.showChannel`) only runs for the player. When a Warden bot defuses (or a Vanguard bot plants), the player gets no warning except the eventual banner. Add a spike-status flash or a banner when a bot's `channel > 0` ("A Warden is defusing the spike!") — it makes the objective legible in live play, which is exactly what criterion 3 rewards.

### O10. The view model reads as a flat tan slab
After B1 the rifle *is* visible, but the ink body material under the amber sun renders as one flat tan wedge with no readable receiver/barrel/stock separation. Darken the receiver (or use the `hairline` steel for the body and keep amber only as a small accent) so the silhouette reads as a rifle at a glance. Cosmetic; verify in the re-taken combat frame.

### O11. Trivial: `state.plantedSite` duplicates `spike.site`
`state.js` keeps both `plantedSite` and `spike.site`, always set together. Drop `plantedSite` and read `spike.site`.

---

## Verified working (do not re-litigate; these passed live probing)

- **Gunplay:** rifle body shot at 13 m deals 34 damage; headshot deals 85 (34 × 2.5) with the ray hitting the `head` mesh; mag 30→29 per shot; reload refills 2→32 mag, 96→66 reserve; spread/bloom exist in code and the stationary-vs-moving spread path is wired (`weapons.spread` reads ground speed/airborne/crouch).
- **Movement:** acceleration + friction, AABB axis-separated collision (walked into the Crusher-side low wall and a container and stopped exactly at face + radius), crouch 1.72→1.12 m / eye 1.60→1.02 m and back, jump peak ~0.91 m and land, diagonal W+D normalised (no speed boost; wall-slide preserves the free component).
- **Rounds/economy:** buy phase (10 s) → live (100 s) → roundEnd (4 s) → buy → … → matchEnd, reached live (V 0–5 W by timeouts in the probe); kill +$300, plant +$300, win +$3250 / loss +$1900 + streak bonus all applied; buying via real `Digit2` keypress works (SMG $1500, $4700→$3200); `B` toggles the menu.
- **Grenades:** frag/smoke/flash purchasable; smoke detonates into a zone and `sightBlocked()` returns true across it.
- **Bots:** move along lane routes, engage, investigate gunfire/last-seen, strafe while fighting, and kill — the player was killed by bot fire in the probe; killfeed, hitmarker, damage vignette, team pips, health/ammo/timer/score all update.
- **Spike flow (partial):** plant channel accumulates on `E` in-site; the player was killed mid-channel by defenders (legitimate); the fuse/round-end-by-detonation path is code-verified (not live-observed — see B7 for the related gap).
- **Code structure:** 12 single-job modules, fixed 60 Hz sim decoupled from rendering, state in `state.js`, pooled tracers/sparks; import/export graph and `node --check` on all modules pass (builder-verified, unchanged since).

## What this round did NOT do
No entry file was modified, committed, or pushed; no repo created; nothing bundled or submitted; no fee paid. All live probing ran against the scratch copy in `/tmp/probe` (plus the kit starter on port 8081 as a control). The entry's four screenshots are still the broken-camera versions — retaking them after B1–B4 is part of the revision pass, not this review.

**Bottom line for the revision pass, in order:** (1) one-line camera fix (B1); (2) yaw fixes (B2) + re-stage all four shots (B3); (3) lighting/palette lift + luminance re-check (B4); (4) spike-status span (B5); (5) unstick the bots (B6) and add spike retrieval (B7); (6) sweep O1–O2 dead code/allocations; (7) re-take screenshots, re-run the dossier build, and play-test one full match live before submitting.

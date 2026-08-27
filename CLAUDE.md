# CLAUDE.md — FTC Simulator

Permanent engineering instructions for this repository. These rules outlive any
single task. Read them before writing code.

## Source of truth

- `docs/PRODUCT_SPEC.md` is the authoritative product definition. Behavior,
  scope, and terminology come from it.
- If code and spec disagree, the spec wins — fix the code, or raise the conflict.
  Never silently change the spec to match an implementation.
- Spec changes are their own commit, made deliberately and never as a side effect
  of a code change.

## Architecture rules

- **Three layers, one direction of dependency:** `sim core -> rendering/UI` and
  `sim core -> robot control API`. The core never imports rendering, DOM, window,
  canvas, or any UI type.
- **The sim core runs headless.** Every physics and scoring behavior must be
  testable with no renderer attached. If a behavior can only be observed on
  screen, it is in the wrong layer.
- **Rendering is a pure read of simulation state.** Renderers may not mutate
  world state, and no gameplay logic may live in a draw call.
- **Robot control code is a sandboxed consumer.** It reads sensors and writes
  actuator commands through a defined API; it never reaches into world internals.

## Determinism

Determinism is a hard requirement, not a nice-to-have — replays, tests, and
autonomous-mode debugging all depend on it.

- **Fixed timestep** for the physics/logic update. Never integrate using
  wall-clock or frame delta. Decouple render rate from tick rate.
- **All randomness goes through one seeded RNG** owned by the sim. No
  `Math.random`, no unseeded RNG, no time-based seeds inside the core.
- **No iteration over unordered collections** where results depend on order.
  Sort explicitly when order matters.
- Same seed + same inputs + same tick count must produce byte-identical state.
  This is a testable invariant — treat a break as a bug.

## Units, frames, and constants

- One canonical unit system for the core, declared once in a constants module.
  Convert only at boundaries (UI display, config files, user input) — never mid
  expression, never ad hoc. Canonical units are fixed from `PRODUCT_SPEC.md`
  before the first physics code lands.
- Name variables with their unit when ambiguity is possible
  (`headingRad`, `widthIn`, `dtSec`).
- One documented world coordinate frame and one heading convention (origin, axis
  directions, zero heading, positive rotation). Every transform states which
  frame it maps from and to.
- **No magic numbers.** Field dimensions, robot geometry, motor specs, match
  timings, and scoring values live in named constants/config, not inline in
  logic.

## Code standards

- Small, single-purpose modules. If a file needs a section comment to be
  navigable, split it.
- Match the surrounding code's naming, structure, and comment density.
- Comments explain *why* — physics assumptions, unit choices, rule citations.
  Do not narrate what the code plainly does.
- Prefer explicit, readable math over clever compression. This code models
  physical behavior; it must be auditable against the spec.
- No dead code, no commented-out blocks, no speculative abstraction for features
  that are not in the spec.

## Dependencies

- Default to zero new dependencies. Adding one requires a concrete justification
  and explicit approval — physics, math, and geometry helpers are usually
  cheaper to write than to depend on.
- The sim core stays free of framework and platform lock-in.

## Testing

- Every core rule — physics, scoring, timing, collision, game state transitions —
  gets a test that asserts behavior from the spec.
- Test physical invariants, not just outputs: energy/momentum sanity, no
  tunneling through walls, robot stays inside field bounds, no NaN in state.
- Include determinism tests (same seed, identical result) and regression tests
  for every fixed bug.
- Tests run headless and fast. No test depends on rendering or real elapsed time.

## Performance

- The sim loop has a per-tick budget; the simulation must sustain real-time
  playback at the target tick rate on ordinary hardware.
- No allocation in the hot loop where it can be avoided — reuse vectors and
  buffers.
- Measure before optimizing. Never trade determinism or clarity for speed
  without a benchmark proving the win.

## Working agreements

- Do not implement features that are not in `docs/PRODUCT_SPEC.md`. If something
  is needed but unspecified, ask or write it into the spec first.
- Do not change public API shapes, save formats, or replay formats without
  calling it out explicitly.
- Report honestly: if a behavior is approximated, unfinished, or untested, say so
  rather than presenting it as complete.

---

## Progress checkpoint — 2026-08-26

Written for session recovery. The repository is the source of truth; this is a
map, not a substitute for reading it.

### Where the project is

Phases 1 and 2 are complete. **Phase 3 is built end to end** — snapshot →
observations → events → rules → score — and it is now wired into the app: the
browser runs a real DECODE `MatchSimulation`, draws the game's regions and zones
and its pieces, and shows phase, clock, score and recent awards. Phase 4 (PDF
ingestion) and Phase 5 (metrics, archetypes) are not started.

`docs/ASSUMPTIONS.md` is the live ledger and is accurate. Read §2.2, §5.7, §5.8,
§10.9 and §10.14 before touching physics or the DECODE fixture.

### Physics decisions worth knowing before changing anything

- **Contacts produce a manifold, not a point** (§5.7). A single contact point
  taken at the deepest vertex lands at the *middle of a perimeter wall*, and the
  lever arm spins any robot that meets a wall off-centre. Face-on contacts
  resolve at two points; corner contacts at one, which is what still lets a
  robot square up against a wall it hits at an angle.
- **Resolution sweeps within a contact and across the contact set** (§5.7,
  §5.8). Both are needed: within, so two coupled points do not leave residual
  spin; across, so a body with two contacts is not corrected twice in ignorance.
- **Mecanum has a roller degree of freedom** (§2.2). Roller slip is
  `√2(v_y ± a·ω)` and has *no* `v_x` term, so resistance in the roller path is
  geometrically confined to strafing and yaw. This is why strafing is slower
  than driving and forward performance is bit-identical to before it existed.
  Do not "fix" strafe speed with a factor; the asymmetry is derived.
- **Braking is real BRAKE, and already at the physical ceiling** (§2.4).
  Deceleration on release equals peak acceleration from rest, because a shorted
  motor at free speed draws stall current in reverse. Roughly 0.18 m from
  1.57 m/s. It is not coasting, and it cannot brake harder without inventing
  force the motor cannot make.
- **Perimeter walls are 12 in thick** (§5.8), and only the inner face is
  gameplay. Thinner than a game piece lets a squeezed circle tunnel.
- **Mechanisms are functional state machines** (§9.9). The product path is
  `FIELD → HELD → launch action → game route → rules → score`.
  There is no flywheel/ballistic/shot-spread model: a valid enabled shot is a
  deterministic action, and only the rules engine changes a score.
- **Arc driving is slower, and that is correct** (§2.2.1). Saturation scales
  forward speed to `1/(1+turn)`, and a robot on a circular path crabs slightly
  to make its own centripetal force. Do not reach for a multiplier.

### DECODE fixture: what is sourced and what is not

- **Sourced with citations:** all element *sizes*, rules, point values, timings,
  piece counts, robot limits, RP thresholds, penalty values, MOMENTARY/
  CONTINUOUS, the CONTROL limit — and, from the **Event FIELD Setup Guide**, the
  TILE grid and the positions of both LAUNCH LINES, the six SPIKE MARKS, the
  BASE, GATE, LOADING and SECRET TUNNEL ZONES.
- **Inferred, and marked:** the world frame (`DECODE_FIELD_ORIENTATION`), the
  LAUNCH ZONE triangle vertices (`DECODE_LAUNCH_ZONE_SHAPE`), ARTIFACT mass
  (`ARTIFACT_MASS_LB` — the manual names the part, AndyMark publishes its
  weight).
- **Still inferred:** the low GATE panel's own outline, and the SECRET
  TUNNEL's wall *height* (its footprint is sourced, §9.3). The GOAL cluster
  sits on the *same* side as its own alliance — **red is -X, blue is +X**,
  matching `decodeField.ts`'s `SIDE` — not cross-court from it; its triangle
  footprint uses the manual opening dimensions. The supplied full-field CAD
  (untracked, 13 MB) remains the authority for the GATE panel's shape.

### Deployment

GitHub Pages, from `.github/workflows/deploy-pages.yml`, at
<https://psftc2082424.github.io/Ftcsim/>. The workflow runs `npm run verify`
(typecheck + lint + the full suite) before it builds, so a broken commit cannot
publish. Vite's `base` is `/Ftcsim/` **unconditionally** — `vite preview` reports
itself as a serve command, so a build-only base makes preview disagree with
production and the page goes blank locally with nothing left to reproduce it.

### The exact next task

**Extract the CAD-backed GATE panel's own shape.** The GATE ZONE now has a
real, live-state visual (an arm that reads open/closed from
`PieceConveyors.isOpen`, drawn in `fieldRenderer.ts`'s `drawGate`) and the
SECRET TUNNEL now has real side-rail collision bodies built from its already-
sourced footprint (`tunnelRailBodies` in `decodeCollision.ts`). What is still
missing is the GATE's own physical panel outline — the manual gives its
contact heights (§9.8.3) but not a plan-view shape, and the setup guide
installs it by figure. Read the supplied STEP assembly before inventing one;
keep the passable/logic-only contract elsewhere in `decodeCollision.ts` and
never derive an obstacle from a game region.

### Latest handoff — 2026-08-27 (dSim-aligned field pass)

- **Found and fixed a real alignment bug: the GOAL cluster was cross-court
  from its own GATE.** `decodeField.ts`'s `GOAL_CLUSTER_SIDE` (`{red:1,
  blue:-1}`) disagreed with the `SIDE` convention every other alliance-owned
  zone uses (`{red:-1, blue:1}`, from G402's TILE columns) — so an alliance's
  own GOAL/RAMP/DEPOT sat in the opposite corner from its own GATE ZONE, LOAD
  ING ZONE and BASE. A shot still scored (regions are self-consistent with
  the physics fixture), but a driver standing where the manual puts the GATE
  could never open their own classifier, and the GATE render (added this
  session) would have been reading the wrong robot's position entirely.
  Fixed by setting `GOAL_CLUSTER_SIDE = SIDE` and flipping
  `decodeCollision.ts`'s `goalSide()` to match. A second, dependent bug
  followed from the same root cause: `fieldRenderer.ts`'s "which triangle is
  red" heuristic (`sum of vertex x >= 0`) was tuned for the old, wrong sign
  and needed flipping too — caught by screenshot, not by any test, because no
  test checked colour against alliance identity before this session.
  Regression test: `decodeField.test.ts` → "keeps a GOAL, its RAMP, its GATE
  and its own half on the same side" (verified it fails on the old sign by
  reverting it locally and confirming the failure, then restoring the fix).
- **The SECRET TUNNEL is now a real, collidable corridor**, not an invisible
  region. `decodeCollision.ts`'s `tunnelRailBodies` builds two thin static
  rails flanking each already-sourced tunnel footprint (§9.3's 46.5 × 6.125 in,
  already placed by `decodeField.ts` — nothing about the footprint was
  invented, only the rail height, ~2 in, which is presentational). A rolling
  ARTIFACT is confined between the rails; a robot must enter end-on rather
  than drive through the side, which is the first "robot collision" the
  tunnel has ever had. Rendered in a neutral gold, distinct from a plain wall
  (`COLORS.tunnelRail`), detected in `fieldRenderer.ts` by rail thickness
  (~1 in, thinner than the 6 in classifier channel or the 12 in perimeter) —
  the same kind of geometry-guess `drawField` already used for goal colour.
- **The GATE ZONE has a real, live-state visual.** `drawGate` in
  `fieldRenderer.ts` draws a literal arm across the low end of the classifier
  channel, reading `PieceConveyors.isOpen` through a new `FieldOverlay
  .openConveyorIds` set (computed once per frame in `simRunner.ts` from
  `simulation.conveyors.conveyorIds`) — closed is a heavy solid line, open is
  thin and pale. It is not a scoring rectangle: the state it draws is the
  exact fact that already gates the CLASSIFIER's drain, so the two can never
  disagree. Needed a `presentationKind` fix first — gate zones were being
  swept into the same "skip, a real body already draws this" branch as the
  RAMP and TUNNEL, so the branch never ran. The GATE's own panel *shape* is
  still CAD-only (see "exact next task").
- **ARTIFACTS render by colour: purple for `P`, green for `G`.** Previously
  every piece drew the same purple regardless of type. Type-keyed, not
  per-instance, so a replay draws identically every time
  (`renderer.test.ts` asserts both the colour split and the determinism).
- **A shot now visibly travels**, without becoming a second physics model.
  `MatchSimulation.drainLaunchAnimations()` exposes `PieceLaunchAnimation`
  (pieceId, pieceType, alliance, `fromM`/`toM`, tick) purely as description —
  the underlying piece has *already* made its deterministic
  `HELD -> destination` move (PRODUCT_SPEC.md §1.1) by the time one exists,
  so a caller that never drains it changes nothing about the match. `App`'s
  `SimRunner` drains it once per fixed tick, stamps a wall-clock start time,
  and for 350 ms interpolates a straight line with a small cosmetic parabolic
  lift (`SHOT_ARC_HEIGHT_M`) between the shot's origin and its resolved
  destination — real projectile physics, spread and RNG were explicitly kept
  out of this per the product spec. `fieldRenderer.ts`'s `renderFrame` skips
  the ordinary draw for any piece with an active animation so it is never
  drawn twice. Verified end to end with a scripted-controller test that fires
  a real shot and reads back the animation's `fromM`/`toM`/`pieceType` before
  asserting the score (`matchSimulation.test.ts`).
- **Browser verification, and its limit.** `npm run verify` is clean — 46
  files, 945 tests (some regressed/added this session), typecheck, ESLint —
  and `npm run build` succeeds. Static rendering was inspected directly in
  Chrome and matches the fixes above (red left / blue right consistently
  across GOAL, GATE, DEPOT, BASE, SPIKE MARKS; gold tunnel rails; branding and
  scoreboard intact). Live interactive testing (drive → intake → fire →
  watch the shot animate) could not be completed in this session: the
  automated browser tab's `document.hidden` stayed `true` throughout, which
  suspends `requestAnimationFrame` almost entirely — a tooling limitation of
  remote/backgrounded tab automation, confirmed directly (`document.hidden`
  read from the page), not a product defect. One earlier interactive run,
  before this was diagnosed, *did* drive, collide, and score correctly with
  no console errors, which is corroborating but not a substitute for a real
  driver session. **Next session: if browser-testing this, drive from a
  visible/foregrounded tab, or accept that the deterministic test suite is
  the authority and use the browser only for visual/static checks.**
- **Functional shot scoring is green.** `DECODE_MECHANISM_ACTION_ROUTES`
  routes a valid `launch` action to its alliance GOAL; the normal
  `RegionMembershipDetector` then emits `PieceEnteredRegion`, and the ordinary
  CLASSIFIED rule scores it. The direct DECODE test harness includes those
  routes now. `oncePerPiece` prevents a parked goal piece scoring repeatedly.
- **Do not restore removed mechanism physics.** No ballistics, projectile
  motion, launch velocity, flywheel/RPM/energy model, shot RNG/spread/recoil or
  roller-force intake model belongs in the current product. Intake, three-piece
  storage and shooter are deterministic state transitions; UI controls feed
  the same `ControlInput` path. Shooting is a rising-edge `Space` action: it
  removes exactly one held artifact and routes it through the normal game
  event/rule boundary. There is no gate-open, shooter-enable, or ready state.
- **Verification:** targeted CLASSIFIED tests pass; `npm run verify` is clean
  (typecheck, ESLint, full Vitest). The redesigned UI production build also
  passed before this fixture-only scoring correction.
- **Inspect first next time:** `decodeMatch.test.ts` for fixture wiring,
  `matchSimulation.ts` for event routing, then `App.tsx` and
  `MechanismPanel.tsx` for the field-first UI. The remaining data-quality task
  is extracting inferred GOAL/RAMP/DEPOT placement from the full-field CAD;
  region IDs are the contract and must not change.
- **Data-backed DECODE collision fixture added:**
  `core/game/fixtures/decodeCollision.ts` explicitly classifies every relevant
  field object as `SOLID / COLLIDABLE`, `PASSABLE`, or `GAME-LOGIC REGION ONLY`.
  `createDecodeField()` now composes the perimeter with the dSim/setup-guide
  cross-court triangular GOAL assemblies (blue far-left, red far-right) and
  raised classifier channels. `App.tsx` supplies that field to the real DECODE
  match runner, so both robots and loose pieces use it.
- **Do not turn regions into obstacles.** Gate zones, secret-tunnel zones,
  launch zones, base/loading/depot tape, goal membership, and ramp queue
  regions have no collision bodies. The GATE and RAMP assemblies are real
  solids, but their component-level footprint is CAD-only, so they are marked
  solid-without-body rather than approximated from a scoring rectangle. The
  The raised classifier channel is a sourced/inferred physical fixture; the
  low GATE panel and tunnel walls remain CAD-only and intentionally body-free.
  The OBELISK is outside the perimeter and needs no duplicate body.
- **Verification after the collision pass:** `decodeCollision.test.ts` covers
  classifications, triangle/classifier bodies, a loose artifact and a robot
  resolving against the same live GOAL fixture, plus the passable tunnel
  opening. `fieldRenderer.ts` now renders static fixtures from their actual
  collision shapes and renders SPIKE MARKS as white tape strips rather than
  rectangles. Local browser inspection at `/Ftcsim/` confirmed the field-first
  blue/white presentation. `npm run verify` is clean: 45 files / 934 tests,
  TypeScript and ESLint.
- **Inspect first next time:** `decodeCollision.ts` and its tests for the
  collision contract, `decodeField.ts` for sourced/inferred placements, then
  `app/App.tsx`, `app/input/bindings.ts`, `app/components/ControlsPanel.tsx`
  and `storage/` for the configuration/keybind pass. The full-field STEP CAD
  remains the exact next source for ramp, gate and tunnel-wall geometry.
- **Configure/Controls flow complete:** top navigation now separates Play,
  Configure and Controls. Configure keeps the existing validated
  RobotBuilder/preset workflow; Controls groups drive versus mechanism actions
  and every keyboard binding persists automatically through the existing
  `KeyValueStore` as `settings/keyboard-bindings-v1`. IndexedDB schema v2 adds
  that `settings` collection while memory storage remains the fallback.
  `bindingPreferences.test.ts` protects default, round-trip and corrupt-value
  behavior. Browser inspection verified both setup screens and the full
  `npm run verify` suite remains clean.

**Out of scope by decision, not by oversight:** robot-to-robot interaction. The
simulator assumes solo runs, so G402 (AUTO opponent interference) is not
assessed and no robot-contact event exists.

After that: an intake, so a robot can pick a piece up rather than only push and
shoot; then Phase 4 (PDF ingestion).

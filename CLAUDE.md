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
- **Mechanisms are functional state machines; the piece they release is not**
  (§9.9, updated 2026-08-27). Capture and fire are still deterministic,
  rate-gated actions — `acquisitionRatePerSec` / `shotsPerSecond` gate
  *consecutive* captures/shots exactly the way a cooldown would, and there is
  still no flywheel, RPM, motor-derived exit speed, or shot RNG/spread. What
  changed: the piece a shot releases is no longer teleported to its
  destination. `SimWorld.launchPieceTowards` solves a closed-form ballistic
  arc (`physics/ballistics.ts`'s `apexShot`, given only distance and a
  declared apex height — still zero randomness, still "perfect accuracy") and
  the piece flies it under the same 2.5D height/gravity integration every
  other airborne body uses, landing and colliding normally. The product path
  is `FIELD → HELD → launch action (real arc) → normal physics → region entry
  → rules → score`.
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
- **Removed 2026-08-27 — see the bottom-most "Latest handoff" below.** This
  bullet described a *cosmetic* `PieceLaunchAnimation`/`drainLaunchAnimations`
  interpolation system (`SHOT_ARC_HEIGHT_M`, a 350 ms lerp) built because a
  shot used to teleport a piece straight to its destination with nothing
  visible in between. That whole system, and the teleport it was covering
  for, is gone: a shot now flies a real, physically simulated arc
  (`SimWorld.launchPieceTowards`), so the existing height-aware `drawPiece`
  renders it with no animation layer needed. None of the identifiers named
  above exist any more.
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
- **Superseded 2026-08-27 — see the bottom-most "Latest handoff" below.** This
  bullet used to say a shot teleports and that firing is single-rising-edge
  only. Neither is true any more: a released piece now flies a real 2.5D
  ballistic arc (`SimWorld.launchPieceTowards`), and holding the fire command
  fires continuously at a configured `shotsPerSecond`. What is still true:
  intake and shooter stay deterministic, rate-gated state machines — no
  flywheel/RPM/motor-derived speed, no shot RNG/spread/recoil, no
  roller-force intake model, and no gate-open/shooter-enable/ready state.
  Only the piece's post-release motion changed, not the mechanism's own logic.
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

### Latest handoff — 2026-08-27 (real ballistic flight, hold-to-fire BPS, GOAL shell fix)

- **The core ask: a scored piece had to stop teleporting.** Previously a shot
  moved a piece directly from `HELD` to its destination region in one step —
  functional, but exactly the "fake visual-only path" the product now
  explicitly disallows. Ballistics were restored (they existed before an
  earlier session removed them): `physics/ballistics.ts` brings back
  `VerticalState`/`stepVertical`/`isAirborne` under real gravity, and adds one
  new closed-form solver, `apexShot(distanceM, launchHeightM, apexHeightM)`,
  which finds the horizontal/vertical launch speed that puts a piece exactly
  at a declared apex height directly over its target — geometry, not a motor
  or RNG model, so "perfect accuracy" (PRODUCT_SPEC.md §1.1) still holds.
  `SimWorld.launchPieceTowards` calls it and gives the piece a real velocity;
  from there it is an ordinary airborne body — same height integration, same
  `spansOverlap` collision gating, same rest-and-roll — until it lands. The
  DECODE game layer supplies the apex height as a new
  `MechanismActionRoute.arcApexHeightM` (the GOAL's own top-lip height plus an
  inferred clearance margin), keeping the season-specific number out of
  `sim/`. The old *cosmetic* shot-flight animation from the previous session
  (`PieceLaunchAnimation`, `SHOT_ARC_HEIGHT_M`) is deleted outright — it was
  built to cover for the teleport, and a real arc renders correctly through
  the pre-existing height-aware `drawPiece` with no animation layer at all.
- **Hold-to-fire at a configured BPS, matching hold-to-fire for intake.**
  Firing used to be rising-edge only (one shot per `Space` press,
  edge-detected). Both intake capture and shooter fire now use the same
  cadence gate — `tick - lastActionTick >= round(tickRateHz / ratePerSecond)`
  — so holding the command fires (or captures) continuously at the declared
  rate and a tap still fires exactly one (a real press always spans more than
  one tick). The rate itself is a new, purely functional per-mechanism field:
  `LaunchCapability.shotsPerSecond`, `AcquireCapability.acquisitionRatePerSec`
  — no torque, RPM, or projectile parameter anywhere near it. Both are now
  editable in **Configure**: `RobotBuilder.tsx` renders "Shooter BPS" under a
  `launch` mechanism and "Acquire rate" / "Reach" under an `acquire` one,
  right beside the existing mass field, validated by the same
  `robotConfig.schema.ts` (`0–50`, both fields) that guards presets and saved
  files. Storage capacity is unchanged at 3 (`presets.ts`); no torque/RPM/
  projectile field was added anywhere, per the explicit constraint.
- **Found and fixed a real, confirmed bug: the GOAL was a solid filled
  triangle.** `decodeCollision.ts`'s `goalBody` gave the whole GOAL assembly
  one collision shape spanning floor to full height (54 in). That was
  harmless when a scored piece was teleported past it, but the instant a
  piece can *fly over the lip and land inside the same footprint*, a filled
  shape has no "inside" — the piece is in deep collision with the fill from
  the moment its 2D position crosses into the triangle, and the resolver
  shoves it back out. Traced with a scripted shot through the real
  `createDecodeField()`: the piece scored correctly (`PieceEnteredRegion`
  fired right on schedule) and then visibly caromed sideways off the GOAL
  interior and slid across the entire floor for the rest of the match —
  confirmed by logging its position tick-by-tick, not inferred. Fixed by
  replacing the filled triangle with `goalWallBodies`: two thin backstop
  walls along the triangle's two real legs (the manual's opening
  width/depth), leaving the diagonal face — the actual shot opening — and the
  whole interior open. A robot still cannot drive through either leg; a piece
  landing inside now has nothing to collide with. Regression test:
  `decodeCollision.test.ts` → "leaves the GOAL interior empty so a scored
  artifact can rest there" (asserts near-zero displacement for a piece placed
  in the open interior; a companion test still asserts either leg blocks a
  robot). `fieldRenderer.ts`'s goal/tunnel-rail colour heuristic, previously
  keyed on `shape.kind === 'poly'`, is now thickness-banded like the tunnel
  rail check already was, since the GOAL is no longer a polygon.
- **A related exploit, partially mitigated, honestly not fully solved:**
  a robot can approach a SECRET TUNNEL's open (audience-side) mouth head-on
  and shove a loose piece the entire 46.5 in corridor length onto the RAMP —
  confirmed the same way, by scripting a robot into the corridor's own axis
  and watching a piece it never touched directly get carried the whole
  length once contact happened. The side rails already stop a robot from
  driving *inside* the corridor (no legal chassis fits the 6.125 in gap), but
  until this session they ended exactly at the corridor's real boundary, so a
  wide robot's *bumper* could still reach a piece resting right at the mouth
  before its own corners caught the rails. `tunnelRailBodies` now extends the
  rails `TUNNEL_RAIL_OPEN_END_FLARE_IN` (14 in) past the real boundary on the
  open end only, so that stop happens well back from the mouth. This is a
  standoff, not a true one-way gate — this engine has no directional/trigger
  volumes to build one from, and a piece resting exactly at the true mouth
  can still be nudged a few inches. It removes the case with no defense at
  all (a full-length carry into the RAMP); it does not claim to remove every
  case. A future session wanting a real fix should expect to add a
  game-logic-level guard (e.g. reject/clamp a piece arriving at a RAMP entry
  region without having gone through `PieceConveyors.release`) rather than
  chase more physics standoff distance.
- **A real gap found in the DECODE test harness, not the app.** The real app
  (`App.tsx` → `simulationFromDefinition(DECODE_GAME)`) wires `conveyors:
  DECODE_CONVEYORS` and always has. `decodeMatch()`, the test helper nearly
  every test in `decodeMatch.test.ts` calls, builds a `MatchSimulation`
  directly and has never passed `conveyors` — every existing CLASSIFIED/
  OVERFLOW/PATTERN/DEPOT test in that file runs with the CLASSIFIER queue and
  SECRET TUNNEL drain entirely absent, undetected because none of them assert
  a piece's post-score position. Left `decodeMatch()` itself unchanged (many
  tests, real risk of an unrelated regression for no asked-for benefit) and
  instead added one new, separate suite —
  `describe('CLASSIFIER -> SECRET TUNNEL conveyor flow')` — built on
  `simulationFromDefinition(DECODE_GAME)`, that shoots a real artifact through
  the redesigned GOAL shell, into the CLASSIFIER queue, through an
  open GATE, and confirms it leaves down the SECRET TUNNEL under real
  velocity rather than sitting parked or stuck in collision.
- **Timing bug, not a physics bug, in one inherited failing test.**
  `matchSimulation.test.ts`'s three-shots-by-holding-fire test failed
  (6 points instead of 9) because its own timing landed the third shot's
  flight during the AUTO→TELEOP *transition* window, and `isWithinPhase(...,
  'ANY')` correctly excludes `TRANSITION` from scoring (a piece that arrives
  during the gap scores nothing unless the game declares
  `transitionScoresAs`) — matching DECODE's own real rule for the AUTO/TELEOP
  gap. Fixed by moving the fire command later so all three shots land inside
  TELEOP; the sim behavior was already correct.
- **Verification:** `npm run verify` is clean — 45 files, 948 tests,
  TypeScript, ESLint. `npm run build` succeeds.
- **Browser verification, and its limit (same limit as last session).**
  Configure was inspected directly in Chrome: "Acquire rate", "Reach" and
  "Shooter BPS" render under the right mechanisms, accept edits, and apply
  with no validation errors. The field itself (GOAL triangles, tunnel rails,
  robot, pieces) renders correctly. Live gameplay (drive → intake → hold
  fire → watch a real arc land) could not be exercised interactively in this
  session's automated tab: `document.hidden` read `true` throughout, which
  still suspends `requestAnimationFrame` almost entirely — the same tooling
  limitation the previous session hit and documented, not a product defect.
  The deterministic Vitest suite is the authority for the behavior above,
  including the exact bug-reproduction traces described in this handoff.
- **Inspect first next time:** `core/physics/ballistics.ts` (`apexShot`) and
  `core/sim/simWorld.ts` (`launchPieceTowards`, `releasePieceMoving`) for the
  flight itself; `core/sim/robotMechanisms.ts` for the cadence gate shared by
  capture and fire; `core/game/fixtures/decodeCollision.ts` (`goalWallBodies`,
  `tunnelRailBodies`) for the collision fixes above; `core/game/conveyor.ts`
  for the queue/drain/release model a real one-way tunnel fix would extend.

**Out of scope by decision, not by oversight:** robot-to-robot interaction. The
simulator assumes solo runs, so G402 (AUTO opponent interference) is not
assessed and no robot-contact event exists.

After that: an intake, so a robot can pick a piece up rather than only push and
shoot; then Phase 4 (PDF ingestion).

### Latest handoff — 2026-08-27 (dSim-aligned DECODE plan, controls, and one-way tunnel)

- **Drivetrain deliberately unchanged.** This pass did not edit `core/drive`,
  motor behavior, braking, acceleration, SAT/contact resolution, or collision
  tuning. The only driving addition is an app-layer coordinate transform in
  `app/input/driveMode.ts`: field-centric input is rotated into the same
  body-frame `ControlInput` the existing drivetrain already consumes.
- **DECODE's playable plan now follows dSim's public reference layout.**
  `decodeField.ts` separates the drive-team/alliance half (red -X, blue +X)
  from the cross-court GOAL/classifier half (red +X, blue -X). The triangular
  GOAL openings, six-inch side-wall classifier, five-inch gate mouth
  (`-2..+3 in`), tunnel ending at `-2 in`, and classifier beginning at `+2 in`
  now agree with that plan. The source is honestly `inferred`: the official
  full-field CAD remains the required dimensional audit. Tests and provenance
  assertions were updated with that status rather than retaining the obsolete
  "invented layout" label.
- **Field presentation now matches the reference's hierarchy rather than
  abstract regions.** `fieldRenderer.ts` draws the filled triangular GOAL
  basins, two parallel colored GATE tape lines and a hinged-looking gate arm,
  diagonal white DEPOT launch-line tape, and the alliance-colored SECRET
  TUNNEL floor/edge. The collision fixture remains the source for rendered
  solid perimeter/goal/classifier/tunnel rails; tape and score regions are not
  silently collision bodies. A Chrome screenshot at `/Ftcsim/` was manually
  inspected after these changes.
- **Intake is now a true toggle everywhere.** `F`, gamepad left trigger, and
  the virtual controller each toggle intake on/off on a press edge; key/button
  repeat cannot flip it twice. The virtual control visibly latches as
  `INTAKE ON`. `Space` remains the default shoot key and holding it fires at
  the configured BPS. The mechanism path remains the existing 3-piece FIFO:
  intake → storage → shoot → normal events/rules/scoring.
- **Controls persist both bindings and drive mode.** The Controls page now
  presents robot-centric versus field-centric mode and stores it in the
  existing `settings` key-value store. `driveMode.test.ts` proves the transform
  preserves turn/buttons and keeps field direction fixed as heading changes;
  `driveModePreferences.test.ts` covers safe default, round-trip, and corrupt
  preference handling.
- **SECRET TUNNEL is now explicitly one-way at the gameplay boundary.**
  `PieceConveyorSpec.blocksInboundExit` is season-agnostic data for chutes and
  tunnels. It allows pieces released by that conveyor to travel through the
  real exit path, but returns unrelated loose pieces trying to roll backwards
  into its public mouth to the outside, at rest. DECODE declares this flag;
  `conveyor.test.ts` guards both invalid inbound rejection and normal
  authorised flow. This replaces the previous rail-extension-only mitigation
  without adding wall-specific force behavior.
- **What is intentionally not restored:** no shooter enable/ready state,
  flywheel/RPM/torque model, shot RNG/spread, cosmetic trajectory, roller-force
  intake, or UI-direct scoring. The existing deterministic post-release arc
  remains solely to make a physically visible, perfect-accuracy ball travel to
  the GOAL; it is not tied to motor performance.
- **Remaining practical differences from dSim:** GOAL-to-classifier basin
  motion is still represented by the generic ordered conveyor queue rather
  than individual granular ball caroms/rail stacking, and the GATE opens from
  the existing release-zone interaction rather than a direction-sensitive arm
  push. The next highest-priority work is a generic visible conveyor-path/gate
  state model that preserves the same event/rules boundary, followed by a
  direct full-CAD audit of goal/ramp/gate/tunnel dimensions. Inspect
  `core/game/conveyor.ts`, `fixtures/decode.ts`, `fixtures/decodeField.ts`, and
  `app/render/fieldRenderer.ts` first.

### Latest handoff — 2026-08-27 (latched release and artifact settling)

- **One GATE activation now drains the whole current classifier queue.**
  `PieceConveyors` is still season-agnostic, but its declared `releaseZoneId`
  now latches `releaseLatched` until that conveyor's queue is empty. A DECODE
  robot can activate its own GATE then drive away; ARTIFACTS leave in arrival
  order at the declared `drainIntervalSec` rather than requiring the robot to
  occupy the zone for every ball. `conveyor.test.ts` covers the exact
  activate-once → leave → all-three-drain path and confirms the latch closes
  when the final piece has left. This deliberately does not alter the existing
  one-way return-path guard or automatic full-queue overflow.
- **ARTIFACTS now settle instead of preserving artificial impact energy.**
  `SimWorld` gives a piece↔piece or piece↔static-field contact restitution
  `0.20`, via the optional resolver override needed because static walls remain
  globally inelastic. Loose, floor-level pieces also lose `20 in/s²`, copied as
  an observational calibration from dSim's ball configuration. Robot↔robot,
  robot↔field and robot↔piece calls deliberately use the unchanged default
  restitution path; drivetrain coasting, BRAKE behavior and robot collision
  response have not changed. See `ASSUMPTIONS.md §5.5` and focused tests in
  `physics.test.ts` / `pieces.test.ts`.
- **Removed a stale false derivation.** `decode.ts` no longer exposes an
  invented RAMP angle or a full-tunnel gravity-speed calculation. The manual
  does not establish either, and the actual DECODE data now records the
  0.35-second drain cadence and 22 in/s release speed as inferred,
  dSim-observed gameplay calibration instead.
- **Verification:** `npm run verify` is clean after this change (TypeScript,
  ESLint, 46 Vitest files). Targeted conveyor, artifact-material and contact
  tests also pass.
- **Still incomplete — do not claim otherwise:** the classifier's pre-release
  queue is still `PieceConveyors.holdQueue`'s ordered, parked abstraction. It
  is no longer required to stay open and released balls are real physical
  pieces, but queued balls do not yet collide/pack on a modeled ramp. The 2D
  core has no inclined-plane component or live gate collider, so converting
  this faithfully requires a generic, data-declared guided lane plus dynamic
  gate blocker — not DECODE-specific fixed coordinates. Do not restore the
  removed motor/flywheel/RNG mechanism physics to solve it.
- **Highest-priority next work:** make that generic physical classifier lane
  (normal balls, lane gravity/damping, a live gate blocker, 9-ball packing and
  automatic overflow) and then use DECODE as its fixture. Inspect
  `core/game/conveyor.ts`, `core/sim/simWorld.ts`, `decodeCollision.ts`, and
  dSim's `src/sim/goal.ts` / `src/sim/field.ts` first. The supplied CAD is
  still required before claiming the GATE panel outline matches the real field.

### Latest handoff — 2026-08-27 (physical guided classifier lane)

- **The DECODE CLASSIFIER no longer parks ARTIFACTS in fixed slots.** A generic
  `GuidedLaneSpec` in `core/game/conveyor.ts` applies bounded down-lane and
  centring acceleration to ordinary active pieces. `PieceConveyors` never
  assigns a lane position: pieces collide, rebound at 0.20 restitution, lose
  the existing rolling energy, and pack against the real live GATE collider.
  Nine normal pieces occupy the lane; the tenth and later pieces use the
  declared elevated overflow path. The drive model was not touched.
- **Gate and GOAL entry are semantic collision boundaries, not season code in
  the solver.** `FieldTemplate.colliderTags` names static bodies. The GATE tag
  is enabled only while closed. A lane may additionally declare an entry
  barrier: only a piece that entered the lane's declared GOAL is permitted
  through that one solid face. It still uses ordinary integration, ball↔ball
  and ball↔field contacts everywhere else. This keeps ground balls and robots
  out of the tall GOAL/classifier while allowing a legitimate scored ball to
  roll from its hollow basin into the lane; it is not a teleport or animation.
- **Shot contract:** `launchPieceTowards` remains the deterministic, perfect
  accuracy launch. After GOAL membership, no shooter guidance remains; the
  ball is a normal loose physical piece. `decodeMatch.test.ts` now covers a
  real one-ball shot through GOAL → live lane → opened gate/tunnel, and three
  separately launched physical balls scoring once and settling in a closed
  lane. `conveyor.test.ts` covers lane capacity, overflow, cruise governor,
  latch/collider state, refill guidance, and backwards return rejection.
- **Verification:** focused tests, TypeScript, ESLint, and `npm run verify`
  pass on this state. Inspect `core/game/conveyor.ts`, `sim/simWorld.ts`,
  `fixtures/decodeCollision.ts`, and `fixtures/decodeMatch.test.ts` first for
  follow-up work. Do not restore fixed slots, virtual drain positioning,
  flywheel/RPM/random shot behaviour, or alter drivetrain physics.

### Latest handoff — 2026-08-27 (GOAL basin capture boundary)

- A valid high GOAL entry now enters a generic `GuidedLaneSpec.receivingBasin`
  before joining the physical lane. The ball is never parked or teleported:
  it remains an active rigid body with ordinary restitution, rolling loss and
  ball contacts while bounded basin guidance feeds the throat.
- The prior per-piece collider bypass was removed. The GOAL face is physically
  clipped at the classifier arch and `inboundRejectPointM` rejects only a loose
  piece that entered the protected lane without the declared GOAL acceptance.
  This mirrors dSim's ground-ball classifier guard without allowing a robot to
  push a field ball into the classifier. The drivetrain is unchanged.
- Inspect `src/core/game/conveyor.ts`, `src/core/game/fixtures/decode.ts`,
  `src/core/game/fixtures/decodeCollision.ts`, and
  `src/core/game/fixtures/classifierPhysicalLane.test.ts` first. Do not restore
  the removed tagged-collider permission, fixed slots, or physics-heavy shooter
  systems. Run `npm run verify` before further field work.

### Latest handoff — 2026-08-27 (self-closing GATE activation)

- **A GATE touch is now a one-shot activation.** `PieceConveyors` records the
  previous raw release-zone contact and latches only on a false→true transition
  when the lane/basin contains ARTIFACTS. The current batch drains normally;
  after its last physical ball leaves, `releaseLatched` clears and the tagged
  GATE collider closes on that same update even when the robot stays parked on
  the gate. To release a later batch, the robot must leave and touch again.
- **Regression coverage:** `conveyor.test.ts` now keeps a robot at the release
  zone through a three-piece drain, asserts all pieces release in order and the
  GATE closes, then verifies a leave/re-touch opens a newly arrived piece.
  Existing live-lane collider coverage remains intact. No drivetrain or ball
  contact physics changed.
- **Verification:** focused conveyor test passes. Run `npm run verify` after
  this handoff before continuing field/UI work. Inspect
  `src/core/game/conveyor.ts` and `src/core/game/conveyor.test.ts` first.

### Latest handoff — 2026-08-27 (field-elevation source audit)

- **Ground truth reviewed before further collision changes:** the Event FIELD
  Setup Guide identifies GOAL and upper/lower RAMP as assemblies, while the
  SECRET TUNNEL *ZONE* is tape. The local full-field STEP contains the GOAL
  Internal Ramp, Goal Archway, Gate Arm, Lower Ramp Blocker, and upper/lower
  ramp assemblies for both alliances. dSim source (`src/sim/goal.ts` and
  `src/sim/field.ts`, commit `7a1c112`) independently models a 38.75 in GOAL
  opening, 14 in basin floor, 10 in classifier rail, and separate overflow
  level; released balls use the floor strip beneath the gate. Do not turn the
  tape zone itself into an elevated obstacle.
- **Fixed the immediate top-down visual defect:** `fieldRenderer.ts` no longer
  scales an ARTIFACT radius by height. An elevated ball retains its true 2D
  diameter and may only cast a shadow; `renderer.test.ts` guards this.
- **Highest-priority next step:** add reusable receiving-basin and lane-surface
  heights to `GuidedLaneSpec`, then connect the CAD-derived GOAL/classifier
  profile to DECODE. Accepted balls must stay active and collidable; elevation
  gates access, but must never become a parked queue or animation. Inspect
  `conveyor.ts`, `simWorld.ts`, `decode.ts`, and `decodeCollision.ts` first.

### Latest handoff — 2026-08-27 (raised GOAL/classifier surfaces)

- `GuidedLaneSpec` now declares optional receiving-basin and normal-lane
  surface heights/rates. DECODE uses a 14 in basin, 10 in classifier rail, and
  13.5 in overflow surface, matching dSim's observable elevation model.
  `SimWorld.guidePiece` maintains those surfaces while accepted ARTIFACTS stay
  active and collidable. No robot or drivetrain code changed.
- The full STEP model was successfully loaded and measured (overall bounding
  box about 144 × 153 × 54 in), confirming a tall field assembly. The setup
  guide confirms GOAL/RAMP are assemblies and SECRET TUNNEL ZONE is tape;
  retain the existing floor-level, one-way return zone rather than inventing an
  elevated tunnel floor.
- Targeted TypeScript, conveyor and DECODE tests pass. Run `npm run verify`
  before claiming the elevation pass complete; add an integration regression
  observing accepted ball height through basin → rail → gate exit.

### Latest handoff — 2026-08-27 (GOAL capture funnel)

- **Fixed the GOAL → classifier overshoot boundary.** A valid high entry still
  crosses the rules-defined opening and remains a normal physical body, but its
  internal GOAL-funnel impact now retains only 5% horizontal speed and applies
  the bounded `1150 in/s²` dSim-observed basin guide. This prevents a shot from
  carrying launch speed across the hollow 2D basin and escaping through the
  field-facing opening before the classifier throat can capture it. The guide
  is generic `GuidedLaneSpec` data; DECODE alone supplies the value.
- Ground balls are unchanged: the vertical GOAL entry band and unauthorized
  lane guard keep them out of the raised basin/classifier path. Targeted
  classifier and complete `decodeMatch.test.ts` suites pass. Next: add a
  multi-origin 20-shot integration regression and browser verification, then
  run `npm run verify` and commit.

### Latest handoff — 2026-08-27 (single GOAL outlet)

- **The GOAL basin now has one outlet only.** The diagonal face in
  `decodeCollision.ts` closes flush to the six-inch classifier arch; the prior
  11 in artificial clearance left a broad field-facing escape gap. Accepted
  ARTIFACTS can only travel to the classifier through that arch, while the
  existing vertical-entry and unauthorized-lane guards still reject loose
  ground balls. Inspect `goalWallBodies()` before changing GOAL geometry.

### Latest handoff — 2026-08-27 (deterministic shot transfer)

- `SimWorld` now marks a routed deterministic shot as `transferring`: it skips
  all contacts while flying to its declared GOAL, so a robot, field rail, or
  unrelated ARTIFACT cannot deflect it into the wrong part of the structure.
  `dampPieceVelocity()` clears that marker on receiving-basin capture, before
  GOAL → classifier physics begins. This is only transfer access control; the
  captured ball remains an ordinary active, collidable body.

### Latest handoff — 2026-08-27 (physical GOAL/classifier hand-off)

- CLASSIFIED and OVERFLOW retain normal per-entry scoring: an ARTIFACT that
  genuinely leaves and later re-enters a GOAL may score again. Do **not** use
  `oncePerPiece` to hide a settling defect. The physical GOAL basin, one arch,
  continuous rails and closed live gate keep an accepted ball from re-entering
  the GOAL score region while it packs.
- The former classifier escape was two separate geometry/order defects:
  the rail stopped short of the gate, and the continuous inner rail also
  blocked the one legitimate raised GOAL arch. `decodeCollision.ts` now has a
  continuous outer rail, inner segments around one dSim-observed arch, and a
  tagged gate collision envelope that overlaps the raised 5 in ARTIFACT. In
  `conveyor.ts`, declared GOAL arrivals are authorized before the protected
  lane rejects loose ground balls. The drivetrain is untouched.
- `SimWorld` records field-supported raised pieces as resting rather than
  airborne while they remain active/collidable; this is presentation/state
  semantics only, not a parked queue. The three-real-shot closed-gate test now
  asserts all pieces remain queued in the physical channel, packed and scored
  once. `npm run verify` passes: typecheck + ESLint + **970 tests / 48 files**.
- **Next priority:** manually playtest GOAL → arch → lane → gate → SECRET
  TUNNEL in the browser and compare the visible arch/rail spacing with the
  CAD/dSim reference. Keep the single-arch, continuous-rail invariant; do not
  restore `oncePerPiece`, fixed slots, or drivetrain changes.

### Latest handoff — 2026-08-27 (single-file settling and gate batch latch)

- Raised basin/rail ARTIFACTS now receive the same rolling loss as a floor
  ball plus data-declared surface damping. The receiving basin admits one body
  at a time only when the physical rail entrance is clear. This gives the
  narrow six-inch channel a stable, end-to-end contact column without invented
  slot coordinates or nonphysical parked pieces.
- A GATE contact now arms an activation even if the channel is initially empty.
  Once a ball enters, that activation serves the whole physical batch and then
  closes the tagged collider; holding the robot in place cannot reopen it.
  The end-to-end tunnel regression explicitly checks the queue and basin empty
  and the gate closed after drain. Drivetrain behavior remains unchanged.

### Latest handoff — 2026-08-27 (corrected GOAL funnel throat)

- dSim's basin funnel/rail hand-off is at `x=69 in, y=57 in`. The fixture had
  incorrectly aimed at `y=68 in`, above the physical inner-rail arch; this was
  the remaining source of balls stalled high in the GOAL. `decode.ts` now aims
  directly at the arch centre and waits for one-radius physical clearance
  before changing a body from basin to rail guidance. The three-shot packing
  test explicitly requires an empty basin after all balls have reached the
  single-file column.

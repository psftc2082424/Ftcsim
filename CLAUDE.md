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
  `FIELD → HELD → GATE → launch action → game route → rules → score`.
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
- **Still inferred:** where the GOAL cluster sits — GOAL, RAMP and DEPOT. The
  setup guide installs them by figure, so they are constrained by the elements
  around them rather than placed. `GOAL_CLUSTER_PROVENANCE` says so, and the
  supplied full-field CAD (untracked, 13 MB) would settle it.

### Deployment

GitHub Pages, from `.github/workflows/deploy-pages.yml`, at
<https://psftc2082424.github.io/Ftcsim/>. The workflow runs `npm run verify`
(typecheck + lint + the full suite) before it builds, so a broken commit cannot
publish. Vite's `base` is `/Ftcsim/` **unconditionally** — `vite preview` reports
itself as a serve command, so a build-only base makes preview disagree with
production and the page goes blank locally with nothing left to reproduce it.

### The exact next task

**Refine the functional match flow, if needed.** The dSim-informed UI pass is
complete: Play is field-first with a broadcast-style bottom score overlay,
mechanism state card, named keyboard/gamepad/virtual controls and collapsible
engineering telemetry; Configure contains robot/preset/control editing. The
GOAL-cluster CAD extraction remains a later data-quality task.

**Out of scope by decision, not by oversight:** robot-to-robot interaction. The
simulator assumes solo runs, so G402 (AUTO opponent interference) is not
assessed and no robot-contact event exists.

After that: an intake, so a robot can pick a piece up rather than only push and
shoot; then Phase 4 (PDF ingestion).

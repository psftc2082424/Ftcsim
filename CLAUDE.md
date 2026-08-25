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

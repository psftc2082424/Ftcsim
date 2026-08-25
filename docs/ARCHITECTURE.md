# FTC Universal 2D Simulator — Architecture

**Status:** Approved. This document is the authoritative engineering plan.

**Relationship to other documents:**

| Document | Role |
|---|---|
| `docs/PRODUCT_SPEC.md` | Authoritative *product* definition — what the simulator must do |
| `docs/ARCHITECTURE.md` | Authoritative *engineering* plan — how it is built (this file) |
| `docs/ASSUMPTIONS.md` | Authoritative ledger of every assumed physical/modeling constant |
| `CLAUDE.md` | Permanent engineering instructions |

Where this document and `PRODUCT_SPEC.md` differ, the differences are deliberate,
enumerated in §0.1, and were explicitly approved.

---

## 0. Locked decisions

| # | Decision |
|---|---|
| 1 | **Perfect traction.** No friction coefficient, no traction clamp, no hidden traction parameter. A `TractionModel` seam exists so a calibrated mode can be added later as an explicit opt-in. |
| 2 | **User-configurable robot physics = length, width, height, mass only.** Everything else (inertia, centre of mass, track, wheelbase) is derived. |
| 3 | **SI internally** (m, kg, s, N, N·m, rad). FTC units (in, lb, ft/s, deg) exist only at the UI boundary. |
| 4 | **Capability-based mechanisms.** Mechanism type names are user-facing presets; the engine operates on capabilities. |
| 5 | **Archetypes are strategic roles**, generated per-game. Budgets are a feasibility filter applied *after* the role determines the design — never the definition of an archetype. |
| 6 | **Measured-probe statistics.** Concrete, game-specific, in real units. Never 1–10 ratings. |
| 7 | **Core supports N robots and alliances.** Phase 1 UI exposes exactly one robot. |
| 8 | **Endgame is a sub-phase of TeleOp**, not a fourth period. |
| 9 | **Height is explicit** on robots, scoring targets, and traversable clearances. |
| 10 | **One `ControlInput` abstraction** from keyboard, virtual pad, Gamepad API, and scripted traces. No Java/FTC SDK execution. |
| 11 | **Human-in-the-loop manual pipeline.** The PDF is never assumed to contain precise field geometry. |

### 0.1 Deliberate deviations from PRODUCT_SPEC.md

| Spec section | Deviation | Rationale |
|---|---|---|
| §2, §17 | Endgame modelled as a sub-phase of TeleOp rather than an additive third period | FTC matches are 30 s auto + 2:00 teleop, where endgame is the final 30 s *of* teleop. Treating the three durations as additive would produce a 3-minute match. |
| §8 | Mechanism type names become UI presets over a capability model | Branching engine logic on `kind === 'shooter'` would hard-code a season, which §23 forbids. |
| §4, §11 | `chassis.massLb` is user-set; `totalMass` is derived as chassis + Σ mechanism mass | §4 makes mass a universal parameter, §11 requires mechanisms to add mass. Deriving the total satisfies both. |
| §4 | Moment of inertia, centre of mass, track and wheelbase are *derived*, not removed | §4 forbids requiring the user to configure them. It does not require pretending they are absent from the physics. |
| §16 | Entity model is `robots[]` with alliance from day 1 | Multi-robot support is cheap now and expensive to retrofit. Phase 1 constructs an array of length one. |
| §15 | A `ScriptedController` implements the same `Controller` interface | Required by headless metric probes and determinism tests. Still no Java/FTC SDK execution. |

---

## 1. Stack

| Concern | Choice | Major version |
|---|---|---|
| Language | TypeScript, `strict`, `noUncheckedIndexedAccess` | 5.x |
| Build / dev server | Vite | 6.x |
| UI | React | 19 |
| Rendering | **Canvas 2D** — no WebGL, no Pixi | — |
| Schema / validation | Zod | 3.x |
| PDF (Phase 4 only) | `pdfjs-dist` | — |
| Persistence (Phase 2+) | IndexedDB, thin hand-rolled wrapper | — |
| Testing | Vitest | 2.x |
| Lint | ESLint + `no-restricted-imports` layer zones | 9.x |
| Styling | Plain CSS. No Tailwind. | — |

**Runtime dependencies for Phases 1–3: `react`, `react-dom`, `zod`.** Everything
else is a devDependency. No physics library. No math library.

**Prerequisite:** Node.js ≥ 20 LTS.

---

## 2. Directory structure

```
FTC-Simulator/
├── CLAUDE.md
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── ARCHITECTURE.md
│   └── ASSUMPTIONS.md
├── package.json  tsconfig.json  vite.config.ts  eslint.config.js
├── index.html
└── src/
    ├── core/                      # DOM-free · React-free · deterministic
    │   ├── units/                 si.ts, convert.ts
    │   ├── math/                  vec2.ts, angle.ts, rng.ts, hash.ts, spatialHash.ts
    │   ├── motor/                 motorModel.ts, battery.ts, catalog/goBILDA.ts
    │   ├── drive/                 mecanumKinematics.ts, drivetrain.ts, traction.ts
    │   ├── mechanism/             (Phase 2) capability.ts, mechanism.ts
    │   ├── robot/                 robotConfig.ts, derive.ts, robotRuntime.ts
    │   ├── physics/               body.ts, shapes.ts, sat.ts, broadphase.ts,
    │   │                          resolve.ts, integrate.ts
    │   ├── sim/                   simWorld.ts, snapshot.ts, headless.ts, events.ts
    │   ├── game/                  (Phase 3) gameDefinition.ts, matchClock.ts,
    │   │                          rulesEngine.ts, scoring.ts
    │   ├── control/               controlInput.ts, controller.ts, scripted.ts
    │   ├── field/                 fieldTemplate.ts
    │   ├── metrics/               (Phase 5) metricSpec.ts, probes/
    │   ├── archetype/             (Phase 5) synthesize.ts, feasibility.ts
    │   └── telemetry/             sampler.ts, types.ts
    ├── schema/                    (Phase 2) zod schemas + migrations/
    ├── storage/                   (Phase 2) idb.ts, presets.ts
    ├── manual/                    (Phase 4) ingest/, extract/, draft/
    └── app/                       React shell
        ├── render/                canvasRenderer.ts, camera.ts, layers/
        ├── input/                 keyboard.ts, gamepadApi.ts, virtualPad.tsx
        ├── panels/                telemetry/, (Phase 2) builder/, presets/
        └── styles/                *.css
```

Directories marked with a phase are **not created until that phase**. Phase 1
does not ship empty placeholder modules.

---

## 3. Module boundaries

### 3.1 Cross-layer rules (ESLint-enforced; a violation fails the build)

```
core/*      →  may import only from core/*
schema/*    →  may import core *types*; may NOT import core logic
storage/*   →  may import schema/*
manual/*    →  may import schema/* and core game types
app/*       →  may import anything
```

`core/` additionally bans, by lint rule: `document`, `window`, `performance`,
`Date.now`, `Math.random`, `crypto`, `react`, and any `app/` path.

### 3.2 Internal core layering (lower may not import higher)

```
0  units, math
1  motor, physics/shapes
2  drive, mechanism, physics
3  robot, field
4  sim
5  game            reads sim events, never mutates bodies
6  metrics, archetype, telemetry
```

The load-bearing rule: **`physics` never imports `game`, and `game` never
imports `physics` internals.** They meet at exactly two places — the `SimEvent`
queue (physics → rules) and a closed `Effect` union (rules → physics).

---

## 4. Data models

### 4.1 Units

SI internally, with branded types so unit mismatches are compile errors:

```ts
type Meters       = number & { readonly __u: 'm' };
type Kilograms    = number & { readonly __u: 'kg' };
type Seconds      = number & { readonly __u: 's' };
type Newtons      = number & { readonly __u: 'N' };
type NewtonMeters = number & { readonly __u: 'N·m' };
type Radians      = number & { readonly __u: 'rad' };
type RadPerSec    = number & { readonly __u: 'rad/s' };
type MetersPerSec = number & { readonly __u: 'm/s' };
type Volts        = number & { readonly __u: 'V' };
type Amps         = number & { readonly __u: 'A' };
```

`units/convert.ts` is the **only** module permitted to construct branded values
from raw numbers, and the only place FTC↔SI conversions live.

### 4.2 RobotConfig — serializable, user-authored

```ts
interface RobotConfig {
  schemaVersion: number;
  id: string;
  name: string;
  chassis: {              // THE ONLY user-facing physical parameters
    lengthIn: number;
    widthIn: number;
    heightIn: number;
    massLb: number;
  };
  drivetrain: {
    motorId: string;      // → goBILDA catalog
    motorCount: number;
    gearRatio: number;    // external reduction beyond the motor's own gearbox
    wheelDiameterIn: number;
  };
  mechanisms: MechanismConfig[];   // Phase 2; empty in Phase 1
}
```

### 4.3 RobotRuntime — derived, never persisted, never user-edited

```ts
interface RobotRuntime {
  config: RobotConfig;
  totalMass: Kilograms;      // chassis + Σ mechanism mass
  inertiaZ: number;          // m(L² + W²)/12 — uniform rectangle
  halfTrack: Meters;         // (W − WHEEL_INSET) / 2
  halfWheelbase: Meters;     // (L − WHEEL_INSET) / 2
  kinematicK: number;        // halfTrack + halfWheelbase
  wheelRadius: Meters;
  motor: MotorModel;
  body: RigidBody;
}
```

Every derived quantity has exactly one derivation site (`robot/derive.ts`) and
exactly one entry in `ASSUMPTIONS.md`.

### 4.4 RigidBody

```ts
interface RigidBody {
  id: EntityId;
  kind: 'robot' | 'piece' | 'static';
  pose: { p: Vec2; theta: Radians };
  vel:  { v: Vec2; omega: RadPerSec };
  mass: Kilograms; invMass: number;
  inertiaZ: number; invInertiaZ: number;
  shape: Obb | Circle | ConvexPoly;
  heightM: Meters;           // vertical extent, for clearance gating
  layer: CollisionLayer;
}
```

### 4.5 ControlInput — one struct, four sources

```ts
interface ControlInput {
  drive: { x: number; y: number; turn: number };  // each ∈ [−1, 1]
  buttons: Readonly<Record<string, boolean>>;
  axes:    Readonly<Record<string, number>>;
}

interface Controller {
  sample(tick: number, snapshot: WorldSnapshot): ControlInput;
}
```

Implementations: `KeyboardController`, `VirtualPadController`,
`GamepadApiController`, `ScriptedController`.

---

## 5. Physics architecture

### 5.1 Motor model

Derived once per catalog entry:

```
k_e = V_nom / ω_free
R   = V_nom / I_stall
k_t = τ_stall / I_stall
```

Per tick:

```
τ(ω, duty, V) = k_t · (duty · V_battery − k_e · ω) / R
I(ω, duty, V) =       (duty · V_battery − k_e · ω) / R
```

This form handles duty cycle and voltage sag correctly and goes **negative above
effective free speed**, so brake-mode and regenerative deceleration emerge from
the model rather than from an invented drag term. It also satisfies
`PRODUCT_SPEC.md` §7 — maximum torque does not exist at every RPM.

Catalog entries are transcribed from published goBILDA datasheets. Every entry
carries a `source` URL. **No motor specification is ever recalled or invented.**
Unverifiable fields are marked explicitly rather than guessed.

### 5.2 Battery

```
V_battery = V_oc − I_total · R_int
```

Motor torque depends on voltage, which depends on current, which depends on
torque — an algebraic loop. **Resolved by a one-tick lag:** the voltage computed
at the end of tick *n* is consumed by tick *n+1*. Deterministic, unconditionally
stable, and 5 ms of lag is physically irrelevant at these time constants.

### 5.3 Mecanum drivetrain — force-based

45° rollers, X-configuration. `k = halfTrack + halfWheelbase`.

Inverse kinematics (body → wheel):

```
v_FL = vx − vy − k·ω        v_FR = vx + vy + k·ω
v_BL = vx + vy − k·ω        v_BR = vx − vy + k·ω
```

Forward kinematics (wheel → body):

```
vx = ( v_FL + v_FR + v_BL + v_BR) / 4
vy = (−v_FL + v_FR + v_BL − v_BR) / 4
ω  = (−v_FL + v_FR − v_BL + v_BR) / (4k)
```

Per-tick chain:

1. `ControlInput` → four wheel commands via inverse kinematics.
2. **Saturation normalize:** if `max|cmd| > 1`, divide *all four* by that
   maximum. This preserves the commanded motion direction.
3. Perfect traction ⇒ no slip ⇒ each wheel's angular velocity is *known* from
   the body velocity via forward kinematics. `ω_motor = ω_wheel · G`.
4. Motor torque from §5.1 at that speed, duty, and battery voltage.
5. Wheel force `F = τ_motor · G · η / r_wheel`.
6. Body wrench via the transpose of the kinematics Jacobian:
   ```
   Fx = ( F_FL + F_FR + F_BL + F_BR)
   Fy = (−F_FL + F_FR + F_BL − F_BR)
   Mz = (−F_FL + F_FR − F_BL + F_BR) · k
   ```
7. `a = F / m`, `α = Mz / I`. Integrate.

Back-EMF reduces available torque as speed rises until torque balances
resistance. **Top speed and the acceleration curve are emergent.** There is no
max-speed or max-acceleration input anywhere in the system.

### 5.4 Traction seam

```ts
interface TractionModel {
  limit(wheelForces: Newtons[], body: RigidBody): Newtons[];
}

const IdealTraction: TractionModel = { limit: (f) => f };
```

Phase 1 wires `IdealTraction` unconditionally. **No friction coefficient exists
anywhere in the codebase.** Acceleration is stall-torque-limited:

```
a_max(0) = n · τ_stall · G · η / (r_wheel · m)
```

A future calibrated mode implements the same interface; nothing else changes.

### 5.5 Collision

- **Broadphase:** uniform spatial hash, 0.3048 m (12 in) cells.
- **Narrowphase:** SAT for OBB↔convex-polygon; circle↔polygon and circle↔circle
  where needed.
- **Ordering:** contacts sorted by `(entityIdA, entityIdB)` before resolution, so
  results never depend on hash-bucket iteration order.
- **Resolution:** MTV positional correction plus normal-velocity cancellation for
  robot↔static; mass-weighted impulse for dynamic pairs.
- **Vertical gating:** a pair collides only if their height intervals overlap. A
  robot lower than an element's clearance passes beneath it. This is what makes
  a trench/clearance metric derivable from the actual robot.
- **No CCD in Phase 1.** At 200 Hz and ~2.4 m/s, per-tick displacement is ~12 mm,
  far below any game-piece dimension.

### 5.6 Integration

Semi-implicit (symplectic) Euler at fixed `dt = 1/200 s`.

---

## 6. Game-definition architecture *(Phase 3–4)*

### 6.1 Provenance wrapper

```ts
type Confidence = 'explicit' | 'inferred' | 'assumed' | 'unknown';

interface Sourced<T> {
  value: T;
  confidence: Confidence;
  sourcePage?: number;
  sourceQuote?: string;
  note?: string;
}
```

Applied to every extracted field, making `PRODUCT_SPEC.md` §3 structural rather
than advisory — the assumption ledger is a projection over the definition and
cannot drift out of date.

### 6.2 Shape

```ts
interface GameDefinition {
  schemaVersion: number;
  id: string; season: string; name: string;
  field: {
    template: 'ftc-standard-12ft' | 'custom';
    widthIn: Sourced<number>; lengthIn: Sourced<number>;
    elements: FieldElement[]; zones: Zone[]; startPositions: Pose2[];
  };
  pieces: GamePieceType[];
  match: MatchStructure;
  robotConstraints: {
    maxLengthIn: Sourced<number>; maxWidthIn: Sourced<number>;
    maxHeightIn: Sourced<number>; expansionRules: Sourced<string>[];
  };
  objectives: Objective[];
  strategicFunctions: StrategicFunction[];
  scoringRules: ScoringRule[];
  metrics: MetricSpec[];
  assumptions: AssumptionEntry[];
}
```

`field.template` keeps the season-stable 12 ft × 12 ft perimeter out of the
extractor entirely.

### 6.3 Match structure

```ts
interface MatchStructure {
  periods: [
    { id: 'AUTO';   durationSec: Sourced<number> },
    { id: 'TELEOP'; durationSec: Sourced<number>;
      subPhases: [ { id: 'ENDGAME'; startsAtRemainingSec: Sourced<number> } ] }
  ];
}
```

State machine: `PRE → AUTO → TRANSITION → TELEOP → (ENDGAME within TELEOP) → POST`.
Endgame is entered when teleop remaining crosses the threshold; it does not
extend match length.

### 6.4 Rules engine

Pure function:

```
(GameDefinition, WorldSnapshot, SimEvent[], MatchClock, ScoreState)
    → { deltas: ScoreDelta[], effects: Effect[] }
```

Physics emits facts only — `PieceEnteredRegion`, `PieceReleasedBy`,
`PieceCameToRest`, `RobotOverlapsZone`, `RobotHeightExceeded`,
`MechanismStateChanged`. Rules return a **closed `Effect` union**
(`consumePiece | attachPiece | detachPiece | teleportPiece | setPieceLayer`)
which `sim` applies. Rules cannot touch bodies directly.

**No `eval`, ever.** Predicates too complex to encode declaratively resolve
through a TypeScript registry keyed by id — auditable, deterministic, and not
executable from data.

### 6.5 Manual pipeline *(Phase 4)*

```
PDF → pdf.js (per-page text + layout boxes + page raster)
    → page-anchored chunk index
    → constrained extraction passes (JSON Schema derived from Zod):
        A timing · B pieces · C scoring · D robot constraints · E field elements
    → GameDefinition DRAFT, every field Sourced<T>
    → HUMAN REVIEW: Game Config Editor + to-scale Field Layout Editor
    → Zod validation → FINAL GameDefinition
```

It is **not assumed** that the PDF contains precise field geometry. Geometry
defaults to the field template plus human placement; extraction only proposes.

**Evaluation:** one hand-authored GameDefinition built in Phase 3 serves as the
golden fixture. Phase 4's extractor is scored by field-by-field diff against it.

---

## 7. Mechanism architecture *(Phase 2)*

The engine operates on capabilities. Type names are authoring presets.

```ts
type CapabilityKind =
  'acquire' | 'release' | 'launch' | 'elevate' | 'climb' | 'traverse';

interface MechanismConfig {
  id: string; name: string;
  preset: string;         // 'intake' | 'shooter' | … — UI label only
  massLb: number;         // contributes to totalMass → real tradeoffs
  mount: { xIn: number; yIn: number; facingDeg: number };
  actuation?: { motorId: string; motorCount: number;
                gearRatio: number; efficiency: number };
  capabilities: CapabilitySpec[];
}
```

| Capability | Parameters | Derived where possible from |
|---|---|---|
| `acquire` | pieceTypes, regionLocal, ratePerSec, capacity | motor speed × gear ratio × geometry |
| `release` | targetSelector, ratePerSec | ″ |
| `launch` | exitSpeed, exitAngle, spreadStdDev | flywheel surface speed |
| `elevate` | minHeightIn, maxHeightIn, travelTimeSec | motor torque vs. load |
| `climb` | level, timeSec, successModel | — |
| `traverse` | requiredClearanceIn | robot `heightIn` |

**No engine code branches on `preset`.** Scoring rules reference capabilities and
heights. A new season needing "hang a specimen at 26 inches" is
`release` + `elevate(≥26 in)` — a data change, not a code change.

---

## 8. Archetype architecture *(Phase 5)*

**Archetypes are strategic roles. Budgets are a validator, never the generator.**

```
GameDefinition
  │
  ├─▶ ① STRATEGIC FUNCTION ANALYSIS
  │      From objectives[] and scoringRules[], identify the functions that win
  │      matches in THIS game — e.g. acquire from floor, score at height H,
  │      score at range, relocate to partner, climb at endgame, deny access.
  │      → StrategicFunction { id, label, pointLeverage, timeCost,
  │                            requiredCapabilities[], phase }
  │
  ├─▶ ② ARCHETYPE SYNTHESIS          ← the role IS the archetype
  │      Group functions into coherent strategic roles by emphasis:
  │      Archetype { id, name, rationale,
  │                  prioritized: FunctionId[], deprioritized: FunctionId[] }
  │      Names emerge from the functions present in this game. Never a fixed list.
  │
  ├─▶ ③ BASELINE ROBOT SYNTHESIS
  │      For each archetype emit a physically plausible RobotConfig: select
  │      mechanisms whose capabilities serve the prioritized functions, size and
  │      mass them realistically, choose motor and gearing to match the role.
  │
  ├─▶ ④ FEASIBILITY FILTER           ← constraints only, not the definition
  │      motor ports ≤ 8 (drivetrain takes 4) · 18 in start volume ·
  │      mass sanity · GameDefinition.robotConstraints
  │      On violation, degrade the archetype's DEPRIORITIZED functions first.
  │      The role survives; the extras get cut.
  │
  └─▶ ⑤ MEASUREMENT
         Headless probe runs → concrete metrics → game-specific stat sheet.
```

### 8.1 Metrics

```ts
interface MetricSpec {
  id: string; label: string;
  unit: string; displayUnit: string;
  source: { kind: 'probe';   probeId: string }
        | { kind: 'derived'; path: string };
  format: 'int' | '1dp' | 'percent';
}
```

Probes are scripted deterministic headless runs sharing the `runHeadless` path
with the test suite:

| Probe | Method | Example output |
|---|---|---|
| `maxSpeed` | full throttle straight, 4 s | 8.1 ft/s |
| `maxAccel` | 0 → 80 % top speed | 35 ft/s² |
| `rotationRate` | full-authority spin, steady state | 200 °/s |
| `strafeSpeed` | full lateral, 4 s | 6.3 ft/s |
| `intakeRate` | continuous acquire | 25 b/s |
| `capacity` | derived from `acquire.capacity` | 65 |
| `shootRate` / `accuracy` | repeated launch vs. target | 10 b/s / 95 % |
| `clearance` | robot height vs. element clearances | Trench: 70 |
| `climbLevel` / `climbTime` | scripted endgame sequence | 1 / 1.0 s |
| `cycleTime` | scripted acquire → score loop | 4.2 s |

Displayed in FTC units via the boundary converter. Never a 1–10 rating.

---

## 9. Simulation loop

Fixed-step accumulator inside `requestAnimationFrame`; the renderer interpolates
between the two most recent snapshots. **Canonical tick order, identical in the
browser and headless:**

```
 1  matchClock.advance(dt)                 period / sub-phase transitions
 2  controller.sample(tick) per robot      → ControlInput
 3  mechanisms.update(dt)                  capability states, current draw, events
 4  drivetrain.solve(dt)                   wheel cmds → torques → body wrench
                                           (uses battery voltage from tick n−1)
 5  traction.limit(...)                    IdealTraction: identity in Phase 1
 6  integrate(dt)                          semi-implicit Euler, all bodies
 7  broadphase → narrowphase → resolve     contacts, MTV, impulses
 8  events.flush()                         SimEvent[] from physics + mechanisms
 9  rulesEngine.evaluate(...)              → ScoreDelta[] + Effect[]
10  effects.apply()                        the ONLY rules → physics mutation path
11  battery.update()                       voltage for tick n+1
12  telemetry.sample()   [every 20th tick] 10 Hz UI feed
13  tick++
```

**Rate discipline:**

| Concern | Rate |
|---|---|
| Physics | 200 Hz fixed (`dt = 1/200 s`) |
| Render | `requestAnimationFrame`, interpolated |
| Telemetry → React | 10 Hz |

**The simulation loop never writes React state.** Render frequency never affects
physics. `core/` is DOM-free, so relocating the loop into a Web Worker later is a
drop-in change; this is not done in Phase 1.

**Multi-robot:** every structure is already `robots: RobotRuntime[]` with
`alliance: 'red' | 'blue'`. Phase 1 constructs an array of one and the UI exposes
a single robot. No branching, no special-casing.

### 9.1 Determinism

- The **integer tick counter is the only clock** inside `core/`.
- `performance.now`, `Date.now`, `Math.random`, and `crypto` are lint-banned in
  `core/`.
- A single **PCG32** generator is owned by `SimWorld`, with **per-subsystem
  sub-streams** so adding a random draw in one system cannot shift another's
  sequence.
- No result depends on `Map`/`Set` iteration order; entities live in arrays and
  contacts are stable-sorted by id.

**Known limit:** JavaScript numbers are IEEE-754 doubles and basic arithmetic is
deterministic, but `Math.sin/cos/atan2/pow` are not guaranteed bit-identical
across engines and platforms. Same-machine replay and CI determinism are solid;
cross-machine bit-identical replay would require a deterministic math library and
is explicitly out of scope.

### 9.2 `runHeadless` is the canonical path

```ts
runHeadless(opts: {
  robots: RobotConfig[];
  controllers: Controller[];
  ticks: number;
  seed: number;
}): { finalSnapshot: WorldSnapshot; telemetry: TelemetrySample[]; stateHash: string }
```

Used by the test suite, future metric probes, future archetype measurement, and
future replay verification. **There is exactly one simulation implementation.**
The UI drives the same `SimWorld` through a different clock source.

---

## 10. Testing strategy

| Tier | What it proves | Examples |
|---|---|---|
| **Unit** | Pure functions match analytic truth | motor curve reproduces datasheet free speed and stall torque; IK∘FK = identity; SAT vs. hand-computed overlaps |
| **Analytic reference** | Emergent behaviour matches hand calculation | steady-state top speed vs. `ω_free · r / G`; `a(0)` vs. `n·τ_stall·G·η/(r·m)` |
| **Invariant / property** | Holds on every tick of randomised runs | no NaN in any body; robot inside field bounds; no tunneling at max speed; saturation preserves direction |
| **Determinism** | Golden state hash | fixed seed + committed input trace + N ticks → FNV-1a hash matches committed value |
| **Regression** | One test per fixed bug, permanently | per `CLAUDE.md` |

CI gates: `tsc --noEmit`, ESLint (including layer zones), and the full Vitest
suite including the determinism hash.

---

## 11. Phase 1 implementation sequence

Each step lands with its tests before the next begins.

| # | Step | Done when |
|---|---|---|
| 1 | Scaffold: Vite + TS strict + Vitest + ESLint layer zones; `units`, `vec2`, `angle`, PCG32 `rng`, `hash` | Suite green; a deliberate `core/` → `app/` import fails lint |
| 2 | Motor model + goBILDA catalog transcribed from datasheets with source URLs | Curve reproduces published free speed / stall torque per entry |
| 3 | Battery model with one-tick voltage lag | Four-motor near-stall sag is plausible and stable |
| 4 | Mecanum IK, FK, saturation normalize | Forward / strafe / rotate / combined tests; IK∘FK identity |
| 5 | Force-based drivetrain dynamics; `IdealTraction` | Emergent top speed and `a(0)` match analytic reference |
| 6 | `robot/derive.ts` — L, W, H, mass → inertia, halfTrack, halfWheelbase, wheel radius | Derivations unit-tested; each logged in `ASSUMPTIONS.md` |
| 7 | `SimWorld` — fixed 200 Hz loop, tick counter, snapshot, event queue, `robots[]` of length 1 | Golden determinism hash test passes |
| 8 | `physics/` — OBB↔static SAT, spatial hash, resolution | No tunneling at max speed; robot stays in bounds under randomised input |
| 9 | Field: `ftc-standard-12ft`, 144 in × 144 in perimeter | Dimensionally correct in world units |
| 10 | Canvas2D renderer, camera, snapshot interpolation | 60 fps, decoupled from tick rate |
| 11 | `control/` + `app/input/` — keyboard, virtual PS5 pad, Gamepad API, scripted | All four produce identical motion from identical input |
| 12 | Telemetry bus at 10 Hz + panel | Values update; React does not re-render at 60 Hz |
| 13 | **Verification:** measured max speed / accel / rotation vs. hand-computed reference | Agreement documented, or discrepancy explained in `ASSUMPTIONS.md` |

**Phase 1 explicitly excludes:** game pieces, scoring, mechanisms, archetypes,
presets and storage, PDF ingestion, and multi-robot UI. No placeholder systems
are created for them.

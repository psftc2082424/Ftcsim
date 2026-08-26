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
    │   ├── mechanism/             capability.ts, mechanism.ts, presets.ts
    │   ├── robot/                 robotConfig.ts, derive.ts, robotRuntime.ts
    │   ├── physics/               body.ts, shapes.ts, sat.ts, broadphase.ts,
    │   │                          resolve.ts, integrate.ts
    │   ├── sim/                   simWorld.ts, snapshot.ts, headless.ts, events.ts
    │   ├── game/                  sourced.ts, matchStructure.ts, scoring.ts,
    │   │                          gameDefinition.ts, events.ts, effects.ts,
    │   │                          matchClock.ts, predicates.ts, rulesEngine.ts,
    │   │                          matchRunner.ts, regions.ts,
    │   │                          membershipDetector.ts, observation.ts,
    │   │                          matchSimulation.ts, fixtures/
    │   ├── control/               controlInput.ts, controller.ts, scripted.ts
    │   ├── field/                 fieldTemplate.ts
    │   ├── metrics/               (Phase 5) metricSpec.ts, probes/
    │   ├── archetype/             (Phase 5) synthesize.ts, feasibility.ts
    │   └── telemetry/             sampler.ts, types.ts
    ├── schema/                    robotConfig.schema.ts,
    │                              gameDefinition.schema.ts, migrations.ts
    ├── storage/                   kvStore.ts, presets.ts
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

**Implementation status.** Phase 3 is built end to end: a snapshot becomes
observations, observations become events, events run through rules, and rules
produce score. Shipped today:

| Module | Contents |
|---|---|
| `core/game/sourced.ts` | `Sourced<T>` and its constructors |
| `core/game/matchStructure.ts` | Match timing types and pure derivation |
| `core/game/matchClock.ts` | Tick-driven phase transitions |
| `core/game/scoring.ts` | `Objective` and `ScoringRule` types, capability helpers |
| `core/game/events.ts` | The closed `SimEvent` union — the physics→rules channel |
| `core/game/predicates.ts` | The reviewed predicate registry |
| `core/game/rulesEngine.ts` | Rule matching and evaluation |
| `core/game/effects.ts` | The closed `Effect` union and score state |
| `core/game/regions.ts` | Placed field geometry and support fractions |
| `core/game/membershipDetector.ts` | Membership changes → events |
| `core/game/observation.ts` | `WorldSnapshot` → detector observations |
| `core/game/matchRunner.ts` | Clock, rules, effects and logical world state |
| `core/game/matchSimulation.ts` | The whole pipeline, wired and ordered |
| `core/game/gameDefinition.ts` | The container, validation, and the derived ledger |
| `core/game/fixtures/` | DECODE as a golden `GameDefinition` |
| `schema/gameDefinition.schema.ts` | Zod validation and `safeParse*` |

Not built: metrics, and the Phase 4 PDF ingestion pipeline (§6.6). Sections below
mark which is which, so this document can be trusted about what exists.

### 6.1 Provenance wrapper

```ts
type Confidence = 'explicit' | 'inferred' | 'assumed' | 'unknown';

interface Sourced<T> {
  readonly value: T;
  readonly confidence: Confidence;
  readonly sourcePage?: number | undefined;
  readonly sourceRule?: string | undefined;   // e.g. R101, G415
  readonly sourceQuote?: string | undefined;  // verbatim
  readonly note?: string | undefined;
}
```

`sourceRule` is separate from `sourcePage` rather than overloading it: FTC
manuals are cited by rule far more often than by page, and a rule number
survives a re-paginated revision where a page number does not.

Constructed through named helpers rather than object literals, so the confidence
level is always a deliberate choice:

```ts
explicit(value, sourcePage?, sourceQuote?, note?)      // stated outright
explicitRule(value, sourceRule, sourceQuote?, page?)   // stated, cited by rule
inferred(value, note, sourcePage?)                     // deduced from context
assumed(value, note)                                   // estimate; note required
unresolved(placeholder, note)                          // a human must replace it
```

**`sourceQuote` is verbatim, and that is load-bearing.** A value read out of a
table quotes the row as printed and names its column in `note`; reconstructing a
row as `"LABEL | value"` reads like a quotation but is not one, and nothing can
check it against the source. `tools/verify-citations.mjs` searches each quote on
the page it claims — it found three real errors on its first run, including
constants citing a rule that says nothing about them.

Note the asymmetry in naming: the *confidence value* is `'unknown'`, but the
constructor is `unresolved()` — it carries a working placeholder so the
simulation can still run, which is strictly weaker than `assumed`.

Reading helpers: `isTrustworthy()` (explicit or inferred), `needsReview()` (its
negation), `valueOf()` to unwrap, and `describeSource()` for display.

Wrapping every extracted field makes `PRODUCT_SPEC.md` §3 structural rather than
advisory: a field cannot hold a bare number, so "where did this come from?"
always has an answer.

**Built:** `collectProvenance()` walks a whole definition and reports every
`Sourced` value with its path; `assumptionLedger()` filters that to what needs
review, and `provenanceSummary()` counts each confidence level. The ledger for a
season is therefore a projection over the definition rather than a document that
drifts.

Two subtleties the DECODE transcription forced. A `Sourced` shared between fields
is reported at *every* path that uses it — deduplicating by identity hid that
both DECODE piece types share one estimated mass. And `provenanceNotes` carries
statements that belong to a definition rather than to any single value, because
the largest gap in a fixture is often of that kind: "element positions are
published only in the CAD model".

### 6.2 Container shape *(built)*

Deferred until its members existed, which was the right call: the shape below
differs from what was sketched here, and every difference came from building the
parts rather than from imagining them.

```ts
interface GameDefinition {
  id: string; season: string; name: string;

  match: MatchStructure;                          // §6.3
  pieces: GamePieceType[];

  regions: FieldRegion[];                         // placed geometry
  zones: FieldZone[];                             // robot support is measured here
  slottedRegions: Record<string, number>;         // ordered regions and their slots

  setup?: MatchSetupSpec;                         // how pieces are staged
  rules: ScoringRule[];                           // §6.4
  objectives: Objective[];                        // §6.4
  robotConstraints: RobotConstraints;

  rankingPoints?: RankingPointRules;              // recorded, not scored
  penalties?: PenaltyValues;                      // values only; triggers need a referee
  provenanceNotes?: Sourced<unknown>[];           // facts that belong to no single field

  variables?: Record<string, FilterValue>;        // per-match, e.g. a randomised motif
}
```

Four departures from the sketch, each with a reason found in the building:

**Regions and zones are separate, and both are top-level.** The sketch nested
them under `field` alongside a template and dimensions. In practice a *region*
is where a piece can be (scoring asks "is the artifact in it") and a *zone* is
where a robot's support is measured ("is the robot fully in it"), and those are
different questions asked by different rules. Field perimeter and dimensions
belong to `FieldTemplate` in the physics layer, not to the game definition.

**`schemaVersion` is not here.** Versioning belongs to the persisted form, which
is `schema/`'s concern; putting it on the runtime type would make every consumer
carry a field none of them read.

**Ranking points and penalties are recorded rather than scored.** A ranking point
is a threshold on a match total that no event carries, and it depends on an event
tier that is not part of the game — `rankingPointsFor(rules, tier, totals)`
throws on an unknown tier rather than defaulting, because silently scoring a
Championship against a lower bar inflates every result in the tournament. Penalty
*values* are transcribed; which actions draw a foul is referee judgement, and no
rule in a definition assesses one.

**`provenanceNotes` exists because a manual says things that are not values.**
"Element positions are published only in the CAD model" is the largest gap in the
DECODE fixture and belongs to no field; without somewhere to put it, it lives in
a comment and never reaches the ledger.

`validateGameDefinition` cross-checks the parts against each other before a match
runs: rules naming geometry that does not exist, predicates this build cannot
resolve, staged pieces that do not add up to the declared counts, ranking-point
criteria whose event tiers disagree. Errors mean the definition cannot score
correctly; warnings mean it will run with something estimated.

### 6.3 Match structure *(built)*

```ts
type PeriodId  = 'AUTO' | 'TELEOP';
type SubPhaseId = 'ENDGAME';
type PhaseId   = PeriodId | SubPhaseId;          // what a rule can scope to
type MatchState = 'PRE' | PhaseId | 'TRANSITION' | 'POST';   // what the clock reports

interface MatchStructure {
  readonly periods: readonly [AutoPeriod, TeleopPeriod];
  /** Dead time between autonomous and teleop, if the game defines any. */
  readonly transitionSec?: Sourced<number> | undefined;
  /** Which period an achievement during that gap is scored as. */
  readonly transitionScoresAs?: Sourced<PeriodId> | undefined;
}

interface AutoPeriod   { id: 'AUTO';   durationSec: Sourced<number> }
interface TeleopPeriod {
  id: 'TELEOP';
  durationSec: Sourced<number>;
  subPhases: readonly [EndgameSubPhase];
}
interface EndgameSubPhase { id: 'ENDGAME'; startsAtRemainingSec: Sourced<number> }
```

Endgame is positioned by **time remaining in teleop**, never by a duration. That
is what makes it structurally incapable of lengthening the match, whatever value
it holds — the locked decision from §0.1 enforced by the type rather than by
convention.

**Derivation API**, all pure:

| Function | Returns |
|---|---|
| `totalMatchDurationSec(m)` | auto + transition + teleop. Endgame contributes nothing. |
| `teleopStartSec(m)` | absolute time teleop begins |
| `endgameStartSec(m)` | absolute time endgame begins, clamped into teleop |
| `matchTimeline(m)` | non-overlapping `PhaseWindow[]` tiling the match exactly once |
| `matchStateAt(m, t)` | `MatchState` at an absolute time |
| `scoringStateAt(m, t)` | the phase a rule is scoped against, or `null` |
| `periodOf(state)` | the period a state belongs to, or `null` |
| `isWithinPhase(state, scope)` | whether a rule scoped to `scope` applies |

**`TRANSITION` is its own state, and the reason it has to be is instructive.**
It was originally reported as `'PRE'`, on the argument that the match has started
but no scoring period is active and `PRE` already means exactly that. That
argument is wrong, and the DECODE manual says so: an 8-second gap sits between
AUTO and TELEOP, and "ARTIFACTS that meet scoring criteria prior to the start of
TELEOP are assessed as part of AUTO" (§10.5 A). Reporting the gap as `PRE` made
every artifact that settled in it score nothing — which is the opposite of what
the 8 seconds exist for.

Which period a transition scores as is a property of the game, not of the engine,
so it is read from `transitionScoresAs`; a structure that does not say scores
nothing there rather than having a period guessed for it.

`periodOf('TRANSITION')` is deliberately `null`. A period *ends* when its clock
does — DECODE assesses LEAVE "at the end of AUTO" (§10.5 E), not at the end of
the settling window that follows it — so end-of-period assessment fires at the
AUTO→TRANSITION boundary. What the gap scores as is the separate question
`scoringStateAt` answers.

**The asymmetry that makes the sub-phase model correct**, and the single most
important semantic in this module:

```
isWithinPhase('ENDGAME', 'TELEOP') === true    // endgame IS teleop
isWithinPhase('TELEOP', 'ENDGAME') === false   // but teleop is not endgame
```

A rule scoped to `TELEOP` keeps scoring during endgame, because endgame is part
of teleop. A rule scoped to `ENDGAME` does not fire earlier. Getting this
backwards would award hang points for the entire driver-controlled period.

`endgameStartSec` **clamps** a threshold longer than teleop rather than
producing an endgame that starts before teleop does. The schema rejects such a
definition (§6.5), but the derivation must not emit nonsense if one reaches it.

`FTC_CONVENTIONAL_MATCH` ships as a convenience: 30 s auto, 2:00 teleop, endgame
in the final 30 s. **Every field is marked `assumed`, not `explicit.`** These
values have held for many seasons but they are *rules*, and a real definition
must read them from that season's manual. Shipping them as `explicit` would be
precisely the silent invention `PRODUCT_SPEC.md` §3 forbids.

### 6.4 Objectives and scoring rules *(built)*

Two ideas kept deliberately separate, because one objective may be served by
several rules:

- **`Objective`** is strategic — what is worth points, and which capabilities a
  robot needs to pursue it. This is what the Phase 5 archetype generator reasons
  over.
- **`ScoringRule`** is mechanical — which simulated event awards which points
  under which conditions. This is what the rules engine will evaluate.

```ts
type PhaseScope = PhaseId | 'ANY';
type AllianceTarget = 'owner' | 'red' | 'blue';
type FilterValue = string | number | boolean;

interface RuleFilter   { field: string; equals: FilterValue }
interface ScoringTrigger { event: SimEventKind; filters: readonly RuleFilter[] }
interface PredicateRef { predicateId: string; params?: Record<string, FilterValue> }
interface ScoringAward { points: Sourced<number>; alliance: AllianceTarget }

interface ScoringRule {
  id: string; label: string;
  phase: PhaseScope;
  trigger: ScoringTrigger;
  condition?: PredicateRef | undefined;   // optional extra condition
  oncePerPiece?: boolean | undefined;     // a piece scores once, however often it re-enters
  maxAwards?: number | undefined;         // absent means unbounded
}

interface Objective {
  id: string; label: string;
  phase: PhaseScope;
  pointValue: Sourced<number>;
  requiredCapabilities: readonly CapabilityKind[];
  repeatable: boolean;
  estimatedCycleSec?: Sourced<number> | undefined;
  notes?: string | undefined;
}
```

Objectives reference **capability kinds, never mechanism type names**, which is
the link to §7 and the reason an objective stays season-agnostic.

Helpers, all pure: `objectivesReachableBy(objectives, capabilities)`,
`missingCapabilitiesFor(objective, capabilities)`, and `maxContributionOf(rule)`
— which returns `null` for an uncapped rule rather than a sentinel number.

`SimEventKind` is the vocabulary rules may subscribe to:
`PieceEnteredRegion`, `PieceReleasedBy`, `PieceCameToRest`, `RobotOverlapsZone`,
`RobotHeightExceeded`, `MechanismStateChanged`. Physics emits these facts; it
never computes score.

**No `eval`, ever.** A condition is a `PredicateRef` — an *identifier* into a
reviewed TypeScript registry, not an expression. A definition may be produced by
a language model from a PDF in Phase 4; there must be no path by which generated
text becomes executed code. The schema enforces this with a conservative
identifier pattern (§6.5).

**Built.** The rules engine, the predicate registry and the closed `Effect`
union are all in place, and `MatchSimulation` wires the whole pipeline. Rules
never touch bodies: the only channel out is an `Effect`, and the only channel in
is a `SimEvent`.

One event kind was added by DECODE and is general: `RobotAssessed`. Zone events
only fire for zones a robot is *in*, which cannot express a rule about where a
robot is **not** — DECODE's LEAVE awards exactly the robots that produce no zone
event (§10.5.3). A period boundary therefore restates each robot as a bare fact
and predicates answer questions about it.

### 6.5 Validation layer *(built)*

`schema/gameDefinition.schema.ts` is the boundary where model output stops being
text and becomes something the simulator will act on. It enforces two properties
the TypeScript types cannot:

1. **Endgame cannot escape teleop.** `matchStructureSchema` refines the endgame
   threshold against teleop's own duration, so a definition claiming a 200 s
   endgame inside a 120 s teleop is *rejected*, not silently clamped.
2. **No executable content.** Identifiers — predicate ids and filter fields —
   must match `/^[a-zA-Z][a-zA-Z0-9_-]*$/`. Strings like `() => true`,
   `require("fs")` or `eval(1)` cannot pass. Unknown keys are stripped rather
   than forwarded.

```ts
safeParseMatchStructure(raw) → GameParseResult<MatchStructure>
safeParseScoringRule(raw)    → GameParseResult<ScoringRule>
safeParseObjective(raw)      → GameParseResult<Objective>
```

`GameParseResult<T>` is a discriminated union carrying either the value or
pathed `GameParseFailure[]`, so a failure names the field that caused it.
`sourcedSchema(inner)` wraps any value schema in the provenance envelope, and
`isReviewRequired(confidence)` gates which parsed values still need a human.

Validation is per-structure rather than whole-document because the container
does not exist yet (§6.2).

### 6.6 Manual pipeline *(Phase 4 — not implemented)*

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

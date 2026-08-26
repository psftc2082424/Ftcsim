# Physical & Modelling Assumptions Ledger

**Authoritative record of every assumed physical or modelling constant in the
simulator.** If a number in `src/core/` is not a direct consequence of user input
or a cited datasheet value, it must appear here.

## Confidence levels

| Level | Meaning |
|---|---|
| **EXPLICIT** | Taken directly from a manufacturer datasheet, official rule, or physical definition. Source cited. |
| **DERIVED** | Computed from EXPLICIT values or user input by a stated formula. No new information introduced. |
| **ASSUMED** | An engineering estimate. Physically motivated, but not measured. A calibration target. |
| **UNVERIFIED** | Used because a value was required, but the source could not be confirmed. Highest priority for replacement. |

Every ASSUMED and UNVERIFIED entry names the single code constant that carries it
so it can be recalibrated in one place.

---

## 1. Geometry & inertia

### 1.1 `WHEEL_INSET_M` — track and wheelbase inset

| | |
|---|---|
| **Value** | `0.0635 m` (2.5 in) |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/robot/derive.ts` |
| **Used by** | `halfTrack = (widthM − WHEEL_INSET_M) / 2`, `halfWheelbase = (lengthM − WHEEL_INSET_M) / 2` |

**Reasoning.** `PRODUCT_SPEC.md` §4 forbids asking the user for track width or
wheelbase, so both must be derived from the robot's outer length and width. The
wheel centreline never sits at the outer face: a goBILDA 96 mm mecanum wheel is
about 38 mm wide, and in a typical FTC build it is mounted inboard of a side rail
(15 mm extrusion, or 3 mm plate plus hub clearance). That places the centreline
roughly 1.25 in inside each outer face, so the full-width reduction is about
2.5 in. The same inset is applied to the wheelbase, since front and rear wheels
are inset from the bumper faces by a comparable amount.

**Sensitivity.** This constant does **not** affect straight-line top speed or
translational acceleration at all — those depend only on motor, gearing, wheel
radius and mass. It affects only `kinematicK = halfTrack + halfWheelbase`, which
sets the translation↔rotation coupling, and therefore the rotation rate. A ±1 in
error in the inset changes the rotation rate of an 18 in robot by roughly ±7 %.

**Guard.** For robots narrower or shorter than the inset the derivation would
produce a non-positive half-dimension. `derive.ts` clamps each half-dimension to
a floor of `MIN_HALF_DIMENSION_M` and the clamp is reported, never silent.

**Calibration path.** Replace with a measured track and wheelbase when real robot
data is available. A single constant, one site.

### 1.2 `MIN_HALF_DIMENSION_M` — degenerate-geometry floor

| | |
|---|---|
| **Value** | `0.01 m` (10 mm) |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/robot/derive.ts` |

Numerical guard only; it has no physical meaning. Prevents division by zero in
`kinematicK` for robots smaller than `WHEEL_INSET_M`. Reaching this clamp is
reported on the derived runtime so the UI can flag an unphysical configuration.

### 1.3 Moment of inertia about the vertical axis

| | |
|---|---|
| **Formula** | `I_z = m · (L² + W²) / 12` |
| **Confidence** | **ASSUMED** (uniform-density rectangular plate) |
| **Location** | `src/core/robot/derive.ts` |

**Reasoning.** `PRODUCT_SPEC.md` §4 forbids asking the user for a moment of
inertia, but rotational dynamics require one. The uniform rectangular plate is
the only defensible estimate from length, width and mass alone.

**Known bias.** Real FTC robots concentrate mass at the perimeter (drivetrain,
motors, battery) and in mechanisms mounted high and outboard. Their true `I_z` is
therefore **higher** than the uniform-plate estimate, so the simulator will
**over-predict angular acceleration**. Magnitude is unmeasured. Calibration
target.

### 1.4 Centre of mass

| | |
|---|---|
| **Value** | Geometric centre of the chassis rectangle |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/robot/derive.ts` |

Follows from the same uniform-density assumption as §1.3, and holds exactly for a
robot with no mechanisms.

**Superseded by §9.2 for robots that carry mechanisms.** Mechanism mass and mount
positions now shift the centre of mass to a mass-weighted centroid. Note that the
offset is derived and reported but is not yet consumed by the integrator, which
still rotates bodies about their geometric centre — see §9.2 and §8.

---

## 2. Drivetrain

### 2.1 Perfect traction — Phase 1 is ideal by explicit decision

| | |
|---|---|
| **Model** | `TractionModel.limit(forces) = forces` (identity) |
| **Confidence** | **EXPLICIT** — mandated by `PRODUCT_SPEC.md` §4 and §6 |
| **Location** | `src/core/drive/traction.ts` (`IdealTraction`) |

**No friction coefficient, traction coefficient, or force clamp exists anywhere
in the codebase.** Wheel force is limited only by available motor torque.

**Consequence, stated plainly.** Acceleration is stall-torque-limited rather than
friction-limited:

```
a_max(v = 0) = n · τ_stall · G · η / (r_wheel · m)
```

Real mecanum wheels on FTC foam tiles break traction readily — small contact
patch, only the loaded roller bears force, constant roller scrub. The simulator
will therefore **over-predict acceleration**, most severely for light robots on
high-reduction gearing. This is a known and accepted property of the Phase 1
model, not a defect.

**Extension path.** `TractionModel` is an interface. A calibrated Coulomb model
becomes an explicit opt-in implementation with no change to any caller.

### 2.2 No strafe-efficiency penalty

| | |
|---|---|
| **Value** | None modelled — forward and lateral force magnitudes are equal |
| **Confidence** | **ASSUMED** (idealisation) |
| **Location** | `src/core/drive/drivetrain.ts` |

Ideal mecanum kinematics with the Jacobian-transpose force mapping produce
`|F_x| = |F_y| = 4F` for pure forward and pure strafe respectively, so the model
gives identical translational acceleration and top speed in every direction.

**Known bias.** Real mecanum drivetrains strafe measurably slower than they drive
forward — roller scrub, single-roller load transfer, and higher effective
rolling resistance laterally. Introducing a correction factor would mean adding
an invented, traction-adjacent coefficient, which is explicitly out of scope for
Phase 1. Recorded here as a known idealisation. Calibration target alongside
§2.1.

### 2.3 External transmission efficiency `DRIVETRAIN_EFFICIENCY`

| | |
|---|---|
| **Value** | `0.95` |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/drive/drivetrain.ts` |

**Reasoning.** `PRODUCT_SPEC.md` §5 specifies a **belted** mecanum drivetrain. A
single synchronous-belt reduction stage typically transmits 95–98 % of input
power. 0.95 is the conservative end of that band and also absorbs a small amount
of bearing and hub loss.

**Important — no double counting.** goBILDA publishes free speed and stall torque
**at the gearbox output shaft**, so the motor's internal planetary losses are
already reflected in the catalogued figures. `DRIVETRAIN_EFFICIENCY` therefore
covers *only* the external belt reduction between the motor output shaft and the
wheel. Applying a separate gearbox-efficiency term on top of the catalogue values
would count planetary losses twice.

### 2.4 Zero-power behaviour: BRAKE

| | |
|---|---|
| **Value** | Brake (motor terminals effectively shorted at zero duty) |
| **Confidence** | **ASSUMED** (matches the common FTC default) |
| **Location** | emergent from `src/core/motor/motorModel.ts` |

At `duty = 0` the motor model yields `τ = −k_t · k_e · ω / R`, a braking torque
proportional to speed. This is real generator behaviour, not an added drag term.

**No rolling-resistance term is modelled in Phase 1.** Deceleration comes
entirely from back-EMF braking, which is the dominant real effect for a powered
drivetrain. Adding rolling resistance would require an invented coefficient with
no datasheet backing. A robot commanded to zero decelerates; it does not coast
forever. Float behaviour (`τ = 0` at zero duty) is a future option.

### 2.5 Efficiency is applied multiplicatively in both directions

| | |
|---|---|
| **Choice** | `F = τ · G · η / r` regardless of torque sign |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/drive/drivetrain.ts` |

Strictly, transmission losses always oppose power flow: while driving, the wheel
receives `τ·G·η`; while the wheel back-drives the motor during braking, the wheel
must supply `τ·G/η`. Branching on torque sign would be about 10 % more accurate
in the braking regime.

It is not done, because the branch introduces a discontinuity exactly at
`τ = 0` — which is where a robot spends every moment of coasting and every
transition between accelerating and braking. A discontinuous force there invites
chatter at low speed. Continuity is worth more than 10 % on a second-order term.

**Known bias.** Braking force is understated by roughly `1 − η²` ≈ 10 %, so
stopping distances are slightly long.

---

## 3. Electrical

### 3.1 Battery open-circuit voltage `BATTERY_V_OC`

| | |
|---|---|
| **Value** | `12.0 V` |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/motor/battery.ts` |

The FTC-legal battery is a 12 V NiMH pack (10 × 1.2 V cells). A freshly charged
pack reads roughly 13.0–13.5 V and falls through the match. 12.0 V is used as a
representative mid-match resting voltage rather than a best case, so quoted
performance is not flattered by a full battery. Configurable per simulation run.

### 3.2 Battery internal resistance `BATTERY_R_INT`

| | |
|---|---|
| **Value** | `0.030 Ω` |
| **Confidence** | **UNVERIFIED** |
| **Location** | `src/core/motor/battery.ts` |

**Reasoning.** This lumps pack internal resistance together with wiring, XT30
connectors, and the power-distribution path — the sag a robot actually
experiences, not the cell chemistry alone. At the chosen value a drivetrain
drawing 40 A total sags about 1.2 V, which is consistent with the brownout
behaviour FTC teams commonly report under hard acceleration.

**This number is not from a datasheet.** It is the single least-supported
constant in the Phase 1 model and the highest priority for measurement.

**Sensitivity.** Affects acceleration under heavy load only. Near free speed,
current is small and sag is negligible, so top speed is essentially unaffected.

### 3.3 Battery/motor algebraic loop — one-tick voltage lag

| | |
|---|---|
| **Choice** | Voltage computed at the end of tick *n* is consumed by tick *n+1* |
| **Confidence** | **EXPLICIT** — mandated by `ARCHITECTURE.md` §5.2 |
| **Location** | `src/core/sim/simWorld.ts` step 11 |

Motor torque depends on battery voltage, which depends on total current, which
depends on torque. Rather than iterate the algebraic loop, the previous tick's
voltage is used. At `dt = 5 ms` the lag is far shorter than any electrical or
mechanical time constant in the system, and the scheme is unconditionally stable
and exactly deterministic. Tick 0 uses `BATTERY_V_OC` with zero load.

### 3.4 Current sign convention

| | |
|---|---|
| **Choice** | Only positive (motoring) current contributes to sag; regenerative current is not credited back to the pack |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/motor/battery.ts` |

During braking the motor model produces negative current. Real FTC power systems
do not usefully recharge the pack through the motor controllers, and modelling
regeneration would raise pack voltage during deceleration, which is not observed.
Negative per-motor current is therefore clamped to zero when summing pack load.
Per-motor current is still reported signed in telemetry.

---

## 4. Simulation

### 4.1 Fixed timestep `DT_SECONDS`

| | |
|---|---|
| **Value** | `1/200 s` (5 ms, 200 Hz) |
| **Confidence** | **EXPLICIT** — mandated by `ARCHITECTURE.md` §5.6 |
| **Location** | `src/core/sim/simWorld.ts` |

Chosen so that per-tick displacement at realistic FTC speeds (~2.4 m/s) is about
12 mm — far below the smallest game-piece dimension, which removes any need for
continuous collision detection in Phase 1. It is also well above the drivetrain's
mechanical bandwidth, so the integrator is comfortably resolved.

### 4.2 Integrator

| | |
|---|---|
| **Choice** | Semi-implicit (symplectic) Euler |
| **Confidence** | **EXPLICIT** — mandated by `ARCHITECTURE.md` §5.6 |

Velocity is updated from acceleration first, then position from the new velocity.
The dominant dynamics are first-order (motor torque–speed), so a higher-order
integrator buys nothing measurable at 200 Hz.

### 4.3 Telemetry sample rate

| | |
|---|---|
| **Value** | Every 20th tick (10 Hz) |
| **Confidence** | **EXPLICIT** — mandated by `ARCHITECTURE.md` §9 |

Chosen so that React never re-renders at simulation or frame rate.

---

## 5. Collision and contact

### 5.1 Restitution and contact friction

| | |
|---|---|
| **Values** | `restitution = 0`; contacts are **frictionless** |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/physics/body.ts`, `src/core/physics/resolve.ts` |

**Restitution 0.** An FTC robot striking the field perimeter does not bounce
appreciably: the collision is dominated by structural compliance and the
drivetrain's resistance to being back-driven, not by elastic rebound. Zero is
the honest default, and the field is per-body so a springy game element can
override it later.

**Frictionless contacts.** Only the normal component of a contact is resolved.
Tangential friction would require a coefficient, and Phase 1 introduces no
friction coefficient of any kind (`PRODUCT_SPEC.md` §4).

**Known bias.** A robot sliding along a wall keeps all of its tangential speed,
where a real one would be scrubbed slower. Wall-following therefore looks
frictionless, and glancing impacts shed less energy than they should. Calibration
target alongside §2.1.

### 5.2 Broadphase cell size

| | |
|---|---|
| **Value** | `0.3048 m` (12 in) |
| **Confidence** | **ASSUMED** (performance tuning, not physics) |
| **Location** | `src/core/physics/broadphase.ts` |

One FTC floor tile is 24 in; half a tile puts a typical 18 in robot across about
two cells in each axis, which is the usual sweet spot for a uniform grid. This
value affects only how many candidate pairs the narrowphase examines — never a
simulation result. A wrong choice costs time, not correctness.

### 5.3 Positional correction constants

| | |
|---|---|
| **Values** | `POSITIONAL_CORRECTION_RATE = 0.8`, `PENETRATION_SLOP_M = 0.001` |
| **Confidence** | **ASSUMED** (numerical, not physical) |
| **Location** | `src/core/physics/resolve.ts` |

Standard Baumgarte-style constants. Correcting less than the full overlap per
tick damps the response so bodies settle instead of jittering apart; tolerating
1 mm of penetration stops a resting contact oscillating between overlapping and
separated. Neither is a physical quantity, and neither changes where a body comes
to rest by more than the slop itself.

### 5.4 Perimeter wall height

| | |
|---|---|
| **Value** | `12 in` |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/field/fieldTemplate.ts` |

FTC field perimeter panels are roughly a foot tall. The value is used only by the
vertical-span overlap test, and nothing in Phase 1 can drive over a wall, so it
has no observable effect until traversable field elements exist. It is recorded
now so the number is not mistaken for a measurement later.

### 5.5 Game pieces have no damping

| | |
|---|---|
| **Value** | None — a piece keeps whatever velocity a collision gave it |
| **Confidence** | **ASSUMED** (idealisation) |
| **Location** | `src/core/sim/simWorld.ts` |

Pieces integrate as free bodies with no applied force. Contacts are frictionless
(§5.1) and there is no rolling resistance (§2.4), so a knocked piece slides at
constant speed until it meets a wall.

**Why nothing was added.** Any damping figure would be an invented coefficient
with no measurement behind it, which `CLAUDE.md` forbids. The robot avoids this
problem because back-EMF braking supplies a real, derived decelerating torque;
a game piece has no motor, so there is no honest equivalent to derive.

**Known bias.** Pieces travel further than real ones after being struck.
Calibration target alongside §2.1 and §5.1.

### 5.6 A piece pinned against a wall escapes the field

| | |
|---|---|
| **Status** | **Known defect**, asserted by test rather than hidden |
| **Location** | `src/core/physics/resolve.ts`, surfaced in `src/core/sim/pieces.test.ts` |

A robot that keeps driving into a piece already resting against the perimeter
pins it in a gap narrower than its own diameter. The situation is geometrically
unsatisfiable: no position exists that separates the piece from both bodies.

**Why it escapes rather than jamming.** Both contact normals point along the same
axis, so single-pass positional correction alternates pushing the piece out of
the wall and out of the robot, and eventually displaces its centre past the
wall's far face. Real physics would squirt a round piece sideways; the resolver
has no lateral impulse to give it because neither contact has a lateral
component.

**Scope of the effect.** Robots remain correctly contained — this is specific to
a small, light body pinned between a heavy one and static geometry. Verified by
test: in the same scenario the robot stops at the wall while the piece leaves.

**Fix path, deliberately not taken here.** Iterating contact resolution several
times per tick, or adding a tangential escape for circle-versus-face contacts.
Either changes robot-versus-wall resolution too and would rebaseline the Phase 1
golden determinism digest, so it belongs in its own change with its own
verification rather than riding along with entity plumbing.

---

## 6. Input handling

### 6.1 Stick deadzones

| | |
|---|---|
| **Value** | `GAMEPAD_DEADZONE = 0.12`, radial |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/control/controlInput.ts`, `src/app/input/sources.ts` |

Consumer thumbsticks rest a few percent off centre and drift as they wear; 0.12
covers a well-used controller without noticeably cutting into usable travel.

**Radial, not per-axis.** A per-axis deadzone snaps a stick held near an axis
onto that axis, so a robot commanded diagonally jumps to driving straight. The
remaining range is rescaled to [0, 1] so full travel stays reachable.

This is an input-conditioning choice and lives entirely in the input layer.
Scripted and programmatic controllers bypass it completely, so it can never
affect a headless measurement or a determinism test.

---

## 7. Motor catalogue

Every catalogue entry is transcribed from a published goBILDA datasheet and
carries its own `source` URL in `src/core/motor/catalog/goBILDA.ts`. Nothing is
estimated, recalled or interpolated.

All values retrieved **2026-08-24**, at 12 VDC nominal, quoted **at the output
shaft**. Every one of the 9.2 A / 0.25 A / 12 VDC columns is identical across the
series, which is the shared base motor showing through.

| Part number | Ratio | Free speed | Stall torque | Stall A | No-load A | Encoder (output) |
|---|---|---|---|---|---|---|
| 5203-2402-0001 | 1:1 | 6000 RPM | 1.47 kg·cm (20.45 oz-in) | 9.2 A | 0.25 A | 28 PPR |
| 5203-2402-0003 | 3.7:1 | 1620 RPM | 5.4 kg·cm (75.8 oz-in) | 9.2 A | 0.25 A | 103.8 PPR |
| 5203-2402-0005 | 5.2:1 | 1150 RPM | 7.9 kg·cm (109 oz-in) | 9.2 A | 0.25 A | 145.1 PPR |
| 5203-2402-0014 | 13.7:1 | 435 RPM | 18.7 kg·cm (260 oz-in) | 9.2 A | 0.25 A | 384.5 PPR |
| 5203-2402-0019 | 19.2:1 | 312 RPM | 24.3 kg·cm (338 oz-in) | 9.2 A | 0.25 A | 537.7 PPR |
| 5203-2402-0027 | 26.9:1 | 223 RPM | 38.0 kg·cm (530 oz-in) | 9.2 A | 0.25 A | 751.8 PPR |
| 5203-2402-0051 | 50.9:1 | 117 RPM | 68.4 kg·cm (950 oz-in) | 9.2 A | 0.25 A | 1425.1 PPR |
| 5203-2402-0071 | 71.2:1 | 84 RPM | 93.6 kg·cm (1310 oz-in) | 9.2 A | 0.25 A | 1993.6 PPR |
| 5203-2402-0100 | 99.5:1 | 60 RPM | 133.2 kg·cm (1850 oz-in) | 9.2 A | 0.25 A | 2786.2 PPR |
| 5203-2402-0139 | 139:1 | 43 RPM | 185 kg·cm (2570 oz-in) | 9.2 A | 0.25 A | 3895.9 PPR |

Source URLs are stored per entry in the catalogue and asserted present by test.

**Not included:** a 43.7:1 / 137 RPM variant was searched for and does not appear
in goBILDA's 5203 line. It is absent rather than estimated.

### 7.1 Three cross-checks the catalogue passes

All three are enforced as tests, not observed once and forgotten. Measured
residuals across the ten entries:

| Check | Worst case | Tolerance |
|---|---|---|
| `6000 RPM ÷ ratio` vs published free speed | 0.75 % (50.9:1) | 1.5 % |
| kg·cm vs oz-in, converted independently | 1.08 % (3.7:1) | 1.5 % |
| Implied gearbox efficiency in a plausible band | 86.1 %–103.3 % | 80 %–105 % |

1. **One shared base motor.** Identical electrical specs across every ratio, and
   the base 6000 RPM divided by each ratio reproduces every published free speed.
2. **Independent unit agreement.** The kg·cm and oz-in figures agree once
   converted separately, validating `units/convert.ts` against the
   manufacturer's own arithmetic. The 3.7:1 entry is the worst at 1.08 %, purely
   because "5.4 kg·cm" is two significant figures — its own oz-in figure implies
   5.458 kg·cm.
3. **Implied gearbox efficiency.** `published torque ÷ (1.47 kg·cm × ratio)`.
   This is only possible because the 1:1 entry is the bare base motor. It is a
   data-entry integrity check: a transposed digit or mis-typed ratio in a future
   entry lands far outside the band.

### 7.1.1 What the efficiency spread shows

| Ratio | 1:1 | 3.7 | 5.2 | 13.7 | 19.2 | 26.9 | 50.9 | 71.2 | 99.5 | 139 |
|---|---|---|---|---|---|---|---|---|---|---|
| Implied η | base | 99.3 % | 103.3 % | 92.9 % | 86.1 % | 96.1 % | 91.4 % | 89.4 % | 91.1 % | 90.5 % |

The single-stage 3.7:1 sits near unity and the multi-stage ratios cluster around
90 %, which is what planetary stage counts predict. The 5.2:1 exceeding 100 % is
a rounding artefact of its two-significant-figure torque, not a free-energy
machine.

This spread is the direct evidence for §7.3: gearbox losses are already inside
the published numbers, they differ per ratio, and no single efficiency constant
could stand in for them.

### 7.2 What the model does *not* take from the catalogue

`freeCurrentA` is stored but **not consumed**. The mandated current model is
`I = (duty·V − k_e·ω)/R`, which returns 0 A at free speed where the datasheet
reports 0.25 A.

**Known bias.** Current, and therefore battery sag, is understated by roughly the
no-load current per motor — about 1 A across a four-motor drivetrain, or 2.5 % of
a 40 A load. Negligible at present. Reconciling it would mean interpolating
current between the two measured endpoints instead, which departs from the
specified formula; that change would be made deliberately, not silently.

### 7.3 Gearbox efficiency is not applied separately

Published stall torque is measured at the output shaft, so planetary losses are
already inside it. Back-calculating base-motor torque from each entry gives
1.27–1.52 kg·cm — the spread *is* the differing stage counts and efficiencies.
Applying a gearbox-efficiency term on top would count those losses twice. Only
the external belt reduction carries an efficiency term (§2.3).

---

## 8. Deliberately not modelled in Phase 1

| Effect | Why omitted | Consequence |
|---|---|---|
| Wheel slip / traction limit | Excluded by `PRODUCT_SPEC.md` §4 | Over-predicts acceleration (§2.1) |
| Strafe efficiency loss | Would require an invented coefficient | Over-predicts strafe performance (§2.2) |
| Rolling resistance | Would require an invented coefficient | Coasting is slightly optimistic (§2.4) |
| Contact friction | Would require a coefficient | Wall sliding sheds no speed (§5.1) |
| No-load current | Not in the specified current formula | Battery sag understated ~2.5 % (§7.2) |
| Motor heating / thermal derating | No datasheet basis; long-run effect | Sustained performance is optimistic |
| Motor controller current limiting | Firmware-dependent, unmeasured | Peak current may exceed real limits |
| Battery discharge over match time | Needs a discharge curve | `V_oc` is constant within a run |
| Centre-of-mass offset in the dynamics | Derived but not yet integrated | Robot rotates about its centroid (§9.2) |
| Continuous collision detection | Unnecessary at 200 Hz (§4.1) | Would matter only at much larger `dt` |
| Aerodynamic drag | Negligible at 2–3 m/s | None |

### 8.1 Net direction of the Phase 1 biases

Almost every omission above flatters the robot: no traction limit, no strafe
penalty, no rolling resistance, no contact friction, understated current, an
under-estimated moment of inertia. **Phase 1 numbers should be read as an
optimistic upper bound on what a design can do, not as a prediction of match
performance.** The acceleration figure is the least trustworthy of them.

---

## 9. Mechanisms

### 9.1 `PIECES_PER_OUTPUT_REVOLUTION` — mechanism throughput

| | |
|---|---|
| **Value** | `1` piece per revolution of the mechanism output |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/mechanism/mechanism.ts` |
| **Used by** | `throughputPerSec = outputRpm / 60 × PIECES_PER_OUTPUT_REVOLUTION` |

**Reasoning.** A mechanism's throughput has to come from its motor and gearing
rather than from a number the user types, or the statistics stop corresponding
to the design (`PRODUCT_SPEC.md` §14). One piece per output revolution is the
standard first-order model for a roller intake or an indexed feeder: each turn
of the roller sweeps one game piece through.

**Known bias.** Real intakes vary widely. A wide roller can take two or three
pieces per revolution; a single-slot indexer may need more than one revolution
per piece. The constant is therefore a *shape* — throughput proportional to
output speed — rather than a calibrated figure, and it is the reason a
throughput number should be read as relative rather than absolute in Phase 2.

**Extension path.** The natural refinement is a per-mechanism
`piecesPerRevolution` field once real games define real piece geometry in
Phase 3, at which point this global constant becomes its default.

### 9.2 Centre of mass with mechanisms

| | |
|---|---|
| **Model** | Uniform chassis at the centroid; each mechanism a point mass at its mount |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/mechanism/mechanism.ts` (`centreOfMassOffsetIn`) |

Supersedes §1.4 for robots that have mechanisms. The chassis keeps its
uniform-density treatment and contributes no moment; every mechanism is
collapsed to a point at its mount coordinates.

**Known bias.** A mechanism is not a point — a linear slide spans most of the
robot — so the offset is overstated for long mechanisms and understated for
compact ones mounted high. The vertical component is not modelled at all,
because the simulation is planar; a top-heavy robot tips in reality and cannot
here.

**Not yet consumed by the physics.** The offset is derived and reported, but the
rigid-body integrator still rotates about the geometric centre. Wiring it into
the dynamics is a Phase 3 change and is listed in §8.

### 9.3 Motor port budget

| | |
|---|---|
| **Value** | `TOTAL_MOTOR_PORTS = 8` |
| **Confidence** | **EXPLICIT** — FTC control-system hardware |
| **Location** | `src/core/mechanism/mechanism.ts` |

Four motor ports on a REV Control Hub plus four on an Expansion Hub. This is a
hardware fact rather than an estimate, and it is season-stable. It is the
constraint that stops a robot from having every mechanism at once, and therefore
one of the structural sources of the tradeoffs `PRODUCT_SPEC.md` §11 requires.

### 9.4 Mechanism preset template values

| | |
|---|---|
| **Values** | Per-template mass, motor choice, gearing and capability parameters |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/mechanism/presets.ts` |

Templates are authoring conveniences — a named starting point the user edits —
not calibrated designs. They divide into two kinds of value:

**Values the physics consumes today.** `massLb` and `actuation` are real inputs:
mass changes acceleration, motor count consumes ports. The masses (1–7 lb) are
plausible FTC subassembly weights but are **not** measured. A team should replace
them with their own CAD weights. Motor selection follows obvious engineering
logic rather than measurement — flywheels take the 1150 RPM unit, lifts and
climbers the 117/60 RPM units, intakes the 435 RPM unit.

**Values nothing consumes yet.** Capacity, reach, exit speed, launch angle,
spread, travel time, climb time and success rate are *declarative descriptors*.
No Phase 2 code reads them; they are consumed by the rules engine in Phase 3
once game pieces exist. They are recorded here so they are not later mistaken
for calibrated figures — an exit speed of 30 ft/s is a placeholder, not a
prediction.

**Consequence.** A mechanism's contribution to simulated performance in Phase 2
is entirely through mass and motor ports. Its throughput number is derived
(§9.1) and directional; its other capability figures are inert.

---

## 10. Game layer and the DECODE fixture

### 10.1 What is *not* assumed

Every DECODE point value, duration, artifact count and dimension in
`core/game/fixtures/decode.ts` is transcribed from the official *DECODE
Competition Manual* (Team Update 32) and carries a `Sourced` citation with the
page and a verbatim quote. A test asserts every entry in `DECODE_POINTS` has
confidence `explicit`. None of it is recalled.

Two findings worth recording because they contradict reasonable expectations:

| Finding | Evidence |
|---|---|
| **DECODE has no endgame.** The word appears zero times in the manual. BASE is assessed "at the end of the TELEOP". | §10.5 F; full-text search |
| **The AUTO→TELEOP gap is 8 s and is not a scoring period.** Total match length is 158 s, not 150 s. | §10.4 |

The second matters: achievements during the gap are explicitly "subject to
penalties" rather than points (§10.5), so the simulator scores nothing then.

### 10.2 DECODE cycle-time estimates

| | |
|---|---|
| **Values** | 2–6 s per objective, in `DECODE_OBJECTIVES` |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/game/fixtures/decode.ts` |

The manual states what actions are *worth*; it never states how long one takes.
Cycle times are required by the Phase 5 archetype generator to rank objectives,
so they are estimated and flagged. A test asserts every one is marked `assumed`.

**Known bias.** These are guesses about robot performance, not game facts. They
should be replaced with measured probe results (ARCHITECTURE.md §8.1) once
mechanisms can actually execute a cycle.

### 10.3 `PIECES_PER_OUTPUT_REVOLUTION` interaction

Nothing in the DECODE fixture depends on §9.1's throughput constant yet, because
mechanisms do not act on artifacts in Phase 3. When they do, artifact throughput
will inherit that assumption.

### 10.4 Logical world state is bookkeeping, not physics

| | |
|---|---|
| **Model** | `MatchRunner` tracks region membership, ordered slots and zone occupancy |
| **Confidence** | **ASSUMED** (a modelling choice, not a measurement) |
| **Location** | `src/core/game/matchRunner.ts` |

Games score things rigid-body physics does not express — "third artifact from
the gate on the ramp", "all support inside the base tile". The runner maintains
that as logical state fed by events, rather than trying to derive it from
geometry.

**Consequence.** Region and slot occupancy are only as accurate as the events a
simulation emits. In Phase 3 those events are scripted by tests; when the
physics layer emits them for real, the mapping from geometry to region
membership becomes a new source of error and will need its own entry here.

### 10.5 What is transcribed from the manual, and what is not

| Item | Status | Why |
|---|---|---|
| RP thresholds (Table 10-3) | **Transcribed** | `DECODE_RP_THRESHOLDS`, p.88, all three tiers |
| Penalty values (Table 10-4) | **Transcribed** | `DECODE_PENALTIES`, p.89 — values only; see §10.13 |
| Field element **sizes** | **Transcribed** | `decodeDimensions.ts`, every value with a page and a verbatim quote |
| ARTIFACT staging (§10.3.1) | **Transcribed** | `DECODE_SETUP`, p.81 — composition and arrangement per location; positions are still the CAD's |
| Field element **positions** | Not modelled | The manual gives the CAD model as authoritative and states illustration dimensions are nominal ±1 in — see §10.9 |
| ARTIFACT mass | Estimated | Confirmed absent from the manual — see §10.10 |
| Which actions draw a foul | Not modelled | Refereeing judgement — see §10.13 |
| RP eligibility rules (G206, G417, G418, G431) | Not modelled | Refereeing judgement — see §10.13 |
| AprilTag positions | Recorded only as ids | Navigation aid, not scoring |
| DEPOT tape as a LAUNCH LINE | Not modelled | See §10.12 |

Field geometry is the significant gap: DECODE regions currently exist as *ids*
that events reference, not as placed shapes. Scoring is correct; spatial
detection of when a piece enters a region is not yet implemented.

**Closed for the pipeline; open for the data.** `regions.ts` places geometry,
`membershipDetector.ts` turns membership changes into events, `SimWorld` carries
pieces as bodies, and `observation.ts` maps a snapshot onto detector
observations each tick. `MatchSimulation` runs the whole chain, so a score now
derives from a robot physically pushing a piece into a region.

What remains is not the pipeline but the *coordinates*: DECODE's field element
positions are still invented (§10.9). The engine applies DECODE's rules
correctly to whatever geometry it is given; it is given a placeholder.

**Sizes are now sourced.** `decodeDimensions.ts` transcribes every dimension the
Competition Manual publishes — field, tiles, tape, each zone, the GOAL and its
top lip, the CLASSIFIER, the ARTIFACT, the AprilTags and the OBELISK — each with
a page number and a verbatim quote. `decodeField.ts` builds the layout from
those extents, so the elements are the right size at guessed places rather than
guessed size at guessed places.

**The AUTO-to-TELEOP gap scores.** §10.5.A: "ARTIFACTS that meet scoring
criteria prior to the start of TELEOP are assessed as part of AUTO." The gap was
modelled as `PRE` — the same state as before the match — so an artifact still
rolling at 0:31 scored nothing, which is the opposite of what the 8 seconds are
for. `TRANSITION` is now its own match state, and which period it scores as is
read from `MatchStructure.transitionScoresAs` rather than assumed by the engine;
a game that does not say scores nothing there.

The earlier reading came from §10.5's "achievements scored ... during the
AUTO-to-TELEOP transition ... are subject to penalties", taken to mean "are
worth no points". It means the achievement counts *and* a referee may assess a
penalty — which is not simulated (§10.13).

**Staging is transcribed, and it reconciles.** §10.3.1 gives the complete
ARTIFACT staging — three SPIKE MARK rows carrying the three MOTIFS, three per
LOADING ZONE arranged PGP, six per ALLIANCE AREA with no set order, and up to
three pre-loaded per robot. Transcribed as composition rather than coordinates,
because that is the part the manual publishes.

It adds up to exactly 24 purple and 12 green, which §9.9 states on a different
page. `validateGameDefinition` enforces that reconciliation, so a mistranscribed
group fails at load rather than starting a match with 33 artifacts. The manual
also notes that staging may be adjusted for Championship and Premier events,
which is recorded in `provenanceNotes`.

**Scoring criteria are now the manual's, not an approximation of them.** §10.5.3
defines LEAVE and BASE as questions about a robot's *final position*, and both
rules were previously triggered by a boundary crossing — so a robot that left
the LAUNCH LINE and drove back still scored LEAVE, and a robot that touched BASE
mid-match and left still scored BASE. Both now trigger on an end-of-period
`RobotAssessed` fact. LEAVE additionally checks *every* LAUNCH LINE, not the
alliance's own, because the LAUNCH ZONES belong to the FIELD (§9.3).

### 10.6 Robot zone occupancy by corner sampling

| | |
|---|---|
| **Model** | Fraction of the robot's four footprint corners inside the zone |
| **Confidence** | **ASSUMED** (deliberate approximation) |
| **Location** | `src/core/game/regions.ts` (`robotSupportFraction`) |

The support fraction is quantised to 0, 0.25, 0.5, 0.75 or 1 rather than
computed by polygon clipping.

**Why this is enough.** Games do not ask for a continuous overlap fraction; they
ask "fully inside" or "partially inside" — DECODE's BASE is assessed exactly
that way (§10.5.3). Both endpoints are **exact** under corner sampling: for a
convex zone, all four corners inside means the whole footprint is inside, and
the robot's rotation is accounted for because the corners are taken in world
space.

**Known failure mode.** A zone small enough to sit entirely within the robot's
footprint touches none of its corners and reports zero overlap. No FTC zone is
smaller than a robot, so this does not arise today; it is asserted as a test so
the limitation stays visible rather than becoming folklore.

**Extension path.** Replace the body of `robotSupportFraction` with convex
polygon clipping. Every caller asks only for the fraction, so nothing else
changes.

### 10.7 The detector's snapshot contract

| | |
|---|---|
| **Model** | `update()` receives the **complete** set of observed objects for a tick |
| **Confidence** | **ASSUMED** (an interface contract, not a measurement) |
| **Location** | `src/core/game/membershipDetector.ts` |

An object previously seen and absent from a later snapshot is treated as having
left the field, and its exits are emitted for every region it occupied.

**Why this way round.** The alternative — treating absence as "unchanged" —
makes a piece that is consumed or removed silently remain in a goal forever,
which quietly inflates score. The chosen direction fails loudly instead: a caller
that reports only the objects that moved gets obviously wrong exit events rather
than a subtly wrong score.

**Consequence for callers.** Whatever eventually drives this from the simulation
must enumerate every piece and robot each tick, not just the ones that changed.

### 10.8 Zone occupancy buckets are duplicated, deliberately

| | |
|---|---|
| **Coupling** | `occupancyFor()` mirrors `MatchRunner.setZoneOccupancy` thresholds |
| **Confidence** | **ASSUMED** (a known duplication) |
| **Location** | `src/core/game/membershipDetector.ts`, `src/core/game/matchRunner.ts` |

Both classify a support fraction as *full* at `>= 1`, *partial* at `> 0` and
*outside* otherwise. The detector diffs on that bucket — so drifting from 0.25 to
0.5 support emits nothing, while 0.5 to 1.0 emits `RobotOverlapsZone` — because
the bucket is the entire zone state a predicate can observe.

**The hazard.** If the two thresholds ever diverge, the detector could report a
robot entering a zone the runner does not record it in, and a rule would silently
never fire. They are duplicated rather than shared because the runner takes a
fraction off an event while the detector computes one from geometry; extracting
a shared constant is the obvious fix if a third caller appears.

**Not lossy in the event.** The bucket decides *whether* to emit; the emitted
`supportFraction` is the real measured value, so a future consumer wanting finer
resolution is not stuck with a representative number invented to fit.

### 10.9 DECODE field element positions are invented

| | |
|---|---|
| **Status** | **Placeholder**, marked in code and asserted by test |
| **Location** | `src/core/game/fixtures/decodeField.ts` |

Every coordinate in the DECODE layout is made up — but only the coordinates.
Element **sizes** are transcribed from the manual with citations
(`decodeDimensions.ts`); what remains invented is where each correctly-sized
element sits.

The manual publishes no coordinate table: §9.4 defines TILE coordinates in
Figures 9-4 and 9-5, which are images, and §9.1 names the 3D CAD model as the
official representation with a ±1 in tolerance on anything measured from it.
`DECODE_LAYOUT_PROVENANCE` records the remaining gap as an `assumed` value and a
test asserts it stays that way.

**Consequence, precisely.** Distances between elements are wrong, so cycle times
and "did it reach the goal" outcomes are not predictive. Every "is it inside"
judgement is right relative to the placed geometry, and correct in absolute
terms once positions are supplied, because the extents being tested against are
the real ones.

**What this does and does not invalidate.** The rules, point values, timings and
piece counts are transcribed and cited; the end-to-end scores in
`decodeMatch.test.ts` verify the engine applies those rules correctly to the
positions it was given. They are not predictions of a real match. Region ids are
the contract between layout and rules, so correcting the coordinates changes no
rule.

### 10.10 ARTIFACT mass is estimated

| | |
|---|---|
| **Value** | `0.3 lb` |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/game/fixtures/decodeGame.ts` (`ARTIFACT_ESTIMATED_MASS_LB`) |

DECODE specifies ARTIFACT diameter (4.9 in ± 0.25) and material, but no weight,
and the physics needs one. This is an estimate for a hollow 5 in polypropylene
ball.

**Confirmed absent, not merely unfound.** §9.9 gives diameter, tolerance,
colour, part numbers (`am-3376a_purple` / `am-3376a_green`) and material —
"Gopher ResisDent polypropylene" — and no mass; searching the manual for a
weight returns nothing. `ARTIFACT_MASS_NOT_IN_MANUAL` in `decodeDimensions.ts`
records that as a fact about the source, so the estimate reads as filling a real
gap rather than as a failure to look. Resolving it needs the AndyMark product
spec for `am-3376a` or a weighed artifact — neither is in the supplied manual.

**Why it matters more than it looks.** Piece mass sets how far an artifact
travels when a robot strikes it, and with no piece damping (§5.5) a struck
artifact slides until it meets a wall. Every "did it reach the goal" outcome
therefore depends on this number. It is the single highest-value correction to
the DECODE fixture.

### 10.11 The assumption ledger for a game is derived

`gameDefinition.ts` walks a `GameDefinition` and reports every `Sourced` value
that is not `explicit`. ARCHITECTURE.md §6.1 promised the ledger would be a
projection over the definition rather than a document that drifts; that is now
true in code, and `provenanceSummary()` reports how much of a season is
transcribed versus estimated.

This section still records assumptions in the *engine*. Assumptions in a
*season* live in the definition and are read out of it.

**Two corrections the DECODE transcription forced.** The walker deduplicated
shared `Sourced` objects, so a value used by several fields was reported once —
DECODE's two ARTIFACT types share one estimated mass, and the ledger read as
though only one piece type was estimated. And a fact that belongs to the
definition rather than to any single field had nowhere to live, so the largest
gap in the fixture — the invented layout — appeared only in a source comment.
`provenanceNotes` now carries such statements, and both are asserted by test.

### 10.12 The DEPOT tape is a LAUNCH LINE, and is not modelled as one

| | |
|---|---|
| **Status** | **Known incompleteness**, recorded in code |
| **Location** | `src/core/game/fixtures/decode.ts` (`ALL_LAUNCH_LINE_ZONE_IDS`) |

§9.3 states plainly: "The DEPOT tape is a LAUNCH LINE". LEAVE is assessed
against being over *any* LAUNCH LINE (§10.5.3), so a robot parked over a DEPOT
at the end of AUTO does not qualify.

Here the DEPOT is a **region** — a place artifacts come to rest, which is what
the DEPOT scoring rule needs — and not a **zone**, which is what a robot's
support is measured against. So `ALL_LAUNCH_LINE_ZONE_IDS` names the two LAUNCH
ZONE placeholders only, and a robot over a DEPOT scores LEAVE here when it
would not on a real field.

**Why it is not simply fixed.** The DEPOT would need a zone as well as a region,
placed at the base of the GOAL — and its position is exactly what §10.9 says is
missing. Adding a zone at an invented position would replace a visible gap with
an invisible one. Fix this together with the layout, not before it.

### 10.13 Fouls and RP eligibility are outside what a simulator can assess

| | |
|---|---|
| **Status** | Values transcribed; triggers **not modelled** |
| **Location** | `src/core/game/fixtures/decode.ts` (`DECODE_PENALTIES`, `DECODE_RANKING_POINT_RULES`) |

Table 10-4 (p.89) gives the point values, and they are transcribed: a MINOR FOUL
credits 5 points to the opponent, a MAJOR FOUL 15. Note the direction — a foul
*credits the opponent* rather than deducting from the violator, so a penalised
alliance's own score is unchanged.

What is not modelled is *which actions draw a foul*, and that is a limit of the
simulator rather than an omission from the manual. The manual says it directly:
"All rules throughout the Game Rules section are called as perceived by a
REFEREE" (p.89). The benchmarks are explicitly qualitative — MOMENTARY is
"fewer than approximately 3 seconds", PERSISTENT and REPEATED are judgement —
and most violations turn on intent (G205 throwing a match, G206 colluding) or on
contact assessments no geometric predicate settles. `DECODE_SCORING_RULES`
therefore contains no penalty rule, and a test asserts it stays that way.

The same applies to the several rules that make an alliance *ineligible* for a
ranking point (G206, G417, G418, G431): the thresholds are transcribed and
`rankingPointsFor` applies them, but eligibility is a referee's call.

**Ranking points are recorded, not scored.** They are on the definition
(`rankingPoints`) rather than in the rule set, because an RP is a threshold on a
match total — which no event carries — and depends on the event tier, which is
not part of the game. Table 10-3 gives three tiers, and the manual states that
two of them are provisional ("will be announced in Team Updates") and that
Premier Events set their own; `rankingPointsFor` therefore throws on an unknown
tier rather than defaulting, since a silent default would score a Championship
match against the lowest bar.

---

## 11. Revision log

| Date | Change |
|---|---|
| 2026-08-24 | Ledger created for Phase 1. |
| 2026-08-24 | Added §2.5 (efficiency direction), §5 (collision and contact), §6 (input), §7 (motor catalogue provenance and cross-checks), §8.1 (net bias direction) as the corresponding code landed. |
| 2026-08-24 | Motor catalogue extended from 5 to 10 verified entries, including the 1:1 base motor. Base free speed and base stall torque are now datasheet-read rather than inferred; added the implied-gearbox-efficiency integrity check (§7.1). |
| 2026-08-24 | Added §9 (mechanisms): throughput constant, centre-of-mass model with mechanisms, motor port budget. Centre-of-mass entry supersedes §1.4 for robots carrying mechanisms. |
| 2026-08-25 | Added §10 (game layer and DECODE fixture): what is transcribed vs assumed, DECODE cycle-time estimates, logical world-state bookkeeping, and what was deliberately not transcribed from the manual. |
| 2026-08-25 | Added §10.6 (corner-sampled zone occupancy) as region geometry landed; §10.5 updated to record that regions now have placed shapes but nothing emits events from them yet. |
| 2026-08-25 | Added §10.7 (detector snapshot contract) and §10.8 (duplicated zone-occupancy thresholds) as the membership detector landed; §10.5 narrowed to the remaining gap, piece bodies. |
| 2026-08-25 | Competition Manual (Team Update 32) supplied and treated as authoritative. Every DECODE dimension it publishes transcribed into `decodeDimensions.ts` with a page number and verbatim quote; `decodeField.ts` rebuilt on those extents. §10.9 narrowed from "the layout is invented" to "the positions are invented"; §10.10 narrowed to record that ARTIFACT mass is confirmed absent from the manual rather than merely unfound. |
| 2026-08-25 | RP thresholds (Table 10-3) and penalty values (Table 10-4) transcribed, closing the last `unresolved` value in the DECODE definition; §10.5 table rewritten and §10.13 added for what refereeing judgement puts out of reach. |
| 2026-08-25 | ARTIFACT staging transcribed from §10.3.1 into a season-agnostic `MatchSetupSpec`, cross-checked against the declared piece counts by `validateGameDefinition`. |
| 2026-08-25 | AUTO-to-TELEOP transition corrected against §10.5.A: it is now its own `TRANSITION` match state and scores as the period the game declares, where it was previously `PRE` and scored nothing. |
| 2026-08-25 | Assumption ledger corrected: shared `Sourced` values are now reported at every path that uses them, and `provenanceNotes` carries statements that belong to a definition rather than to one field — so the invented layout and the estimated mass on both piece types now appear in `assumptionLedger(DECODE_GAME)`. |
| 2026-08-25 | LEAVE and BASE corrected against §10.5.3: both are assessed on a robot's final position, and LEAVE checks every LAUNCH LINE rather than the alliance's own. Added §10.12 for the DEPOT tape, which the manual makes a LAUNCH LINE and which this model cannot yet treat as one. |
| 2026-08-25 | Added §5.5 (pieces have no damping) and §5.6 (a pinned piece escapes the field — known resolver defect, asserted by test) as game pieces became entities; §10.5 narrowed to the snapshot-to-observation join. |
| 2026-08-25 | Phase 3 pipeline closed end to end. Added §10.9 (DECODE positions invented), §10.10 (ARTIFACT mass estimated), §10.11 (per-season ledger is derived by walking the GameDefinition); §10.5 narrowed from the pipeline to the coordinates. |
| 2026-08-24 | Added §9.4 recording that mechanism preset templates are editable starting points: mass and actuation feed the physics, the remaining capability parameters are inert until Phase 3. |

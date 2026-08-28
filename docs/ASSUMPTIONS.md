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

### 2.2 Roller-path resistance `MECANUM_ROLLER_DRAG_N_PER_MPS`

| | |
|---|---|
| **Value** | `3.757` N per m/s of roller slip |
| **Confidence** | **ASSUMED** (one scalar; the direction dependence is derived) |
| **Location** | `src/core/drive/drivetrain.ts`, `src/core/drive/mecanumKinematics.ts` |

Real mecanum drivetrains strafe measurably slower than they drive forward. The
hub kinematics do not explain it: ideal 45° mecanum with the Jacobian-transpose
force mapping gives `|F_x| = |F_y| = 4F`, identical acceleration and identical
top speed in every direction. That symmetry is a genuine theorem about the hub,
and this ledger previously recorded it as an idealisation with no fix available
short of an invented traction coefficient.

**What was missing was the second degree of freedom.** A mecanum wheel has two:
the hub, which the motor drives, and the rollers, which spin freely about axes
45° to it. Splitting the contact velocity along the roller axis `â` and the
perpendicular `û`,

```
v_c = (ω_wheel · r) x̂ + s û        ⇒   s = v_c·û − ω_wheel·r (x̂·û)
```

and substituting the inverse kinematics collapses to

```
s_FL = s_FR = √2 (v_y + a·ω)
s_BL = s_BR = √2 (v_y − a·ω)
```

with **no `v_x` term**. Driving straight ahead, a mecanum wheel's rollers do not
turn at all — it rolls like a plain wheel. Strafing, they turn at `√2` times the
chassis speed. So any resistance in the roller path is *geometrically* confined
to lateral motion and yaw.

**What is assumed is one scalar**, the resistance itself: rollers are small,
barrel-shaped and carried on short bearings, and turning them costs something.
The direction dependence is not assumed — it falls out of the 45° geometry
above.

**Why this is not a friction coefficient.** `IdealTraction` remains the identity
function and no friction or traction coefficient exists anywhere in the
codebase (§2.1). This is a resistance *inside* the drivetrain, a sibling of
`DRIVETRAIN_EFFICIENCY` (§2.3), applied as a force before integration. Top speed
stays emergent: the robot accelerates until motor force balances roller drag,
and nothing anywhere reads a maximum speed.

**Mapped by Jacobian transpose, deliberately.** Roller slip is a linear function
of chassis velocity, so a force conjugate to it maps back through the transpose
of that map — the same discipline the wheel forces already follow. This is not
merely tidy: it makes the result provably dissipative, `P = s·f = −c Σ s² ≤ 0`,
for any chassis motion. Assembling the four contact forces by hand instead
produces a yaw term proportional to `(halfTrack − halfWheelbase)` that *injects*
energy into a chassis wider than it is long.

**Effect on the reference robot** (18 in, 4 × 312 RPM, 96 mm wheels, 12 V):

| Quantity | Before | After |
|---|---|---|
| Forward free speed | 1.5685 m/s | 1.5685 m/s (unchanged, exactly) |
| Peak acceleration | 12.996 m/s² | 12.996 m/s² (unchanged, exactly) |
| Strafe settling speed | 1.5685 m/s | 1.2549 m/s (0.80 ×) |
| Spin rate | 228.3 °/s | 214.8 °/s |

**Calibrating it.** The value was chosen to put the reference robot at a
strafe/forward ratio of 0.80, which is mid-range for what FTC teams report. From
a measured robot,

```
c = (k_t k_e G² η) / (2 R r²) · (v_forward / v_strafe − 1)
```

Because `c` is a property of the wheel rather than of the robot, the resulting
ratio varies with the drivetrain — a heavily geared robot overcomes roller drag
more easily and strafes relatively faster, which is the right direction.

**Known limitation.** The drag force is independent of normal load, so a heavier
robot pays the same absolute resistance. Making it load-dependent would be a
friction coefficient, which §2.1 excludes. The consequence is that the
strafe/forward ratio does not vary with robot mass.

### 2.2.1 Arc driving is slower, and both reasons are emergent

| | |
|---|---|
| **Behaviour** | Forward speed while turning settles near `v_free / (1 + |turn|)` |
| **Confidence** | **Derived** — no constant, no correction |
| **Location** | `src/core/drive/mecanumKinematics.ts`, asserted in `arcDrive.test.ts` |

Commanding forward and turn together is visibly slower than driving straight.
Investigated in full — `ControlInput` through mixing, saturation, wheel speeds,
motor torque, wheel forces and the body wrench — and no implementation error
exists. Two effects account for it exactly.

**Saturation, which is most of it.** `commandToWheels(1, 0, t)` asks `1 + t` of
the outside wheels, and a duty cycle cannot exceed 1. `saturate` divides all
four by that peak so the commanded direction survives (PRODUCT_SPEC.md §6),
scaling the forward component to `1 / (1 + t)`. Each motor settles where its own
torque reaches zero, so its wheel settles at `duty x v_free` and the chassis at
the *mean* of the saturated duties times free speed. Clipping wheels
individually instead would curve a robot that asked to go straight.

**The centripetal term, which is the remaining few percent.** A robot on a
circular path needs a force toward the centre, and its wheels are the only
source. A mecanum makes lateral force by running wheels at unequal speeds, so an
arcing robot **crabs**: it carries a small body-frame `v_y` that nothing
commanded. In the body frame the steady state is `Fx = -m w vy` and
`Fy = m w vx`; the second fixes `v_y` with no free parameter, and the first
costs the small extra forward speed. Measured against the prediction to three
decimals for turn commands of 0.25, 0.5 and 1.

**Not a defect, and deliberately not corrected.** The wheel speeds reproduce the
chassis velocity through the forward kinematics to nine decimals at every turn
command tested, which is the check that would fail first if duties were paired
to the wrong wheels or a torque were evaluated at the wrong speed.

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
friction coefficient of any kind (`PRODUCT_SPEC.md` §4). Where the normal
impulse acts is a separate question, answered in §5.7.

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

### 5.5 ARTIFACT contacts and rolling are modestly inelastic

| | |
|---|---|
| **Value** | contact restitution `0.20`; floor-roll deceleration `20 in/s²` (`0.508 m/s²`) |
| **Confidence** | **INFERRED** from dSim's published game-ball configuration; not an FTC manual dimension |
| **Location** | `src/core/sim/simWorld.ts` |

ARTIFACTS need to form a useful queue in the GOAL classifier and SECRET TUNNEL:
an entirely elastic ball keeps artificial gaps alive, while a fully inelastic
one looks like clay. The piece material therefore retains 20% of approach speed
along a ball↔ball or ball↔static-field contact and loses `20 in/s²` of loose,
floor-level rolling speed. This is limited in `SimWorld` to `piece↔piece` and
`piece↔static` contacts; a robot↔wall or robot↔piece contact calls the unchanged
default resolver. Drivetrain coasting, BRAKE behavior and robot collision
response do not read either constant.

It is an observable gameplay calibration, not a generic friction model. The
only reason it exists is to let loose ARTIFACTS settle and pack after impacts;
it is deliberately not applied to the drivetrain or to arbitrary dynamic
bodies. Focused tests cover the material rebound, rolling loss and the fact
that robot collision defaults are unaffected.

### 5.6 A piece pinned against a wall escapes the field — **fixed, see §5.8**

| | |
|---|---|
| **Status** | **Fixed.** Kept for the record; §5.8 has the fix |
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

**Closed by §5.8.** The manifold work of §5.7 sweeps within a contact; what this
needed was sweeping *across* pairs, plus a perimeter body thick enough that a
squeezed circle cannot get its centre past the far face.

### 5.7 Contact manifolds and normal-solver sweeps

| | |
|---|---|
| **Values** | up to 2 manifold points per polygon pair; `NORMAL_SOLVER_SWEEPS = 8`; `REFERENCE_FACE_TIE_TOLERANCE = 1e-9 m` |
| **Confidence** | **ASSUMED** (numerical, not physical) |
| **Location** | `src/core/physics/sat.ts`, `src/core/physics/resolve.ts` |

**Why a manifold exists at all.** A contact normal says which way to push; it
does not say where. `polyPoly` originally answered "where" with the deepest
vertex of B along the normal, averaging ties — and against the perimeter, the
tied vertices are the wall's whole inner face, so the answer was the middle of
the wall. A robot meeting the east wall square-on at y = 0.5 m took its stopping
impulse through a 0.5 m lever arm and left the contact at −2.5 rad/s, sliding
the length of the field. The narrowphase now clips the incident face to the
reference face's extent, which is the region the shapes actually share.

**Why two points and not one.** A face-on contact resolved at both ends of the
touching face has two impulses whose torques cancel, so a squared-up robot is
stopped rather than spun. A corner contact still clips to a single point and
still rotates the robot, which is the real behaviour and is what squares a robot
up against a wall it hits at an angle.

**Why eight sweeps.** The two points of a face-on manifold are coupled through
the body's rotation, so solving each once leaves a residual spin — about
0.5 rad/s per m/s of approach for this robot, which is visible. Gauss-Seidel on
the 2x2 normal system converges at a rate of `(k12/k11)^2`, roughly 0.04 for an
18 in robot, so eight sweeps is far past diminishing returns and still costs
nothing at the handful of contacts an FTC field produces. Impulses accumulate
across sweeps and are clamped non-negative, so a contact can be corrected
downward without ever becoming a pull.

**Why a tie tolerance.** Two boxes meeting exactly flat report identical
separations for A's face and B's face. Preferring A unless B is shallower by
more than 1 nm makes the reference-face choice a function of argument order
rather than of floating-point noise, which is what keeps `collide` reproducible
— and argument order is already fixed by the id sort in the broadphase.

**Not physical.** None of the three values changes where a body comes to rest by
more than the penetration slop of §5.3. They change how faithfully the resolver
solves the contact it was given.

### 5.8 Multi-pass contact resolution and perimeter thickness

| | |
|---|---|
| **Values** | `CONTACT_PASSES = 4`; `WALL_THICKNESS_IN = 12` (was 2) |
| **Confidence** | **ASSUMED** (numerical and modelling, not physical) |
| **Location** | `src/core/sim/simWorld.ts`, `src/core/field/fieldTemplate.ts` |

Together these close §5.6, and each is useless without the other.

**Passes over the contact set.** Resolution used to visit every pair once. That
is enough for a body with one contact and wrong for a body with two, because the
correction for one contact is computed without knowing about the other. A game
piece pinned between a driving robot and the perimeter has two, and so does a
robot in a corner. Four passes let neighbouring contacts see each other's work;
the sweep stops early when a pass finds nothing touching, so an uncontested tick
costs one pass. Narrowphase re-runs each pass because the previous one moved
bodies; broadphase does not, because a positional correction is bounded by the
penetration it removes and cannot carry a body into a cell it was not already
overlapping.

Measured: a robot driven diagonally into a corner now settles at exactly the
corner with a residual speed of 2e-24 m/s and no heading change.

**Perimeter thickness.** Passes alone did not fix the pinned piece, and the
reason was elsewhere. `circlePoly` pushes a circle whose centre is *inside* a
polygon out through the nearest face. A 2 in wall is thinner than a 4.9 in
artifact, so a squeezed piece could get its centre past the wall's midline — at
which point the nearest face is the outer one and the resolver ejected the piece
out of the field, accelerating.

Only the wall's *inner face* is gameplay; the walls are placed outside the
playing area, so the interior measures exactly 144 in whatever the thickness.
12 in exceeds any FTC scoring element, so no piece can be squeezed far enough to
flip which face is nearest, and it is about the depth of the real perimeter
structure rather than a number chosen to be large.

**What is still true.** The squeeze remains geometrically unsatisfiable: no
position separates a piece from both a robot and a wall that are closer together
than its diameter. The piece is now nudged sideways instead — which is what a
real one does — then slows under the deliberately modest artifact-only rolling
loss (§5.5) until it meets something. The
test asserts it stays inside the field over thirty further seconds of the robot
driving into it, rather than asserting a resting position it does not have.

### 5.9 Piece flight is 2.5D, with no air resistance

| | |
|---|---|
| **Model** | Height and climb rate integrated separately from the planar body |
| **Values** | `g = 9.80665` (SI standard); no drag; restitution 0 |
| **Confidence** | **Derived**, except the omission of drag |
| **Location** | `src/core/physics/ballistics.ts`, `src/core/sim/simWorld.ts` |

Robots never leave the floor and launched game pieces do, so a piece carries one
extra degree of freedom rather than the physics gaining a third dimension it
would not use. With no air resistance the horizontal and vertical components of
projectile motion are independent, so integrating them separately is **exact**
rather than an approximation, and the same semi-implicit Euler runs on both.

Two closed forms — range `v² sin 2θ / g` and apex `v² sin²θ / 2g` — back the
tests, the way `analyticFreeSpeed` backs the drivetrain. The measured apex sits
below the true one by exactly `v_vertical · dt / 2`, the same symplectic
half-step offset the planar integrator carries (§4.2), and the test asserts that
identity rather than a tolerance.

**Vertical spans were already there.** Bodies have carried a `VerticalSpan`
since Phase 1 and a pair collides only if their spans overlap. That was written
so a low robot could drive under a raised element; it is what makes a ball in
flight pass over a robot with no new collision code, and a piece's span now
rises with it.

**No drag, and why.** A 5 in polypropylene ball at 30 ft/s sits near Re 1.5e5
with a drag coefficient around 0.5, costing a few percent of range across an FTC
field. Modelling it needs a drag coefficient and a spin model, and neither is
published for this piece. The separate floor-level artifact rolling loss is a
gameplay calibration recorded in §5.5, not an aerodynamic model.
**Known bias:** launched pieces fly slightly further and flatter than real ones,
and the error grows with range.

**Modest bounce.** ARTIFACT horizontal contacts use the material value in §5.5;
vertical landings use the same `0.20` restitution and `stepVertical`'s
minimum-bounce floor so repeated low bounces terminate instead of jittering.

### 5.10 Scoring through a GOAL is gated on height, not proximity

| | |
|---|---|
| **Model** | The GOAL region's floor is the top lip, 38.75 in (§9.7) |
| **Confidence** | **EXPLICIT** (the lip height); the region is where §9.7 puts it |
| **Location** | `src/core/game/fixtures/decodeField.ts` |

CLASSIFIED and OVERFLOW used to trigger on a piece reaching the RAMP, which a
robot could do by shoving an artifact along the floor. The GOAL is now a region
whose vertical span starts at its top lip, so entering it means going *over* it.
The RAMP below is unchanged: it is where pieces come to rest, where capacity is
measured and where PATTERN reads them.

That makes shooting a skill the simulation actually tests — a shot has to clear
0.98 m at the range it is taken from — and it is asserted both ways: a shot
scores, and the same artifact pushed across the tiles into the RAMP scores
nothing.


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

Almost every omission above flatters the robot: no traction limit, no rolling
resistance, no contact friction, understated current, an under-estimated moment
of inertia. The strafe penalty is no longer among them (§2.2). **Phase 1 numbers should be read as an
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

**Values the physics consumes as of the mechanism pass.** Capacity, reach, mouth
width, roller diameter, exit speed, launch angle, spread, flywheel diameter and
mass, transfer ratio and shoot-on-move compensation are now all read by real
mechanism physics (§9.5–§9.7). They remain *editable starting points* rather than
measurements — an exit speed of 30 ft/s is a plausible FTC shooter, not a
prediction — but changing one now changes what the simulation does, which is the
point.

**Values still inert.** Elevate travel time, climb time and success rate are
declarative descriptors; no code reads them yet.

**Consequence.** A mechanism's contribution to simulated performance in Phase 2
is entirely through mass and motor ports. Its throughput number is derived
(§9.1) and directional; its other capability figures are inert.

---

### 9.5 Flywheel transfer ratio, inertia and shot energy

| | |
|---|---|
| **Values** | `transferRatio` (0.5 hooded / 1.0 dual), `I = ½mr²`, `E = mv²(0.5 + 0.2((1−t)/t)²)` |
| **Confidence** | **DERIVED**, with one geometric declaration |
| **Location** | `src/core/mechanism/flywheel.ts` |

A shooter is a rotating inertia driven by the same `k_t`/`k_e`/`R` motor model
the drivetrain uses (§7). Everything a shooter is usually given as a constant is
computed here instead:

- **Exit speed.** A ball squeezed between a surface moving at `v₁` and one moving
  at `v₂` leaves with its centre at `(v₁+v₂)/2`, because the contact points must
  match the surfaces and the centre is midway between them. One wheel against a
  fixed hood gives half the surface speed; two counter-rotating wheels give all
  of it. `transferRatio` names which build it is — a *geometric* property of the
  design, not an efficiency fudge.
- **Spin-up.** `J dω/dt = kT·G·η·N·(duty·V − kE·G·ω)/R` is first order, with
  steady state `duty·V/(kE·G)` and time constant `J·R/(kT·kE·G²·η·N)`. There is
  no `spinUpTimeSec`; the test measures the integrator against that closed form.
- **Recovery.** A shot carries away `E = ½mv² + ⅕mv²(1−t)²/t²` — translation plus
  the backspin the transfer imparts — and that energy comes out of the wheel:
  `½Jω'² = ½Jω² − E`. So fire rate, shot-to-shot consistency and the value of a
  heavy wheel all fall out of conservation of energy. There is no cooldown
  constant anywhere in the shooter.
- **Duty.** Full power below target, then exactly `ω_target·kE·G/V` — the duty
  whose back-EMF balances the target. That is the steady state of the motor
  equation, so the controller contributes no gain of its own.

**The one declaration.** The wheel is treated as a solid disc, `I = ½mr²`. Every
FTC flywheel is closer to a disc than to a ring, and the alternative is to ask a
user for a second geometry figure they have no way to measure. A ring would give
twice the inertia, so this errs toward a wheel that spins up fast and recovers
fast.

**Consequence.** A target exit speed above what the motor can reach is simply
never reached — the wheel saturates at its own free speed and the shot falls
short. That is deliberate: an unreachable design should be visible to the
builder rather than quietly granted.

---

### 9.6 Intake roller force, and why collection has no timer

| | |
|---|---|
| **Values** | `ROLLER_TRANSFER_RATIO = 0.5`, `F_max = τ/r`, `v_drive = ωr/2` |
| **Confidence** | **DERIVED** |
| **Location** | `src/core/mechanism/intake.ts` |

The intake applies a real force to a real body, derived exactly the way the
drivetrain derives wheel force: torque at the output over the radius it acts at.
The roller drives the piece's velocity *relative to the robot* toward half the
roller's surface speed — the same pinch geometry as §9.5, a ball between a
moving roller and a stationary surface — and the force is whatever that demands,
capped at `τ/r`.

**There is no acquisition rate and no capture probability.** How long collecting
takes is however long that force needs to move that mass across the mouth, so
gearing an intake down genuinely slows it: surface speed falls and grip rises,
both off the one number. A test asserts a geared-down intake takes longer on the
same ball.

**Capture is contact, not a threshold.** A piece is collected once it is inside
the robot's footprint grown by its own radius, which is exactly "resting against
the robot" and needs no tolerance of its own.

**What is declared rather than derived:** the mouth's `reachIn` and
`mouthWidthIn`, and the `rollerDiameterIn`. These are geometry — the shape of a
design — and belong to the user the same way chassis length does. Preset values
follow §9.4: editable starting points, not measurements.

---

### 9.7 Shot accuracy is a velocity, never a probability

| | |
|---|---|
| **Values** | mechanical `spreadDeg`; carried velocity `v + ω×r`; transit time `D/v` |
| **Confidence** | **DERIVED**, with one declared length scale |
| **Location** | `src/core/sim/shooter.ts` |

There is no hit probability anywhere in this simulator. A shot is composed into a
velocity, it flies (§5.9), and it lands where it lands. Three terms decide it and
only the first is random:

1. **Mechanical spread.** A uniform cone of `spreadDeg`, drawn from the world's
   seeded `Launch` sub-stream so a replay reproduces every shot. This is the
   shooter's own repeatability — compression, ball seam, feed alignment.
2. **Carried velocity.** A ball leaving a moving robot keeps the robot's velocity
   *at the muzzle*, `v + ω×r`. This is exact and is not a penalty: it is what
   leaving a moving vehicle means. A robot strafing at 1 m/s while shooting at
   8 m/s throws the ball `atan(1/8) ≈ 7°` off.
3. **Yaw during transit.** The robot turns while the ball is being accelerated,
   so the ball leaves pointing where the barrel had got to.

`shootOnMoveCompensation` ∈ [0,1] cancels a fraction of (2) and (3) — a shooter
that measures its own motion aims off to compensate. What is left is a real
velocity error. Stationary is best, slow movement degrades a little, fast
movement degrades a lot, and a high compensation reduces it, all without a
percentage being subtracted anywhere.

**The declared length scale.** Transit time is taken as `D/v`: the ball travels
about its own radius through the acceleration zone at a mean speed of `v/2`. It
is the only figure in the accuracy model that is not measured, it is bounded by
the ball's own size, and it only ever matters for a robot firing while turning.
A shooter with a longer acceleration zone would smear more; one with a shorter
zone, less.

**What is not modelled:** a turret. The shooter fires along its mount facing, so
the driver aims by turning the robot. Adding a turret would be a second
capability rather than a change here.

---

### 9.8 A held piece is carried kinematically

| | |
|---|---|
| **Value** | Held pieces are placed at hopper slots and excluded from contact |
| **Confidence** | **ASSUMED** |
| **Location** | `src/core/sim/simWorld.ts` |

A collected piece stays a real body — still counted, still drawn, still there
when the robot lets go — but it stops being integrated. Each tick it is placed at
its slot in the robot's body frame and given the robot's velocity *at that slot*,
`v + ω×r`, so a piece released by a spinning robot leaves with the velocity it
really had.

It is skipped by contact resolution, because a piece inside the robot holding it
has no contact worth resolving: it is held by a mechanism, not resting against a
surface. Letting the solver see it pushed it straight back out of the hopper,
which is how this was found.

**Consequence.** A robot's hopper is rigid: pieces do not jostle, and a violent
collision cannot shake one loose. Capacity is enforced by count rather than by
whether they physically fit. Both err toward a robot that keeps what it collects.

**What *is* physical about it:** the mass is real and rides on the robot, the
reaction force from the intake roller is applied to the robot (Newton's third
law), and firing applies the equal and opposite impulse — a 75 g ball at 9 m/s
shifts a 15 kg robot by 45 mm/s.

---

### 9.9 Functionality-first mechanism model

| | |
|---|---|
| **Model** | Deterministic capability and state transitions |
| **Confidence** | **PRODUCT DECISION** |
| **Location** | `core/sim/robotMechanisms.ts`, `core/game/matchSimulation.ts` |

The simulator models the observable game result, not the internal mechanics of
an intake or shooter. The active path is:

`FIELD → HELD (capacity-limited storage) → GATE → launch action → game-defined destination → rules → score`.

An eligible piece centred in an active intake mouth is acquired immediately.
Outtake releases the oldest stored piece. An enabled shooter is ready
immediately; one rising-edge fire command with the gate open consumes one
eligible stored piece. A `GameDefinition` supplies the deterministic action
route, and normal region-membership events let the rules engine determine the
score. No UI or mechanism directly changes a score.

This supersedes the experimental mechanism-physics assumptions in §§9.1 and
9.4–9.8: there is no roller-force acquisition model, flywheel energy/RPM
model, launch velocity, projectile trajectory, accuracy RNG, recoil, or
shoot-on-move correction. These effects do not create a needed match behavior
in the current product and are intentionally absent. Drivetrain and collision
models remain only where they make driver navigation and field constraints
observable.

**A visible flight is not a reintroduction of that physics.**
`MatchSimulation.drainLaunchAnimations()` and `fieldRenderer.ts`'s
`ShotAnimation` (added alongside §10.16/§10.17) draw a piece travelling from
its launch point to its already-resolved destination over a fixed wall-clock
duration, with a cosmetic parabolic lift. The piece has already completed its
one deterministic `HELD → destination` transition before either exists; a
caller that never asks for them changes nothing about the match. No velocity,
no spread, no RNG informs where the piece ends up — only how long the picture
takes to catch up.

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

### 10.9 DECODE field element positions — transcribed, except the GOAL cluster

| | |
|---|---|
| **Status** | Placed from the Event FIELD Setup Guide, except GOAL/RAMP/DEPOT |
| **Location** | `src/core/game/fixtures/decodeTiles.ts`, `decodeField.ts` |

Every coordinate in this layout used to be made up, because the Competition
Manual publishes no coordinate table: §9.4 defines TILE coordinates in Figures
9-4 and 9-5, which are images, and §9.1 names the CAD model as the official
representation.

The **Event FIELD Setup Guide** publishes the same grid *in text* and places
almost every element against it — "The red BASE ZONE is on TILE B2", "SPIKE
MARKS are placed on TILE pairs A4/B4, A3/B3, and A2/B2, each spanning TILE seam
V", "16.75 in. away from the inside of TILE seam V". Those are transcriptions.

**Now sourced:** both LAUNCH LINES, the six SPIKE MARKS, the BASE ZONES, GATE
ZONES, LOADING ZONES and SECRET TUNNEL ZONES.

**The orientation, and how it was settled.** §9.5 puts the red ALLIANCE AREA on
the audience's left; G402 puts blue in columns A-C. Both hold only if column A
is the audience's *right*, so the lettering runs right to left. Two independent
checks confirm it: the guide's "TILE intersection X3" lands on the field centre
and "X1" one TILE in from the audience wall, which is exactly where it puts each
LAUNCH LINE apex.

**A confirmation worth recording.** The LAUNCH ZONE outline was `inferred` from
§9.3 as isosceles with its apex toward the centre. The guide describes the same
shape directly — a "V" from the back corners to the centre point — so it is now
`explicit`. The earlier inference was right.

**A conflict, decided and recorded.** The guide's colour labels put the red BASE
ZONE and red SECRET TUNNEL in columns A-B, contradicting G402 *and* its own GATE
ZONE labels. The Competition Manual wins as the rules document, and the cost of
being wrong is bounded: the guide states the field is "symmetrical from right to
left", so a mistaken assignment mirrors the colours and changes no distance,
shape or rule. `DECODE_SETUP_GUIDE_COLOUR_CONFLICT` carries it.

**Still not transcribed: the GOAL, RAMP and DEPOT.** The guide installs them by
figure. They are *constrained* rather than invented — the GATE ZONE fixes the
CLASSIFIER's low end at the side wall on seam 3, the SECRET TUNNEL is "bounded
by ... the GOAL assembly" at its far end, and the GOAL brackets slip over the
perimeter — so the GOAL is in the back corner with the RAMP climbing to it. How
far along that wall is the remaining freedom, and the full-field CAD (am-5700)
would settle it. `GOAL_CLUSTER_PROVENANCE` records this as `inferred`.

**Consequence.** Distances to the GOAL are approximate, so cycle times are not
yet predictive. Everything else is placed where the field places it.

### 10.9.1 Superseded: positions were invented

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
travels when a robot strikes it; the artifact-only roll loss (§5.5) bounds that
travel, but the initial collision still depends on this number. It remains the
single highest-value correction to the DECODE fixture.

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

### 10.15 OVERFLOW is a capacity outcome, and the skip case is not modelled

| | |
|---|---|
| **Model** | CLASSIFIED and OVERFLOW are one arrival at the RAMP, split by capacity |
| **Confidence** | **EXPLICIT** for the capacity rule; the skip case is **not modelled** |
| **Location** | `src/core/game/fixtures/decode.ts` (`RAMP_ARRIVAL`) |

The glossary makes both outcomes properties of a single arrival: CLASSIFIED is
"an ARTIFACT that passes through the SQUARE and transitions directly to the
RAMP", OVERFLOW is "an ARTIFACT that passes through the SQUARE but does not meet
CLASSIFIED criteria", and §9.8.2 gives the criterion — "The RAMP can fit up to 9
CLASSIFIED ARTIFACTS before newly entered ARTIFACTS will OVERFLOW."

**What was wrong.** OVERFLOW was a second region with invented coordinates, so
an artifact scored it by reaching a made-up patch of floor, and a tenth artifact
arriving at a full RAMP still scored CLASSIFIED because nothing checked
capacity. Both rules now trigger on the same arrival and are told apart by
whether the RAMP still had room, which *deletes* a set of invented coordinates
rather than adding any.

**Not modelled.** §9.8.2 also says an artifact "LAUNCHED into the GOAL at a high
velocity or with significant spin may skip over the 9th open CLASSIFIER slot and
count as OVERFLOW", and calls that normal FIELD operation rather than a fault.
That outcome is stochastic and depends on a launch this simulator cannot yet
make, so a full RAMP is the only route to OVERFLOW here. The consequence is
that OVERFLOW is under-reported relative to a real match.

**A bug this exposed.** `regionContents` held piece *types* and was appended to
both when a piece entered a region and when it came to rest there, so a region
appeared to hold twice what it did and `consumePiece` searched a list of colours
for an id. Nothing read more than its length, so nothing noticed until a rule
asked about capacity. It now holds piece ids, once each.

### 10.14 Possession is decided from contact and motion, not intent

| | |
|---|---|
| **Model** | A robot possesses a piece when it is touching it and driving into it |
| **Values** | `DEFAULT_CONTACT_TOLERANCE_M = 0.005`, `DEFAULT_MIN_PUSH_SPEED_MPS = 0.05`, `DEFAULT_RELEASE_GRACE_TICKS = 10` |
| **Confidence** | **ASSUMED** (the thresholds; the *shape* follows the manual) |
| **Location** | `src/core/game/possession.ts` |

DECODE defines CONTROL in its glossary (p.183): "an action by a ROBOT in which
the SCORING ELEMENT is fully supported by or stuck in, on, or under the ROBOT or
it intentionally pushes a SCORING ELEMENT to a desired location or in a preferred
direction (i.e., herding)", with case B given as "the ROBOT is moving the
SCORING ELEMENT in a preferred direction with a flat or concave face of the
ROBOT".

Case B is what the model implements, and it is the only case a Phase 2 robot can
reach: nothing in the simulator can carry a piece, so "fully supported by the
ROBOT" cannot arise until an intake mechanism does more than consume ports.

**The gap, precisely.** The same glossary excludes "bulldozing" — inadvertent
contact with a piece in the robot's path — and "deflecting". Deflecting is
excluded here too, because a robot that is not driving into the piece does not
possess it. **Bulldozing is not**, and cannot be: bulldozing and herding are
geometrically identical, and what separates them is intent, which a referee
judges and a snapshot does not contain. The model therefore over-reports
possession for a robot that drives through a piece on its way somewhere else.

**How the G408 rules cope with it.** DECODE's CONTROL limit is now assessed
(`DECODE_FOUL_RULES`), and it triggers on *sustained* possession rather than on
acquisition. The manual supplies the threshold: G408 measures excessive
violations as "greater-than-MOMENTARY CONTROL of 4 or more ARTIFACTS", and the
glossary puts MOMENTARY at "fewer than approximately 3 seconds" (p.185). A robot
crossing a scattered field does not hold four pieces for three seconds; a robot
hoarding does. That is a proxy for intent, not the rule as written, and a robot
that shepherds pieces incidentally for longer than three seconds is still fined
where a referee would not fine it.

Attribution is unaffected either way: crediting the robot that last moved a
piece is right whether it meant to or not.

**The three thresholds.** Contact tolerance is set by the resolver, not by
taste: `PENETRATION_SLOP_M` is 1 mm and correction is damped, so a piece resting
against a robot sits a millimetre or two off its surface; 5 mm covers that and is
still far below any FTC piece diameter. The push-speed floor separates a robot
that is moving from one whose brake is asymptoting to zero (§2.4). The release
grace exists because a pushed piece bounces — contact breaks and remakes over a
few ticks — and without it one continuous push would emit a burst of possession
and release events; 50 ms is far below the ~3 s the manual calls MOMENTARY, so
no rule about duration can notice it.

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

### 10.16 The GOAL cluster's side was flipped from its own GATE — found and fixed

| | |
|---|---|
| **Status** | Bug, fixed. Regression test added. |
| **Location** | `src/core/game/fixtures/decodeField.ts` (`GOAL_CLUSTER_SIDE`), `decodeCollision.ts` (`goalSide`), `app/render/fieldRenderer.ts` |

`decodeField.ts` places every alliance-owned zone — GATE, LOADING, BASE, SECRET
TUNNEL, the alliance half itself — with one sign convention, `SIDE = {red: -1,
blue: 1}`, read off G402's TILE columns (an explicit rule). The GOAL, RAMP and
DEPOT used a *second*, independent constant, `GOAL_CLUSTER_SIDE = {red: 1,
blue: -1}` — the opposite sign. Both conventions were internally consistent (a
valid mirrored pair each), so nothing about a single alliance's *own* geometry
looked wrong in isolation, and nothing failed: a shot into "the red GOAL" still
counted, because the physical GOAL shell (`decodeCollision.ts`) and the scoring
region (`decodeField.ts`) at least agreed *with each other*.

What they did not agree with is red and blue's own GATE, LOADING ZONE, BASE and
half of the field. The GOAL/RAMP/DEPOT — one physical CLASSIFIER assembly with
the GATE, per the code's own description of the conveyor ("the RAMP runs from
the GATE ... toward the GOAL") — sat in the *opposite corner* from the GATE that
opens it. A driver standing where the manual puts their own GATE ZONE would
never be near their own RAMP or GOAL at all.

**Why nothing caught it.** Every existing test asked one of two questions: "is
this alliance's own geometry internally consistent" (yes, both conventions were
self-consistent) or "does a shot into a GOAL located by `centreOf(...)` score"
(yes, because the query and the geometry used the same, if wrong, value). No
test ever asked "are two *different* elements — a GATE and its own RAMP — on
the same physical side." That is now `decodeField.test.ts`'s "keeps a GOAL, its
RAMP, its GATE and its own half on the same side", which fails against the old
sign (verified directly: reverted the fix locally, confirmed the test caught
it, restored the fix).

**A second bug shared the same root cause.** `fieldRenderer.ts` colours a GOAL
triangle by guessing from its vertices (`sum of x >= 0` ⇒ red), because a static
`RigidBody` carries no alliance tag. That guess was tuned to the old, wrong
sign and needed flipping in step — caught only by looking at a screenshot after
the fix (the left triangle drew blue when the underlying body was red's), which
is the reason this session also added `renderer.test.ts` assertions that a
piece's fill colour actually matches its type, so a colour/identity mismatch
like this one has a test that would have caught it.

**How it was found.** Not by a failing test — by print-diagnosing every named
region and zone's actual centre coordinates side by side and checking, by hand,
whether each alliance's own elements clustered on one side. This is worth
repeating whenever a new field element is added: two internally-consistent
mirror conventions can still disagree with each other, and nothing enforces
that automatically except an explicit cross-element test.

### 10.17 The SECRET TUNNEL has real rails; the GATE has a real, live-state visual

| | |
|---|---|
| **Status** | Presentational geometry added on top of already-sourced footprints |
| **Location** | `decodeCollision.ts` (`tunnelRailBodies`), `app/render/fieldRenderer.ts` (`drawGate`) |

Two gaps the collision table (§10.9, `decodeCollision.ts`) used to leave
`PASSABLE` / no-body are filled, without inventing any footprint the manual
does not already give:

- **The SECRET TUNNEL** already had a sourced footprint (§9.3: 46.5 × 6.125 in)
  placed by `decodeField.ts`; only a wall existed nowhere. `tunnelRailBodies`
  reads that same zone's already-computed centre and adds two thin (~1 in)
  static rails flanking it, ~2 in tall — tall enough to register any contact,
  since every body here starts at the floor. The **height** is the only
  invented number, and it is bounded: any positive height turns a marked-but-
  open rectangle into a corridor a rolling ARTIFACT is kept inside of and a
  ROBOT must enter end-on. Nothing about the corridor's *width* changed.
- **The GATE ZONE** gets a literal drawn arm (`drawGate`) instead of the two
  short tick-marks it drew before, reading `PieceConveyors.isOpen` through a
  new `FieldOverlay.openConveyorIds` — the exact fact that already gates the
  CLASSIFIER's drain (§10.15's conveyor), so the visual cannot disagree with
  what the RAMP is actually doing. It has no collision body of its own; the
  GATE's own panel shape remains CAD-only (§10.9).

---

### 10.18 Superseded: guided-lane GOAL-to-classifier experiment

| | |
|---|---|
| **Values** | lane guide `80 in/s²`, governed at `22 in/s`; GOAL basin centre `14 in`, classifier rail centre `10 in`, overflow centre `13.5 in` |
| **Confidence** | **INFERRED** from dSim-observed DECODE behaviour; the manual establishes capacity/overflow, not these dynamic values |
| **Location** | `src/core/game/conveyor.ts`, `src/core/game/fixtures/decode.ts`, `src/core/sim/simWorld.ts` |

> Superseded on 2026-08-27 by §10.19. This records the previous physical-lane
> experiment only; it is not current simulator behaviour.

The CLASSIFIER is a generic `GuidedLaneSpec`, not an ordered holder. A declared
lane supplies only bounded environmental acceleration and centring toward its
channel; pieces keep their own positions and velocities and resolve their own
contacts. The `22 in/s` cap prevents a lone ball from acquiring unbounded speed
in the frictionless contact solver before it reaches a gate. It is a governed
ramp/belt approximation, not mechanism or shooter physics.

The first nine balls remain ordinary floor-level bodies and pack against the
closed live GATE. The tenth and later balls travel on the declared elevated
overflow surface, because the manual distinguishes OVERFLOW from an additional
classifier slot. The values for the guide and overflow surface are observations
of dSim's public DECODE behaviour and are explicitly not manual dimensions.

The GOAL's field-facing solid boundary reaches the stated `38.75 in` top lip;
its backboard and side panels retain the full `54 in` assembly height. A ball
that genuinely crosses the raised GOAL region is first retained in the hollow
receiving basin, then receives bounded physical guidance to the classifier
throat. The face is clipped at that throat, as in dSim; ordinary loose balls
are projected back to a declared public-side point if they intrude into the
protected lane without completing the GOAL entry. This is a generic
receiving-basin/lane contract, not a positional move through the lane: accepted
balls remain subject to the same integration, `0.20` restitution, rolling loss,
and ball/field contacts as every other loose ball.

The live GATE stays a tagged solid collider until its owner latches it open.
Opening it does not release or animate any ball; it simply retracts that one
collider, allowing the already-packed physical balls to roll under their normal
lane guidance. One continuous robot contact is one activation: when the lane
and receiving basin become empty, the gate closes even if that robot remains in
the release zone. A later batch requires the robot to leave and make a new
touch. This preserves the one-way return guard and never changes robot or
drivetrain collision behaviour.

The lane's inner rail is split only at the GOAL-to-classifier arch (dSim's
observed hand-off near `y = 57 in`); its outer rail and the inner rail below
that arch are continuous all the way to the GATE. This represents one elevated
inlet for accepted GOAL balls and closes the floor-level bypass around the gate.
The exact arch opening length and the closed-gate's 2D collision envelope are
**inferred** projection values: the manual gives the 3.75–5.5 in gate contact
height, while a top-down raised-ball model needs the envelope to overlap a
10 in rail ball. They are deliberately fixture geometry, not a generic drive
or ball-physics parameter.

Receiving-basin and rail surfaces also apply modest linear damping (`4 s⁻¹`
and `2 s⁻¹`, respectively) in addition to the documented `20 in/s²` rolling
loss. Without it, an elevated ball avoids the floor-only rolling-loss path and
keeps enough lateral energy to bunch or orbit instead of forming a single-file
physical column. The basin admits the next ball only when its shared lane
entrance is clear; this is a chute-occupancy condition, not a coordinate slot.
One GATE touch may arm the gate before a ball arrives. It becomes a served
batch only once a real ball enters, then gravity-closes when that batch clears;
a stationary robot cannot reopen it without leaving and touching again.

The physical basin target is the dSim rail hand-off at `x = 69 in, y = 57 in`,
the centre of the single GOAL-to-classifier arch. A previous target above that
arch could leave an accepted ball pressing against the inner rail. The body now
remains under basin guidance until its centre reaches the throat (one-radius
clearance), then boards the physical rail. This is an **inferred** placement
from dSim's observable geometry, not a new fixed storage position.

The simplified deterministic shooter clamps its final integration segment at
the declared GOAL target before capture. This prevents a fixed 200 Hz step from
skipping a perfect-accuracy destination; it is not a score shortcut or a
replacement for GOAL/classifier physics. The membership detector, rules engine,
and physical basin still perform the capture and scoring transition.

### 10.19 Superseded: indexed elevated classifier representation

| | |
|---|---|
| **Values** | nine 4.9 in ARTIFACT centres in the RAMP; `0.35 s` release cadence; `50 in/s` gate exit speed |
| **Confidence** | capacity and ARTIFACT diameter are **EXPLICIT**; storage representation, cadence and exit speed are **INFERRED** gameplay abstractions |
| **Location** | `src/core/game/conveyor.ts`, `src/core/game/fixtures/decode.ts`, `src/core/sim/simWorld.ts` |

> Superseded on 2026-08-27 by §10.20. This records the brief direct-storage
> fallback only; it is not current simulator behaviour.

The real GOAL/RAMP is an elevated three-dimensional gravity mechanism. Its
funnel and ball-to-ball contact behaviour did not remain reliable when projected
onto a top-down 2D solver: balls could lodge in its upper footprint instead of
reaching the classifier. DECODE therefore uses a declared **indexed field
mechanism** after the normal, height-gated GOAL membership transition. This is a
functional approximation of the observable result, not a replacement for the
normal collision system used by loose field ARTIFACTS.

Only a legitimately accepted GOAL entry is taken into the classifier. A loose
ground ball remains rejected by the elevated GOAL/classifier access boundary;
it cannot be robot-pushed into the stored row. The first nine accepted pieces
are held end-to-end at the official 4.9 in ARTIFACT pitch, with index 1 at the
GATE end as Figure 10-4 requires. Tenth and later accepted pieces bypass that
full row using the ordinary conveyor overflow release path, preserving OVERFLOW
without a tenth slot.

The GATE remains a semantic tagged collider. A qualified robot touch latches it
open, and the generic conveyor releases one indexed ARTIFACT per declared
cadence. The latch marks the batch served at the actual release, so it closes
after the final ball even if the robot remains in the GATE ZONE. An opened GATE
does not change drivetrain or robot collision physics.

Released and overflow ARTIFACTS immediately become ordinary loose bodies with a
`50 in/s` downward return push. With the documented `20 in/s²` rolling loss,
that has a 62.5 in stopping distance from the GATE and reaches the audience-side
human-player LOADING ZONE through the SECRET TUNNEL. They still use normal
ball-to-ball and ball-to-field collision, restitution, and damping after release.

The deterministic shooter still clamps the final transfer step at its declared
GOAL target so a perfect-accuracy shot cannot skip the membership detector. The
membership detector and rules engine remain the only scoring path; classifier
storage never awards score directly.

### 10.20 Physical classifier run after GOAL admission

| | |
|---|---|
| **Values** | classifier intake `y = 54 in`; `8 in/s` initial downhill speed; governed `22 in/s` lane speed; `50 in/s` gate outflow |
| **Confidence** | **INFERRED** top-down projection from dSim/CAD-observed GOAL arch; ARTIFACT diameter and RAMP capacity remain **EXPLICIT** |
| **Location** | `src/core/game/conveyor.ts`, `src/core/game/fixtures/decode.ts`, `src/core/sim/simWorld.ts` |

The classifier is again an active `GuidedLaneSpec` for DECODE, but only after
the normal height-gated GOAL membership transition. The 3D GOAL funnel is not
re-solved inside the 2D contact system: an authorised shot is placed one time
at the physical lane intake (`x = ±69 in, y = 54 in`), immediately below the
GOAL arch and above the visible classifier run. It is not placed in a storage
slot, at the GATE, or in the SECRET TUNNEL.

From that intake onward, the ARTIFACT is an active, collidable body. The lane's
bounded downhill guide and the existing ball contacts carry it to the live
GATE; a closed gate retains it and other arriving ARTIFACTS pack normally. At
the moment a ball physically crosses into the return zone, the GATE applies its
declared `50 in/s` outflow velocity **without changing its position**. The ball
then rolls through the SECRET TUNNEL under normal rolling loss, restitution and
field collision. No direct classifier exit placement is permitted.

The tenth accepted piece follows the declared elevated overflow lane rather
than becoming a fixed tenth slot. Unaccepted ground pieces retain the existing
height-gated GOAL and protected-lane rejection path, so a robot cannot push one
into the classifier. The membership detector and rules engine remain the only
scoring path.

### 10.21 Single-file rail clearance and G416 launch-zone foul

| | |
|---|---|
| **Values** | 5.0 in classifier clear width = explicit 4.9 in ARTIFACT diameter + inferred 0.1 in dSim running clearance; 9-ball capacity; 5-point MINOR FOUL per invalid launch |
| **Confidence** | ARTIFACT diameter, capacity, and MINOR FOUL are **EXPLICIT**; the 0.1 in clearance is **INFERRED** from dSim's observable 5.1 in rail pitch for its nominal 5 in ball |
| **Location** | `decodeDimensions.ts`, `decodeCollision.ts`, `decodeField.ts`, `decode.ts`, `matchSimulation.ts` |

The older six-inch plan-view classifier was wide enough for visibly misleading
lateral gaps. The shared `CLASSIFIER_SINGLE_FILE_CLEAR_WIDTH_IN` narrows both
the rendered RAMP region and the two physical rails to one specified ARTIFACT
plus only 0.1 in running clearance. This is an environmental channel dimension,
not a storage pitch: accepted pieces remain active bodies, collide and settle
at positions chosen by the ordinary solver, and the tenth arrival still uses
the elevated overflow path after the manual's explicit nine-ball capacity.

G416 is now assessed at the generic mechanism-action boundary. A launch emits
`PieceLaunched` with the same string robot identity used by zone observations;
the DECODE data rules apply a 5-point opponent MINOR FOUL for each event whose
robot is outside both LAUNCH ZONES. This implements the requested base per-ball
penalty without putting DECODE knowledge in the shooter. The Competition Manual
also describes a MAJOR escalation when a violating ball enters the open GOAL;
that referee-level escalation is intentionally **not** implemented yet, rather
than silently approximated from top-down geometry.

Initial zone occupancy is seeded into the rule runner as non-scoring
bookkeeping. A robot that starts in a LAUNCH ZONE is therefore recognized for
its first launch, but no `RobotOverlapsZone` award is manufactured from the
initial field setup. This is generic match-state initialization, not a DECODE
exception.

### 10.22 Overflow clearance and timed gate drainage

| | |
|---|---|
| **Values** | 16 in overflow ball centre; 4 s DECODE quiet GATE window |
| **Confidence** | **INFERRED** top-down collision projection; the manual establishes OVERFLOW and gravity-closed gate behaviour but not these timing/height values |
| **Location** | `conveyor.ts`, `decode.ts`, `decodeCollision.ts` |

The former 13.5 in overflow centre remained vertically overlapping the
top-down model's 12.5 in expanded GATE collision span once a 4.9 in ball radius
was included. It therefore behaved as a tenth ball trapped behind the nine
instead of an OVERFLOW. The 16 in centre clears that envelope and lets an
accepted tenth body travel over the physical packed lane, through a still-closed
gate, and then into the ordinary SECRET TUNNEL return at the actual exit. It is
still an active colliding body throughout; no classifier or tunnel teleport was
added.

`PieceConveyorSpec.releaseOpenWindowSec` makes a live gate a finite physical
push. A touch starts the window, and only a normal-lane ball actually crossing
the gate renews it. A served empty batch closes immediately; an untouched gate
closes after the window even if the robot remains in the release zone. DECODE
uses four seconds so one valid ball can roll from its GOAL-side inlet to the
gate, while a robot cycling isolated shots cannot leave the gate open forever.
OVERFLOW deliberately does not renew this window because it passes above the
gate rather than through it.

The red/blue rail layout is now mirrored by field-relative direction, not by
raw X sign: both classifiers have one field-facing GOAL arch and a continuous
perimeter-side rail. This fixes the previous side-specific hole without adding
a game-logic rectangle as a collider.

### 10.23 Canonical CAD-projected field assemblies

| | |
|---|---|
| **Source** | DECODE full-field STEP CAD `am-5700_Full.step`; Event FIELD Setup Guide §9; Competition Manual §9.3 / §9.7 |
| **Location** | `fieldTemplate.ts`, `decodeAssemblies.ts`, `decodeCollision.ts`, `fieldRenderer.ts` |
| **Decision** | One reusable mirrored GOAL/classifier/GATE/SECRET TUNNEL assembly owns visual geometry, collision geometry, semantic ids, and elevation metadata. |

The STEP assembly was inspected directly. Its named components include the Red
and Blue Goal Rear/Front/Backboard Panels, Goal Internal Ramp, Goal Archway,
Ramp Support, Gate Arm, Gate Stop, and Lower Ramp Blocker.  The projected 2D
model represents those as a hollow receiving basin, CAD-panel boundaries, a
raised ramp surface, rails, and a live GATE in one assembly.  This avoids
deriving an obstacle from a scoring region or inferring visual material from
collider thickness.

The SECRET TUNNEL remains a passable taped zone per the manual; its neutral
return surface is part of the same presentation assembly but deliberately has
no collider.  Normal Play renders only these physical/tape structures. Rule
regions, collision envelopes, labels, and authoring outlines are behind the
off-by-default **Debug field geometry** toggle.  The renderer never assigns an
alliance colour simply because an object sits on one side of the field; only
real tape/material data may do so.

## 11. Revision log

| Date | Change |
|---|---|
| 2026-08-27 | Replaced collider-thickness and rule-region-driven DECODE drawing with two mirrored canonical STEP-CAD assembly projections. Every fixture collider derives from its matching assembly part, while normal Play hides regions/diagnostics behind Debug field geometry. |
| 2026-08-27 | Replaced the direct DECODE classifier-storage fallback with a physical classifier run. A valid GOAL entry may be placed only at the lane intake below the GOAL arch, then rolls/collides down the full visible classifier. The gate applies return velocity at the physical exit position rather than teleporting the ball into the SECRET TUNNEL. |
| 2026-08-27 | Narrowed the DECODE classifier from a 6 in placeholder to the shared 5.0 in single-file clear width (4.9 in ARTIFACT plus 0.1 in dSim-derived clearance), and added G416's requested per-launch 5-point MINOR FOUL as a generic `PieceLaunched` event/rule. |
| 2026-08-27 | Raised the overflow surface to clear the semantic GATE collision span, made live gates quiet-window based and renewed only by real normal-lane releases, and corrected the mirrored classifier rail/arch construction. |
| 2026-08-27 | Superseded the unreliable 2D physical GOAL-to-classifier lane experiment with an indexed elevated field mechanism after legitimate GOAL membership. The nine explicit 4.9 in ARTIFACT positions are end-to-end at the GATE end; tenth-and-later arrivals use the ordinary overflow release. Added the generic `queuePitchM` and `gateColliderTag` conveyor data, and raised return speed to 50 in/s so normal rolling loss carries released ARTIFACTS to the human-player loading side. |
| 2026-08-27 | Updated §10.18 with an explicit reusable elevated-surface profile: 14 in basin, 10 in normal rail, and 13.5 in overflow centres. The STEP full-field assembly was loaded to verify the GOAL/RAMP are raised assemblies; dSim supplies the observed ball-surface heights. |
| 2026-08-27 | Updated §10.18: the physical classifier now has one raised GOAL arch and continuous rails to the live gate. This closes the former rail/gate seam without adding parked slots; GOAL entry is admitted before the protected-lane guard so valid shots cannot be rejected during the overlapping hand-off tick. |
| 2026-08-27 | Updated §10.18: raised GOAL/rail surfaces now dissipate rolling energy, basin admission is one physical ball at a time, and a GATE touch arms a future batch rather than being lost when the channel is initially empty. |
| 2026-08-27 | Corrected the basin target from an above-rail point to dSim's actual `y = 57 in` arch centre. Accepted ARTIFACTS must physically reach that arch before rail hand-off; the packed-shot regression now asserts no piece remains in the basin. |
| 2026-08-27 | Expanded the physical classifier regression from three to all nine normal valid shots. It verifies the stated capacity as an end-to-end packed column, not merely a queue counter. |
| 2026-08-27 | Updated §10.18: GATE contact is edge-triggered. One activation drains the current physical batch, then the tagged collider closes as soon as the lane and basin are empty, even if the robot stays parked at the release zone. |
| 2026-08-27 | Updated §10.18: a generic receiving basin now retains a valid GOAL entry before feeding its physical lane. The GOAL face is clipped at the classifier throat and a data-declared public-side guard rejects loose, unaccepted lane intrusions; no per-piece collider bypass remains. |
| 2026-08-27 | Added §10.16: found and fixed `GOAL_CLUSTER_SIDE` disagreeing with `SIDE`, which put an alliance's own GOAL/RAMP/DEPOT in the opposite corner from its own GATE/LOADING/BASE; a dependent renderer colour-guess needed the same flip. Added §10.17: the SECRET TUNNEL got real side-rail collision bodies from its already-sourced footprint, and the GATE ZONE got a live-state visual reading `PieceConveyors.isOpen`. Added a note under §9.9 that the new cosmetic shot-flight animation does not reintroduce the removed mechanism physics. |
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
| 2026-08-25 | Added §5.5 (at that time, pieces had no damping) and §5.6 (a pinned piece escapes the field — known resolver defect, asserted by test) as game pieces became entities; §10.5 narrowed to the snapshot-to-observation join. |
| 2026-08-25 | Phase 3 pipeline closed end to end. Added §10.9 (DECODE positions invented), §10.10 (ARTIFACT mass estimated), §10.11 (per-season ledger is derived by walking the GameDefinition); §10.5 narrowed from the pipeline to the coordinates. |
| 2026-08-24 | Added §9.4 recording that mechanism preset templates are editable starting points: mass and actuation feed the physics, the remaining capability parameters are inert until Phase 3. |
| 2026-08-26 | Added §5.9 (2.5D piece flight, no drag) and §5.10 (GOAL scoring gated on height). Pieces have height and climb rate, robots can launch them, and the 24 on-field ARTIFACTS are staged from §10.3.1 and the setup guide. |
| 2026-08-26 | Field layout transcribed from the Event FIELD Setup Guide: TILE grid, both LAUNCH LINES, SPIKE MARKS, BASE, GATE, LOADING and SECRET TUNNEL ZONES. §10.9 rewritten; only the GOAL cluster remains untranscribed. |
| 2026-08-26 | Added §2.2.1 recording the arc-driving investigation: the slowdown is command saturation plus the centripetal crab, both emergent, no correction applied. |
| 2026-08-26 | Added §10.15 (OVERFLOW as a capacity outcome). The invented OVERFLOW region is gone, and `regionContents` now holds piece ids once each rather than piece types twice. |
| 2026-08-26 | Added §5.8 (multi-pass contact resolution, perimeter thickness), which closes the §5.6 defect: a piece pinned between a robot and a wall now stays in play. Phase 1 golden digest rebaselined. |
| 2026-08-26 | G408's CONTROL limit assessed from sustained possession, and ranking-point criteria measured from a match. §10.14 extended with the MOMENTARY proxy the foul rules use for intent. |
| 2026-08-26 | Added §10.14 (possession from contact and motion). Piece attribution now comes from simulation state: `PieceEnteredRegion.byRobotId` / `byAlliance` have existed unfilled since the event model was written, and a possession tracker fills them. |
| 2026-08-26 | §2.2 replaced: the strafe penalty is now modelled. The mecanum roller degree of freedom was missing entirely, and its slip `√2(v_y ± aω)` has no `v_x` term, so a single roller-path resistance makes strafing slower while leaving forward performance bit-identical. Phase 1 golden digest rebaselined. |
| 2026-08-26 | Added §9.5–§9.8 as intake and shooter physics landed: flywheel transfer ratio, inertia and shot energy; roller force with no acquisition timer; shot accuracy as a velocity rather than a probability; and the kinematic carry for held pieces. `PIECES_PER_OUTPUT_REVOLUTION` (§9.1) gained a second consumer — it is now the feeder cadence that sets fire rate. |
| 2026-08-27 | §9.9 supersedes the experimental mechanism physics with the functionality-first model: deterministic intake/storage/gate/shooter state transitions and game-defined action routes. Ballistics, flywheel energy/RPM, shot RNG and roller-force acquisition are deliberately removed. |
| 2026-08-26 | Added §5.7 (contact manifolds and normal-solver sweeps) with the wall-spin defect it fixes; §5.1 now points at it for where a normal impulse acts, and §5.6 records that the pinned-piece defect survives the change. Phase 1 golden digest rebaselined. |

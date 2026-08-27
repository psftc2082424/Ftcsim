# FTC Universal 2D Simulator — Product Specification

## 1. Product Vision

Build a reusable FIRST Tech Challenge (FTC) top-down 2D robot simulator, conceptually similar to:

https://sim.team4414.com/

The simulator must NOT be hard-coded for one FTC season.

The user should be able to upload an FTC Game Manual and have the application analyze it, generate a structured representation of the game, and create a playable match simulation.

The goal is to let FTC teams experiment with robot designs and answer:

> "If we build this robot instead of that robot, how will it actually perform in this FTC game?"

Prioritize:

1. Functional match behavior
2. Accurate game rules
3. Accurate field geometry
4. Useful game-specific metrics
5. Usability
6. Deterministic, comprehensible simulation
7. Rendering

Visual quality is low priority.

### 1.1 Functional match-simulation model

This product models the **observable behavior of an FTC robot in a match**, not
the hidden physical process inside every subsystem. A detail belongs in the
simulation only when it changes a driver-visible or rule-visible outcome.

- Keep the existing deterministic mecanum drive and collision model where it
  governs where a robot can drive and what it can contact.
- Model game pieces as deterministic stateful objects (for example `FIELD`,
  `HELD`, `TRANSFERRING`, `SCORED`, and `RETURNING`), not as a general-purpose
  rigid-body problem.
- Model mechanisms through their capabilities and valid state transitions. An
  intake acquires eligible nearby pieces, a shooter becomes ready and performs a
  valid scoring action, and an arm/turret moves toward a bounded target.
- A scoring action must still travel through the core event and rules pipeline;
  the UI and a mechanism never write a score directly.
- Default to ideal, repeatable operation. Randomness, probabilistic success,
  detailed launch trajectories, aerodynamic effects, contact-force models,
  motor-load models, and material properties are out of scope unless a
  documented gameplay requirement explicitly needs one.

When a simple transition produces the same observable match behavior, it is the
required model. Any more detailed model must document the gameplay behavior it
adds and remain deterministic.

---

## 2. Game Manual Input

Support:

- PDF game manuals as the primary format
- Webpages where practical
- Images/diagrams where practical

Pipeline:

Game Manual
→ Document Analysis
→ Structured GameDefinition
→ User Review / Correction
→ Playable Simulation

The system should extract, where available:

### Field
- Dimensions
- Geometry
- Starting positions
- Zones
- Obstacles
- Walls
- Trenches
- Ramps
- Structures
- Other relevant elements

### Game Pieces
- Types
- Dimensions
- Weight if available
- Quantity
- Physical behavior
- Possession rules

### Scoring
- Scoring locations
- Scoring heights
- Scoring values
- Scoring conditions
- Bonuses
- Penalties
- Possession limits

### Match
- Autonomous duration
- TeleOp duration
- Endgame duration
- Match transitions

### Robot Restrictions
- Dimensions
- Height
- Extension rules
- Protected areas
- Mechanism restrictions
- Game-specific constraints

### Mechanisms

Identify strategically relevant mechanisms such as:

- Intakes
- Outtakes
- Shooters
- Flywheels
- Elevators
- Arms
- Turrets
- Spindexers
- Conveyors
- Climbers
- Passing systems
- Other game-specific mechanisms

---

## 3. Manual Analysis Reliability

Distinguish between:

### Explicit
Directly stated by the manual.

### Inferred
Estimated from diagrams or other evidence.

### Assumed
Engineering estimates required because information is unavailable.

### Unknown
Cannot reasonably be determined.

Never silently invent important values.

Important assumptions must be visible to the user and editable.

After analysis, provide a Game Configuration Editor where the user can review and correct:

- Field dimensions
- Field elements
- Game pieces
- Scoring
- Timing
- Endgame rules
- Robot restrictions
- Mechanisms
- Assumptions

---

## 4. Robot Model

Keep the universal robot model intentionally simple.

Every robot has only:

- Length
- Width
- Height
- Mass

Do NOT require configuration of:

- Center of mass
- Moment of inertia
- Friction coefficient
- Traction coefficient
- Wheelbase
- Track width
- Wheel placement
- Ground friction

Assume perfect traction.

Length and width determine collision geometry.

Height affects relevant game constraints.

Mass affects acceleration, deceleration, motor loading, and relevant mechanism behavior.

---

## 5. Drivetrain

Every robot uses a custom belted mecanum drivetrain.

Do not provide drivetrain-type selection.

Users should configure meaningful drivetrain parameters such as:

- Motor model
- Motor count
- Gear ratio
- Wheel diameter

Use these with robot mass and motor characteristics to derive performance.

Do not let users simply enter arbitrary maximum-speed or acceleration values unless there is a specific reason to support an override.

---

## 6. Drivetrain Physics

Model:

Motor torque
→ Gear ratio
→ Wheel torque
→ Wheel force
→ Robot acceleration
→ Robot velocity

and:

Motor RPM
→ Wheel RPM
→ Theoretical wheel velocity

Account for:

- Motor torque
- Motor RPM
- Gear ratio
- Wheel diameter
- Motor count
- Robot mass
- Mechanical efficiency where appropriate
- Battery voltage where practical

Assume perfect traction.

Implement real mecanum kinematics supporting:

- Forward/backward
- Strafing
- Rotation
- Combined translation + rotation
- Wheel-speed saturation

The physics should derive performance from underlying physical parameters rather than arbitrary statistics.

---

## 7. Motors

Use goBILDA motors as the default FTC motor ecosystem.

Use realistic manufacturer specifications where available.

Do not assume maximum torque exists at every RPM.

Create a reusable motor model supporting different goBILDA motors.

The motor model should eventually account for things such as:

- Free speed
- Stall torque
- Torque-speed relationship
- Current
- Voltage

Only expose useful parameters to users.

---

## 8. Robot Configuration

### Universal

- Length
- Width
- Height
- Mass

### Drivetrain

- Motor
- Motor count
- Gear ratio
- Wheel diameter

### Mechanisms

Provide a modular mechanism framework for:

- Intake
- Outtake
- Shooter
- Flywheel
- Arm
- Elevator
- Lift
- Turret
- Spindexer
- Conveyor
- Claw
- Pivot
- Climber
- Passer
- Custom mechanisms

Mechanisms should be configured through meaningful parameters such as:

- Motor
- Motor count
- Gear ratio
- Efficiency
- Maximum RPM
- Torque
- Throughput
- Capacity
- Position limits

Only expose mechanisms relevant to the current game where practical.

Do not over-engineer every mechanism in the first version.

---

## 9. Robot Presets

Users can:

- Create
- Save
- Load
- Edit
- Duplicate
- Rename
- Delete

robot configurations.

Presets should persist between sessions.

Use a structured format so presets can eventually be exported/imported.

---

## 10. Functional Robot Archetypes

Archetypes are based primarily on:

function + strategy + mechanisms + game objectives

NOT generic drive speed.

Do not use archetypes such as:

- Fast Bot
- Medium Bot
- Slow Bot

unless speed itself is strategically important.

Instead, analyze the game and identify meaningful functional archetypes such as:

- High-throughput scorer
- Precision scorer
- Shooter specialist
- High-capacity scorer
- Passing/support robot
- Endgame specialist
- Climbing specialist
- Defensive/control robot
- Specialized scorer
- General-purpose robot

These are examples, not hard-coded categories.

The simulator should determine which archetypes actually make sense for the uploaded game.

---

## 11. Archetype → Actual Robot

Selecting an archetype must generate a real baseline robot configuration.

For example:

### High-throughput scorer

Could generate:

- Appropriate intake
- High mechanism throughput
- Appropriate capacity
- Appropriate motor configuration
- Corresponding robot mass
- Appropriate physical representation

### Shooter specialist

Could generate:

- Shooter/flywheel
- Appropriate launch characteristics
- Shooting accuracy
- Shooting rate
- Appropriate physical representation

Archetypes must have real engineering tradeoffs.

A robot should not be better at everything.

Example tradeoffs:

- Higher capacity → more mass → lower acceleration
- Larger shooter → more mass/space → less intake capacity
- Climbing mechanism → more mass/space → better endgame
- High throughput → potentially lower precision

---

## 12. Game-Specific Statistics

Do NOT use generic RPG-style statistics such as:

- Speed: 8/10
- Defense: 7/10
- Shooting: 9/10

Instead, generate concrete metrics relevant to the specific game.

The FRC simulator is the conceptual inspiration.

Example statistics could look like:

- 8 ft/s
- Rotation: 200°/s
- Accel: 35 ft/s²
- Intake: 25 b/s
- Outtake: 25 b/s
- Capacity: 65
- Trench: 70
- Shoot: 10 b/s
- Shoot Spd: 50%
- Pass Spd: 100%
- Accuracy: 95%
- Climb Lvl: 1
- Climb Time: 1s
- Back Intake

These are examples, NOT universal fields.

---

## 13. Dynamic Game Metrics

Analyze each game and determine which statistics matter.

For shooting:

- Shoot Rate
- Shoot Speed
- Range
- Accuracy
- Capacity

For object scoring:

- Intake Rate
- Outtake Rate
- Capacity
- Scoring Rate
- Cycle Time

For passing:

- Pass Rate
- Pass Speed
- Pass Accuracy
- Receiving Capacity

For climbing:

- Climb Level
- Climb Time
- Climb Success Rate

For traversal constraints:

- Clearance
- Traversal Speed

The simulator should dynamically create a game-specific stat sheet.

---

## 14. Stats Must Reflect Reality

Statistics should correspond to actual simulation parameters or measured simulation results whenever possible.

For example:

Drive Speed should emerge from:

- Motor
- Gear ratio
- Wheel diameter
- RPM
- Mass
- Mecanum model

Intake Rate should correspond to the intake mechanism.

Capacity should correspond to actual mechanism capacity.

Accuracy should correspond to the shooting model.

Avoid arbitrary decorative numbers.

---

## 15. Controls

Support two control methods.

### Virtual Gamepad

Provide a virtual PS5-style controller with:

- Left stick
- Right stick
- Triggers
- Face buttons
- Shoulder buttons
- D-pad

Controls must be configurable.

### Keyboard + Mouse

Provide configurable keyboard/mouse controls.

Do not implement Java/FTC SDK code execution yet.

---

## 16. Simulation

Use a top-down 2D field.

Field geometry should be dimensionally accurate.

Robot representation should accurately reflect:

- Length
- Width
- Orientation
- Mechanisms

Implement relevant collision between:

- Robot/walls
- Robot/field elements
- Robot/game pieces
- Robot/scoring structures
- Robot/robot where relevant

Use simple collision geometry when possible.

---

## 17. Scoring Engine

Separate scoring/game rules from physics.

Support:

- Multiple game pieces
- Multiple scoring locations
- Scoring conditions
- Possession
- Capacity
- Bonuses
- Penalties
- Autonomous
- TeleOp
- Endgame
- Time-dependent rules
- Game-specific conditions

Score must result from actual simulated actions.

---

## 18. Telemetry

Provide useful real-time telemetry such as:

- X
- Y
- Heading
- Velocity
- Angular Velocity
- Acceleration
- Motor RPM
- Wheel RPM
- Motor Torque
- Current
- Battery Voltage
- Game Pieces Held
- Intake Rate
- Outtake Rate
- Scoring Rate
- Score
- Match Time
- Cycle Time
- Mechanism State

Add game-specific metrics dynamically.

Post-match analytics should potentially include:

- Total score
- Score breakdown
- Cycle time
- Maximum speed
- Maximum acceleration
- Distance traveled
- Intake efficiency
- Scoring efficiency
- Accuracy
- Mechanism utilization
- Endgame performance
- Battery usage

---

## 19. Architecture

Keep these systems modular:

- Input System
- Physics Engine
- Robot Model
- Mecanum Drive Model
- Motor Model
- Mechanism System
- Game Definition
- Game Rules Engine
- Scoring Engine
- Game Manual Parser
- Archetype Generator
- Robot Preset System
- Telemetry System
- Simulation Runtime
- UI
- Renderer

Game-specific logic must not be deeply coupled to the physics engine.

Desired pipeline:

Upload Game Manual
→ Analyze Manual
→ GameDefinition
→ Review / Correct
→ Strategic Analysis
→ Functional Archetypes
→ Baseline Robots
→ Select / Modify Robot
→ Run Simulation
→ Measure Performance

Adding a new FTC season should ideally require generating a new GameDefinition rather than rewriting simulator code.

---

## 20. Development Roadmap

### Phase 1 — Driving and field interaction

Build:

- Top-down field
- Four-wheel belted mecanum robot
- goBILDA motor model
- Gear ratios
- Wheel diameter
- Motor physics
- Mecanum kinematics
- Acceleration
- Rotation
- Perfect traction
- Basic collision
- Keyboard controls
- Virtual gamepad
- Telemetry

### Phase 2 — Robot Builder

Build:

- Length
- Width
- Height
- Mass
- Motor selection
- Motor count
- Gear ratio
- Wheel diameter
- Mechanism framework
- Robot presets

### Phase 3 — Game Engine

Build:

- GameDefinition
- Field elements
- Game pieces
- Scoring zones
- Scoring rules
- Match timer
- Autonomous
- TeleOp
- Endgame
- Scoring

### Phase 4 — Game Manual Intelligence

Build:

- PDF ingestion
- Webpage/image ingestion where practical
- Text extraction
- Diagram interpretation
- Rule extraction
- GameDefinition generation
- Assumption tracking
- Game configuration editor

### Phase 5 — Archetypes

Build:

- Strategic analysis
- Functional archetype generation
- Baseline robot generation
- Game-specific statistics
- Tradeoff modeling

### Phase 6 — Optional calibrated simulation

Only add a calibrated detail when it demonstrably changes a gameplay decision:

- Measured drive/battery calibration
- Field-element constraints that affect access or scoring
- Mechanism timing calibration
- Analytics
- Robot comparison

Projectile simulation, motor heating, material properties, and general-purpose
mechanism/contact physics are not roadmap goals by themselves.

The roadmap may be changed if a better engineering sequence is identified.

---

## 21. Technical Self-Critique

Before substantial implementation, identify:

- Questionable assumptions
- Missing FTC requirements
- Important physics
- Physics that can safely be approximated
- What manual information can reliably be extracted
- What requires human verification
- Missing useful metrics
- Features that should be postponed
- Architectural risks
- Performance risks
- Determinism requirements
- Future real-world calibration requirements

Do not blindly follow this specification if a better engineering approach exists.

Explain significant deviations before implementing them.

---

## 22. Repository Workflow

Before modifying anything:

1. Inspect the repository.
2. Determine the technology stack.
3. Understand existing architecture.
4. Identify reusable code.
5. Identify limitations.
6. Recommend the best implementation approach.

If the repository is empty, choose the stack based on:

- Functional match-simulation capability
- 2D rendering
- UI
- Performance
- Cross-platform support
- Development speed
- Extensibility

Do not unnecessarily replace working infrastructure.

---

## 23. Implementation Rules

Work incrementally.

Do not create superficial mockups.

Do not:

- Hard-code a season
- Hard-code archetypes to one game
- Generate arbitrary stats
- Hide assumptions
- Add decorative or unneeded physics
- Couple game rules to physics
- Force unnecessary robot parameters
- Prioritize graphics over simulation

After each major milestone:

1. Run the application.
2. Test it.
3. Identify bugs.
4. Fix them.
5. Verify the result.
6. Continue.

If accurate implementation is not yet possible, explain the limitation and create an extensible foundation for improving it later.

---

## 24. Final Objective

Build an FTC robot engineering sandbox.

A team should be able to:

Upload FTC Game Manual
→ Simulator understands game
→ Identifies strategic capabilities
→ Generates functional archetypes
→ Selects archetype
→ Generates baseline robot
→ User modifies robot
→ User drives robot
→ Simulation produces predictable match behavior
→ Game-specific statistics + score
→ Compare robot designs

The central question the simulator should answer is:

> "If we build this robot instead of that robot, how will it actually perform in this FTC game?"

Optimize for:

**Functional match behavior + game accuracy + functional archetypes + meaningful metrics + engineering tradeoffs + extensibility**

over graphical polish.

---

END OF SPECIFICATION.

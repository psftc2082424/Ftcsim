/**
 * The physics → game bridge.
 *
 * Maps a `WorldSnapshot` onto the observations the region-membership detector
 * consumes. This is the join that makes game events derive from real simulated
 * positions rather than from scripted test input.
 *
 * ── Why the mapping lives here ─────────────────────────────────────────────
 *
 * `sim` may not import `game` — the physics layer must not know that regions or
 * scoring exist (ARCHITECTURE.md §3.2). But `game` sits above `sim` in the
 * layering, so the game layer is free to read a snapshot. Putting the mapping on
 * this side keeps the dependency pointing the right way, and keeps `SimWorld`
 * free of any concept it has no business knowing about.
 *
 * The snapshot deliberately carries both identities for a piece — the numeric
 * entity id physics uses, and the `pieceId`/`pieceType` strings events use — so
 * this mapping is a rename, not a lookup table that could fall out of sync.
 */

import type { WorldSnapshot } from '../sim/snapshot.js';
import type { Observation, PieceObservation, RobotObservation } from './membershipDetector.js';
import { createObb } from '../physics/shapes.js';

/**
 * Attribution for a piece, when the caller knows which robot is responsible.
 *
 * Possession is not modelled yet, so nothing in the simulation can currently
 * answer this. The hook exists because scoring rules that award "the alliance
 * that scored it" need it, and threading it later should not mean reworking the
 * bridge. Absent attribution simply produces events with no `byAlliance`, which
 * the rules engine already treats as unattributable.
 */
export type PieceAttribution = (
  pieceId: string,
) => { robotId?: string; alliance?: 'red' | 'blue' } | undefined;

export interface BridgeOptions {
  readonly attribution?: PieceAttribution | undefined;
}

/**
 * Robot footprints are rebuilt per call from the snapshot's dimensions.
 *
 * A robot's size never changes during a match, so this could be cached. It is
 * not, because the cache key would be robot identity and a stale entry would
 * silently mis-measure zone support — a wrong score is far more expensive than
 * an allocation at the observation rate.
 */
function robotObservationOf(
  robot: WorldSnapshot['robots'][number],
): RobotObservation {
  return {
    robotId: String(robot.id),
    alliance: robot.alliance,
    shape: createObb(robot.lengthM, robot.widthM),
    positionM: robot.pose.p,
    headingRad: robot.pose.theta,
  };
}

function pieceObservationOf(
  piece: WorldSnapshot['pieces'][number],
  attribution: PieceAttribution | undefined,
): PieceObservation {
  const credited = attribution?.(piece.pieceId);

  return {
    pieceId: piece.pieceId,
    pieceType: piece.pieceType,
    positionM: piece.pose.p,
    heightM: piece.heightM,
    byRobotId: credited?.robotId,
    byAlliance: credited?.alliance,
  };
}

/**
 * Convert one simulation snapshot into a detector observation.
 *
 * The result is a *complete* snapshot in the detector's sense (§10.7): every
 * piece and robot in the world is present, so anything the detector has seen
 * before and does not see here has genuinely left play.
 */
export function observationFrom(
  snapshot: WorldSnapshot,
  options: BridgeOptions = {},
): Observation {
  return {
    pieces: snapshot.pieces.map((piece) => pieceObservationOf(piece, options.attribution)),
    robots: snapshot.robots.map(robotObservationOf),
  };
}

/**
 * Robot ids as the game layer sees them.
 *
 * Physics keys robots by numeric entity id while events carry strings, so the
 * bridge stringifies. Exposed so a caller writing rules or assertions can name
 * the same robot the events will.
 */
export function robotIdOf(entityId: number): string {
  return String(entityId);
}

/**
 * The set of games the app can run, and what each one needs beyond its bare
 * `GameDefinition`.
 *
 * `GameDefinition` describes rules, pieces and scoring, but `SimRunner` also
 * needs a `FieldTemplate` (collision bodies), a starting piece layout, and a
 * legal start pose per alliance — none of which belong on `GameDefinition`
 * itself, since a field-editor UI (ARCHITECTURE.md §6.6) may one day let a
 * user place those independently of the rules. Bundling them here, rather
 * than importing DECODE-specific fixtures directly into the app shell, is
 * what lets `App.tsx` stay season-blind: adding a second game means adding one
 * entry to `GAME_REGISTRY`, not touching how the shell wires a game in.
 */

import type { GameDefinition } from './gameDefinition.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';
import type { GamePieceSpec } from '../sim/simWorld.js';
import type { Pose } from '../physics/body.js';
import { DECODE_GAME } from './fixtures/decodeGame.js';
import { createDecodeField } from './fixtures/decodeCollision.js';
import { stageDecodePieces } from './fixtures/decodeStaging.js';
import { DECODE_LEGAL_START_POSES } from './fixtures/decodeField.js';
import { BIOBUZZ_GAME } from './fixtures/biobuzzGame.js';
import { createBiobuzzField } from './fixtures/biobuzzCollision.js';
import { stageBiobuzzPieces } from './fixtures/biobuzzStaging.js';
import { BIOBUZZ_LEGAL_START_POSES } from './fixtures/biobuzzField.js';

export interface GameEntry {
  readonly definition: GameDefinition;
  /** Builds this game's collision fixture. Called once per game selection. */
  readonly createField: () => FieldTemplate;
  /** Builds this game's starting piece layout. Called once per game selection. */
  readonly stagePieces: () => readonly GamePieceSpec[];
  readonly legalStartPoses: Readonly<Record<'red' | 'blue', Pose>>;
}

/**
 * Every game the app can run. Order is display order in the game selector.
 *
 * To add a game built from a new manual: write its `GameDefinition` and field
 * fixture under `fixtures/` following the DECODE files as a template
 * (`decodeGame.ts`, `decodeField.ts`, `decodeCollision.ts`, `decode.ts`, ...),
 * then add one entry here. No other file needs to change.
 */
export const GAME_REGISTRY: readonly GameEntry[] = [
  {
    definition: DECODE_GAME,
    createField: createDecodeField,
    stagePieces: stageDecodePieces,
    legalStartPoses: DECODE_LEGAL_START_POSES,
  },
  {
    definition: BIOBUZZ_GAME,
    createField: createBiobuzzField,
    stagePieces: stageBiobuzzPieces,
    legalStartPoses: BIOBUZZ_LEGAL_START_POSES,
  },
];

export const DEFAULT_GAME_ID: string = DECODE_GAME.id;

export function getGameEntry(id: string): GameEntry {
  const entry = GAME_REGISTRY.find((candidate) => candidate.definition.id === id);
  if (entry === undefined) {
    throw new Error(`No registered game with id "${id}".`);
  }
  return entry;
}

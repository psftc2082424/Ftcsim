/**
 * BIOBUZZ assembled as a complete `GameDefinition`.
 *
 * The second proof of `docs/ARCHITECTURE.md`'s central claim: adding a season
 * is writing one of these, not changing the engine. BIOBUZZ needed two new
 * generic primitives DECODE never exercised (`tipper.ts`, `reserveFeed.ts`)
 * and one new pair of predicates (piece-identity/type arrival checks), but
 * every one of them is season-blind — nothing in `core/game/` outside this
 * `fixtures/` directory says HIVE, CELL, FLOWER, POLLEN or NECTAR.
 */

import type { GameDefinition } from '../gameDefinition.js';
import {
  BIOBUZZ_HAS_NO_WEIGHT_LIMIT,
  BIOBUZZ_ELEVATED_REGIONS,
  BIOBUZZ_FOULS_ASSESSED_BY_REFEREE,
  BIOBUZZ_MATCH,
  BIOBUZZ_MECHANISM_ACTION_ROUTES,
  BIOBUZZ_PENALTIES,
  BIOBUZZ_PIECES,
  BIOBUZZ_RANKING_POINT_RULES,
  BIOBUZZ_RESERVE_FEEDS,
  BIOBUZZ_ROBOT_CONSTRAINTS,
  BIOBUZZ_RP_THRESHOLD_TIER,
  BIOBUZZ_RULE_SET,
  BIOBUZZ_SETUP,
  BIOBUZZ_TIPPING_STRUCTURES,
} from './biobuzz.js';
import { BIOBUZZ_FIELD_REGIONS, BIOBUZZ_FIELD_ZONES, BIOBUZZ_LAYOUT_PROVENANCE } from './biobuzzField.js';

export const BIOBUZZ_GAME: GameDefinition = {
  id: 'ftc-biobuzz-2026',
  season: '2026-27',
  name: 'FIRST Tech Challenge BIOBUZZ',

  match: BIOBUZZ_MATCH,
  pieces: BIOBUZZ_PIECES,

  regions: BIOBUZZ_FIELD_REGIONS,
  zones: BIOBUZZ_FIELD_ZONES,
  slottedRegions: {},

  mechanismActionRoutes: BIOBUZZ_MECHANISM_ACTION_ROUTES,
  tippingStructures: BIOBUZZ_TIPPING_STRUCTURES,
  reserveFeeds: BIOBUZZ_RESERVE_FEEDS,
  elevatedRegions: BIOBUZZ_ELEVATED_REGIONS,

  setup: BIOBUZZ_SETUP,

  rules: BIOBUZZ_RULE_SET,
  objectives: [],
  robotConstraints: BIOBUZZ_ROBOT_CONSTRAINTS,

  rankingPoints: BIOBUZZ_RANKING_POINT_RULES,
  penalties: BIOBUZZ_PENALTIES,

  provenanceNotes: [
    BIOBUZZ_LAYOUT_PROVENANCE,
    BIOBUZZ_HAS_NO_WEIGHT_LIMIT,
    BIOBUZZ_FOULS_ASSESSED_BY_REFEREE,
    BIOBUZZ_RP_THRESHOLD_TIER,
  ],
};

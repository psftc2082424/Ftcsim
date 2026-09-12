/**
 * BIOBUZZ sizes, transcribed from the 2026-27 Competition Manual (V1) with
 * page citations. No positions here — only how big things are. Positions are
 * `biobuzzField.ts`'s job, and the split matters for the same reason it did
 * for DECODE: a size the manual states outright must not share a confidence
 * level with a position it only implies.
 *
 * Citations are to the PDF's own page numbers (footer "N of 173").
 */

import { assumed, explicitRule } from '../sourced.js';

/** The FTC field interior is 144 in on a side (§9.2, p.64) — same as every season. */
export const FIELD_SIZE_IN = 144;

export const ALLIANCE_AREA = {
  widthIn: explicitRule(97, 'S9.3', 'an approximately 97 in. (246.40 cm) wide', 65),
  depthIn: explicitRule(54, 'S9.3', 'by 54 in. (137.15 cm) deep', 65),
};

export const LOADING_ZONE = {
  widthIn: explicitRule(23, 'S9.3', 'an approximately 23 in. (58.40 cm) wide', 66),
  depthIn: explicitRule(11, 'S9.3', 'by 11 in. (27.95 cm) deep', 66),
};

export const GARDEN = {
  widthIn: explicitRule(23, 'S9.3', 'an approximately 23 in. (58.40 cm)', 66),
  depthIn: explicitRule(2, 'S9.3', 'by 2 in. (5.10 cm) wide', 66),
};

/** The HIVE Structure's frame (§9.6.1, p.69). */
export const HIVE_FRAME = {
  widthIn: explicitRule(49.46, 'S9.6.1', 'The frame is 49.46 in. (125.65 cm) wide', 69),
  depthIn: explicitRule(38.95, 'S9.6.1', 'and 38.95 in. (98.95 cm) deep at its base', 69),
  pivotHeightIn: explicitRule(
    43.95,
    'S9.6.1',
    'The frame supports 2 pivots with their axis 43.95 in. (111.65 cm) above the TILES.',
    69,
  ),
};

/** One HIVE's two CELLs (§9.6.2, p.70). */
export const HIVE_CELL = {
  /** Centre-to-centre separation between a HIVE's two CELLs. */
  separationIn: explicitRule(
    18.8,
    'S9.6.2',
    'Each HIVE includes two CELLS ... approximately 18.8 in. (47.8 cm) apart',
    70,
  ),
  openingWidthIn: explicitRule(20, 'S9.6.2', 'approximately 20 in. (50.8 cm) wide', 70),
  openingHeightIn: explicitRule(14, 'S9.6.2', 'by 14 in (35.6 cm) tall', 70),
  openingDepthIn: explicitRule(12, 'S9.6.2', 'and 12 in. (30.5 cm) deep', 70),
};

/** The FLOWER (§9.7, p.72). */
export const FLOWER = {
  topOpeningDiameterIn: explicitRule(
    4,
    'S9.7',
    'The opening on the top of each FLOWER is approximately 4 in. (10.15 cm) in diameter',
    72,
  ),
  topOpeningHeightIn: explicitRule(
    21.5,
    'S9.7',
    'approximately 21.5 in. (54.6 cm) above the TILES',
    72,
  ),
  backstopHeightIn: explicitRule(1.25, 'S9.7', 'This backstop is 1.25 in. (3.15 cm) tall', 72),
  retrievalOpeningHeightIn: explicitRule(
    3.55,
    'S9.7',
    'approximately 3.55 in. (9.0 cm) tall',
    72,
  ),
  retrievalOpeningDepthIn: explicitRule(3.57, 'S9.7', 'and 3.57 in. (9.1 cm) deep', 72),
  lowerRingHeightIn: explicitRule(0.4, 'S9.7', 'approximately 0.4 in. (1.0 cm) tall', 72),
  lowerRingHoleDiameterIn: explicitRule(
    2.79,
    'S9.7',
    'a hole for POLLEN to sit in that is approximately 2.79 in. (7.1 cm) diameter',
    72,
  ),
};

/** SCORING ELEMENTS (§9.8, p.73). */
export const POLLEN_DIAMETER_IN = explicitRule(
  2.8,
  'S9.8',
  'POLLEN are approximately 2.8 in. (7.1 cm) Gopher ResisDent polyethylene balls in yellow',
  73,
);
export const NECTAR_DIAMETER_IN = explicitRule(
  3.6,
  'S9.8',
  'NECTAR are approximately 3.6 in. (9.1 cm) Gopher ResisDent polyethylene balls',
  73,
);

export const POLLEN_COUNT = explicitRule(40, 'S9.8', 'There are 40 POLLEN, 8 red NECTAR, and 8 blue NECTAR total', 73);
export const NECTAR_COUNT_PER_ALLIANCE = explicitRule(
  8,
  'S9.8',
  'There are 40 POLLEN, 8 red NECTAR, and 8 blue NECTAR total',
  73,
);

/**
 * Neither ball is published with a mass. AndyMark's am-5851/am-5852 product
 * pages are the DECODE-style route to a real number, but this pass has no
 * fetched figure to cite, so both are an engineering estimate rather than a
 * transcription — the same honesty DECODE's `ARTIFACT_MASS_LB` uses.
 */
export const POLLEN_MASS_LB = assumed(
  0.09,
  'No published mass. Estimated from a hollow polyethylene ball at this diameter, ' +
    'the same weight class as DECODE\'s ARTIFACT. Needs the AndyMark am-5851 spec sheet to confirm.',
);
export const NECTAR_MASS_LB = assumed(
  0.16,
  'No published mass. Estimated from a hollow polyethylene ball at this diameter, ' +
    'scaled up from POLLEN by volume. Needs the AndyMark am-5852 spec sheet to confirm.',
);

/** ROBOT construction limits (§12.1, pp.121-122). */
export const STARTING_CUBE_IN = explicitRule(
  18,
  'R102',
  'the ROBOT must be fully self-contained within an 18 in. (45.70 cm) wide, by 18 in. (45.70 cm) long, by 18 in. (45.70 cm) high volume',
  121,
);
export const EXPANSION_WIDTH_IN = explicitRule(
  18,
  'R105',
  'must remain within a 18 in. (45.70 cm) by 24 in. (61.0 cm) by 29 in. (73.65 cm) tall sizing volume',
  122,
);
export const EXPANSION_DEPTH_IN = explicitRule(
  24,
  'R105',
  'must remain within a 18 in. (45.70 cm) by 24 in. (61.0 cm) by 29 in. (73.65 cm) tall sizing volume',
  122,
);
export const EXPANSION_HEIGHT_IN = explicitRule(
  29,
  'R105',
  'must remain within a 18 in. (45.70 cm) by 24 in. (61.0 cm) by 29 in. (73.65 cm) tall sizing volume',
  122,
);

/**
 * Provenance wrapper (ARCHITECTURE.md §6.1, PRODUCT_SPEC.md §3).
 *
 * Every value extracted from a game manual carries where it came from and how
 * much it should be trusted. This makes "never silently invent important values"
 * a *structural* property rather than a rule someone has to remember: a
 * `GameDefinition` field cannot hold a bare number, so the question "where did
 * this come from?" always has an answer.
 *
 * The assumption ledger for a game is therefore a projection over the
 * definition itself, not a separate document that can drift out of date.
 *
 * Nothing here reads a PDF or talks to a model — this is the type layer only.
 */

/** How much a value can be trusted. Mirrors PRODUCT_SPEC.md §3. */
export type Confidence = 'explicit' | 'inferred' | 'assumed' | 'unknown';

export interface Sourced<T> {
  readonly value: T;
  readonly confidence: Confidence;
  /** Page of the source document the value was read from. */
  readonly sourcePage?: number | undefined;
  /**
   * Rule or section identifier, e.g. `R104`, `G414`, `S10.5.3`.
   *
   * FTC manuals are cited by rule far more often than by page, and a rule number
   * survives a re-paginated revision where a page number does not. Kept separate
   * from `sourcePage` rather than overloading it, because they are different
   * kinds of reference and a citation may have either, both or neither.
   */
  readonly sourceRule?: string | undefined;
  /** Short verbatim quote supporting the value. */
  readonly sourceQuote?: string | undefined;
  /** Why this confidence level, especially for `assumed` and `unknown`. */
  readonly note?: string | undefined;
}

/** Stated directly by the manual. */
export function explicit<T>(value: T, sourcePage?: number, sourceQuote?: string): Sourced<T> {
  return { value, confidence: 'explicit', sourcePage, sourceQuote };
}

/** Stated directly by the manual, cited by rule or section rather than page. */
export function explicitRule<T>(value: T, sourceRule: string, sourceQuote?: string): Sourced<T> {
  return { value, confidence: 'explicit', sourceRule, sourceQuote };
}

/** Deduced from a diagram or from surrounding text, not stated outright. */
export function inferred<T>(value: T, note: string, sourcePage?: number): Sourced<T> {
  return { value, confidence: 'inferred', note, sourcePage };
}

/** An engineering estimate, because the manual does not say. */
export function assumed<T>(value: T, note: string): Sourced<T> {
  return { value, confidence: 'assumed', note };
}

/**
 * Could not be determined at all.
 *
 * A value is still required — the simulation needs *something* to run — so this
 * carries a placeholder. It means "this number is a stand-in and a human must
 * replace it", which is strictly weaker than `assumed`.
 */
export function unresolved<T>(placeholder: T, note: string): Sourced<T> {
  return { value: placeholder, confidence: 'unknown', note };
}

/** Values a user can reasonably act on without checking the manual themselves. */
export function isTrustworthy<T>(sourced: Sourced<T>): boolean {
  return sourced.confidence === 'explicit' || sourced.confidence === 'inferred';
}

/** Values that must be surfaced for review before a definition is used. */
export function needsReview<T>(sourced: Sourced<T>): boolean {
  return !isTrustworthy(sourced);
}

/** Read the value, discarding provenance. Use where provenance is irrelevant. */
export function valueOf<T>(sourced: Sourced<T>): T {
  return sourced.value;
}

/**
 * Human-readable provenance, for the review editor and the assumption ledger.
 */
export function describeSource<T>(sourced: Sourced<T>): string {
  const parts: string[] = [sourced.confidence];
  if (sourced.sourceRule !== undefined) parts.push(sourced.sourceRule);
  if (sourced.sourcePage !== undefined) parts.push(`p.${sourced.sourcePage}`);
  if (sourced.note !== undefined) parts.push(sourced.note);
  return parts.join(' — ');
}

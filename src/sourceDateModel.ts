import { lineMap } from "./lineDiff";

/**
 * Source dates on the text in the editor: a line unchanged since the checkout's baseline shows
 * the date the IBM i recorded for it; a line added or changed locally has none yet. Kept free of
 * the `vscode` module so it can be unit tested.
 */

/** Two-digit years from this one are 19xx (the IBM i's own pivot for source dates). */
const PIVOT_YEAR = 40;

/** A source date as `YYYY-MM-DD`, or undefined for "0" (never dated) or anything else. */
export function formatSourceDate(raw: string): string | undefined {
  if (!/^\d{6}$/.test(raw)) {
    return undefined;
  }
  const yy = Number(raw.slice(0, 2));
  const month = raw.slice(2, 4);
  const day = raw.slice(4, 6);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    return undefined;
  }
  return `${yy >= PIVOT_YEAR ? 1900 + yy : 2000 + yy}-${month}-${day}`;
}

export interface SourceDateLookup {
  /** The formatted date of a line of the current text (0-based), or undefined when it has none. */
  dateAt(line: number): string | undefined;
  /** Whether the line is unchanged from the baseline (it may still have no date). */
  isMapped(line: number): boolean;
  /** Lines of the current text. */
  lines: number;
  /** The texts differed too much to map line by line; only the common ends are mapped. */
  truncated: boolean;
}

/**
 * Maps the baseline's dates onto `current` through the lines unchanged between the two texts.
 * `dates` is one entry per baseline line, as `DateStore` keeps them.
 */
export function mapSourceDates(baseline: string, current: string, dates: readonly string[]): SourceDateLookup {
  const { map, truncated } = lineMap(baseline, current);
  return {
    dateAt: (line) => {
      const index = map[line];
      return index === undefined ? undefined : formatSourceDate(dates[index] ?? "0");
    },
    isMapped: (line) => map[line] !== undefined,
    lines: map.length,
    truncated,
  };
}

/** The dates of lines `start` to `end` (0-based, inclusive), null where there is none. */
export function datesForLines(lookup: SourceDateLookup, start: number, end: number): Array<string | null> {
  const dates: Array<string | null> = [];
  for (let line = start; line <= end; line++) {
    dates.push(lookup.dateAt(line) ?? null);
  }
  return dates;
}

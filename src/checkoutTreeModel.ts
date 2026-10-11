import { CheckedOutMember, CheckoutStatus, formatMemberPath, isReferenceCopy } from "./types";

/**
 * What Checked Out Members shows, without the `vscode` module: which source files and members are
 * listed for a search, and each member's description, tooltip, icon and context value.
 * `checkoutTreeProvider.ts` turns these into tree items. Dates are formatted by the caller, since
 * VS Code shows them in the user's locale.
 */

export interface DateFormat {
  date(iso: string): string;
  dateTime(iso: string): string;
}

/** A theme icon's id and, if any, its theme color id. */
export interface IconSpec {
  id: string;
  colorId?: string;
}

/** Whether a checkout matches the search term (already lowercased): its member name contains it. */
export function matchesSearch(entry: Pick<CheckedOutMember, "memberName">, term: string): boolean {
  return !term || entry.memberName.toLowerCase().includes(term);
}

/** The source files with members matching `term`, each once, by library then source file. */
export function sourceFileGroups(
  entries: readonly CheckedOutMember[],
  term: string
): Array<{ library: string; sourceFile: string }> {
  const seen = new Set<string>();
  const groups: Array<{ library: string; sourceFile: string }> = [];
  for (const entry of entries.filter((e) => matchesSearch(e, term))) {
    const key = `${entry.library}/${entry.sourceFile}`;
    if (!seen.has(key)) {
      seen.add(key);
      groups.push({ library: entry.library, sourceFile: entry.sourceFile });
    }
  }
  return groups.sort((a, b) => a.library.localeCompare(b.library) || a.sourceFile.localeCompare(b.sourceFile));
}

/** The members of one source file matching `term`, by member name. */
export function membersOf(
  entries: readonly CheckedOutMember[],
  library: string,
  sourceFile: string,
  term: string
): CheckedOutMember[] {
  return entries
    .filter((e) =>
      e.library.toUpperCase() === library.toUpperCase() &&
      e.sourceFile.toUpperCase() === sourceFile.toUpperCase() &&
      matchesSearch(e, term)
    )
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
}

/** The status part of a member's description, with the date it was checked out or last checked. */
export function statusDescription(entry: CheckedOutMember, format: DateFormat): string {
  const checkedOutDate = format.date(entry.checkedOutAt);
  const checkedDate = entry.lastCheckedAt ? format.date(entry.lastCheckedAt) : checkedOutDate;
  switch (entry.status) {
    case "checked-out":
      return `checked out ${checkedOutDate}`;
    case "merged":
      return `merged ${checkedDate}`;
    case "modified":
      return `local changes pending (checked ${checkedDate})`;
    case "remote-changed":
      return `remote changed ${checkedDate}`;
    case "conflict":
      return `conflict detected ${checkedDate}`;
    case "in-sync":
      return `in sync ${checkedDate}`;
    case "remote-missing":
      return `deleted on IBM i (checked ${checkedDate})`;
  }
}

/** The stale-checkout reminder: members checked out for `thresholdDays` or longer (0 turns it off). */
export interface StaleCheck {
  now: Date;
  thresholdDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the member was checked out; 0 for a checkout today or an unreadable date. */
export function checkoutAgeDays(entry: Pick<CheckedOutMember, "checkedOutAt">, now: Date): number {
  const age = Math.floor((now.getTime() - Date.parse(entry.checkedOutAt)) / DAY_MS);
  return Number.isFinite(age) && age > 0 ? age : 0;
}

/** Whether a checkout for change has been out for the reminder's number of days. Reference copies never are. */
export function isStale(entry: Pick<CheckedOutMember, "checkedOutAt" | "kind">, stale: StaleCheck): boolean {
  return stale.thresholdDays > 0 && !isReferenceCopy(entry) && checkoutAgeDays(entry, stale.now) >= stale.thresholdDays;
}

/** The stale checkouts, oldest first. */
export function staleEntries(entries: readonly CheckedOutMember[], stale: StaleCheck): CheckedOutMember[] {
  return entries
    .filter((entry) => isStale(entry, stale))
    .sort((a, b) => Date.parse(a.checkedOutAt) - Date.parse(b.checkedOutAt));
}

/** A member's description: a missing local file first, then reference copies, then its status, then its age when stale. */
export function memberDescription(entry: CheckedOutMember, localMissing: boolean, format: DateFormat, stale?: StaleCheck): string {
  if (localMissing) {
    return "local file missing — Refresh to re-checkout or remove";
  }
  const status = isReferenceCopy(entry) ? `reference · ${statusDescription(entry, format)}` : statusDescription(entry, format);
  return stale && isStale(entry, stale) ? `${status} · ${checkoutAgeDays(entry, stale.now)} days` : status;
}

/** A member's tooltip, as Markdown. */
export function memberTooltip(entry: CheckedOutMember, localMissing: boolean, format: DateFormat, stale?: StaleCheck): string {
  let md = `**${formatMemberPath(entry)}**\n\n`;
  if (isReferenceCopy(entry)) {
    md += "Read-only reference copy: it can't be uploaded or merged back.\n\n";
  }
  if (entry.status === "remote-missing") {
    md += "The member no longer exists on the IBM i. Your local copy is kept: remove the checkout, or keep the file.\n\n";
  }
  md += `- **System:** ${entry.system}\n`;
  md += `- **Status:** ${entry.status}\n`;
  md += `- **Checked out:** ${format.dateTime(entry.checkedOutAt)}`;
  if (stale && isStale(entry, stale)) {
    md += ` (${checkoutAgeDays(entry, stale.now)} days ago)`;
  }
  md += "\n";
  if (entry.lastCheckedAt) {
    md += `- **Last checked:** ${format.dateTime(entry.lastCheckedAt)}\n`;
  }
  md += `- **Local:** ${entry.localPath}${localMissing ? " (missing)" : ""}\n`;
  return md;
}

const STATUS_ICONS: Record<CheckoutStatus, IconSpec> = {
  "checked-out": { id: "edit", colorId: "charts.yellow" },
  merged: { id: "check", colorId: "charts.green" },
  modified: { id: "pencil", colorId: "charts.orange" },
  "remote-changed": { id: "cloud-download", colorId: "charts.blue" },
  conflict: { id: "warning", colorId: "charts.red" },
  "in-sync": { id: "check-all", colorId: "charts.green" },
  "remote-missing": { id: "circle-slash", colorId: "charts.red" },
};

/** A member's icon: a missing local file first, then reference copies, then its status. */
export function memberIcon(entry: CheckedOutMember, localMissing: boolean): IconSpec {
  return localMissing
    ? { id: "error", colorId: "problemsErrorIcon.foreground" }
    : isReferenceCopy(entry)
      ? { id: "lock" }
      : STATUS_ICONS[entry.status];
}

/**
 * The context value menus match on: "checkout-<status>" or "reference-<status>", so Upload, Merge
 * Back and Run Action never apply to reference copies, nor to members deleted on the IBM i.
 */
export function contextValueFor(entry: CheckedOutMember): string {
  return `${isReferenceCopy(entry) ? "reference" : "checkout"}-${entry.status}`;
}

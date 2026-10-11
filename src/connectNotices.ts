import { CheckedOutMember, isReferenceCopy } from "./types";

/**
 * What the extension tells the user when the connection comes or goes: members whose changes
 * haven't reached the IBM i, and checkouts that have been out for a long time. Kept free of the
 * `vscode` module; `commands/connectNotices.ts` shows the messages.
 */

/** How many member names a notice lists before "and N more". */
const NAMES_SHOWN = 5;

/** Checkouts for change whose local text differs from the IBM i's: modified, or in conflict. */
export function unsentChanges(entries: readonly CheckedOutMember[]): CheckedOutMember[] {
  return entries.filter((entry) => !isReferenceCopy(entry) && (entry.status === "modified" || entry.status === "conflict"));
}

/** The member names, at most `NAMES_SHOWN` of them, then "and N more". */
export function listNames(entries: readonly CheckedOutMember[]): string {
  const names = entries.map((entry) => entry.memberName);
  if (names.length <= NAMES_SHOWN) {
    return names.join(", ");
  }
  return `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`;
}

function members(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/** The warning shown when the connection to `system` drops with changes not uploaded. */
export function disconnectedMessage(system: string, unsent: readonly CheckedOutMember[]): string {
  return (
    `${members(unsent.length)} on ${system} ${unsent.length === 1 ? "has" : "have"} changes not uploaded: ${listNames(unsent)}. ` +
    "They stay on your computer; upload them when you reconnect."
  );
}

/** The reminder shown after connecting to `system` with changes still not uploaded. */
export function reconnectedMessage(system: string, unsent: readonly CheckedOutMember[]): string {
  return `${members(unsent.length)} on ${system} still ${unsent.length === 1 ? "has" : "have"} changes not uploaded: ${listNames(unsent)}.`;
}

/** The reminder about members checked out for `thresholdDays` or longer. */
export function staleMessage(stale: readonly CheckedOutMember[], thresholdDays: number): string {
  return (
    `${members(stale.length)} ${stale.length === 1 ? "has" : "have"} been checked out for more than ` +
    `${thresholdDays} day${thresholdDays === 1 ? "" : "s"}: ${listNames(stale)}. ` +
    "Upload or discard what you're done with, or raise ibmi-member-workspace.staleCheckoutDays."
  );
}

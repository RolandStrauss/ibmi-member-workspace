import { memberNameProblem } from "./types";

/**
 * New Member and Copy Member As: the CL commands that add a source member on the IBM i, and the
 * checks on what the user typed before anything reaches a command string. Kept free of the
 * `vscode` module so it can be unit tested; `commands/memberCreate.ts` asks and runs.
 */

/** ADDPFM's TEXT parameter holds 50 characters. */
export const MAX_MEMBER_TEXT = 50;

export interface MemberRef {
  library: string;
  sourceFile: string;
  memberName: string;
}

export interface NewMemberSpec extends MemberRef {
  /** The SEU source type, e.g. RPGLE; it becomes the local file's extension. */
  sourceType: string;
  /** The member's description; empty for none. */
  text: string;
}

/** Why the text can't go into the command, or undefined. */
export function memberTextProblem(text: string): string | undefined {
  if (text.length > MAX_MEMBER_TEXT) {
    return `The text is ${text.length} characters; the IBM i keeps ${MAX_MEMBER_TEXT}.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    return "The text can't contain control characters.";
  }
  return undefined;
}

/** Why the member can't be created as specified, or undefined. */
export function newMemberProblem(spec: NewMemberSpec): string | undefined {
  return memberNameProblem({ ...spec, extension: spec.sourceType }) ?? memberTextProblem(spec.text);
}

/** Text as a quoted CL value: apostrophes doubled. */
export function clText(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function qualified(ref: MemberRef): string {
  return `${ref.library.toUpperCase()}/${ref.sourceFile.toUpperCase()}`;
}

/** The ADDPFM command that adds the empty member with its source type and text. */
export function addMemberCommand(spec: NewMemberSpec): string {
  const text = spec.text.trim();
  return (
    `ADDPFM FILE(${qualified(spec)}) MBR(${spec.memberName.toUpperCase()}) SRCTYPE(${spec.sourceType.toUpperCase()})` +
    (text ? ` TEXT(${clText(text)})` : "")
  );
}

/**
 * The CPYSRCF command that fills `to` with `from`'s source. `MBROPT(*REPLACE)` replaces the
 * (empty) member's records; sequence numbers and source dates are kept (`SRCOPT(*SAME)`).
 */
export function copySourceCommand(from: MemberRef, to: MemberRef): string {
  return (
    `CPYSRCF FROMFILE(${qualified(from)}) TOFILE(${qualified(to)}) ` +
    `FROMMBR(${from.memberName.toUpperCase()}) TOMBR(${to.memberName.toUpperCase()}) MBROPT(*REPLACE)`
  );
}

/**
 * Copy Member As: ADDPFM first, so the member gets the source type and text the user chose
 * (CPYSRCF alone would take the original's), then CPYSRCF to fill it.
 */
export function copyMemberPlan(from: MemberRef, to: NewMemberSpec): string[] {
  return [addMemberCommand(to), copySourceCommand(from, to)];
}

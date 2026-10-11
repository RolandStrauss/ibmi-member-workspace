import type { MemberInfo } from "./memberInfo";
import { CheckedOutMember, isReferenceCopy, memberNameProblem, systemKey } from "./types";

/**
 * Export and Import Work Item: the list of a work item's members as a small JSON file, so a
 * colleague (or the same person on another computer) can check out the same set. The file names
 * members, never text or tokens. Kept free of the `vscode` module so it can be unit tested.
 */

export const WORK_ITEM_FORMAT = "ibmi-member-workspace/work-item";
export const WORK_ITEM_EXPORT_VERSION = 1;
export const MAX_EXPORTED_MEMBERS = 5000;

export interface ExportedMember {
  library: string;
  sourceFile: string;
  memberName: string;
  extension: string;
  kind?: "reference";
}

export interface WorkItemExport {
  format: typeof WORK_ITEM_FORMAT;
  version: typeof WORK_ITEM_EXPORT_VERSION;
  system: string;
  workItem: string;
  exportedAt: string;
  members: ExportedMember[];
}

export function exportWorkItem(system: string, workItem: string, entries: readonly CheckedOutMember[], now = new Date()): WorkItemExport {
  return {
    format: WORK_ITEM_FORMAT,
    version: WORK_ITEM_EXPORT_VERSION,
    system,
    workItem,
    exportedAt: now.toISOString(),
    members: [...entries]
      .sort((a, b) => a.library.localeCompare(b.library) || a.sourceFile.localeCompare(b.sourceFile) || a.memberName.localeCompare(b.memberName))
      .map((entry) => ({
        library: entry.library,
        sourceFile: entry.sourceFile,
        memberName: entry.memberName,
        extension: entry.extension,
        ...(isReferenceCopy(entry) ? { kind: "reference" as const } : {}),
      })),
  };
}

/** The file's name for a work item, safe for any file system. */
export function exportFileName(workItem: string): string {
  return `${workItem.replace(/[\\/:*?"<>|\s]+/g, "_") || "work-item"}.ibmi-work-item.json`;
}

export type ParsedExport = { ok: true; value: WorkItemExport } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a file's text is a work item export whose every member name is an IBM i name. */
export function parseWorkItemExport(text: string): ParsedExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The file isn't JSON." };
  }
  if (!isRecord(parsed) || parsed.format !== WORK_ITEM_FORMAT) {
    return { ok: false, reason: "The file isn't a work item export from IBM i Member Workspace." };
  }
  if (parsed.version !== WORK_ITEM_EXPORT_VERSION) {
    return { ok: false, reason: `The file is version ${String(parsed.version)}; this version of the extension reads version ${WORK_ITEM_EXPORT_VERSION}.` };
  }
  if (typeof parsed.system !== "string" || parsed.system.trim() === "" || typeof parsed.workItem !== "string") {
    return { ok: false, reason: "The file doesn't say which system or work item it is for." };
  }
  if (!Array.isArray(parsed.members)) {
    return { ok: false, reason: "The file has no member list." };
  }
  if (parsed.members.length > MAX_EXPORTED_MEMBERS) {
    return { ok: false, reason: `The file lists ${parsed.members.length} members; at most ${MAX_EXPORTED_MEMBERS} are imported.` };
  }
  const members: ExportedMember[] = [];
  for (const [index, item] of parsed.members.entries()) {
    if (!isRecord(item)) {
      return { ok: false, reason: `Member ${index + 1} isn't an object.` };
    }
    const member = {
      library: String(item.library ?? "").toUpperCase(),
      sourceFile: String(item.sourceFile ?? "").toUpperCase(),
      memberName: String(item.memberName ?? "").toUpperCase(),
      extension: String(item.extension ?? "").toLowerCase(),
    };
    const problem = memberNameProblem(member);
    if (problem) {
      return { ok: false, reason: `Member ${index + 1}: ${problem}` };
    }
    members.push(item.kind === "reference" ? { ...member, kind: "reference" } : member);
  }
  return {
    ok: true,
    value: {
      format: WORK_ITEM_FORMAT,
      version: WORK_ITEM_EXPORT_VERSION,
      system: parsed.system.trim(),
      workItem: parsed.workItem,
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "",
      members,
    },
  };
}

export type ImportPlan = { editable: MemberInfo[]; reference: MemberInfo[] } | { problem: string };

/** What to check out from the file, or why not: it must be for the connected system. */
export function importPlan(file: WorkItemExport, connectedSystem: string | undefined): ImportPlan {
  if (!connectedSystem) {
    return { problem: `Connect to ${file.system} first: the file's members are on that system.` };
  }
  if (systemKey(connectedSystem) !== systemKey(file.system)) {
    return { problem: `The file is for ${file.system}, but you are connected to ${connectedSystem}. Connect to ${file.system} to import it.` };
  }
  const toInfo = ({ library, sourceFile, memberName, extension }: ExportedMember): MemberInfo => ({ library, sourceFile, memberName, extension });
  return {
    editable: file.members.filter((member) => member.kind !== "reference").map(toInfo),
    reference: file.members.filter((member) => member.kind === "reference").map(toInfo),
  };
}

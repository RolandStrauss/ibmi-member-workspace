import * as path from "node:path";
import { buildCheckoutId, memberNameProblem } from "./types";

/**
 * Adopt Checkout Folder: the files already in the checkout folder's layout
 * (`<system>/<LIB>/<SRCFILE>/<MEMBER>.<EXT>`) that no checkout tracks, for example after the
 * same folder is opened from another workspace or computer. Kept free of the `vscode` module and
 * of the file system so it can be unit tested; the folder is injected.
 */

export interface FolderEntry {
  name: string;
  kind: "file" | "directory" | "link" | "other";
}

export interface FolderIo {
  /** The entries of a directory; empty when it doesn't exist or can't be read. */
  list(directory: string): FolderEntry[];
  /** Whether the file can't be written: how a reference copy is kept. */
  isReadOnly(filePath: string): boolean;
}

export interface AdoptCandidate {
  library: string;
  sourceFile: string;
  memberName: string;
  extension: string;
  localPath: string;
  readOnly: boolean;
}

export interface ScanResult {
  candidates: AdoptCandidate[];
  /** Files and folders in the layout's place whose names aren't IBM i names, and links. */
  skipped: number;
  /** The scan stopped at `MAX_ADOPT_CANDIDATES`. */
  truncated: boolean;
}

/** A folder of thousands of members is adopted in parts, so one quick pick stays usable. */
export const MAX_ADOPT_CANDIDATES = 2000;

/** The layout writes upper-case names; another case would be tracked under a path that isn't the file's on a case-sensitive file system. */
function named(entry: FolderEntry, kind: FolderEntry["kind"]): boolean {
  return entry.kind === kind && !entry.name.startsWith(".") && entry.name === entry.name.toUpperCase();
}

/**
 * The members found under `<root>/<systemFolder>` that aren't in `trackedIds` (checkout ids for
 * `system`). Only the fixed three levels are read; links are never followed.
 */
export function scanCheckoutFolder(
  root: string,
  systemFolder: string,
  system: string,
  io: FolderIo,
  trackedIds: ReadonlySet<string>
): ScanResult {
  const result: ScanResult = { candidates: [], skipped: 0, truncated: false };
  const systemRoot = path.join(root, systemFolder);
  const sorted = (entries: FolderEntry[]) => [...entries].sort((a, b) => a.name.localeCompare(b.name));

  const counted = (entry: FolderEntry) => entry.kind === "link" || (entry.kind === "directory" && !entry.name.startsWith(".")) ? 1 : 0;
  for (const libraryEntry of sorted(io.list(systemRoot))) {
    if (!named(libraryEntry, "directory")) {
      result.skipped += counted(libraryEntry);
      continue;
    }
    const libraryDir = path.join(systemRoot, libraryEntry.name);
    for (const fileEntry of sorted(io.list(libraryDir))) {
      if (!named(fileEntry, "directory")) {
        result.skipped += counted(fileEntry);
        continue;
      }
      const sourceDir = path.join(libraryDir, fileEntry.name);
      for (const memberEntry of sorted(io.list(sourceDir))) {
        if (!named(memberEntry, "file")) {
          result.skipped += memberEntry.kind === "link" || (memberEntry.kind === "file" && !memberEntry.name.startsWith(".")) ? 1 : 0;
          continue;
        }
        const dot = memberEntry.name.lastIndexOf(".");
        if (dot <= 0 || dot === memberEntry.name.length - 1) {
          result.skipped++;
          continue;
        }
        const candidate = {
          library: libraryEntry.name.toUpperCase(),
          sourceFile: fileEntry.name.toUpperCase(),
          memberName: memberEntry.name.slice(0, dot).toUpperCase(),
          extension: memberEntry.name.slice(dot + 1).toLowerCase(),
        };
        if (memberNameProblem(candidate)) {
          result.skipped++;
          continue;
        }
        if (trackedIds.has(buildCheckoutId(system, candidate.library, candidate.sourceFile, candidate.memberName))) {
          continue;
        }
        if (result.candidates.length >= MAX_ADOPT_CANDIDATES) {
          result.truncated = true;
          return result;
        }
        const localPath = path.join(sourceDir, memberEntry.name);
        result.candidates.push({ ...candidate, localPath, readOnly: io.isReadOnly(localPath) });
      }
    }
  }
  return result;
}

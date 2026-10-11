/**
 * Compile on IBM i: what a compile's events file (EVFEVENT, written with OPTION(*EVENTF)) says,
 * turned into diagnostics for the local files. Code for IBM i parses the file; this module
 * chooses which EVFEVENT member is the compile's, maps the parsed errors to checkouts, and
 * words the summary. Kept free of the `vscode` module so it can be unit tested.
 */

/** Code for IBM i's parsed event, as its `evfeventParser` returns it. */
export interface FileErrorLike {
  sev: number;
  lineNum: number;
  toLineNum: number;
  column: number;
  toColumn: number;
  text: string;
  code: string;
}

export interface EvfeventRow {
  library: string;
  /** When the member last changed, as the IBM i reports it. */
  updated: string;
}

/** The EVFEVENT member written last: the compile's, when several libraries hold one for the program. */
export function newestEvfevent(rows: readonly EvfeventRow[]): EvfeventRow | undefined {
  return [...rows].sort((a, b) => b.updated.localeCompare(a.updated))[0];
}

export type CompileSeverity = "error" | "warning" | "info";

export interface CompileDiagnostic {
  /** The file as the events file names it, e.g. DEVLIB/QRPGLESRC/ORD100. */
  path: string;
  /** The checkout's local file, when the member is checked out. */
  localPath?: string;
  /** 0-based. */
  line: number;
  endLine: number;
  column: number;
  endColumn: number;
  severity: CompileSeverity;
  message: string;
  code: string;
}

/** ILE compilers: severity 30 and above stops the compile, 20 warns, below that informs. */
export function severityOf(sev: number): CompileSeverity {
  return sev >= 30 ? "error" : sev >= 20 ? "warning" : "info";
}

/**
 * The events as diagnostics, each tied to the local file `resolve` gives for its path. Paths
 * that resolve to nothing (a copybook that isn't checked out) are listed in `unresolvedFiles`.
 */
export function toDiagnostics(
  parsed: ReadonlyMap<string, readonly FileErrorLike[]>,
  resolve: (path: string) => string | undefined
): { diagnostics: CompileDiagnostic[]; unresolvedFiles: string[] } {
  const diagnostics: CompileDiagnostic[] = [];
  const unresolvedFiles: string[] = [];
  for (const [path, errors] of parsed) {
    if (errors.length === 0) {
      continue;
    }
    const localPath = resolve(path);
    if (localPath === undefined) {
      unresolvedFiles.push(path);
    }
    for (const error of errors) {
      const line = Math.max(0, error.lineNum - 1);
      const column = Math.max(0, error.column - 1);
      diagnostics.push({
        path,
        ...(localPath === undefined ? {} : { localPath }),
        line,
        endLine: Math.max(line, error.toLineNum - 1),
        column,
        endColumn: Math.max(column + 1, error.toColumn),
        severity: severityOf(error.sev),
        message: error.text,
        code: error.code,
      });
    }
  }
  return { diagnostics, unresolvedFiles };
}

/** "3 errors, 1 warning" or "no errors or warnings"; informational messages are counted only when nothing else is. */
export function describeCounts(diagnostics: readonly CompileDiagnostic[]): string {
  const count = (severity: CompileSeverity) => diagnostics.filter((d) => d.severity === severity).length;
  const errors = count("error");
  const warnings = count("warning");
  const parts = [
    ...(errors > 0 ? [`${errors} error${errors === 1 ? "" : "s"}`] : []),
    ...(warnings > 0 ? [`${warnings} warning${warnings === 1 ? "" : "s"}`] : []),
  ];
  if (parts.length > 0) {
    return parts.join(", ");
  }
  const infos = count("info");
  return infos > 0 ? `no errors or warnings (${infos} informational message${infos === 1 ? "" : "s"})` : "no errors or warnings";
}

/** The notification after a compile; `success` is what Code for IBM i's action reported, when known. */
export function summarizeCompile(member: string, diagnostics: readonly CompileDiagnostic[], success?: boolean): string {
  const counts = describeCounts(diagnostics);
  const failedQuietly = success === false && !diagnostics.some((d) => d.severity === "error");
  return `Compile of ${member}: ${counts}.${failedQuietly ? " The action reported a failure: see the job log." : ""}`;
}

/** The libraries an EVFEVENT member is looked for in: the member's own, then the current library and library list. */
export function compileLibraries(memberLibrary: string, libraryList: readonly string[]): string[] {
  const seen = new Set<string>();
  return [memberLibrary, ...libraryList]
    .map((library) => library.trim().toUpperCase())
    .filter((library) => library !== "" && !seen.has(library) && (seen.add(library), true));
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileErrorLike, compileLibraries, describeCounts, newestEvfevent, severityOf, summarizeCompile, toDiagnostics } from "../compileResult";

function error(sev: number, lineNum: number, text: string, overrides: Partial<FileErrorLike> = {}): FileErrorLike {
  return { sev, lineNum, toLineNum: lineNum, column: 1, toColumn: 0, text, code: `RNF${sev}`, ...overrides };
}

describe("newestEvfevent", () => {
  it("picks the member changed last", () => {
    const rows = [
      { library: "DEVLIB", updated: "2026-10-10 10:00:00.000000" },
      { library: "QTEMP", updated: "2026-10-10 10:05:00.000000" },
      { library: "OLDLIB", updated: "2026-10-01 10:05:00.000000" },
    ];
    assert.equal(newestEvfevent(rows)?.library, "QTEMP");
    assert.equal(newestEvfevent([]), undefined);
  });
});

describe("toDiagnostics", () => {
  it("maps 1-based positions to 0-based ranges and resolves files to local paths", () => {
    const parsed = new Map<string, FileErrorLike[]>([
      ["DEVLIB/QRPGLESRC/ORD100", [error(30, 12, "Not defined", { column: 8, toColumn: 14 }), error(0, 0, "Compile started")]],
      ["PRODLIB/QCPYSRC/ORDCPY", [error(20, 3, "Unused")]],
      ["DEVLIB/QRPGLESRC/EMPTY", []],
    ]);
    const { diagnostics, unresolvedFiles } = toDiagnostics(parsed, (path) => (path.endsWith("ORD100") ? "/c/ORD100.RPGLE" : undefined));
    assert.deepEqual(unresolvedFiles, ["PRODLIB/QCPYSRC/ORDCPY"]);
    assert.equal(diagnostics.length, 3);
    assert.deepEqual(diagnostics[0], {
      path: "DEVLIB/QRPGLESRC/ORD100", localPath: "/c/ORD100.RPGLE", line: 11, endLine: 11, column: 7, endColumn: 14,
      severity: "error", message: "Not defined", code: "RNF30",
    });
    assert.deepEqual([diagnostics[1].line, diagnostics[1].column, diagnostics[1].endColumn, diagnostics[1].severity], [0, 0, 1, "info"]);
    assert.equal(diagnostics[2].localPath, undefined);
    assert.equal(diagnostics[2].severity, "warning");
  });

  it("grades severities as ILE compilers do", () => {
    assert.deepEqual([severityOf(50), severityOf(30), severityOf(20), severityOf(10), severityOf(0)], ["error", "error", "warning", "info", "info"]);
  });
});

describe("summarizeCompile", () => {
  const { diagnostics } = toDiagnostics(new Map([["X", [error(30, 1, "a"), error(30, 2, "b"), error(20, 3, "c"), error(0, 4, "d")]]]), () => undefined);

  it("counts errors and warnings, and informational messages only when there is nothing else", () => {
    assert.equal(describeCounts(diagnostics), "2 errors, 1 warning");
    assert.equal(describeCounts(diagnostics.filter((d) => d.severity === "info")), "no errors or warnings (1 informational message)");
    assert.equal(describeCounts([]), "no errors or warnings");
  });

  it("mentions a failure the events don't explain", () => {
    assert.equal(summarizeCompile("ORD100", diagnostics, false), "Compile of ORD100: 2 errors, 1 warning.");
    assert.equal(summarizeCompile("ORD100", [], false), "Compile of ORD100: no errors or warnings. The action reported a failure: see the job log.");
    assert.equal(summarizeCompile("ORD100", [], true), "Compile of ORD100: no errors or warnings.");
  });
});

describe("compileLibraries", () => {
  it("starts with the member's library and drops repeats and blanks", () => {
    assert.deepEqual(compileLibraries("devlib", ["QTEMP", "DEVLIB", "", " prodlib "]), ["DEVLIB", "QTEMP", "PRODLIB"]);
  });
});

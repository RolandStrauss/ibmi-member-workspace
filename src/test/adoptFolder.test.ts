import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { FolderEntry, FolderIo, MAX_ADOPT_CANDIDATES, scanCheckoutFolder } from "../adoptFolder";
import { buildCheckoutId } from "../types";

const root = path.join("/", "checkout");

/** A folder tree: directories map to their entries, files to "file" or "ro" (read-only), links to "link". */
function folder(tree: Record<string, string[]>): FolderIo {
  const readOnly = new Set<string>();
  const io: FolderIo = {
    list: (directory) => (tree[directory] ?? []).map((item): FolderEntry => {
      const [name, kind = "directory"] = item.split(":");
      if (kind === "ro") {
        readOnly.add(path.join(directory, name));
      }
      return { name, kind: kind === "ro" ? "file" : (kind as FolderEntry["kind"]) };
    }),
    isReadOnly: (filePath) => readOnly.has(filePath),
  };
  return io;
}

const sys = path.join(root, "dev.example.com");

describe("scanCheckoutFolder", () => {
  it("finds members three levels down, skipping what's tracked, dot folders, links and odd names", () => {
    const io = folder({
      [sys]: ["DEVLIB", ".git", "PRODLIB", "notes.txt:file", "elsewhere:link", "lowerlib"],
      [path.join(sys, "DEVLIB")]: ["QRPGLESRC", "QCLSRC"],
      [path.join(sys, "DEVLIB", "QRPGLESRC")]: ["ORD100.RPGLE:file", "ORD200.SQLRPGLE:file", "README:file", "ORD 300.RPGLE:file", "x.rpgle:link", "ord400.rpgle:file"],
      [path.join(sys, "DEVLIB", "QCLSRC")]: ["ORD100C.CLLE:file"],
      [path.join(sys, "PRODLIB")]: ["QRPGLESRC"],
      [path.join(sys, "PRODLIB", "QRPGLESRC")]: ["ORDUTIL.RPGLE:ro"],
    });
    const tracked = new Set([buildCheckoutId("dev.example.com", "DEVLIB", "QRPGLESRC", "ORD200")]);
    const result = scanCheckoutFolder(root, "dev.example.com", "dev.example.com", io, tracked);
    assert.deepEqual(result.candidates.map((c) => `${c.library}/${c.sourceFile}(${c.memberName}).${c.extension}${c.readOnly ? " ro" : ""}`), [
      "DEVLIB/QCLSRC(ORD100C).clle",
      "DEVLIB/QRPGLESRC(ORD100).rpgle",
      "PRODLIB/QRPGLESRC(ORDUTIL).rpgle ro",
    ]);
    assert.equal(result.candidates[1].localPath, path.join(sys, "DEVLIB", "QRPGLESRC", "ORD100.RPGLE"));
    // README (no extension), "ORD 300" (not a name), "ord400.rpgle" and "lowerlib" (not the layout's upper case), two links.
    assert.equal(result.skipped, 6);
    assert.equal(result.truncated, false);
  });

  it("finds nothing in a folder that doesn't exist", () => {
    assert.deepEqual(scanCheckoutFolder(root, "nowhere", "nowhere", folder({}), new Set()), { candidates: [], skipped: 0, truncated: false });
  });

  it("stops at the limit and says so", () => {
    const names = Array.from({ length: MAX_ADOPT_CANDIDATES + 1 }, (_, i) => `M${String(i).padStart(5, "0")}.RPGLE:file`);
    const io = folder({ [sys]: ["LIB"], [path.join(sys, "LIB")]: ["SRC"], [path.join(sys, "LIB", "SRC")]: names });
    const result = scanCheckoutFolder(root, "dev.example.com", "dev.example.com", io, new Set());
    assert.equal(result.candidates.length, MAX_ADOPT_CANDIDATES);
    assert.equal(result.truncated, true);
  });
});

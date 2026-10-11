import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lineMap, unifiedDiff } from "../lineDiff";

const lines = (...items: string[]) => items.join("\n");

describe("unifiedDiff", () => {
  it("says identical texts are identical, as the IBM i stores them", () => {
    const diff = unifiedDiff("﻿a  \r\nb\r\n\r\n", "a\nb");
    assert.deepEqual(diff, { identical: true, added: 0, removed: 0, text: "", truncated: false });
  });

  it("shows an inserted line with context and the labels", () => {
    const diff = unifiedDiff(lines("1", "2", "3", "4", "5"), lines("1", "2", "3", "new", "4", "5"), { aLabel: "local", bLabel: "IBM i", context: 1 });
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 0);
    assert.equal(diff.text, lines("--- local", "+++ IBM i", "@@ -3,2 +3,3 @@", " 3", "+new", " 4"));
  });

  it("shows a deleted line and a replaced line", () => {
    const deleted = unifiedDiff(lines("a", "b", "c"), lines("a", "c"), { context: 0 });
    assert.equal(deleted.text, lines("--- a", "+++ b", "@@ -2 +1,0 @@", "-b"));
    const replaced = unifiedDiff(lines("a", "b", "c"), lines("a", "B", "c"), { context: 0 });
    assert.equal(replaced.added, 1);
    assert.equal(replaced.removed, 1);
    assert.equal(replaced.text, lines("--- a", "+++ b", "@@ -2 +2 @@", "-b", "+B"));
  });

  it("handles changes at both ends and far apart as separate hunks", () => {
    const a = lines("x", "1", "2", "3", "4", "5", "6", "7", "8", "9", "y");
    const b = lines("X", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Y");
    const diff = unifiedDiff(a, b, { context: 2 });
    assert.equal(diff.text, lines(
      "--- a", "+++ b",
      "@@ -1,3 +1,3 @@", "-x", "+X", " 1", " 2",
      "@@ -9,3 +9,3 @@", " 8", " 9", "-y", "+Y"
    ));
  });

  it("merges changes closer than twice the context into one hunk", () => {
    const diff = unifiedDiff(lines("1", "2", "3", "4", "5", "6"), lines("1", "B", "3", "4", "E", "6"), { context: 1 });
    assert.equal(diff.text, lines("--- a", "+++ b", "@@ -1,6 +1,6 @@", " 1", "-2", "+B", " 3", " 4", "-5", "+E", " 6"));
  });

  it("finds a short edit script, not just a replacement", () => {
    const a = lines("a", "b", "c", "d", "e", "f");
    const b = lines("b", "c", "x", "d", "e", "f", "g");
    const diff = unifiedDiff(a, b, { context: 0 });
    assert.equal(diff.removed, 1);
    assert.equal(diff.added, 2);
    assert.equal(diff.truncated, false);
  });

  it("gives up on unrelated long texts quickly, reporting the middle as one replacement", () => {
    const a = Array.from({ length: 10_000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 10_000 }, (_, i) => `b${i}`).join("\n");
    const started = Date.now();
    const diff = unifiedDiff(a, b, { maxEdits: 500 });
    assert.ok(Date.now() - started < 2000);
    assert.equal(diff.truncated, true);
    assert.equal(diff.removed, 10_000);
    assert.equal(diff.added, 10_000);
    assert.match(diff.text, /^@@ -1,10000 \+1,10000 @@$/m);
  });

  it("treats an empty text as no lines", () => {
    const diff = unifiedDiff("", lines("a", "b"), { context: 0 });
    assert.equal(diff.added, 2);
    assert.equal(diff.text, lines("--- a", "+++ b", "@@ -0,0 +1,2 @@", "+a", "+b"));
  });
});

describe("lineMap", () => {
  it("maps every line of identical texts to itself, as the IBM i stores them", () => {
    assert.deepEqual(lineMap("a\r\nb  \r\n\r\n", "a\nb"), { map: [0, 1], truncated: false });
  });

  it("keeps the baseline index for unchanged lines around an insertion and a change", () => {
    const { map, truncated } = lineMap(lines("1", "2", "3", "4"), lines("1", "new", "2", "THREE", "4"));
    assert.equal(truncated, false);
    assert.deepEqual(map, [0, undefined, 1, undefined, 3]);
  });

  it("shifts the lines after a deletion", () => {
    assert.deepEqual(lineMap(lines("a", "b", "c", "d"), lines("a", "c", "d")).map, [0, 2, 3]);
  });

  it("leaves an empty current text with no lines, and maps nothing from an empty baseline", () => {
    assert.deepEqual(lineMap("a\nb", "").map, []);
    assert.deepEqual(lineMap("", "a\nb").map, [undefined, undefined]);
  });

  it("maps only the common ends when the texts differ too much", () => {
    const base = ["same", ...Array.from({ length: 10 }, (_, i) => `b${i}`), "end"].join("\n");
    const current = ["same", ...Array.from({ length: 10 }, (_, i) => `c${i}`), "end"].join("\n");
    const { map, truncated } = lineMap(base, current, 2);
    assert.equal(truncated, true);
    assert.equal(map[0], 0);
    assert.equal(map[11], 11);
    assert.ok(map.slice(1, 11).every((line) => line === undefined));
  });
});

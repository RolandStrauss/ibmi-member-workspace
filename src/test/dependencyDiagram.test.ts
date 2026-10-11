import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dependencyMarkdown, dependencyMermaid, dependencyTreeText } from "../dependencyDiagram";
import type { ReferenceKind } from "../dependencyScan";
import type { DependencySubject } from "../dependencySources";
import type { WalkNode, WalkResult, WalkUnresolved } from "../dependencyWalk";

const root: DependencySubject = { library: "DEVLIB", sourceFile: "QRPGLESRC", memberName: "ORD100", extension: "rpgle" };

function node(kind: ReferenceKind, member: string, via: string[], library = "PRODLIB"): WalkNode {
  return {
    subject: { library, sourceFile: "QSRC", memberName: member, extension: "rpgle" },
    depth: via.length + 1,
    reference: { kind, member, text: `uses ${member}` },
    candidates: [{ library, sourceFile: "QSRC", member, sourceType: "RPGLE" }],
    via,
  };
}

function missing(kind: ReferenceKind, member: string, via: string[]): WalkUnresolved {
  return { reference: { kind, member, text: `uses ${member}` }, via };
}

function result(nodes: WalkNode[], unresolved: WalkUnresolved[] = [], flags: Partial<WalkResult> = {}): WalkResult {
  return { nodes, unresolved, failed: [], outcomes: [], stopped: false, cancelled: false, ...flags };
}

const walk = result(
  [node("program", "ORD200", []), node("copybook", "ORDCPY", []), node("file", "ORDHDR", ["ORD200"]), node("copybook", "DATECPY", ["ORDCPY"])],
  [missing("program", "MISSING1", ["ORD200"])]
);

describe("dependencyTreeText", () => {
  it("draws the members under what uses them, copybooks before programs before files", () => {
    assert.equal(dependencyTreeText(root, walk), [
      "ORD100  DEVLIB/QRPGLESRC",
      "├─ copybook ORDCPY  PRODLIB/QSRC",
      "│  └─ copybook DATECPY  PRODLIB/QSRC",
      "└─ calls ORD200  PRODLIB/QSRC",
      "   ├─ file ORDHDR  PRODLIB/QSRC",
      "   └─ ? calls MISSING1  (source not found)",
    ].join("\n"));
  });

  it("shows a member reached twice once in full, and never loops", () => {
    const loop = result([node("program", "A", []), node("program", "B", ["A"]), node("program", "A", ["B"], "OTHERLIB")]);
    const text = dependencyTreeText(root, loop);
    assert.match(text, /calls A {2}OTHERLIB\/QSRC {2}\(shown above\)/);
    assert.equal((text.match(/calls B/g) ?? []).length, 1);
  });
});

describe("dependencyMermaid", () => {
  it("declares each member once, draws an edge per use and dashes unresolved ones", () => {
    const mermaid = dependencyMermaid(root, walk);
    assert.equal(mermaid.split("\n")[0], "graph LR");
    assert.match(mermaid, /n0\["ORD100\nDEVLIB\/QRPGLESRC"\]/);
    assert.match(mermaid, /n0 -- calls --> n\d+/);
    assert.match(mermaid, /n\d+ -- file --> n\d+/);
    assert.match(mermaid, /u0\["MISSING1\nsource not found"\]:::unresolved/);
    assert.match(mermaid, /-\. calls \.-> u0/);
    assert.match(mermaid, /classDef unresolved stroke-dasharray: 5 5$/);
    assert.equal((mermaid.match(/\["ORD200/g) ?? []).length, 1);
  });

  it("escapes quotes in labels and leaves out the dashed style when everything resolved", () => {
    const quoted = result([node("file", 'A"B', [])]);
    const mermaid = dependencyMermaid(root, quoted);
    assert.match(mermaid, /A#quot;B/);
    assert.doesNotMatch(mermaid, /classDef/);
  });
});

describe("dependencyMarkdown", () => {
  it("summarizes the walk and holds both the graph and the tree", () => {
    const md = dependencyMarkdown(root, walk, { mermaidSupported: true });
    assert.match(md, /^# Dependencies of DEVLIB\/QRPGLESRC\(ORD100\)\n/);
    assert.match(md, /4 members at 2 levels; 1 whose source wasn't found\./);
    assert.match(md, /```mermaid\ngraph LR\n/);
    assert.match(md, /```text\nORD100 {2}DEVLIB\/QRPGLESRC\n/);
    assert.doesNotMatch(md, /bierner\.markdown-mermaid/);
  });

  it("points to the Mermaid extension when it isn't there, and says when the list is partial", () => {
    const md = dependencyMarkdown(root, result([node("program", "X", [])], [], { stopped: true }), { mermaidSupported: false });
    assert.match(md, /1 member at 1 level; stopped at the limit, so the list is partial\./);
    assert.match(md, /bierner\.markdown-mermaid/);
  });
});

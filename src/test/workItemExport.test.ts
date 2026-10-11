import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CheckedOutMember } from "../types";
import { exportFileName, exportWorkItem, importPlan, parseWorkItemExport } from "../workItemExport";

function member(library: string, name: string, kind?: "reference"): CheckedOutMember {
  return {
    id: `SYS/${library}/QRPGLESRC/${name}`,
    system: "SYS",
    library,
    sourceFile: "QRPGLESRC",
    memberName: name,
    extension: "rpgle",
    localPath: `/c/SYS/${library}/QRPGLESRC/${name}.RPGLE`,
    checkedOutAt: "2026-10-01T00:00:00.000Z",
    remoteHashAtCheckout: "x",
    status: "modified",
    ...(kind ? { kind } : {}),
  };
}

describe("exportWorkItem", () => {
  it("lists the members, sorted, marking reference copies, with nothing else", () => {
    const file = exportWorkItem("SYS", "TICKET-42", [member("PRODLIB", "ORDUTIL", "reference"), member("DEVLIB", "ORD200"), member("DEVLIB", "ORD100")], new Date("2026-10-10T12:00:00Z"));
    assert.deepEqual(file, {
      format: "ibmi-member-workspace/work-item",
      version: 1,
      system: "SYS",
      workItem: "TICKET-42",
      exportedAt: "2026-10-10T12:00:00.000Z",
      members: [
        { library: "DEVLIB", sourceFile: "QRPGLESRC", memberName: "ORD100", extension: "rpgle" },
        { library: "DEVLIB", sourceFile: "QRPGLESRC", memberName: "ORD200", extension: "rpgle" },
        { library: "PRODLIB", sourceFile: "QRPGLESRC", memberName: "ORDUTIL", extension: "rpgle", kind: "reference" },
      ],
    });
    assert.doesNotMatch(JSON.stringify(file), /localPath|remoteHash/);
    assert.equal(exportFileName("TICKET 42/a"), "TICKET_42_a.ibmi-work-item.json");
  });
});

describe("parseWorkItemExport", () => {
  const good = JSON.stringify(exportWorkItem("sys", "w", [member("DEVLIB", "ORD100")]));

  it("reads back what was exported", () => {
    const parsed = parseWorkItemExport(good);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.system, "sys");
    assert.deepEqual(parsed.value.members, [{ library: "DEVLIB", sourceFile: "QRPGLESRC", memberName: "ORD100", extension: "rpgle" }]);
  });

  it("refuses other files, other versions and names that aren't IBM i names", () => {
    assert.deepEqual(parseWorkItemExport("{"), { ok: false, reason: "The file isn't JSON." });
    assert.match((parseWorkItemExport('{"format":"other"}') as { reason: string }).reason, /isn't a work item export/);
    assert.match((parseWorkItemExport(good.replace('"version":1', '"version":2')) as { reason: string }).reason, /version 2/);
    const bad = good.replace("ORD100", "../ORD100");
    assert.match((parseWorkItemExport(bad) as { reason: string }).reason, /Member 1: .*not a valid IBM i member name/);
  });
});

describe("importPlan", () => {
  const file = exportWorkItem("Dev.Example.com", "w", [member("DEVLIB", "ORD100"), member("PRODLIB", "ORDUTIL", "reference")]);

  it("splits members for change from reference copies on the connected system", () => {
    const plan = importPlan(file, "dev.example.com");
    assert.ok("editable" in plan);
    assert.deepEqual(plan.editable.map((m) => m.memberName), ["ORD100"]);
    assert.deepEqual(plan.reference.map((m) => m.memberName), ["ORDUTIL"]);
  });

  it("refuses another system, or none", () => {
    assert.match((importPlan(file, "prod.example.com") as { problem: string }).problem, /for Dev\.Example\.com, but you are connected to prod\.example\.com/);
    assert.match((importPlan(file, undefined) as { problem: string }).problem, /Connect to Dev\.Example\.com first/);
  });
});

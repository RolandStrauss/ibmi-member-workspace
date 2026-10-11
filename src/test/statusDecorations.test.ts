import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { browserDecorationFor, decorationFor } from "../statusDecorations";

describe("decorationFor", () => {
  it("marks local changes, remote changes and conflicts with arrows and a bang", () => {
    assert.deepEqual(decorationFor({ status: "modified" }), {
      badge: "↑",
      tooltip: "IBM i: local changes not yet uploaded",
      colorId: "gitDecoration.modifiedResourceForeground",
    });
    assert.equal(decorationFor({ status: "remote-changed" })?.badge, "↓");
    assert.equal(decorationFor({ status: "conflict" })?.badge, "!");
    assert.equal(decorationFor({ status: "conflict" })?.colorId, "gitDecoration.conflictingResourceForeground");
  });

  it("marks a member deleted on the IBM i with a cross, keeping the local copy", () => {
    assert.deepEqual(decorationFor({ status: "remote-missing" }), {
      badge: "✕",
      tooltip: "IBM i: the member no longer exists on the IBM i. Your local copy is kept.",
      colorId: "gitDecoration.deletedResourceForeground",
    });
    assert.equal(decorationFor({ status: "remote-missing", kind: "reference" })?.badge, "RO");
    assert.match(decorationFor({ status: "remote-missing", kind: "reference" })!.tooltip, /no longer exists/);
  });

  it("leaves members in sync alone", () => {
    for (const status of ["in-sync", "checked-out", "merged"] as const) {
      assert.equal(decorationFor({ status }), undefined, status);
    }
  });

  it("marks reference copies read-only whatever their status, without a color", () => {
    assert.deepEqual(decorationFor({ status: "in-sync", kind: "reference" }), {
      badge: "RO",
      tooltip: "IBM i: read-only reference copy",
    });
    assert.match(decorationFor({ status: "remote-changed", kind: "reference" })!.tooltip, /Refresh offers to update it/);
  });

  it("keeps every badge to the one or two characters VS Code allows", () => {
    for (const status of ["modified", "remote-changed", "conflict", "remote-missing"] as const) {
      for (const kind of [undefined, "reference"] as const) {
        const badge = decorationFor({ status, kind })?.badge ?? "";
        assert.ok(badge.length >= 1 && badge.length <= 2, `${status} ${kind}`);
      }
    }
  });
});

describe("browserDecorationFor", () => {
  it("marks a member in sync as checked out here, naming the work item", () => {
    assert.deepEqual(browserDecorationFor({ status: "in-sync" }, "TICKET-42"), {
      badge: "CO",
      tooltip: "Checked out here (work item TICKET-42): in sync with your local copy.",
      colorId: undefined,
    });
    assert.equal(browserDecorationFor({ status: "in-sync" }, "workspace").tooltip, "Checked out here: in sync with your local copy.");
  });

  it("keeps the status badge and color for a member with local changes", () => {
    const decoration = browserDecorationFor({ status: "modified" }, "workspace");
    assert.equal(decoration.badge, "↑");
    assert.equal(decoration.colorId, "gitDecoration.modifiedResourceForeground");
    assert.equal(decoration.tooltip, "Checked out here: local changes not yet uploaded.");
  });

  it("says a reference copy is a reference copy", () => {
    const decoration = browserDecorationFor({ status: "in-sync", kind: "reference" }, "TICKET-42");
    assert.equal(decoration.badge, "RO");
    assert.equal(decoration.tooltip, "Reference copy here (work item TICKET-42).");
    assert.match(browserDecorationFor({ status: "remote-changed", kind: "reference" }, "workspace").tooltip, /^Reference copy here: read-only reference copy, changed on the IBM i\./);
  });
});

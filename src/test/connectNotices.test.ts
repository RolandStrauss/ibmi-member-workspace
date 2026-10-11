import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { disconnectedMessage, listNames, reconnectedMessage, staleMessage, unsentChanges } from "../connectNotices";
import type { CheckedOutMember, CheckoutStatus } from "../types";

function member(name: string, status: CheckoutStatus, kind?: "reference"): CheckedOutMember {
  return {
    id: `SYS/LIB/QRPGLESRC/${name}`,
    system: "SYS",
    library: "LIB",
    sourceFile: "QRPGLESRC",
    memberName: name,
    extension: "rpgle",
    localPath: `/tmp/SYS/LIB/QRPGLESRC/${name}.RPGLE`,
    checkedOutAt: "2026-10-01T10:00:00.000Z",
    remoteHashAtCheckout: "x",
    status,
    ...(kind ? { kind } : {}),
  };
}

describe("unsentChanges", () => {
  it("keeps modified and conflicting checkouts for change, in order", () => {
    const entries = [member("A", "in-sync"), member("B", "modified"), member("C", "conflict"), member("D", "remote-changed"), member("E", "modified", "reference")];
    assert.deepEqual(unsentChanges(entries).map((entry) => entry.memberName), ["B", "C"]);
  });
});

describe("the notices", () => {
  it("name up to five members, then count the rest", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((name) => member(name, "modified"));
    assert.equal(listNames(six.slice(0, 2)), "A, B");
    assert.equal(listNames(six), "A, B, C, D, E and 1 more");
  });

  it("say what happens to unsent changes when the connection drops", () => {
    assert.equal(
      disconnectedMessage("DEV", [member("ORD100", "modified")]),
      "1 member on DEV has changes not uploaded: ORD100. They stay on your computer; upload them when you reconnect."
    );
    assert.match(disconnectedMessage("DEV", [member("A", "modified"), member("B", "conflict")]), /^2 members on DEV have changes not uploaded: A, B\./);
  });

  it("remind after reconnecting, and about stale checkouts with the setting to change", () => {
    assert.equal(reconnectedMessage("DEV", [member("A", "modified")]), "1 member on DEV still has changes not uploaded: A.");
    assert.equal(
      staleMessage([member("A", "in-sync"), member("B", "modified")], 14),
      "2 members have been checked out for 14 days or more: A, B. Upload or discard what you're done with, or change when this reminder starts."
    );
    assert.match(staleMessage([member("A", "in-sync")], 1), /for 1 day or more:/);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addMemberCommand, clText, copyMemberPlan, copySourceCommand, memberTextProblem, newMemberProblem } from "../memberCreate";

const spec = { library: "devlib", sourceFile: "qrpglesrc", memberName: "ord300", sourceType: "rpgle", text: "Order entry v3" };

describe("addMemberCommand", () => {
  it("adds the member with its source type and text, names in upper case", () => {
    assert.equal(
      addMemberCommand(spec),
      "ADDPFM FILE(DEVLIB/QRPGLESRC) MBR(ORD300) SRCTYPE(RPGLE) TEXT('Order entry v3')"
    );
  });

  it("leaves TEXT out when the text is blank, and doubles apostrophes", () => {
    assert.equal(addMemberCommand({ ...spec, text: "  " }), "ADDPFM FILE(DEVLIB/QRPGLESRC) MBR(ORD300) SRCTYPE(RPGLE)");
    assert.match(addMemberCommand({ ...spec, text: "Bob's orders" }), /TEXT\('Bob''s orders'\)$/);
    assert.equal(clText("it's"), "'it''s'");
  });
});

describe("copyMemberPlan", () => {
  it("adds the member first, then copies the source over it", () => {
    const from = { library: "PRODLIB", sourceFile: "QRPGLESRC", memberName: "ORD200" };
    assert.deepEqual(copyMemberPlan(from, spec), [
      "ADDPFM FILE(DEVLIB/QRPGLESRC) MBR(ORD300) SRCTYPE(RPGLE) TEXT('Order entry v3')",
      "CPYSRCF FROMFILE(PRODLIB/QRPGLESRC) TOFILE(DEVLIB/QRPGLESRC) FROMMBR(ORD200) TOMBR(ORD300) MBROPT(*REPLACE)",
    ]);
    assert.equal(copySourceCommand(from, from), "CPYSRCF FROMFILE(PRODLIB/QRPGLESRC) TOFILE(PRODLIB/QRPGLESRC) FROMMBR(ORD200) TOMBR(ORD200) MBROPT(*REPLACE)");
  });
});

describe("the checks", () => {
  it("refuse text over 50 characters or with control characters", () => {
    assert.equal(memberTextProblem("x".repeat(50)), undefined);
    assert.equal(memberTextProblem("x".repeat(51)), "The text is 51 characters; the IBM i keeps 50.");
    assert.equal(memberTextProblem("line\nbreak"), "The text can't contain control characters.");
  });

  it("refuse names that aren't IBM i names, so nothing odd reaches a CL command", () => {
    assert.equal(newMemberProblem(spec), undefined);
    assert.match(newMemberProblem({ ...spec, memberName: "ORD 300" }) ?? "", /not a valid IBM i member name/);
    assert.match(newMemberProblem({ ...spec, library: "A/B" }) ?? "", /not a valid IBM i library name/);
    assert.match(newMemberProblem({ ...spec, sourceType: "RPG LE" }) ?? "", /not a valid source type/);
    assert.match(newMemberProblem({ ...spec, text: "a)'\u0007" }) ?? "", /control characters/);
  });
});

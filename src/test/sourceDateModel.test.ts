import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { datesForLines, formatSourceDate, mapSourceDates } from "../sourceDateModel";

describe("formatSourceDate", () => {
  it("reads YYMMDD with the IBM i's pivot, and nothing from 0 or odd values", () => {
    assert.equal(formatSourceDate("140321"), "2014-03-21");
    assert.equal(formatSourceDate("991231"), "1999-12-31");
    assert.equal(formatSourceDate("400101"), "1940-01-01");
    assert.equal(formatSourceDate("390101"), "2039-01-01");
    assert.equal(formatSourceDate("0"), undefined);
    assert.equal(formatSourceDate("141301"), undefined);
    assert.equal(formatSourceDate("abc"), undefined);
  });
});

describe("mapSourceDates", () => {
  const baseline = ["a", "b", "c", "d"].join("\n");
  const dates = ["140321", "0", "200102", "210304"];

  it("gives unchanged lines their date and changed or added lines none", () => {
    const current = ["a", "new", "b", "C", "d"].join("\n");
    const lookup = mapSourceDates(baseline, current, dates);
    assert.equal(lookup.lines, 5);
    assert.equal(lookup.truncated, false);
    assert.deepEqual(datesForLines(lookup, 0, 4), ["2014-03-21", null, null, null, "2021-03-04"]);
    assert.equal(lookup.isMapped(2), true);
    assert.equal(lookup.isMapped(1), false);
    assert.equal(lookup.dateAt(2), undefined);
  });

  it("maps an identical text line for line, however it is saved locally", () => {
    const lookup = mapSourceDates(baseline, "a\r\nb  \r\nc\r\nd\r\n\r\n", dates);
    assert.deepEqual(datesForLines(lookup, 0, 3), ["2014-03-21", null, "2020-01-02", "2021-03-04"]);
    assert.equal(lookup.dateAt(9), undefined);
  });

  it("copes with fewer dates than lines", () => {
    const lookup = mapSourceDates(baseline, baseline, ["140321"]);
    assert.deepEqual(datesForLines(lookup, 0, 3), ["2014-03-21", null, null, null]);
  });
});

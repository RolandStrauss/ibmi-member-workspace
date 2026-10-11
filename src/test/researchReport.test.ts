import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeUsage,
  fieldUsageReport,
  fileDescriptionReport,
  memberLocksReport,
  summarizeLocks,
  jobLogReport,
  objectDescriptionReport,
  objectTypeForSourceType,
  serviceProgramExportsReport,
  textTable,
  whereUsedReport,
} from "../researchReport";

describe("textTable", () => {
  it("aligns columns to their widest value and cuts long values short", () => {
    const lines = textTable(["A", "Long header"], [["xx", "y"], ["x", "z".repeat(80)]]);
    assert.equal(lines[0], "A   Long header");
    assert.equal(lines[1], `--  ${"-".repeat(60)}`);
    assert.equal(lines[2], "xx  y");
    assert.equal(lines[3], `x   ${"z".repeat(59)}…`);
    assert.ok(lines.every((line) => line === line.trimEnd()));
  });

  it("copes with a missing cell and collapses line breaks in values", () => {
    assert.deepEqual(textTable(["A", "B"], [["only a"], ["multi\nline", "b"]]), ["A           B", "----------  -", "only a", "multi line  b"]);
  });
});

describe("whereUsedReport", () => {
  it("lists the programs by library, with the usage in words", () => {
    const report = whereUsedReport({
      object: "CUSTMAST", objectType: "*FILE", system: "DEV", librariesSearched: ["PRODOBJ", "DEVOBJ"], librariesLeftOut: ["OLDOBJ"],
      librariesNotRead: [{ library: "DEVOBJ", error: "not authorized" }],
      rows: [
        { library: "PRODOBJ", program: "ORD200", text: "Order update", objectLibrary: "*LIBL", objectType: "*FILE", usage: "5" },
        { library: "PRODOBJ", program: "CUSTINQ", text: "Customer inquiry", objectLibrary: "PRODDTA", objectType: "*FILE", usage: "1" },
      ],
    });
    assert.match(report, /^Where Used: CUSTMAST \(\*FILE\) on DEV\n/);
    assert.match(report, /Not searched \(over the limit\): OLDOBJ/);
    assert.match(report, /Could not read DEVOBJ: not authorized/);
    assert.match(report, /2 program\(s\) refer to it/);
    assert.ok(report.indexOf("CUSTINQ") < report.indexOf("ORD200"), "sorted by program within a library");
    assert.match(report, /ORD200 +\*LIBL\/CUSTMAST \*FILE +input, update +Order update/);
  });

  it("says when nothing refers to the object", () => {
    assert.match(whereUsedReport({ object: "X", system: "S", librariesSearched: [], rows: [] }), /No program or service program/);
  });
});

describe("describeUsage", () => {
  it("reads DSPPGMREF's usage bits", () => {
    assert.equal(describeUsage("1"), "input");
    assert.equal(describeUsage("2"), "output");
    assert.equal(describeUsage("7"), "input, output, update");
    assert.equal(describeUsage(undefined), "");
    assert.equal(describeUsage("?"), "?");
  });
});

describe("fileDescriptionReport", () => {
  it("shows the columns, with precision and scale for numbers, and what is built over the file", () => {
    const report = fileDescriptionReport({
      library: "PRODDTA", systemName: "CUSTMAST", sqlName: "CUSTOMER_MASTER", type: "P", text: "Customers",
      columns: [
        { name: "CUSTOMER_NUMBER", systemName: "CUSTNO", type: "DECIMAL", length: 7, scale: 0, nullable: false, text: "Customer" },
        { name: "BALANCE", systemName: "CUSTBAL", type: "DECIMAL", length: 11, scale: 2, nullable: true, text: "" },
      ],
      dependents: [{ library: "PRODDTA", name: "CUSTMASTL1", type: "LF" }],
      notes: ["DSPDBR could not be run."],
    }, "DEV");
    assert.match(report, /^File: PRODDTA\/CUSTMAST \(SQL name CUSTOMER_MASTER\) on DEV\nType: physical file\nText: Customers\n/);
    assert.match(report, /CUSTOMER_NUMBER +CUSTNO +DECIMAL +7 +Customer/);
    assert.match(report, /BALANCE +CUSTBAL +DECIMAL +11,2 +yes/);
    assert.match(report, /1 object\(s\) built over it:/);
    assert.match(report, /CUSTMASTL1 +LF/);
    assert.match(report, /Note: DSPDBR could not be run\./);
  });
});

describe("objectDescriptionReport", () => {
  it("lists attributes, program information and the bound modules", () => {
    const report = objectDescriptionReport({
      library: "PRODOBJ", name: "ORDENT", type: "*PGM",
      object: { attribute: "RPGLE", text: "Order entry" },
      program: { programType: "ILE", activationGroup: "QILE" },
      modules: [{ library: "PRODOBJ", name: "ORDENT" }, { library: "PRODOBJ", name: "ORDUTIL", attribute: "RPGLE" }],
      boundServicePrograms: [],
      notes: [],
    }, "DEV");
    assert.match(report, /^Program: PRODOBJ\/ORDENT on DEV\n\nattribute {2}RPGLE\ntext {7}Order entry\n/);
    assert.match(report, /Program information:\nprogramType +ILE\nactivationGroup +QILE/);
    assert.match(report, /Modules:\n\nlibrary +name +attribute\n/);
    assert.match(report, /Bound service programs: none/);
  });
});

describe("serviceProgramExportsReport and jobLogReport", () => {
  it("format their rows", () => {
    assert.match(serviceProgramExportsReport({ library: "L", name: "S", exports: [{ symbol: "CUST_get", usage: "*PROCEXP" }] }, "DEV"), /exports 1 symbol\(s\):\n\nSymbol +Usage\n[- ]+\nCUST_get +\*PROCEXP/);
    const log = jobLogReport({ job: "*", messages: [
      { position: 1, id: "CPF9898", type: "ESCAPE", severity: 40, sent: "2026-10-09 10:00:00", fromProgram: "QCMD", text: "It failed.", help: "Line one\nLine two" },
    ] }, "DEV");
    assert.match(log, /^Job log of this connection's job on DEV: 1 message\(s\), oldest first\n\n2026-10-09 10:00:00 {2}CPF9898 {2}ESCAPE {2}severity 40 {2}from QCMD\n {2}It failed\.\n {4}Line one\n {4}Line two\n/);
  });
});

describe("objectTypeForSourceType", () => {
  it("knows which source types compile to files", () => {
    assert.equal(objectTypeForSourceType("pf"), "*FILE");
    assert.equal(objectTypeForSourceType("DSPF"), "*FILE");
    assert.equal(objectTypeForSourceType("rpgle"), undefined);
  });
});

describe("member locks", () => {
  const own = { job: "111111/DEV/QZDASOINIT", user: "DEV", number: "111111", member: "ORDENT", lockType: "MEMBER", state: "*SHRRD", status: "HELD", scope: "JOB", program: "" };
  const seu = { job: "123456/JSMITH/QPADEV0001", user: "JSMITH", number: "123456", member: "ORDENT", lockType: "MEMBER", state: "*SHRNUP", status: "HELD", scope: "JOB", program: "QSEU" };
  const file = { ...seu, job: "123457/BATCH/QBATCH", member: "", lockType: "", state: "*SHRRD", status: "WAITING" };

  it("summarizes the other jobs in one line", () => {
    assert.equal(summarizeLocks([]), "");
    assert.equal(summarizeLocks([seu]), "Also open in job 123456/JSMITH/QPADEV0001 (*SHRNUP).");
    assert.equal(summarizeLocks([seu, file]), "Also open in jobs 123456/JSMITH/QPADEV0001 (*SHRNUP); 123457/BATCH/QBATCH (*SHRRD, whole file, waiting).");
  });

  it("reports every lock, marking this connection, and says when there are none", () => {
    const report = memberLocksReport({ library: "PRODSRC", sourceFile: "QRPGLESRC", memberName: "ORDENT", system: "SYS", locks: [own, seu], ownJob: own.job, notes: [] });
    assert.match(report, /^Locks on PRODSRC\/QRPGLESRC\(ORDENT\) on SYS\n\n2 lock\(s\):/);
    assert.match(report, /111111\/DEV\/QZDASOINIT \(this connection\)/);
    assert.match(report, /QSEU/);
    assert.match(memberLocksReport({ library: "A", sourceFile: "B", memberName: "C", system: "SYS", locks: [], ownJob: "", notes: [] }), /No job holds a lock/);
    assert.match(memberLocksReport({ library: "A", sourceFile: "B", memberName: "C", system: "SYS", locks: [], ownJob: "", notes: ["view missing"] }), /No locks could be read\.[\s\S]*Note: view missing/);
  });
});

describe("fieldUsageReport", () => {
  it("lists the files defining the field and the members mentioning it", () => {
    const report = fieldUsageReport({
      field: "CUSTNO",
      columns: [{ library: "PRODDTA", file: "CUSTMAST", sqlName: "CUSTOMER_MASTER", column: "CUSTNO", systemColumn: "CUSTNO", type: "NUMERIC", length: "7", scale: "0", text: "Customer number" }],
      members: [{ library: "PRODSRC", sourceFile: "QRPGLESRC", member: "ORDENT", extension: "sqlrpgle", lines: [{ number: 12, content: "dcl-s custno packed(7);" }], totalLines: 3 }],
      filesSearched: ["PRODSRC/QRPGLESRC"],
      notes: ["text search"],
    }, "SYS", ["PRODDTA", "PRODSRC"]);
    assert.match(report, /^Field CUSTNO on SYS\nLibraries searched: PRODDTA, PRODSRC\n/);
    assert.match(report, /Defined in 1 file\(s\):/);
    assert.match(report, /CUSTOMER_MASTER/);
    assert.match(report, /Mentioned in 1 source member\(s\) \(searched PRODSRC\/QRPGLESRC\):\n\nPRODSRC\/QRPGLESRC\(ORDENT\) SQLRPGLE: 3 line\(s\)\n {6}12 {2}dcl-s custno packed\(7\);\n {2}… 2 more/);
    assert.match(report, /Note: text search/);
    assert.match(fieldUsageReport({ field: "X", columns: [], members: [], filesSearched: [], notes: [] }, "SYS", []), /No file or table[\s\S]*No source member/);
  });
});

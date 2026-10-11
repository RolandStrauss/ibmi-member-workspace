import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

/**
 * Starts a real VS Code with the bundled extension (`dist/extension.js`, what users load) and a
 * stub standing in for Code for IBM i, then runs `smoke.ts` inside it. Plain `npm test` never
 * loads VS Code, so this is what catches an activation or bundling regression. Run with
 * `npm run test:smoke`; CI runs it on Linux under xvfb. Everything it writes goes to a temporary
 * folder that is removed afterwards.
 */
async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "imw-smoke-"));
  const workspace = path.join(temp, "workspace");
  const userData = path.join(temp, "user-data");
  const stub = path.join(temp, "stub-code-for-ibmi");
  fs.mkdirSync(workspace);
  fs.mkdirSync(userData);
  writeStub(stub);
  try {
    await runTests({
      extensionDevelopmentPath: [repoRoot, stub],
      extensionTestsPath: path.join(__dirname, "smoke"),
      launchArgs: [workspace, "--disable-workspace-trust", "--user-data-dir", userData, "--disable-gpu"],
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * The least that satisfies the extension's dependency on Code for IBM i: the same id, an `instance`
 * that is never connected, and an events parser. Generated here rather than kept as source, so no
 * JavaScript file is linted or packaged.
 */
function writeStub(dir: string): void {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "code-for-ibmi",
    publisher: "halcyontechltd",
    displayName: "Code for IBM i (smoke-test stub)",
    version: "99.0.0",
    engines: { vscode: "^1.90.0" },
    main: "./extension.js",
    activationEvents: ["*"],
  }, null, 2));
  fs.writeFileSync(path.join(dir, "extension.js"), [
    "exports.activate = () => ({",
    "  instance: { getConnection: () => undefined, subscribe: () => undefined },",
    "  evfeventParser: () => new Map(),",
    "});",
    "exports.deactivate = () => undefined;",
    "",
  ].join("\n"));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

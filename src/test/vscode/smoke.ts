import assert from "node:assert/strict";
import * as vscode from "vscode";

/**
 * Runs inside the VS Code that `runSmoke.ts` starts. Not a `node:test` file: it needs the `vscode`
 * module. Checks that the bundled extension activates next to Code for IBM i and that everything
 * the manifest promises is really there.
 */
export async function run(): Promise<void> {
  const failures: string[] = [];
  const check = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      console.log(`not ok - ${name}`);
    }
  };

  const ext = vscode.extensions.getExtension("vinhry.ibmi-member-workspace");
  await check("the extension is installed from the development path", () => {
    assert.ok(ext, "vinhry.ibmi-member-workspace not found");
  });
  if (!ext) {
    throw new Error(failures.join("\n"));
  }

  await check("the Code for IBM i stub is present and active", async () => {
    const dependency = vscode.extensions.getExtension("halcyontechltd.code-for-ibmi");
    assert.ok(dependency, "halcyontechltd.code-for-ibmi not found");
    await dependency.activate();
    assert.ok(dependency.isActive);
  });

  await check("the extension activates from the bundle", async () => {
    assert.equal(ext.packageJSON.main, "./dist/extension.js");
    await ext.activate();
    assert.ok(ext.isActive);
  });

  await check("every contributed command is registered (Bob's only in IBM Bob)", async () => {
    const contributed = (ext.packageJSON.contributes.commands as Array<{ command: string }>).map((item) => item.command);
    const registered = new Set(await vscode.commands.getCommands(true));
    const bobOnly = (command: string) => command.startsWith("ibmi-member-workspace.bob.");
    assert.deepEqual(contributed.filter((command) => !bobOnly(command) && !registered.has(command)), []);
    assert.ok(contributed.some(bobOnly), "the Bob commands are expected in the manifest");
  });

  await check("the view refreshes while disconnected", async () => {
    await vscode.commands.executeCommand("ibmi-member-workspace.refreshView");
  });

  await check("Refresh All Remote Status says it is not connected instead of throwing", async () => {
    await vscode.commands.executeCommand("ibmi-member-workspace.refreshAllRemote");
  });

  if (failures.length > 0) {
    throw new Error(`${failures.length} smoke check(s) failed:\n${failures.join("\n")}`);
  }
}

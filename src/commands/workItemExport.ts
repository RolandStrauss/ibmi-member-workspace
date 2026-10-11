import * as os from "node:os";
import * as vscode from "vscode";
import { ensureCheckoutFolder } from "../checkoutFolder";
import { getSystemName } from "../codeForIBMi";
import { errorMessage } from "../errors";
import { exportFileName, exportWorkItem, importPlan, parseWorkItemExport } from "../workItemExport";
import { checkoutMembersBatch } from "./checkout";
import { CommandContext } from "./context";
import { ensureWorkItemForCheckout } from "./git";

/** A work item export is small; anything much larger isn't one. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * Export Work Item writes the current work item's member list to a JSON file; Import Work Item
 * checks the members of such a file out into the current work item, reference copies as
 * reference copies. Only names travel: no text, no tokens.
 */
export function registerWorkItemExportCommands(ctx: CommandContext): void {
  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("ibmi-member-workspace.exportWorkItem", () => exportCurrentWorkItem(ctx)),
    vscode.commands.registerCommand("ibmi-member-workspace.importWorkItem", () => importWorkItemFile(ctx))
  );
}

async function exportCurrentWorkItem(ctx: CommandContext): Promise<void> {
  const { service } = ctx;
  const system = getSystemName();
  if (!system) {
    vscode.window.showWarningMessage("Connect to an IBM i first: the export lists the work item of the connected system.");
    return;
  }
  const entries = service.getEntriesForSystem(system);
  const workItem = service.getActiveWorkItem(system);
  if (entries.length === 0) {
    vscode.window.showInformationMessage(`Work item ${workItem} on ${system} has no checked-out members to export.`);
    return;
  }
  const target = await vscode.window.showSaveDialog({
    title: "Export Work Item",
    defaultUri: vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir()), exportFileName(workItem)),
    filters: { "Work item export": ["json"] },
    saveLabel: "Export",
  });
  if (!target) {
    return;
  }
  try {
    const file = exportWorkItem(system, workItem, entries);
    await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(file, null, 2), "utf-8"));
    vscode.window.showInformationMessage(`Exported ${entries.length} member(s) of work item ${workItem} to ${target.fsPath}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Could not export the work item: ${errorMessage(err)}`);
  }
}

async function importWorkItemFile(ctx: CommandContext): Promise<void> {
  const { service, log } = ctx;
  const picked = await vscode.window.showOpenDialog({
    title: "Import Work Item",
    canSelectMany: false,
    filters: { "Work item export": ["json"] },
    openLabel: "Import",
  });
  const source = picked?.[0];
  if (!source) {
    return;
  }
  let text: string;
  try {
    const data = await vscode.workspace.fs.readFile(source);
    if (data.byteLength > MAX_IMPORT_BYTES) {
      vscode.window.showErrorMessage("That file is too large to be a work item export.");
      return;
    }
    text = Buffer.from(data).toString("utf-8");
  } catch (err) {
    vscode.window.showErrorMessage(`Could not read ${source.fsPath}: ${errorMessage(err)}`);
    return;
  }
  const parsed = parseWorkItemExport(text);
  if (!parsed.ok) {
    vscode.window.showErrorMessage(`Can't import ${source.fsPath}: ${parsed.reason}`);
    return;
  }
  const plan = importPlan(parsed.value, getSystemName());
  if ("problem" in plan) {
    vscode.window.showWarningMessage(plan.problem);
    return;
  }
  const system = getSystemName();
  if (!system || !(await ensureCheckoutFolder(ctx))) {
    return;
  }
  const total = plan.editable.length + plan.reference.length;
  const choice = await vscode.window.showInformationMessage(
    `Check out the ${total} member(s) of work item ${parsed.value.workItem} (exported from ${parsed.value.system}) into work item ${service.getActiveWorkItem(system)}?`,
    {
      modal: true,
      detail: `${plan.editable.length} for change and ${plan.reference.length} as read-only reference copies. ` +
        "Members already checked out are asked about as in a batch checkout.",
    },
    "Check Out"
  );
  if (choice !== "Check Out" || !(await ensureWorkItemForCheckout(ctx, system))) {
    return;
  }
  if (plan.editable.length > 0) {
    await checkoutMembersBatch(service, system, plan.editable, log);
  }
  if (plan.reference.length > 0) {
    await checkoutMembersBatch(service, system, plan.reference, log, { reference: true });
  }
}

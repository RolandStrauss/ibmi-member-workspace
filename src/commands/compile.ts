import * as vscode from "vscode";
import { CheckoutService } from "../checkoutService";
import {
  connectionLibraryList,
  currentTimestamp,
  downloadMemberContent,
  evfeventMembers,
  getSystemName,
  listSpooledFiles,
  memberUri,
  parseEvfevent,
  readSpooledFile,
} from "../codeForIBMi";
import { CompileDiagnostic, compileLibraries, newestEvfevent, summarizeCompile, toDiagnostics } from "../compileResult";
import { errorMessage } from "../errors";
import { extractMemberInfo } from "../memberInfo";
import { resolveMemberSelections, saveDirtyLocalFiles } from "../prompts";
import { CheckedOutMember, formatMemberPath, isReferenceCopy, systemKey } from "../types";
import { CommandContext } from "./context";
import { uploadWithConflictHandling } from "./uploadMember";

const DIAGNOSTIC_SOURCE = "IBM i compile";
/** Lines of a compile listing shown; a listing is rarely longer. */
const LISTING_LINES = 5000;

/**
 * Compile on IBM i: runs one of Code for IBM i's member actions on the checked-out member's copy
 * on the IBM i (after offering to upload local changes), then reads the compile's events file
 * (EVFEVENT) and shows its errors on the local file, where they can be fixed. Run Action keeps
 * its meaning: Code for IBM i's local actions on the local file.
 */
export function registerCompileCommand(ctx: CommandContext): void {
  const collection = vscode.languages.createDiagnosticCollection("ibmi-member-workspace-compile");
  ctx.context.subscriptions.push(
    collection,
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri)),
    vscode.commands.registerCommand("ibmi-member-workspace.compileOnIbmi", (item?: unknown, all?: unknown[]) =>
      compileOnIbmi(ctx, collection, item, all)
    )
  );
}

async function compileOnIbmi(ctx: CommandContext, collection: vscode.DiagnosticCollection, item?: unknown, all?: unknown[]): Promise<void> {
  const { service, mergeHandler, log } = ctx;
  const selections = resolveMemberSelections(service, item, all);
  if (selections.length === 0) {
    vscode.window.showInformationMessage("Open or select a checked-out member to compile.");
    return;
  }
  if (selections.length > 1) {
    vscode.window.showInformationMessage("Compile one member at a time: each compile's messages are read back for its member.");
    return;
  }
  const entry = selections[0].entry;
  const memberPath = formatMemberPath(entry);
  if (isReferenceCopy(entry)) {
    vscode.window.showWarningMessage(`${memberPath} is a read-only reference copy. Compile the member you have checked out for change.`);
    return;
  }
  if (entry.status === "remote-missing") {
    vscode.window.showWarningMessage(`${memberPath} no longer exists on the IBM i.`);
    return;
  }
  const system = getSystemName();
  if (!system || systemKey(system) !== systemKey(entry.system)) {
    vscode.window.showWarningMessage(`Connect to ${entry.system} first: ${memberPath} is compiled there.`);
    return;
  }
  if (!(await saveDirtyLocalFiles([entry]))) {
    return;
  }
  if (await service.hasLocalChanges(entry)) {
    const upload = "Upload and Compile";
    const choice = await vscode.window.showWarningMessage(
      `${memberPath} has local changes that aren't on the IBM i yet.`,
      { modal: true, detail: "The compile reads the member on the IBM i. Upload first so it compiles what you see here." },
      upload,
      "Compile the IBM i's Copy"
    );
    if (!choice) {
      return;
    }
    if (choice === upload) {
      const outcome = await uploadWithConflictHandling(service, mergeHandler, entry, log);
      if (outcome !== "uploaded" && outcome !== "uploaded-altered") {
        return;
      }
    }
  }

  // The IBM i's clock, to the second (members' change stamps have no finer precision), so only events this compile wrote count.
  const since = (await currentTimestamp().catch(() => "")).slice(0, 19);
  if (!since) {
    vscode.window.showErrorMessage(`Could not read the IBM i's clock, which tells this compile's events from older ones; ${memberPath} was not compiled.`);
    return;
  }
  let result: unknown;
  try {
    result = await vscode.commands.executeCommand("code-for-ibmi.runAction", memberUri(entry));
  } catch (err) {
    vscode.window.showErrorMessage(`Could not run an action on ${memberPath}: ${errorMessage(err)}`);
    return;
  }
  const action = actionOutcome(result);
  if (!action.ran) {
    return;
  }

  const libraries = compileLibraries(entry.library, connectionLibraryList());
  let newest: { library: string } | undefined;
  try {
    newest = newestEvfevent(await evfeventMembers(entry.memberName, libraries, since));
  } catch (err) {
    log.appendLine(`[compile] Could not look for the events of ${memberPath}: ${errorMessage(err)}`);
    await offer(ctx, entry, `The action ran, but couldn't look for the compile's events: ${errorMessage(err)}`, ["Show Job Log"], true);
    return;
  }
  if (!newest) {
    await offer(
      ctx,
      entry,
      `No compile events found for ${memberPath} since the action started. The action may not use OPTION(*EVENTF), ` +
      "or it writes to a library that isn't in your library list.",
      ["Show Compile Listing", "Show Job Log"],
      action.success === false
    );
    return;
  }

  let diagnostics: CompileDiagnostic[];
  let unresolvedFiles: string[];
  try {
    const text = await downloadMemberContent(newest.library, "EVFEVENT", entry.memberName);
    const parsed = parseEvfevent(text.split(/\r?\n/));
    ({ diagnostics, unresolvedFiles } = toDiagnostics(parsed, (path) => localPathOf(service, system, path)));
  } catch (err) {
    vscode.window.showErrorMessage(`Could not read the compile's events of ${memberPath}: ${errorMessage(err)}`);
    return;
  }
  const shown = publish(collection, diagnostics, log);
  const notCheckedOut = unresolvedFiles.length > 3
    ? `${unresolvedFiles.slice(0, 3).join(", ")} and ${unresolvedFiles.length - 3} more`
    : unresolvedFiles.join(", ");
  const message = summarizeCompile(entry.memberName, diagnostics, action.success) +
    (unresolvedFiles.length > 0 ? ` Messages in files that aren't checked out: ${notCheckedOut}.` : "");
  await offer(
    ctx,
    entry,
    message,
    [...(shown > 0 ? ["Show Problems"] : []), "Show Compile Listing", "Show Job Log"],
    action.success === false || diagnostics.some((d) => d.severity === "error")
  );
}

/** What `code-for-ibmi.runAction` returned: whether an action ran at all, and whether it succeeded. */
function actionOutcome(result: unknown): { ran: boolean; success?: boolean } {
  if (result === undefined || result === null) {
    // An older Code for IBM i that returns nothing: look for the events anyway.
    return { ran: true };
  }
  if (typeof result === "boolean") {
    // Older Code for IBM i: the action's success only.
    return { ran: true, success: result };
  }
  if (typeof result !== "object") {
    return { ran: true };
  }
  const { success, output } = result as { success?: unknown; output?: unknown };
  // No target was processed: the action picker was dismissed, or Code for IBM i already said why.
  const targets = Array.isArray(output) ? (output as Array<{ hasRun?: unknown }>) : undefined;
  const ran = targets === undefined || targets.some((target) => target.hasRun !== false);
  return { ran, ...(typeof success === "boolean" ? { success } : {}) };
}

/** The local file of a path the events file names (LIB/FILE/MBR or LIB/FILE(MBR)), when checked out. */
function localPathOf(service: CheckoutService, system: string, path: string): string | undefined {
  if (path.startsWith("/")) {
    return undefined;
  }
  const memberPath = `/${path.replace(/\(/g, "/").replace(/\)/g, "")}`;
  const info = extractMemberInfo({}, { scheme: "member", path: memberPath });
  const entry = info && service.findEntry(system, info.library, info.sourceFile, info.memberName);
  return entry?.localPath;
}

/**
 * Shows the diagnostics on their local files, replacing the previous compile's. A file that
 * already shows the same lines from another source (Code for IBM i puts a compile's errors on an
 * open tab of the same name) is left to it. Returns how many diagnostics were shown.
 */
function publish(collection: vscode.DiagnosticCollection, diagnostics: readonly CompileDiagnostic[], log: vscode.OutputChannel): number {
  collection.clear();
  const byFile = new Map<string, CompileDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.localPath) {
      byFile.set(diagnostic.localPath, [...(byFile.get(diagnostic.localPath) ?? []), diagnostic]);
    }
  }
  let shown = 0;
  for (const [localPath, ours] of byFile) {
    const uri = vscode.Uri.file(localPath);
    const others = vscode.languages.getDiagnostics(uri).filter((d) => d.source !== DIAGNOSTIC_SOURCE);
    // Code for IBM i words its message as "CODE: text (severity)"; the text is what both share.
    const same = (ours: CompileDiagnostic, other: vscode.Diagnostic) =>
      other.range.start.line === ours.line && other.message.includes(ours.message.trim());
    if (others.length > 0 && ours.every((d) => others.some((other) => same(d, other)))) {
      log.appendLine(`[compile] ${localPath}: the same messages are already shown by ${others[0].source ?? "another extension"}`);
      continue;
    }
    collection.set(uri, ours.map(toVscodeDiagnostic));
    shown += ours.length;
  }
  return shown;
}

function toVscodeDiagnostic(diagnostic: CompileDiagnostic): vscode.Diagnostic {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : diagnostic.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
  const result = new vscode.Diagnostic(
    new vscode.Range(diagnostic.line, diagnostic.column, diagnostic.endLine, diagnostic.endColumn),
    diagnostic.message,
    severity
  );
  result.source = DIAGNOSTIC_SOURCE;
  result.code = diagnostic.code;
  return result;
}

/** The notification after a compile, with its follow-ups. */
async function offer(ctx: CommandContext, entry: CheckedOutMember, message: string, buttons: string[], warning: boolean): Promise<void> {
  const choice = warning
    ? await vscode.window.showWarningMessage(message, ...buttons)
    : await vscode.window.showInformationMessage(message, ...buttons);
  try {
    if (choice === "Show Problems") {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
    } else if (choice === "Show Compile Listing") {
      await showListing(ctx, entry);
    } else if (choice === "Show Job Log") {
      await vscode.commands.executeCommand("ibmi-member-workspace.research.jobLog");
    }
  } catch (err) {
    vscode.window.showErrorMessage(`${choice} failed: ${errorMessage(err)}`);
  }
}

/** The newest spooled file named after the member (a compile listing is), as a read-only document. */
async function showListing(ctx: CommandContext, entry: CheckedOutMember): Promise<void> {
  const [file] = await listSpooledFiles({ name: entry.memberName, limit: 1 });
  if (!file) {
    vscode.window.showInformationMessage(`No spooled file named ${entry.memberName} for your user profile. The compile may have written its listing under another name, or none.`);
    return;
  }
  const { lines, totalLines } = await readSpooledFile(file, { startLine: 1, endLine: LISTING_LINES });
  const header = `Spooled file ${file.name} (${file.number}) of job ${file.job}, created ${file.created}` +
    (totalLines > LISTING_LINES ? `; the first ${LISTING_LINES} of ${totalLines} lines` : "");
  await ctx.reports.open(`Listing ${entry.memberName}`, [header, "", ...lines].join("\n"));
}

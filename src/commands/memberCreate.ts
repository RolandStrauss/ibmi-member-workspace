import * as vscode from "vscode";
import { ensureCheckoutFolder } from "../checkoutFolder";
import { getSystemName, memberChangeStamps, runClCommand, sourceFileLayout } from "../codeForIBMi";
import { errorMessage } from "../errors";
import { MemberRef, NewMemberSpec, addMemberCommand, copyMemberPlan, memberTextProblem, newMemberProblem } from "../memberCreate";
import type { BrowserNode, SourceFileInfo } from "../memberInfo";
import { resolveMember } from "../prompts";
import { CheckedOutMember, formatMemberPath, memberNameProblem } from "../types";
import { sourceFileInfoOf } from "./checkout";
import { CommandContext } from "./context";
import { ensureWorkItemForCheckout } from "./git";

const IBMI_NAME = /^[A-Z0-9_$#@][A-Z0-9_$#@.]{0,9}$/i;
const SOURCE_TYPE = /^[A-Z0-9_$#@.]{1,10}$/i;

/**
 * New Member… adds an empty source member on the IBM i and checks it out; Copy Member As… does
 * the same from an existing member's source. The exact CL commands are shown before they run
 * (see `memberCreate.ts`), and nothing runs until the user chooses Run.
 */
export function registerMemberCreateCommands(ctx: CommandContext): void {
  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("ibmi-member-workspace.newMember", async (node?: BrowserNode) => {
      await createMember(ctx, { prefill: sourceFileInfoOf(node) });
    }),
    vscode.commands.registerCommand("ibmi-member-workspace.copyMemberAs", async (item?: unknown) => {
      const entry = resolveMember(ctx.service, item);
      if (!entry) {
        vscode.window.showInformationMessage("Select a checked-out member to copy, or open its local file.");
        return;
      }
      await createMember(ctx, { from: entry });
    })
  );
}

async function createMember(ctx: CommandContext, source: { from?: CheckedOutMember; prefill?: SourceFileInfo }): Promise<void> {
  const { from, prefill } = source;
  const what = from ? "Copy Member As" : "New Member";
  const system = getSystemName();
  if (!system) {
    vscode.window.showWarningMessage(`Connect to an IBM i first: ${what} adds a member there.`);
    return;
  }
  if (!(await ensureCheckoutFolder(ctx))) {
    return;
  }

  const spec = await askForMember(what, from, prefill);
  if (!spec) {
    return;
  }
  const problem = newMemberProblem(spec);
  if (problem) {
    vscode.window.showErrorMessage(problem);
    return;
  }
  const target = `${spec.library}/${spec.sourceFile}(${spec.memberName})`;

  const refusal = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Checking ${spec.library}/${spec.sourceFile} on ${system}...` },
    () => checkTarget(spec)
  );
  if (refusal) {
    vscode.window.showErrorMessage(refusal);
    return;
  }

  const commands = from ? copyMemberPlan(from, spec) : [addMemberCommand(spec)];
  const choice = await vscode.window.showWarningMessage(
    `Run ${commands.length === 1 ? "this command" : `these ${commands.length} commands`} on ${system}?`,
    { modal: true, detail: commands.join("\n") },
    "Run"
  );
  if (choice !== "Run" || !(await ensureWorkItemForCheckout(ctx, system))) {
    return;
  }

  let ran = 0;
  try {
    for (const command of commands) {
      ctx.log.appendLine(`[member] ${command}`);
      await runClCommand(command);
      ran++;
    }
  } catch (err) {
    const added = ran > 0 && from ? ` ${target} was added but is still empty: run the copy again, or remove the member in the Object Browser.` : "";
    void vscode.window
      .showErrorMessage(`${what} failed on ${system}: ${errorMessage(err)}.${added}`, "Show Output")
      .then((pick) => pick && ctx.log.show());
    return;
  }
  ctx.log.appendLine(`[member] Added ${target} on ${system}${from ? ` from ${formatMemberPath(from)}` : ""}`);

  try {
    await ctx.service.checkoutMember(spec.library, spec.sourceFile, spec.memberName, spec.sourceType.toLowerCase(), {
      redownloadBehavior: "force",
      system,
    });
  } catch (err) {
    vscode.window.showErrorMessage(`${target} was added on ${system}, but checking it out failed: ${errorMessage(err)}`);
  }
}

/** Why the member can't be added where asked: not a source file, or the name is taken. */
async function checkTarget(spec: NewMemberSpec): Promise<string | undefined> {
  const file = `${spec.library}/${spec.sourceFile}`;
  let layout;
  try {
    layout = await sourceFileLayout(spec.library, spec.sourceFile);
  } catch (err) {
    return `Could not read ${file}: ${errorMessage(err)}`;
  }
  if (!layout) {
    return `${file} is not a source physical file, or you aren't authorized to it.`;
  }
  const stamps = await memberChangeStamps(spec.library, spec.sourceFile, [spec.memberName]).catch(() => new Map<string, string>());
  if (stamps.has(spec.memberName.toUpperCase())) {
    return `${file}(${spec.memberName}) already exists. Check it out instead.`;
  }
  return undefined;
}

/** Asks for the library, source file, member, source type and text, in that order; undefined when dismissed. */
async function askForMember(what: string, from: MemberRef & { extension: string } | undefined, prefill: SourceFileInfo | undefined): Promise<NewMemberSpec | undefined> {
  const ask = (prompt: string, value: string, validate: (value: string) => string | undefined) =>
    vscode.window.showInputBox({ title: what, prompt, value, ignoreFocusOut: true, validateInput: (typed) => validate(typed.trim()) });
  const name = (label: string) => (value: string) => (IBMI_NAME.test(value) ? undefined : `Enter an IBM i ${label} name of up to 10 characters.`);

  const library = await ask("Library the member is added in", from?.library ?? prefill?.library ?? "", name("library"));
  if (library === undefined) {
    return undefined;
  }
  const sourceFile = await ask("Source physical file", from?.sourceFile ?? prefill?.sourceFile ?? "", name("source file"));
  if (sourceFile === undefined) {
    return undefined;
  }
  const memberName = await ask(from ? `New name for the copy of ${from.memberName}` : "Member name", "", name("member"));
  if (memberName === undefined) {
    return undefined;
  }
  const sourceType = await ask(
    "Source type (RPGLE, SQLRPGLE, CLLE, CBLLE, PF, DSPF…); it becomes the local file's extension",
    from?.extension.toUpperCase() ?? "RPGLE",
    (value) => (SOURCE_TYPE.test(value) ? undefined : "Enter a source type of up to 10 characters.")
  );
  if (sourceType === undefined) {
    return undefined;
  }
  const text = await vscode.window.showInputBox({
    title: what,
    prompt: "Member text (description), up to 50 characters; leave empty for none",
    value: "",
    ignoreFocusOut: true,
    validateInput: (typed) => memberTextProblem(typed.trim()),
  });
  if (text === undefined) {
    return undefined;
  }
  const spec: NewMemberSpec = {
    library: library.trim().toUpperCase(),
    sourceFile: sourceFile.trim().toUpperCase(),
    memberName: memberName.trim().toUpperCase(),
    sourceType: sourceType.trim().toUpperCase(),
    text: text.trim(),
  };
  // The same check the checkout applies, so a name that passes here is one a local path can hold.
  return memberNameProblem({ ...spec, extension: spec.sourceType }) ? undefined : spec;
}

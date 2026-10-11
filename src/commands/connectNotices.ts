import * as vscode from "vscode";
import { staleEntries } from "../checkoutTreeModel";
import { getSystemName, onConnectionChange } from "../codeForIBMi";
import { disconnectedMessage, reconnectedMessage, staleMessage, unsentChanges } from "../connectNotices";
import { errorMessage } from "../errors";
import { CheckedOutMember } from "../types";
import { CommandContext } from "./context";

export const STALE_SETTING = "staleCheckoutDays";
/** Code for IBM i finishes setting up the connection first, and other on-connect work goes before a reminder. */
const CONNECT_DELAY_MS = 6000;

/**
 * Tells the user, once per connection, about checkouts that need attention: members whose
 * changes haven't been uploaded when the connection drops or comes back, and checkouts out for
 * longer than `staleCheckoutDays`. Nothing here asks the IBM i anything.
 */
export function registerConnectNotices(ctx: CommandContext): void {
  const { context, service, treeProvider, log } = ctx;
  let lastHost = getSystemName();
  /** Systems already reminded this session. */
  const reminded = new Set<string>();

  const onConnected = async (system: string): Promise<void> => {
    if (reminded.has(system) || getSystemName() !== system) {
      return;
    }
    reminded.add(system);
    const entries = service.getEntriesForSystem(system);
    const stale = staleEntries(entries, { now: new Date(), thresholdDays: staleThreshold() });
    if (stale.length > 0) {
      const choice = await vscode.window.showWarningMessage(staleMessage(stale, staleThreshold()), "Show");
      if (choice === "Show") {
        await reveal(ctx, stale[0]);
      }
    }
    const unsent = await withLocalChanges(unsentChanges(entries));
    if (unsent.length > 0) {
      const choice = await vscode.window.showInformationMessage(reconnectedMessage(system, unsent), "Upload All…", "Show");
      if (choice === "Upload All…") {
        const items = unsent.map((entry) => ({ kind: "member" as const, entry }));
        await vscode.commands.executeCommand("ibmi-member-workspace.uploadToRemote", items[0], items);
      } else if (choice === "Show") {
        await reveal(ctx, unsent[0]);
      }
    }
  };

  const onDisconnected = async (system: string): Promise<void> => {
    const unsent = await withLocalChanges(unsentChanges(service.getEntriesForSystem(system)));
    if (unsent.length > 0) {
      vscode.window.showWarningMessage(disconnectedMessage(system, unsent));
    }
  };

  /** Keeps the members whose local file really differs (the status is kept up to date, but a revert can lag). */
  const withLocalChanges = async (entries: CheckedOutMember[]): Promise<CheckedOutMember[]> => {
    const kept: CheckedOutMember[] = [];
    for (const entry of entries) {
      try {
        if (await service.hasLocalChanges(entry)) {
          kept.push(entry);
        }
      } catch (err) {
        log.appendLine(`[notice] Could not read ${entry.localPath}: ${errorMessage(err)}`);
      }
    }
    return kept;
  };

  const schedule = (system: string) => {
    setTimeout(() => {
      onConnected(system).catch((err) => log.appendLine(`[notice] On connect: ${errorMessage(err)}`));
    }, CONNECT_DELAY_MS);
  };

  onConnectionChange(context, (event) => {
    if (event === "disconnected") {
      const host = lastHost;
      lastHost = undefined;
      if (host) {
        onDisconnected(host).catch((err) => log.appendLine(`[notice] On disconnect: ${errorMessage(err)}`));
      }
      return;
    }
    const system = getSystemName();
    lastHost = system;
    if (system) {
      schedule(system);
    }
  });
  // Already connected when the extension started (a window reload): no event will come.
  if (lastHost) {
    schedule(lastHost);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`ibmi-member-workspace.${STALE_SETTING}`)) {
        treeProvider.refresh();
      }
    })
  );
}

/** Days after which a checkout is called stale; 0 turns the reminder off. */
export function staleThreshold(): number {
  const days = vscode.workspace.getConfiguration("ibmi-member-workspace").get<number>(STALE_SETTING, 14);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

async function reveal(ctx: CommandContext, entry: CheckedOutMember): Promise<void> {
  await vscode.commands.executeCommand("ibmi-member-workspace.checkoutView.focus");
  try {
    await ctx.treeView.reveal({ kind: "member", entry }, { focus: true, select: true, expand: true });
  } catch (err) {
    ctx.log.appendLine(`[notice] Could not reveal ${entry.memberName}: ${errorMessage(err)}`);
  }
}

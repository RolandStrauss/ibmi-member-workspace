import * as fs from "node:fs";
import * as vscode from "vscode";
import { AdoptCandidate, FolderEntry, MAX_ADOPT_CANDIDATES, scanCheckoutFolder } from "../adoptFolder";
import { ensureCheckoutFolder } from "../checkoutFolder";
import { getSystemName } from "../codeForIBMi";
import { DOWNLOAD_CONCURRENCY, mapWithLimit } from "../concurrency";
import { CheckoutCancelledError, errorMessage } from "../errors";
import { sanitizeSystemName } from "../types";
import { CommandContext } from "./context";
import { ensureWorkItemForCheckout } from "./git";

/**
 * Adopt Checkout Folder: tracks the members whose files are already in the checkout folder but
 * that no checkout lists, for example after the same folder is opened from another workspace or
 * computer. The IBM i's copy of each is read to tell the status; the files are left as they are.
 */
export function registerAdoptFolderCommand(ctx: CommandContext): void {
  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("ibmi-member-workspace.adoptCheckoutFolder", () => adoptCheckoutFolder(ctx))
  );
}

async function adoptCheckoutFolder(ctx: CommandContext): Promise<void> {
  const { service, log } = ctx;
  const system = getSystemName();
  if (!system) {
    vscode.window.showWarningMessage("Connect to an IBM i first: adopted members are compared with their copies there.");
    return;
  }
  if (!(await ensureCheckoutFolder(ctx))) {
    return;
  }
  const root = service.getCheckoutRoot();
  if (!root) {
    return;
  }
  const systemFolder = sanitizeSystemName(system);
  const tracked = new Set(service.getEntriesForSystem(system).map((entry) => entry.id));
  const scan = scanCheckoutFolder(root.fsPath, systemFolder, system, realFolder(), tracked);
  if (scan.candidates.length === 0) {
    vscode.window.showInformationMessage(
      `Nothing to adopt: every member file under ${systemFolder} in the checkout folder is already tracked` +
      (scan.skipped > 0 ? ` (${scan.skipped} file(s) or link(s) not in the member layout were skipped)` : "") + "."
    );
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    scan.candidates.map((candidate) => ({
      label: `${candidate.library}/${candidate.sourceFile}(${candidate.memberName})`,
      description: candidate.readOnly ? "read-only → reference copy" : `.${candidate.extension}`,
      detail: candidate.localPath,
      picked: true,
      candidate,
    })),
    {
      canPickMany: true,
      title: `Adopt members already in the checkout folder of ${system}` + (scan.truncated ? ` (first ${MAX_ADOPT_CANDIDATES}; run again for the rest)` : ""),
      placeHolder: "Each is compared with its copy on the IBM i; read-only files become reference copies. Files are not changed.",
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );
  if (!chosen || chosen.length === 0) {
    return;
  }
  if (!(await ensureWorkItemForCheckout(ctx, system))) {
    return;
  }
  const candidates = chosen.map((item) => item.candidate);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Adopting members...", cancellable: true },
    async (progress, token) => {
      const tally = { inSync: 0, modified: 0, missing: 0, errors: 0 };
      let cancelled = false;
      const adopted: string[] = [];
      const controller = new AbortController();
      const subscription = token.onCancellationRequested(() => controller.abort());
      await service.runBatch(async () => {
        let done = 0;
        const settled = await mapWithLimit(
          candidates,
          DOWNLOAD_CONCURRENCY,
          (candidate: AdoptCandidate) => service.adoptMember(candidate, {
            reference: candidate.readOnly, system, signal: controller.signal, deferCheckpointTo: adopted,
          }),
          {
            signal: controller.signal,
            cancelled: () => new CheckoutCancelledError(),
            onSettled: (index) => {
              done++;
              progress.report({ message: `${candidates[index].memberName} (${done}/${candidates.length})`, increment: 100 / candidates.length });
            },
          }
        );
        settled.forEach((result, index) => {
          if (result.status === "fulfilled") {
            const status = result.value.status;
            tally[status === "remote-missing" ? "missing" : status === "modified" ? "modified" : "inSync"]++;
          } else if (result.reason instanceof CheckoutCancelledError) {
            cancelled ||= token.isCancellationRequested;
          } else {
            tally.errors++;
            log.appendLine(`[adopt] ${candidates[index].library}/${candidates[index].sourceFile}(${candidates[index].memberName}): ${errorMessage(result.reason)}`);
          }
        });
        subscription.dispose();
        await service.saveBatchCheckpoint(system, adopted, `adopt: ${adopted.length} member(s) already in the checkout folder of ${system}`);
      });

      const parts = [
        `${tally.inSync} in sync`,
        `${tally.modified} with local changes`,
        ...(tally.missing > 0 ? [`${tally.missing} deleted on the IBM i`] : []),
        ...(tally.errors > 0 ? [`${tally.errors} error(s), see the IBM i Member Workspace output panel`] : []),
      ];
      const summary = `Adopted ${adopted.length} of ${candidates.length} member(s) from the checkout folder: ${parts.join(", ")}.`;
      if (cancelled) {
        vscode.window.showInformationMessage(`Adopting cancelled. ${summary}`);
      } else if (tally.errors > 0) {
        vscode.window.showWarningMessage(summary);
        log.show();
      } else {
        vscode.window.showInformationMessage(summary);
      }
    }
  );
}

/** The real checkout folder: directory entries by type (links are never followed) and the read-only check. */
function realFolder() {
  return {
    list: (directory: string): FolderEntry[] => {
      try {
        return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          kind: entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        }));
      } catch {
        return [];
      }
    },
    isReadOnly: (filePath: string): boolean => {
      try {
        fs.accessSync(filePath, fs.constants.W_OK);
        return false;
      } catch {
        return true;
      }
    },
  };
}

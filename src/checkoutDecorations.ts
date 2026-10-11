import * as vscode from "vscode";
import { CheckoutService } from "./checkoutService";
import { getSystemName } from "./codeForIBMi";
import { extractMemberInfo } from "./memberInfo";
import { StatusDecoration, browserDecorationFor, decorationFor } from "./statusDecorations";

/**
 * Shows each checked-out file's sync status in the Explorer and on editor tabs, and marks the
 * same members in Code for IBM i's Object Browser, whose items carry `member:` URIs (see
 * `statusDecorations.ts`).
 */
export class CheckoutDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly service: CheckoutService) {
    // Statuses change in batches; asking again for every shown file also clears discarded checkouts.
    this.subscription = service.onDidChange(() => this.emitter.fire(undefined));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const decoration = uri.scheme === "file" ? this.localDecoration(uri) : uri.scheme === "member" ? this.browserDecoration(uri) : undefined;
    return decoration && new vscode.FileDecoration(
      decoration.badge,
      decoration.tooltip,
      decoration.colorId ? new vscode.ThemeColor(decoration.colorId) : undefined
    );
  }

  private localDecoration(uri: vscode.Uri): StatusDecoration | undefined {
    const entry = this.service.findEntryByLocalPath(uri.fsPath);
    return entry && decorationFor(entry);
  }

  /** The Object Browser's member, if it is checked out on the connected system. */
  private browserDecoration(uri: vscode.Uri): StatusDecoration | undefined {
    const system = getSystemName();
    if (!system) {
      return undefined;
    }
    const info = extractMemberInfo({}, uri);
    const entry = info && this.service.findEntry(system, info.library, info.sourceFile, info.memberName);
    return entry && browserDecorationFor(entry, this.service.getActiveWorkItem(system));
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

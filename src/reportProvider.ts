import * as vscode from "vscode";

export const REPORT_SCHEME = "ibmi-research";

/**
 * Reports shown as read-only documents (research results, compile listings, dependency diagrams);
 * each is kept until its document closes. One instance serves every command, registered in
 * `activate`.
 */
export class ReportProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly reports = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private counter = 0;
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === REPORT_SCHEME) {
        this.reports.delete(doc.uri.toString());
      }
    });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.reports.get(uri.toString()) ?? "This report was closed. Run the command again.\n";
  }

  /**
   * Opens `text` as a document titled `title`; `.md` gets Markdown's language, otherwise plain
   * text. With `show: false` the document is only loaded (for a preview to render), not shown.
   */
  async open(title: string, text: string, options: { extension?: "txt" | "md"; show?: boolean } = {}): Promise<vscode.Uri> {
    const file = title.replace(/[\\/:*?"<>|]/g, "_");
    const uri = vscode.Uri.from({
      scheme: REPORT_SCHEME,
      path: `/${file}.${options.extension ?? "txt"}`,
      query: String(++this.counter),
    });
    this.reports.set(uri.toString(), text);
    const doc = await vscode.workspace.openTextDocument(uri);
    if (options.show !== false) {
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    return uri;
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

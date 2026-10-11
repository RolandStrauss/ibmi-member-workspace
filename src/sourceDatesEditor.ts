import * as vscode from "vscode";
import { CheckoutService } from "./checkoutService";
import { checkoutOfDocument } from "./documentCheckout";
import { errorMessage } from "./errors";
import { SourceDateLookup, mapSourceDates } from "./sourceDateModel";

const SETTING = "sourceDates";
const debounceMs = 300;
/** Lines beyond the visible ones that get a gutter date, so scrolling a little shows no gap. */
const MARGIN_LINES = 100;
/** Keeps the gutter aligned on lines without a date (ordinary spaces collapse). */
const BLANK = " ".repeat(10);

/**
 * Shows the IBM i's source dates on checked-out files: the date a line was last changed on the
 * IBM i, on hover and, when the setting says so, in the gutter. Lines added or changed locally
 * have none. The dates belong to the checkout's baseline text; `sourceDateModel.ts` maps them
 * onto the text in the editor.
 */
export function registerSourceDates(context: vscode.ExtensionContext, service: CheckoutService, log: vscode.OutputChannel): void {
  const gutter = vscode.window.createTextEditorDecorationType({
    before: { color: new vscode.ThemeColor("editorLineNumber.foreground"), margin: "0 1em 0 0" },
  });
  /** One lookup per document version and baseline. */
  const cache = new Map<string, { version: number; hash: string; lookup: SourceDateLookup | undefined }>();
  const pending = new Map<string, NodeJS.Timeout>();

  const lookupFor = async (document: vscode.TextDocument): Promise<SourceDateLookup | undefined> => {
    const entry = checkoutOfDocument(service, document, { editableOnly: false });
    if (!entry) {
      return undefined;
    }
    const key = document.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === document.version && cached.hash === entry.remoteHashAtCheckout) {
      return cached.lookup;
    }
    let lookup: SourceDateLookup | undefined;
    try {
      const dates = await service.sourceDatesFor(entry);
      const baseline = dates && await service.baselineText(entry);
      lookup = dates && baseline !== undefined ? mapSourceDates(baseline, document.getText(), dates) : undefined;
    } catch (err) {
      log.appendLine(`[dates] Could not map the source dates of ${entry.memberName}: ${errorMessage(err)}`);
    }
    cache.set(key, { version: document.version, hash: entry.remoteHashAtCheckout, lookup });
    return lookup;
  };

  const decorate = async (editor: vscode.TextEditor): Promise<void> => {
    if (service.sourceDatesMode() !== "gutter" || editor.document.uri.scheme !== "file") {
      editor.setDecorations(gutter, []);
      return;
    }
    const lookup = await lookupFor(editor.document);
    if (!lookup) {
      editor.setDecorations(gutter, []);
      return;
    }
    const options: vscode.DecorationOptions[] = [];
    for (const visible of editor.visibleRanges) {
      const first = Math.max(0, visible.start.line - MARGIN_LINES);
      const last = Math.min(editor.document.lineCount - 1, visible.end.line + MARGIN_LINES);
      for (let line = first; line <= last; line++) {
        options.push({
          range: new vscode.Range(line, 0, line, 0),
          renderOptions: { before: { contentText: lookup.dateAt(line) ?? BLANK } },
        });
      }
    }
    editor.setDecorations(gutter, options);
  };

  const schedule = (editor: vscode.TextEditor) => {
    const key = editor.document.uri.toString();
    clearTimeout(pending.get(key));
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      void decorate(editor);
    }, debounceMs));
  };
  const scheduleAll = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      schedule(editor);
    }
  };
  const forget = () => {
    cache.clear();
    scheduleAll();
  };

  context.subscriptions.push(
    gutter,
    vscode.languages.registerHoverProvider({ scheme: "file" }, {
      provideHover: async (document, position) => {
        if (service.sourceDatesMode() === "off") {
          return undefined;
        }
        const date = (await lookupFor(document))?.dateAt(position.line);
        return date ? new vscode.Hover(new vscode.MarkdownString(`Last changed on the IBM i: ${date}`)) : undefined;
      },
    }),
    vscode.window.onDidChangeVisibleTextEditors(scheduleAll),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => schedule(event.textEditor)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) {
          schedule(editor);
        }
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => cache.delete(document.uri.toString())),
    // A baseline changes (refresh, upload, recheckout), the dates arrive, or a checkout is discarded.
    service.onDidChange(forget),
    service.onDidChangeSourceDates(forget),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`ibmi-member-workspace.${SETTING}`)) {
        forget();
      }
    }),
    vscode.commands.registerCommand("ibmi-member-workspace.toggleSourceDates", async () => {
      const next = service.sourceDatesMode() === "gutter" ? "hover" : "gutter";
      await vscode.workspace.getConfiguration("ibmi-member-workspace").update(SETTING, next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(
        next === "gutter" ? "Source dates: shown in the gutter of checked-out members" : "Source dates: shown on hover",
        4000
      );
    }),
    {
      dispose: () => {
        for (const timer of pending.values()) {
          clearTimeout(timer);
        }
        pending.clear();
      },
    }
  );
  scheduleAll();
}

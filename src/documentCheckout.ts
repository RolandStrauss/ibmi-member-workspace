import type * as vscode from "vscode";
import type { CheckoutService } from "./checkoutService";
import { CheckedOutMember, isReferenceCopy } from "./types";

/**
 * The checkout an open document is the local file of, if any. Editor features (source problems,
 * source dates, compile errors) all decide this the same way: a `file:` document whose path is a
 * tracked local file, and, when `editableOnly`, not a read-only reference copy.
 */
export function checkoutOfDocument(
  service: CheckoutService,
  document: vscode.TextDocument,
  options: { editableOnly: boolean }
): CheckedOutMember | undefined {
  if (document.uri.scheme !== "file") {
    return undefined;
  }
  const entry = service.findEntryByLocalPath(document.uri.fsPath);
  if (!entry) {
    return undefined;
  }
  return options.editableOnly && isReferenceCopy(entry) ? undefined : entry;
}

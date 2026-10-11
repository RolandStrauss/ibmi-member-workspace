import type { ReferenceKind } from "./dependencyScan";
import type { DependencySubject } from "./dependencySources";
import { WalkNode, WalkResult, WalkUnresolved, subjectKey } from "./dependencyWalk";

/**
 * Find All Dependencies as a picture: the members a walk found, drawn as a Mermaid graph and as
 * an indented tree, in one Markdown document. A node's parent is the last member it was reached
 * through (`via`), or the root. Kept free of the `vscode` module so it can be unit tested.
 */

const KIND_LABELS: Record<ReferenceKind, string> = {
  copybook: "copybook",
  program: "calls",
  file: "file",
  table: "SQL table",
  procedure: "procedure",
};

const KIND_ORDER: ReferenceKind[] = ["copybook", "program", "file", "table", "procedure"];

interface Tree {
  children: Map<string, WalkNode[]>;
  unresolved: Map<string, WalkUnresolved[]>;
}

const ROOT = "";

function parentOf(via: readonly string[]): string {
  return via.length === 0 ? ROOT : via[via.length - 1].toUpperCase();
}

function byKindThenName(a: { reference: { kind: ReferenceKind; member: string } }, b: { reference: { kind: ReferenceKind; member: string } }): number {
  return KIND_ORDER.indexOf(a.reference.kind) - KIND_ORDER.indexOf(b.reference.kind) || a.reference.member.localeCompare(b.reference.member);
}

/** Children by parent member name (upper case; "" for the root), each list in a stable order. */
function treeOf(result: WalkResult): Tree {
  const children = new Map<string, WalkNode[]>();
  const unresolved = new Map<string, WalkUnresolved[]>();
  for (const node of [...result.nodes].sort(byKindThenName)) {
    const parent = parentOf(node.via);
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  for (const item of [...result.unresolved].sort(byKindThenName)) {
    const parent = parentOf(item.via);
    unresolved.set(parent, [...(unresolved.get(parent) ?? []), item]);
  }
  return { children, unresolved };
}

function label(subject: DependencySubject): string {
  return `${subject.memberName}  ${subject.library}/${subject.sourceFile}`;
}

/** The walk as an indented tree with box-drawing lines, for reading without a Mermaid renderer. */
export function dependencyTreeText(root: DependencySubject, result: WalkResult): string {
  const tree = treeOf(result);
  const lines: string[] = [label(root)];
  // Children are keyed by member name (what `via` records), so a name is drawn in full once.
  const seen = new Set<string>([root.memberName.toUpperCase()]);

  const draw = (parent: string, prefix: string) => {
    const nodes = tree.children.get(parent) ?? [];
    const missing = tree.unresolved.get(parent) ?? [];
    const total = nodes.length + missing.length;
    let index = 0;
    for (const node of nodes) {
      const last = ++index === total;
      const name = node.subject.memberName.toUpperCase();
      const repeat = seen.has(name);
      seen.add(name);
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${KIND_LABELS[node.reference.kind]} ${label(node.subject)}${repeat ? "  (shown above)" : ""}`);
      if (!repeat) {
        draw(name, `${prefix}${last ? "   " : "│  "}`);
      }
    }
    for (const item of missing) {
      const last = ++index === total;
      lines.push(`${prefix}${last ? "└─ " : "├─ "}? ${KIND_LABELS[item.reference.kind]} ${item.reference.member}  (source not found)`);
    }
  };
  draw(ROOT, "");
  return lines.join("\n");
}

/** A quoted Mermaid label of several lines; member text is data, so its markup characters are escaped as entities. */
function mermaidLabel(...parts: string[]): string {
  const escaped = parts.map((part) => part
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;"));
  return `"${escaped.join("<br/>")}"`;
}

/** The walk as a Mermaid `graph LR`; members whose source wasn't found are dashed. */
export function dependencyMermaid(root: DependencySubject, result: WalkResult): string {
  const ids = new Map<string, string>();
  const idOf = (subject: DependencySubject): string => {
    const key = subjectKey(subject);
    let id = ids.get(key);
    if (!id) {
      id = `n${ids.size}`;
      ids.set(key, id);
    }
    return id;
  };
  const byName = new Map<string, DependencySubject>();
  for (const node of result.nodes) {
    if (!byName.has(node.subject.memberName.toUpperCase())) {
      byName.set(node.subject.memberName.toUpperCase(), node.subject);
    }
  }
  const parentSubject = (via: readonly string[]): DependencySubject =>
    via.length === 0 ? root : byName.get(via[via.length - 1].toUpperCase()) ?? root;

  const lines = ["graph LR"];
  const declared = new Set<string>();
  const declare = (subject: DependencySubject) => {
    const id = idOf(subject);
    if (!declared.has(id)) {
      declared.add(id);
      lines.push(`  ${id}[${mermaidLabel(subject.memberName, `${subject.library}/${subject.sourceFile}`)}]`);
    }
  };
  declare(root);
  const edges = new Set<string>();
  for (const node of [...result.nodes].sort(byKindThenName)) {
    declare(node.subject);
    const edge = `  ${idOf(parentSubject(node.via))} -- ${KIND_LABELS[node.reference.kind]} --> ${idOf(node.subject)}`;
    if (!edges.has(edge)) {
      edges.add(edge);
      lines.push(edge);
    }
  }
  let unresolved = 0;
  for (const item of [...result.unresolved].sort(byKindThenName)) {
    const id = `u${unresolved++}`;
    lines.push(`  ${id}[${mermaidLabel(item.reference.member, "source not found")}]:::unresolved`);
    lines.push(`  ${idOf(parentSubject(item.via))} -. ${KIND_LABELS[item.reference.kind]} .-> ${id}`);
  }
  if (unresolved > 0) {
    lines.push("  classDef unresolved stroke-dasharray: 5 5");
  }
  return lines.join("\n");
}

/** The Markdown document: a summary, the Mermaid graph, and the tree for readers without Mermaid. */
export function dependencyMarkdown(
  root: DependencySubject,
  result: WalkResult,
  options: { mermaidSupported: boolean }
): string {
  const levels = result.nodes.length === 0 ? 0 : Math.max(...result.nodes.map((node) => node.depth));
  const counts = [
    `${result.nodes.length} member${result.nodes.length === 1 ? "" : "s"} at ${levels} level${levels === 1 ? "" : "s"}`,
    result.unresolved.length > 0 ? `${result.unresolved.length} whose source wasn't found` : undefined,
    result.cancelled ? "cancelled, so the list is partial" : result.stopped ? "stopped at the limit, so the list is partial" : undefined,
  ].filter((part): part is string => part !== undefined);
  const lines = [
    `# Dependencies of ${subjectKey(root)}`,
    "",
    `${counts.join("; ")}. Arrows point from a member to what it uses${result.unresolved.length > 0 ? "; dashed arrows lead to members whose source wasn't found" : ""}.`,
    "",
  ];
  if (!options.mermaidSupported) {
    lines.push(
      "> To see this as a diagram, install the Markdown Preview Mermaid Support extension (`bierner.markdown-mermaid`) and open the Markdown preview. The tree below shows the same.",
      ""
    );
  }
  lines.push("```mermaid", dependencyMermaid(root, result), "```", "", "```text", dependencyTreeText(root, result), "```", "");
  return lines.join("\n");
}

export interface TreeItem {
  id: string;
  path: string;
  label?: string;
  role?: string;
  type?: string;
  room?: string;
  value?: unknown;
  disabled?: boolean;
}
export interface TreeNode {
  id: string;
  label: string;
  children: Map<string, TreeNode>;
  count: number;
  item?: TreeItem;
}
export interface TreeRow {
  node: TreeNode;
  depth: number;
}
export function makeTree(items: TreeItem[]) {
  const root: TreeNode = { id: "", label: "", children: new Map(), count: 0 };
  for (const item of items) {
    let node = root,
      id = "";
    for (const part of item.path.split(".")) {
      id = id ? `${id}.${part}` : part;
      if (!node.children.has(part))
        node.children.set(part, {
          id,
          label: part,
          children: new Map(),
          count: 0,
        });
      node = node.children.get(part)!;
      node.count++;
    }
    node.item = item;
  }
  return root;
}
export function matches(
  item: TreeItem,
  query: string,
  role: string,
  room: string,
) {
  const text =
    `${item.path} ${item.label} ${item.role || ""} ${item.type || ""}`.toLowerCase();
  return (
    query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .every((w) => text.includes(w)) &&
    (!role || item.role === role) &&
    (!room || item.room === room)
  );
}
export function visibleNodes(
  tree: TreeNode,
  expanded: Set<string>,
  auto = false,
  depth = 0,
): TreeRow[] {
  const result: TreeRow[] = [];
  for (const node of [...tree.children.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "de", { numeric: true }),
  )) {
    result.push({ node, depth });
    if (node.children.size && (auto || expanded.has(node.id)))
      result.push(...visibleNodes(node, expanded, auto, depth + 1));
  }
  return result;
}
export class ObjectTree {
  host: HTMLElement;
  onSelect: (item: TreeItem, checked: boolean) => void;
  expanded = new Set<string>();
  selected = new Set<string>();
  items: TreeItem[] = [];
  limit = 250;
  query = "";
  role = "";
  room = "";

  constructor(
    host: HTMLElement,
    onSelect: (item: TreeItem, checked: boolean) => void,
  ) {
    this.host = host;
    this.onSelect = onSelect;
  }
  setItems(items: TreeItem[], selected = new Set<string>()) {
    this.items = items;
    this.selected = selected;
    this.limit = 250;
    this.render();
  }
  filter(query: string, role = "", room = "") {
    Object.assign(this, { query, role, room, limit: 250 });
    this.render();
  }
  render() {
    const filtered = this.items.filter((i) =>
      matches(i, this.query, this.role, this.room),
    );
    const rows = visibleNodes(
      makeTree(filtered),
      this.expanded,
      Boolean(this.query || this.role || this.room),
    );
    this.host.replaceChildren();
    const tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "ioBroker Objektbaum");
    const header = document.createElement("div");
    header.className = "object-head";
    for (const text of ["Objekt-ID / Name", "Rolle / Typ", "Wert"]) {
      const cell = document.createElement("span");
      cell.textContent = text;
      header.append(cell);
    }
    this.host.append(header, tree);
    for (const { node, depth } of rows.slice(0, this.limit)) {
      const row = document.createElement("div");
      row.className = `object-row ${node.item ? "is-state" : "is-folder"}`;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      row.style.setProperty("--depth", String(depth));
      const first = document.createElement("div");
      first.className = "object-label";
      if (node.children.size) {
        const expanded = Boolean(
          this.query || this.role || this.room || this.expanded.has(node.id),
        );
        row.setAttribute("aria-expanded", String(expanded));
        const button = document.createElement("button");
        button.className = "tree-expand";
        button.textContent = expanded ? "▾" : "▸";
        button.setAttribute(
          "aria-label",
          `${node.id} ${expanded ? "zuklappen" : "aufklappen"}`,
        );
        button.onclick = () => {
          this.expanded.has(node.id)
            ? this.expanded.delete(node.id)
            : this.expanded.add(node.id);
          this.render();
        };
        first.append(button);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "tree-expand";
        spacer.textContent = "·";
        first.append(spacer);
      }
      if (node.item) {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked =
          Boolean(node.item.disabled) || this.selected.has(node.item.id);
        input.disabled = Boolean(node.item.disabled);
        input.setAttribute(
          "aria-label",
          `${node.item.label} (${node.item.path}) auswählen`,
        );
        input.onchange = () => {
          this.onSelect(node.item!, input.checked);
          this.render();
        };
        first.append(input);
        row.setAttribute("aria-selected", String(input.checked));
        row.ondblclick = () => {
          if (!input.disabled) {
            input.checked = !input.checked;
            input.dispatchEvent(new Event("change"));
          }
        };
      }
      const labels = document.createElement("span"),
        title = document.createElement("strong");
      title.textContent = node.item
        ? node.item.label || node.item.path
        : node.label;
      labels.append(title);
      const detail = document.createElement("small");
      detail.textContent = node.item
        ? node.item.path
        : `${node.id} · ${node.count}`;
      labels.append(detail);
      first.append(labels);
      const meta = document.createElement("span");
      meta.className = "object-meta";
      meta.textContent = node.item
        ? `${node.item.role || "—"} / ${node.item.type || "state"}`
        : depth === 0
          ? "Adapter"
          : depth === 1
            ? "Instanz"
            : "Gerät / Kanal";
      const value = document.createElement("span");
      value.className = "object-value";
      value.textContent =
        node.item?.value === undefined
          ? "—"
          : String(node.item.value).slice(0, 100);
      row.append(first, meta, value);
      tree.append(row);
    }
    if (!filtered.length) {
      const p = document.createElement("p");
      p.className = "tree-empty";
      p.textContent = "Keine passenden Datenpunkte. Suche oder Filter ändern.";
      tree.append(p);
    }
    if (rows.length > this.limit) {
      const more = document.createElement("button");
      more.textContent = `Weitere anzeigen (${rows.length - this.limit})`;
      more.onclick = () => {
        this.limit += 250;
        this.render();
      };
      tree.append(more);
    }
  }
}

import { t } from './lang.js';

export interface TreeItem {
    id: string;
    path: string;
    label?: string;
    role?: string;
    type?: string;
    room?: string;
    value?: unknown;
    /** `common.unit` of the datapoint, shown after a numeric value */
    unit?: string;
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
/** Value of a datapoint as text; objects and arrays as JSON; a number with its unit ("21.5 °C", "60 %") */
export function display(value: unknown, unit?: string): string {
    if (value !== null && typeof value === 'object') {
        return JSON.stringify(value);
    }
    const text = String(value);
    const numeric =
        typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
    return unit && numeric ? `${text} ${unit}` : text;
}
export function makeTree(items: TreeItem[]): TreeNode {
    const root: TreeNode = { id: '', label: '', children: new Map(), count: 0 };
    for (const item of items) {
        let node = root,
            id = '';
        for (const part of item.path.split('.')) {
            id = id ? `${id}.${part}` : part;
            if (!node.children.has(part)) {
                node.children.set(part, {
                    id,
                    label: part,
                    children: new Map(),
                    count: 0,
                });
            }
            node = node.children.get(part)!;
            node.count++;
        }
        node.item = item;
    }
    return root;
}
export function matches(item: TreeItem, query: string, role: string, room: string): boolean {
    const text = `${item.path} ${item.label} ${item.role || ''} ${item.type || ''}`.toLowerCase();
    return (
        query
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .every(w => text.includes(w)) &&
        (!role || item.role === role) &&
        (!room || item.room === room)
    );
}
export function visibleNodes(tree: TreeNode, expanded: Set<string>, auto = false, depth = 0): TreeRow[] {
    const result: TreeRow[] = [];
    for (const node of [...tree.children.values()].sort((a, b) =>
        a.label.localeCompare(b.label, 'de', { numeric: true }),
    )) {
        result.push({ node, depth });
        if (node.children.size && (auto || expanded.has(node.id))) {
            result.push(...visibleNodes(node, expanded, auto, depth + 1));
        }
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
    query = '';
    role = '';
    room = '';
    /** Called after each render with the datapoints that are shown (for loading their values). */
    onRows?: (items: TreeItem[]) => void;

    constructor(host: HTMLElement, onSelect: (item: TreeItem, checked: boolean) => void) {
        this.host = host;
        this.onSelect = onSelect;
    }
    setItems(items: TreeItem[], selected = new Set<string>()): void {
        this.items = items;
        this.selected = selected;
        this.limit = 250;
        this.render();
    }
    filter(query: string, role = '', room = ''): void {
        Object.assign(this, { query, role, room, limit: 250 });
        this.render();
    }
    render(): void {
        const filtered = this.items.filter(i => matches(i, this.query, this.role, this.room));
        const rows = visibleNodes(makeTree(filtered), this.expanded, Boolean(this.query || this.role || this.room));
        this.host.replaceChildren();
        const tree = document.createElement('div');
        tree.setAttribute('role', 'tree');
        tree.setAttribute('aria-label', t('tree_aria'));
        const header = document.createElement('div');
        header.className = 'object-head';
        for (const text of [t('col_id'), t('col_role'), t('col_value')]) {
            const cell = document.createElement('span');
            cell.textContent = text;
            header.append(cell);
        }
        this.host.append(header, tree);
        for (const { node, depth } of rows.slice(0, this.limit)) {
            const row = document.createElement('div');
            row.className = `object-row ${node.item ? 'is-state' : 'is-folder'}`;
            row.setAttribute('role', 'treeitem');
            row.setAttribute('aria-level', String(depth + 1));
            row.style.setProperty('--depth', String(depth));
            const first = document.createElement('div');
            first.className = 'object-label';
            if (node.children.size) {
                const expanded = Boolean(this.query || this.role || this.room || this.expanded.has(node.id));
                row.setAttribute('aria-expanded', String(expanded));
                const button = document.createElement('button');
                button.className = 'tree-expand';
                button.textContent = expanded ? '▾' : '▸';
                button.setAttribute('aria-label', t(expanded ? 'collapse' : 'expand', { id: node.id }));
                button.onclick = () => {
                    this.expanded.has(node.id) ? this.expanded.delete(node.id) : this.expanded.add(node.id);
                    this.render();
                };
                first.append(button);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'tree-expand';
                spacer.textContent = '·';
                first.append(spacer);
            }
            if (node.item) {
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = Boolean(node.item.disabled) || this.selected.has(node.item.id);
                input.disabled = Boolean(node.item.disabled);
                input.setAttribute('aria-label', t('select_aria', { name: node.item.label ?? '', id: node.item.path }));
                input.onchange = () => {
                    this.onSelect(node.item!, input.checked);
                    this.render();
                };
                first.append(input);
                row.setAttribute('aria-selected', String(input.checked));
                row.ondblclick = () => {
                    if (!input.disabled) {
                        input.checked = !input.checked;
                        input.dispatchEvent(new Event('change'));
                    }
                };
            }
            const labels = document.createElement('span'),
                title = document.createElement('strong');
            title.textContent = node.item ? node.item.label || node.item.path : node.label;
            labels.append(title);
            const detail = document.createElement('small');
            detail.textContent = node.item ? node.item.path : `${node.id} · ${node.count}`;
            labels.append(detail);
            first.append(labels);
            const meta = document.createElement('span');
            meta.className = 'object-meta';
            meta.textContent = node.item
                ? `${node.item.role || '—'} / ${node.item.type || 'state'}`
                : depth === 0
                  ? t('adapter')
                  : depth === 1
                    ? t('instance')
                    : t('device_channel');
            const value = document.createElement('span');
            value.className = 'object-value';
            value.textContent =
                node.item?.value === undefined ? '—' : display(node.item.value, node.item.unit).slice(0, 100);
            row.append(first, meta, value);
            tree.append(row);
        }
        if (!filtered.length) {
            const p = document.createElement('p');
            p.className = 'tree-empty';
            p.textContent = t('no_match');
            tree.append(p);
        }
        if (rows.length > this.limit) {
            const more = document.createElement('button');
            more.textContent = t('show_more', { n: rows.length - this.limit });
            more.onclick = () => {
                this.limit += 250;
                this.render();
            };
            tree.append(more);
        }
        this.onRows?.(
            rows
                .slice(0, this.limit)
                .map(r => r.node.item)
                .filter((i): i is TreeItem => Boolean(i)),
        );
    }
}

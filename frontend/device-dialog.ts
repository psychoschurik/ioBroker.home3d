import { element as $ } from './dom.js';
import type { DeviceDialogOptions, Mapping } from './types.js';
import type { TreeItem } from './object-tree.js';
import { ObjectTree } from './object-tree.js';
export function setupDeviceDialog({ callWS, refresh, getHass, getStates, reload }: DeviceDialogOptions): void {
    const dialog = $('mapping-dialog');
    let candidates: Mapping[] = [],
        mappings: Mapping[] = [],
        selected = new Set<string>(),
        mode = 'mapping',
        choose: ((value: string) => void) | null = null,
        single: string | null = null;
    // Values are read only for the rows that are shown, never for all objects.
    const values = new Map<string, unknown>(),
        requested = new Set<string>();
    const tree = new ObjectTree($('candidates'), (item, checked) => {
        if (mode === 'single') {
            selected.clear();
            single = checked ? item.id : null;
            if (checked) {
                selected.add(item.id);
            }
            $('mapping-save').disabled = single === null;
        } else {
            checked ? selected.add(item.id) : selected.delete(item.id);
        }
        $('mapping-result').textContent =
            mode === 'single' ? 'Mit Auswählen übernehmen.' : `${selected.size} neue Datenpunkte ausgewählt.`;
    });
    tree.onRows = items => {
        if (mode === 'single') {
            return;
        }
        const ids = items.map(i => i.path).filter(id => !requested.has(id));
        if (!ids.length) {
            return;
        }
        for (const id of ids) {
            requested.add(id);
        }
        const secret = new Set(candidates.filter(c => c._meta?.secret).map(c => c.state));
        getStates(ids)
            .then(states => {
                for (const id of ids) {
                    const val = states[id]?.val;
                    values.set(
                        id,
                        val === undefined
                            ? undefined
                            : secret.has(id)
                              ? '••••'
                              : typeof val === 'string'
                                ? val.slice(0, 120)
                                : val,
                    );
                }
                for (const item of tree.items) {
                    if (values.has(item.path)) {
                        item.value = values.get(item.path);
                    }
                }
                tree.render();
            })
            .catch(() => {});
    };
    function filters(items: TreeItem[]): void {
        for (const [id, key, label] of [
            ['role-filter', 'role', 'Alle Rollen'],
            ['room-filter', 'room', 'Alle Räume'],
        ] as const) {
            const select = $(id);
            select.replaceChildren(new Option(label, ''));
            for (const value of [
                ...new Set(items.map(i => i[key]).filter((value): value is string => Boolean(value))),
            ].sort()) {
                select.append(new Option(key === 'room' ? getHass()?.areas?.[value]?.name || value : value, value));
            }
        }
        $('search').value = '';
        tree.query = '';
        tree.role = '';
        tree.room = '';
    }
    function mappingItems(): TreeItem[] {
        const existing = new Set(mappings.map(m => m.entity_id));
        return candidates.map(c => ({
            id: c.entity_id,
            path: c.state,
            label: c.name || c.state,
            role: c._meta?.role,
            type: c._meta?.type,
            value: values.get(c.state),
            room: c.area_id,
            disabled: existing.has(c.entity_id),
        }));
    }
    function selectedList(): void {
        $('configured-list').replaceChildren();
        $('configured-count').textContent = String(mappings.length);
        for (const m of mappings) {
            const row = document.createElement('div');
            row.className = 'configured-row';
            const text = document.createElement('span');
            text.textContent = m.name || m.state;
            const id = document.createElement('small');
            id.textContent = m.state;
            text.append(id);
            const remove = document.createElement('button');
            remove.textContent = 'Entfernen';
            remove.setAttribute('aria-label', `${m.name || m.state} aus Zuordnungen entfernen`);
            remove.onclick = () => {
                mappings = mappings.filter(x => x.entity_id !== m.entity_id);
                selectedList();
                tree.setItems(mappingItems(), selected);
            };
            row.append(text, remove);
            $('configured-list').append(row);
        }
        $('mapping-json').value = JSON.stringify(mappings, null, 2);
    }
    function configure(isSingle: boolean): void {
        mode = isSingle ? 'single' : 'mapping';
        selected = new Set();
        single = null;
        tree.expanded.clear();
        $('mapping-title').textContent = isSingle ? 'Datenpunkt auswählen' : 'Geräte verbinden';
        $('mapping-save').textContent = isSingle ? 'Auswählen' : 'Übernehmen';
        $('mapping-save').disabled = isSingle;
        $('mapping-advanced').hidden = isSingle;
        $('configured').hidden = isSingle;
        $('discover').hidden = isSingle;
        $('fixed-options').replaceChildren();
        $('mapping-result').textContent = '';
        $('mapping-description').textContent = isSingle
            ? 'Objektbaum öffnen oder nach Name und Objekt-ID suchen. Passende, bereits verbundene Datenpunkte werden angezeigt.'
            : 'Datenpunkte im Objektbaum auswählen und übernehmen. Bestehende Zuordnungen bleiben erhalten.';
    }
    $('mapping-open').onclick = async () => {
        try {
            configure(false);
            dialog.showModal();
            $('mapping-result').textContent = 'Objekte werden geladen …';
            [mappings, candidates] = await Promise.all([
                callWS({ type: 'iobroker/mappings/get' }),
                callWS({ type: 'iobroker/discover' }),
            ]);
            selectedList();
            const items = mappingItems();
            filters(items);
            tree.setItems(items, selected);
            $('mapping-result').textContent = `${candidates.length} Datenpunkte verfügbar.`;
        } catch (e) {
            $('mapping-result').textContent = e.message;
        }
    };
    $('discover').onclick = async () => {
        try {
            reload();
            values.clear();
            requested.clear();
            candidates = await callWS({ type: 'iobroker/discover' });
            tree.setItems(mappingItems(), selected);
        } catch (e) {
            $('mapping-result').textContent = e.message;
        }
    };
    $('mapping-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
        choose = null;
    });
    for (const id of ['search', 'role-filter', 'room-filter'] as const) {
        $(id).addEventListener(id === 'search' ? 'input' : 'change', () =>
            tree.filter($('search').value, $('role-filter').value, $('room-filter').value),
        );
    }
    $('mapping-json').addEventListener('change', () => {
        try {
            const value = JSON.parse($('mapping-json').value);
            if (!Array.isArray(value)) {
                throw Error('Eine Liste wird erwartet.');
            }
            mappings = value;
            selectedList();
            tree.setItems(mappingItems(), selected);
        } catch (e) {
            $('mapping-result').textContent = `JSON: ${e.message}`;
        }
    });
    $('mapping-save').onclick = async () => {
        try {
            if (mode === 'single') {
                if (single !== null && choose) {
                    choose(single);
                }
                dialog.close();
                return;
            }
            const parsed = JSON.parse($('mapping-json').value);
            if (!Array.isArray(parsed)) {
                throw Error('Zuordnungen müssen eine Liste sein.');
            }
            const known = new Set(parsed.map(m => m.entity_id));
            const additions = candidates
                .filter(c => selected.has(c.entity_id) && !known.has(c.entity_id))
                .map(({ _meta, ...c }) => c);
            const result = await callWS({
                type: 'iobroker/mappings/set',
                mappings: [...parsed, ...additions],
            });
            await refresh();
            $('mapping-result').textContent = `${result.saved} Geräte verbunden.`;
            dialog.close();
        } catch (e) {
            $('mapping-result').textContent = e.message;
        }
    };
    window.addEventListener('iobroker-pick', event => {
        event.stopPropagation();
        const detail = event.detail;
        configure(true);
        choose = detail.choose;
        const hass = getHass();
        const items = detail.options.map(o => {
            const entity = hass?.states[o.id];
            return {
                id: o.id,
                path: entity?.attributes?.iobroker_id || o.id,
                label: o.label,
                role: entity?.attributes?.iobroker_role || '',
                type: entity?.attributes?.iobroker_type || '',
                value: entity?.state,
                room: hass?.entities?.[o.id]?.area_id ?? undefined,
            };
        });
        for (const fixed of detail.fixed || []) {
            const b = document.createElement('button');
            b.textContent = fixed.label;
            b.onclick = () => {
                choose?.(fixed.id);
                dialog.close();
            };
            $('fixed-options').append(b);
        }
        if (items.some(i => i.id === detail.value)) {
            single = detail.value;
            selected.add(single!);
            $('mapping-save').disabled = false;
            const parts = items.find(i => i.id === single)!.path.split('.');
            for (let i = 1; i < parts.length; i++) {
                tree.expanded.add(parts.slice(0, i).join('.'));
            }
        }
        filters(items);
        tree.setItems(items, selected);
        dialog.showModal();
    });
}

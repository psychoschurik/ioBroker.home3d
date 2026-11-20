import { element as $ } from './dom.js';
import type { DeviceDialogOptions, Mapping, PickerDetail } from './types.js';
import type { TreeItem } from './object-tree.js';
import { ObjectTree } from './object-tree.js';
import { t } from './lang.js';
export function setupDeviceDialog({
    callWS,
    refresh,
    getHass,
    getStates,
    reload,
    socket,
    getLanguage,
    pickDatapoint,
}: DeviceDialogOptions): void {
    const dialog = $('mapping-dialog');
    let candidates: Mapping[] = [],
        mappings: Mapping[] = [],
        selected = new Set<string>(),
        mode = 'mapping',
        choose: ((value: string) => void) | null = null,
        pick: PickerDetail | null = null,
        single: string | null = null;
    /** The single choice: datapoints not connected yet, by the entity they become when chosen. */
    let fresh = new Map<string, Mapping>();
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
            mode === 'single' ? t('choose_apply') : t('selected_new', { n: selected.size });
    });
    tree.onRows = items => {
        // a media player is no datapoint of its own: its value column shows its parts; the single choice's
        // connected datapoints bring their value along
        const ids = items
            .filter(i => !i.id.startsWith('media_player.') && (mode !== 'single' || i.value === undefined))
            .map(i => i.path)
            .filter(id => !requested.has(id));
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
    /** The roles and rooms to filter by; `reset`: also the search and the chosen filters (else they stay). */
    function filters(items: TreeItem[], reset = true): void {
        for (const [id, key, label] of [
            ['role-filter', 'role', 'all_roles'],
            ['room-filter', 'room', 'all_rooms'],
        ] as const) {
            const select = $(id);
            const keep = select.value;
            select.replaceChildren(new Option(t(label), ''));
            for (const value of [
                ...new Set(items.map(i => i[key]).filter((value): value is string => Boolean(value))),
            ].sort()) {
                select.append(new Option(key === 'room' ? getHass()?.areas?.[value]?.name || value : value, value));
            }
            if (!reset) {
                select.value = keep;
            }
        }
        if (!reset) {
            return;
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
            path: c._meta?.path ?? c.state,
            label: c._meta?.path ? `🎵 ${c.name || c.state}` : c.name || c.state,
            role: c._meta?.role,
            type: c._meta?.type,
            value: c._meta?.path ? c._meta.value : values.get(c.state),
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
            remove.textContent = t('remove');
            remove.setAttribute('aria-label', t('remove_aria', { name: m.name || m.state }));
            remove.onclick = () => {
                mappings = mappings.filter(x => x.entity_id !== m.entity_id);
                selectedList();
                tree.setItems(mappingItems(), selected);
            };
            const change = document.createElement('button');
            change.textContent = t('change');
            change.setAttribute('aria-label', t('change_aria', { name: m.name || m.state }));
            change.onclick = async () => {
                // a modal <dialog> is always on top of the page: hide it while the object browser is open
                dialog.close();
                try {
                    const next = await pickDatapoint(m);
                    if (next) {
                        mappings = mappings.map(x => (x.entity_id === m.entity_id ? next : x));
                        selectedList();
                        tree.setItems(mappingItems(), selected);
                        $('mapping-result').textContent = t('changed_apply', {
                            name: m.name || m.state,
                            id: next.state,
                        });
                    }
                } catch (e) {
                    $('mapping-result').textContent = (e as Error).message;
                } finally {
                    dialog.showModal();
                }
            };
            row.append(text, change, remove);
            $('configured-list').append(row);
        }
        $('mapping-json').value = JSON.stringify(mappings, null, 2);
    }
    function configure(isSingle: boolean): void {
        mode = isSingle ? 'single' : 'mapping';
        selected = new Set();
        single = null;
        tree.expanded.clear();
        $('mapping-title').textContent = t(isSingle ? 'mapping_title_single' : 'mapping_title');
        $('mapping-save').textContent = t(isSingle ? 'choose' : 'apply');
        $('mapping-save').disabled = isSingle;
        $('mapping-advanced').hidden = isSingle;
        $('configured').hidden = isSingle;
        $('object-browser').hidden = isSingle;
        $('fixed-options').replaceChildren();
        $('mapping-result').textContent = '';
        $('mapping-description').textContent = t(isSingle ? 'mapping_hint_single' : 'mapping_hint');
    }
    $('mapping-open').onclick = async () => {
        try {
            configure(false);
            dialog.showModal();
            $('mapping-result').textContent = t('loading_objects');
            [mappings, candidates] = await Promise.all([
                callWS({ type: 'iobroker/mappings/get' }),
                callWS({ type: 'iobroker/discover' }),
            ]);
            selectedList();
            const items = mappingItems();
            filters(items);
            tree.setItems(items, selected);
            $('mapping-result').textContent = t('available', { n: candidates.length });
        } catch (e) {
            $('mapping-result').textContent = e.message;
        }
    };
    /** The rows of the single choice: the field's choices with the name, role, type and value of their datapoint. */
    function pickItems(options: { id: string; label: string }[]): TreeItem[] {
        const hass = getHass();
        return options.map(o => {
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
    }
    /**
     * All the other datapoints for the single choice, as "Geräte verbinden" lists them: a connected one as its device,
     * one not connected yet as the device it becomes (connected on "Auswählen"). Not the media players (no datapoint).
     */
    async function moreItems(shown: TreeItem[]): Promise<TreeItem[]> {
        [mappings, candidates] = await Promise.all([
            callWS({ type: 'iobroker/mappings/get' }),
            callWS({ type: 'iobroker/discover' }),
        ]);
        const paths = new Set(shown.map(i => i.path));
        const known = new Map(mappings.map(m => [m.state, m]));
        fresh = new Map();
        const more: TreeItem[] = [];
        for (const c of candidates) {
            if (c._meta?.path || paths.has(c.state)) {
                continue;
            }
            paths.add(c.state);
            const m = known.get(c.state);
            if (!m) {
                fresh.set(c.entity_id, c);
            }
            more.push({
                id: m?.entity_id ?? c.entity_id,
                path: c.state,
                label: m?.name || c.name || c.state,
                role: c._meta?.role,
                type: c._meta?.type,
                value: values.get(c.state),
                room: c.area_id,
            });
        }
        return more;
    }
    /** The field's choices first (they are what it looks for), then all the other datapoints. */
    async function pickAll(shown: TreeItem[], detail: PickerDetail): Promise<void> {
        $('mapping-result').textContent = t('loading_objects');
        const more = await moreItems(shown);
        // closed meanwhile, or opened for another field
        if (pick !== detail || mode !== 'single' || !dialog.open) {
            return;
        }
        const all = [...shown, ...more];
        filters(all, false);
        tree.setItems(all, selected);
        $('mapping-result').textContent = t('available', { n: all.length });
    }
    /** Until the page has built its next states (bridge.ts `schedule`) and the editor has drawn them. */
    async function nextHass(before: unknown): Promise<void> {
        for (let i = 0; i < 40 && getHass() === before; i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    }
    /** The single choice again: objects and values read anew, the field's choices as it offers them now. */
    async function refreshPick(): Promise<void> {
        const before = getHass();
        reload();
        values.clear();
        requested.clear();
        await refresh();
        await nextHass(before);
        const items = pickItems(pick?.current?.() ?? pick?.options ?? []);
        tree.setItems(items, selected);
        if (pick) {
            await pickAll(items, pick);
        }
    }
    $('discover').onclick = async () => {
        if (mode === 'single') {
            try {
                await refreshPick();
            } catch (e) {
                $('mapping-result').textContent = e.message;
            }
            return;
        }
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
    // The object browser of ioBroker (@iobroker/gui-components, loaded on demand): the chosen datapoints are selected
    // here like in the tree and connected with "Übernehmen".
    $('object-browser').onclick = async () => {
        try {
            const { selectObjects } = await import('./react/index.js');
            const known = new Map(candidates.map(c => [c.state, c.entity_id]));
            // a modal <dialog> is always on top of the page: hide it while the object browser is open
            dialog.close();
            let ids: string[] | null;
            try {
                ids = await selectObjects({
                    socket,
                    language: getLanguage(),
                    selected: candidates.filter(c => selected.has(c.entity_id)).map(c => c.state),
                });
            } finally {
                dialog.showModal();
            }
            if (!ids) {
                return;
            }
            const missing = ids.filter(id => !known.has(id));
            for (const id of ids) {
                const entity = known.get(id);
                if (entity) {
                    selected.add(entity);
                }
            }
            tree.setItems(mappingItems(), selected);
            $('mapping-result').textContent =
                t('selected_new', { n: selected.size }) +
                (missing.length ? t('skipped_kind', { ids: missing.join(', ') }) : '');
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
                throw Error(t('list_expected'));
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
                    // a datapoint not connected yet becomes a device first, then the field takes it
                    const add = fresh.get(single);
                    if (add) {
                        $('mapping-result').textContent = t('connecting_datapoint');
                        const current = ((await callWS({ type: 'iobroker/mappings/get' })) as Mapping[]).map(
                            ({ _meta, ...m }) => m,
                        );
                        if (!current.some(m => m.entity_id === add.entity_id)) {
                            const { _meta, ...m } = add;
                            const before = getHass();
                            await callWS({ type: 'iobroker/mappings/set', mappings: [...current, m] });
                            await refresh();
                            await nextHass(before);
                        }
                        fresh.delete(single);
                    }
                    choose(single);
                }
                dialog.close();
                return;
            }
            const parsed = JSON.parse($('mapping-json').value);
            if (!Array.isArray(parsed)) {
                throw Error(t('mappings_list_short'));
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
            $('mapping-result').textContent = t('saved_devices', { n: result.saved });
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
        pick = detail;
        fresh = new Map();
        values.clear();
        requested.clear();
        const items = pickItems(detail.options);
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
        pickAll(items, detail).catch(e => {
            $('mapping-result').textContent = e.message;
        });
    });
}

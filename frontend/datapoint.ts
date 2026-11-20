// Datapoints chosen at the device itself: the editor's device form ("Ändern …" beside the ioBroker datapoint) and the
// device list of a room ("+ Datenpunkt aus ioBroker") open the object browser of ioBroker. A changed datapoint keeps the
// device (its place in the plan, its use in the energy view); new datapoints become devices placed in the room.
import type { Connection } from '@iobroker/socket-client';
import { discover, withDatapoint } from './entities.js';
import type { RoomObject } from './model.js';
import type { CallWS, Mapping, StateObject } from './types.js';
import { t } from './lang.js';

interface Access {
    getObjects(ids: string[]): Promise<Record<string, StateObject>>;
    rooms(): Promise<Record<string, RoomObject>>;
}

export interface DatapointOptions {
    callWS: CallWS;
    io: Access;
    socket: Connection;
    getLanguage: () => string;
    refresh: () => Promise<void>;
    setStatus: (text: string, ok?: boolean) => void;
    /** The datapoint of the position (null: the one of the system settings). */
    getPositionId: () => string | null;
}

/** Choose one datapoint in the object browser of ioBroker (null: cancelled). */
async function pickOne(o: DatapointOptions, current: string | null, title: string): Promise<string | null> {
    const { selectObjects } = await import('./react/index.js');
    const ids = await selectObjects({
        socket: o.socket,
        language: o.getLanguage(),
        selected: current ? [current] : [],
        multiSelect: false,
        title,
    });
    return ids?.[0] ?? null;
}

const strip = (list: Mapping[]): Mapping[] => list.map(({ _meta, ...m }) => m);

/** Another datapoint for a mapping, chosen in the object browser (null: cancelled). */
export async function pickDatapoint(o: DatapointOptions, m: Mapping): Promise<Mapping | null> {
    const id = await pickOne(o, m.state, t('datapoint_for', { name: m.name || m.entity_id }));
    if (!id || id === m.state) {
        return null;
    }
    const obj = (await o.io.getObjects([id]))[id];
    if (obj?.type !== 'state') {
        throw new Error(t('not_datapoint', { id }));
    }
    return withDatapoint(m, id, obj);
}

export function setupDatapoints(o: DatapointOptions): void {
    const fail = (e: unknown): void => o.setStatus(t('error', { error: (e as Error).message || String(e) }));
    // a message of success: like the status "connected", the 3D view does not show it
    const info = (text: string): void => o.setStatus(text, true);

    // the editor's device form: another datapoint for the device
    window.addEventListener('iobroker-datapoint', ev => {
        const entityId = (ev as CustomEvent<{ entityId?: string }>).detail?.entityId;
        void (async () => {
            const mappings = strip((await o.callWS({ type: 'iobroker/mappings/get' })) as Mapping[]);
            const m = mappings.find(x => x.entity_id === entityId);
            if (!m) {
                throw new Error(t('no_device', { id: String(entityId) }));
            }
            const next = await pickDatapoint(o, m);
            if (!next) {
                return;
            }
            await o.callWS({
                type: 'iobroker/mappings/set',
                mappings: mappings.map(x => (x.entity_id === m.entity_id ? next : x)),
            });
            await o.refresh();
            info(`${m.name || m.entity_id} · ${next.state}`);
        })().catch(fail);
    });

    // the editor's device form: when the device counts as unreachable (null: as set for the house)
    window.addEventListener('iobroker-reach', ev => {
        const detail =
            (ev as CustomEvent<{ entityId?: string; reach?: Mapping['reach'] | null; connected?: boolean }>).detail ??
            {};
        const { entityId, reach, connected } = detail;
        void (async () => {
            const mappings = strip((await o.callWS({ type: 'iobroker/mappings/get' })) as Mapping[]);
            const m = mappings.find(x => x.entity_id === entityId);
            if (!m) {
                throw new Error(t('no_device', { id: String(entityId) }));
            }
            const next: Mapping = { ...m };
            if ('reach' in detail) {
                if (reach === null || reach === undefined) {
                    delete next.reach;
                } else {
                    next.reach = reach;
                }
            }
            if ('connected' in detail) {
                if (connected) {
                    next.reach_connected = true;
                } else {
                    delete next.reach_connected;
                }
            }
            await o.callWS({
                type: 'iobroker/mappings/set',
                mappings: mappings.map(x => (x.entity_id === m.entity_id ? next : x)),
            });
            await o.refresh();
            info(t('reach_saved', { name: m.name || m.entity_id }));
        })().catch(fail);
    });

    // the editor's device form: the battery of the device – a datapoint chosen in the object browser, "none", or null
    // (found automatically again); a choice counts for the whole device, so others of the same device are dropped
    window.addEventListener('iobroker-battery', ev => {
        const detail =
            (
                ev as CustomEvent<{
                    entityId?: string;
                    battery?: string | null;
                    pick?: boolean;
                    current?: string | null;
                    device?: string[];
                }>
            ).detail ?? {};
        void (async () => {
            const mappings = strip((await o.callWS({ type: 'iobroker/mappings/get' })) as Mapping[]);
            const m = mappings.find(x => x.entity_id === detail.entityId);
            if (!m) {
                throw new Error(t('no_device', { id: String(detail.entityId) }));
            }
            const name = m.name || m.entity_id;
            let battery = detail.battery ?? null;
            if (detail.pick) {
                const start = m.battery && m.battery !== 'none' ? m.battery : (detail.current ?? m.state);
                const id = await pickOne(o, start, t('battery_for', { name }));
                if (!id) {
                    return;
                }
                const obj = (await o.io.getObjects([id]))[id];
                if (obj?.type !== 'state') {
                    throw new Error(t('not_datapoint', { id }));
                }
                battery = id;
            }
            const same = new Set(detail.device ?? []);
            const next = mappings.map(x => {
                if (x.entity_id !== m.entity_id && !(same.has(x.entity_id) && x.battery !== undefined)) {
                    return x;
                }
                const y: Mapping = { ...x };
                delete y.battery;
                if (battery && x.entity_id === m.entity_id) {
                    y.battery = battery;
                }
                return y;
            });
            await o.callWS({ type: 'iobroker/mappings/set', mappings: next });
            await o.refresh();
            info(
                t('battery_saved', {
                    name,
                    battery: battery === 'none' ? t('battery_none') : (battery ?? t('battery_auto')),
                }),
            );
        })().catch(fail);
    });

    // the editor's house settings: the position from a datapoint (GPS on a boat), or again from the system settings
    window.addEventListener('iobroker-position', ev => {
        const clear = !!(ev as CustomEvent<{ clear?: boolean }>).detail?.clear;
        void (async () => {
            const id = clear ? null : await pickOne(o, o.getPositionId(), t('position_pick'));
            if (!clear && !id) {
                return;
            }
            await o.callWS({ type: 'iobroker/position/set', id });
            await o.refresh();
            info(id ? t('position_from', { id }) : t('position_system'));
        })().catch(fail);
    });

    // the editor's house settings: the history instance the time travel prefers (null: automatic)
    window.addEventListener('iobroker-timetravel', ev => {
        const instance = (ev as CustomEvent<{ instance?: string | null }>).detail?.instance || null;
        void (async () => {
            await o.callWS({ type: 'iobroker/timetravel/set', instance });
            await o.refresh();
            info(instance ? t('timetravel_from', { id: instance }) : t('timetravel_auto'));
        })().catch(fail);
    });

    // the editor's house settings: unreachable after so many minutes without an update (null: as the device reports)
    window.addEventListener('iobroker-health', ev => {
        const minutes = (ev as CustomEvent<{ minutes?: number | null }>).detail?.minutes ?? null;
        void (async () => {
            await o.callWS({ type: 'iobroker/health/set', minutes });
            await o.refresh();
            info(minutes ? t('reach_after', { n: minutes }) : t('reach_report'));
        })().catch(fail);
    });

    // the editor's device list of a room: new devices from datapoints, placed in the room
    window.addEventListener('iobroker-add-devices', ev => {
        const done = (ev as CustomEvent<{ done?: (ids: string[]) => void }>).detail?.done;
        void (async () => {
            const { selectObjects } = await import('./react/index.js');
            const ids = await selectObjects({
                socket: o.socket,
                language: o.getLanguage(),
                title: t('room_datapoints'),
            });
            if (!ids?.length) {
                return;
            }
            const mappings = strip((await o.callWS({ type: 'iobroker/mappings/get' })) as Mapping[]);
            const found = discover(await o.io.getObjects(ids), await o.io.rooms());
            // a datapoint that is a device already keeps its device and is only placed here
            const known = new Map(mappings.map(m => [m.state, m.entity_id]));
            const added = found.filter(m => !known.has(m.state)).map(({ _meta, ...m }) => m);
            if (added.length) {
                await o.callWS({ type: 'iobroker/mappings/set', mappings: [...mappings, ...added] });
                await o.refresh();
            }
            const entityIds = ids.map(id => known.get(id) ?? found.find(m => m.state === id)?.entity_id);
            done?.(entityIds.filter((id): id is string => !!id));
            const skipped = ids.filter((_, i) => !entityIds[i]);
            info(
                t('added_devices', { n: added.length }) +
                    (skipped.length ? t('added_skipped', { ids: skipped.join(', ') }) : ''),
            );
        })().catch(fail);
    });
}

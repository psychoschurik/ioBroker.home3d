// Datapoints chosen at the device itself: the editor's device form ("Ändern …" beside the ioBroker datapoint) and the
// device list of a room ("+ Datenpunkt aus ioBroker") open the object browser of ioBroker. A changed datapoint keeps the
// device (its place in the plan, its use in the energy view); new datapoints become devices placed in the room.
import type { Connection } from '@iobroker/socket-client';
import { discover, withDatapoint } from './entities.js';
import type { RoomObject } from './model.js';
import type { CallWS, Mapping, StateObject } from './types.js';

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
    setStatus: (text: string) => void;
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
    const id = await pickOne(o, m.state, `Datenpunkt für ${m.name || m.entity_id}`);
    if (!id || id === m.state) {
        return null;
    }
    const obj = (await o.io.getObjects([id]))[id];
    if (obj?.type !== 'state') {
        throw new Error(`${id} ist kein Datenpunkt.`);
    }
    return withDatapoint(m, id, obj);
}

export function setupDatapoints(o: DatapointOptions): void {
    const fail = (e: unknown): void => o.setStatus(`Fehler · ${(e as Error).message || e}`);

    // the editor's device form: another datapoint for the device
    window.addEventListener('iobroker-datapoint', ev => {
        const entityId = (ev as CustomEvent<{ entityId?: string }>).detail?.entityId;
        void (async () => {
            const mappings = strip((await o.callWS({ type: 'iobroker/mappings/get' })) as Mapping[]);
            const m = mappings.find(x => x.entity_id === entityId);
            if (!m) {
                throw new Error(`Kein ioBroker-Gerät: ${entityId}`);
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
            o.setStatus(`${m.name || m.entity_id} · ${next.state}`);
        })().catch(fail);
    });

    // the editor's house settings: the position from a datapoint (GPS on a boat), or again from the system settings
    window.addEventListener('iobroker-position', ev => {
        const clear = !!(ev as CustomEvent<{ clear?: boolean }>).detail?.clear;
        void (async () => {
            const id = clear ? null : await pickOne(o, o.getPositionId(), 'Position (GPS)');
            if (!clear && !id) {
                return;
            }
            await o.callWS({ type: 'iobroker/position/set', id });
            await o.refresh();
            o.setStatus(id ? `Position aus ${id}` : 'Position aus den Systemeinstellungen');
        })().catch(fail);
    });

    // the editor's house settings: the history instance the time travel prefers (null: automatic)
    window.addEventListener('iobroker-timetravel', ev => {
        const instance = (ev as CustomEvent<{ instance?: string | null }>).detail?.instance || null;
        void (async () => {
            await o.callWS({ type: 'iobroker/timetravel/set', instance });
            await o.refresh();
            o.setStatus(instance ? `Zeitreise aus ${instance}` : 'Zeitreise: Verlauf automatisch');
        })().catch(fail);
    });

    // the editor's house settings: unreachable after so many minutes without an update (null: as the device reports)
    window.addEventListener('iobroker-health', ev => {
        const minutes = (ev as CustomEvent<{ minutes?: number | null }>).detail?.minutes ?? null;
        void (async () => {
            await o.callWS({ type: 'iobroker/health/set', minutes });
            await o.refresh();
            o.setStatus(
                minutes
                    ? `Nicht erreichbar nach ${minutes} min ohne Update`
                    : 'Nicht erreichbar: wie das Gerät es meldet',
            );
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
                title: 'Datenpunkte für diesen Raum',
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
            o.setStatus(
                `${added.length} Geräte verbunden${skipped.length ? ` · übersprungen: ${skipped.join(', ')}` : ''}`,
            );
        })().catch(fail);
    });
}

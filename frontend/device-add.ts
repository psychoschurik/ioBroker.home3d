// New devices from datapoints chosen in a room's device list of the editor ("+ Datenpunkt aus ioBroker"): the parts of
// a light chosen together become one light (frontend/device-kinds.ts), every other datapoint one device.
import { discover, hash, nameOf } from './entities.js';
import { baseName, buildDevice, guessParts, isLight } from './device-kinds.js';
import type { Mapping, RoomObject, StateObject } from './model.js';

/** What it reads of ioBroker. */
export interface AddAccess {
    getObjects(ids: string[]): Promise<Record<string, StateObject>>;
    /** The state objects below an object (a channel's datapoints). */
    statesUnder(prefix: string): Promise<Record<string, StateObject>>;
    rooms(): Promise<Record<string, RoomObject>>;
}

const parentOf = (id: string): string => id.slice(0, id.lastIndexOf('.'));

/**
 * The datapoints chosen in a room's list as devices: the parts of a light chosen together (its switch, dimmer,
 * colour …) become one light, with the other parts of its channel; each other datapoint one device. Returns the new
 * devices and, by chosen datapoint, its device.
 */
export async function devicesOf(
    io: AddAccess,
    ids: string[],
    known: Map<string, string>,
): Promise<{ added: Mapping[]; byId: Map<string, string> }> {
    const objects = await io.getObjects(ids);
    const rooms = await io.rooms();
    const byId = new Map<string, string>();
    const added: Mapping[] = [];
    const groups = new Map<string, string[]>();
    for (const id of ids) {
        if (known.has(id)) {
            byId.set(id, known.get(id)!);
        } else if (objects[id]?.type === 'state' && id.split('.').length >= 3) {
            groups.set(parentOf(id), [...(groups.get(parentOf(id)) ?? []), id]);
        }
    }
    const taken = new Set(known.values());
    for (const [base, chosen] of groups) {
        const siblings = await io.statesUnder(base);
        const parts = guessParts('light', siblings, Object.keys(siblings));
        const used = new Set(Object.values(parts));
        if (!isLight(parts) || !chosen.some(id => used.has(id))) {
            continue;
        }
        const entityId = `light.${hash(base)}`;
        if (!taken.has(entityId)) {
            const names = await io.getObjects([base, parentOf(base)]);
            const m = buildDevice('light', entityId, baseName(base, names, nameOf), parts, siblings);
            const room = Object.values(rooms).find(r =>
                r.common?.members?.some(id => base === id || base.startsWith(`${id}.`)),
            );
            if (room) {
                m.area_id = room._id;
            }
            added.push(m);
            taken.add(entityId);
        }
        for (const id of chosen.filter(x => used.has(x))) {
            byId.set(id, entityId);
        }
    }
    const rest = ids.filter(id => !byId.has(id));
    for (const m of discover(
        Object.fromEntries(rest.filter(id => objects[id]).map(id => [id, { ...objects[id], _id: id }])),
        rooms,
    )) {
        const { _meta, ...plain } = m;
        if (!taken.has(plain.entity_id)) {
            added.push(plain);
            taken.add(plain.entity_id);
        }
        byId.set(plain.state, plain.entity_id);
    }
    return { added, byId };
}

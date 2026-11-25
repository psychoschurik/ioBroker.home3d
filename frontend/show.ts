/**
 * The 3D view steered from ioBroker (a voice assistant, pi-agent, a script): `home3d.0.show` takes a place or a device
 * in words ("Unterdeck", "Bad vorne", "Diesel", "Haus"); every open 3D view (not in the editor) flies there, as the
 * spoken "Zeig …" would, and confirms with ack and the name of what it shows. `home3d.0.places` lists the floors,
 * rooms and devices it knows, written by a browser that may write, so an agent knows the names: those of the default
 * project at the top, those of every other project below `projects.<id>` (each browser writes the part of its project).
 *
 * Only these two states of the page's own instance are subscribed or written (besides the mapped datapoints).
 */
import type { Store } from './store.js';
import { NAMESPACE, type IoBroker } from './iobroker.js';
import { DEFAULT_PROJECT } from './projects.js';

export const SHOW_ID = `${NAMESPACE}.show`;
export const PLACES_ID = `${NAMESPACE}.places`;

/** The instanceObjects of io-package.json with an id (vite.config.ts); missing in the tests. */
declare const __HOME3D_STATES__:
    { _id: string; type: string; common: Record<string, unknown>; native?: object }[] | undefined;
const OWN_STATES = typeof __HOME3D_STATES__ === 'undefined' ? [] : __HOME3D_STATES__;

/** What the panel offers (patched in `showFromIoBroker` of tasks.ts). */
export interface Shower {
    fp3dShow?(words: string): Promise<string | null>;
    fp3dPlaces?(): Promise<string | null>;
}

interface ShowState {
    val?: unknown;
    ack?: boolean;
    ts?: number;
}

/** Whether a write of `home3d.0.show` is a new command: not confirmed and newer than every value seen so far. */
export function isCommand(state: ShowState | null | undefined, lastTs: number): boolean {
    return !!state && !state.ack && typeof state.val === 'string' && !!state.val.trim() && (state.ts ?? 0) > lastTs;
}

/** Waits until the plan has settled before the names are written again. */
const PLACES_DELAY = 5000;

type Places = { floors?: unknown; devices?: unknown; projects?: Record<string, unknown> };

function readPlaces(value: unknown): Places {
    try {
        const d: unknown = typeof value === 'string' && value ? JSON.parse(value) : null;
        return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    } catch {
        return {};
    }
}
/** The other projects' names, sorted by ID (the same content gives the same text); undefined: none. */
function sorted(projects: Record<string, unknown>): Record<string, unknown> | undefined {
    const ids = Object.keys(projects).sort();
    return ids.length ? Object.fromEntries(ids.map(id => [id, projects[id]])) : undefined;
}

/**
 * `home3d.0.places` with the names of one project (`own`: `{floors, devices}` of its 3D view): the default project's at
 * the top, another one's below `projects.<id>` with its name; the rest stays.
 */
export function mergePlaces(old: unknown, project: string, name: string | null, own: string): string {
    const before = readPlaces(old);
    const mine = readPlaces(own);
    const projects = { ...(before.projects && typeof before.projects === 'object' ? before.projects : {}) };
    if (project === DEFAULT_PROJECT) {
        return JSON.stringify({ floors: mine.floors ?? {}, devices: mine.devices ?? [], projects: sorted(projects) });
    }
    projects[project] = { name, floors: mine.floors ?? {}, devices: mine.devices ?? [] };
    return JSON.stringify({ floors: before.floors ?? {}, devices: before.devices ?? [], projects: sorted(projects) });
}

/** `home3d.0.places` without a deleted project; null when it was not in it. */
export function withoutProject(old: unknown, project: string): string | null {
    const before = readPlaces(old);
    if (!before.projects || typeof before.projects !== 'object' || !Object.hasOwn(before.projects, project)) {
        return null;
    }
    const { [project]: _gone, ...rest } = before.projects;
    return JSON.stringify({ ...before, projects: sorted(rest) });
}

/** A deleted project's names leave `home3d.0.places`. */
export async function forgetPlaces(io: IoBroker, project: string): Promise<void> {
    const old = await io.conn.getState(PLACES_ID).catch(() => null);
    const next = withoutProject(old?.val, project);
    if (next !== null) {
        await io.conn.setState(PLACES_ID, { val: next, ack: true });
    }
}

export function setupShow(
    io: IoBroker,
    store: Store,
    panel: () => (HTMLElement & Shower) | undefined,
    project: string = DEFAULT_PROJECT,
): void {
    // the value present when subscribing is old: only later writes are commands (by the server's time, no clock skew)
    let lastTs = Number.POSITIVE_INFINITY;
    const onShow = (_id: string, state: ShowState | null | undefined): void => {
        if (lastTs === Number.POSITIVE_INFINITY) {
            lastTs = state?.ts ?? 0;
            return;
        }
        if (!isCommand(state, lastTs)) {
            lastTs = Math.max(lastTs, state?.ts ?? 0);
            return;
        }
        lastTs = state!.ts ?? lastTs;
        const words = String(state!.val).trim();
        void (async () => {
            const shown = await panel()?.fp3dShow?.(words);
            if (shown) {
                // a viewer without write rights (kiosk) shows it all the same
                await io.conn.setState(SHOW_ID, { val: shown, ack: true }).catch(() => {});
            }
        })().catch(e => console.warn('[home3d] show', e));
    };
    // An update does not create new instanceObjects for an existing instance, and this adapter has no process that
    // would: a browser that may write creates them (once), the others wait for it.
    // The same for a description that changed (an agent reads it): taken over once.
    const exists = (async (): Promise<boolean> => {
        if (store.readOnly || !OWN_STATES.length) {
            return !!(await io.conn.getObject(SHOW_ID).catch(() => null));
        }
        for (const def of OWN_STATES) {
            const id = `${NAMESPACE}.${def._id}`;
            const obj = await io.conn.getObject(id).catch(() => null);
            if (!obj) {
                await io.conn.setObject(id, {
                    type: def.type,
                    common: def.common,
                    native: def.native ?? {},
                } as ioBroker.SettableObject);
            } else if (def.common.desc && JSON.stringify(obj.common?.desc) !== JSON.stringify(def.common.desc)) {
                await io.conn
                    .extendObject(id, { common: { desc: def.common.desc } } as ioBroker.PartialObject)
                    .catch(() => {});
            }
        }
        return true;
    })().catch(e => {
        console.warn('[home3d] create show', e);
        return false;
    });
    void (async () => {
        if (!(await exists)) {
            return;
        }
        await io.conn.subscribeState(SHOW_ID, onShow);
        // states delivered nothing (no value yet): every later write counts
        if (lastTs === Number.POSITIVE_INFINITY) {
            lastTs = 0;
        }
    })().catch(e => console.warn('[home3d] subscribe show', e));

    if (store.readOnly) {
        return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const writePlaces = async (): Promise<void> => {
        if (!(await exists)) {
            return;
        }
        const own = await panel()?.fp3dPlaces?.();
        if (!own) {
            return;
        }
        const old = await io.conn.getState(PLACES_ID).catch(() => null);
        const text = mergePlaces(old?.val, project, store.data.name ?? null, own);
        if (old?.val !== text) {
            await io.conn.setState(PLACES_ID, { val: text, ack: true });
        }
    };
    const later = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => void writePlaces().catch(e => console.warn('[home3d] places', e)), PLACES_DELAY);
    };
    store.onEvent(type => {
        if (type === 'home3d/building/subscribe' || type === 'iobroker/mappings' || type === 'iobroker/project') {
            later();
        }
    });
    later();
}

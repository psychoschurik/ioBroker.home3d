/**
 * The 3D view steered from ioBroker (a voice assistant, pi-agent, a script): `home3d.0.show` takes a place or a device
 * in words ("Unterdeck", "Bad vorne", "Diesel", "Haus"); every open 3D view (not in the editor) flies there, as the
 * spoken "Zeig …" would, and confirms with ack and the name of what it shows. `home3d.0.places` lists the floors,
 * rooms and devices it knows, written by a browser that may write, so an agent knows the names.
 *
 * Only these two states of the page's own instance are subscribed or written (besides the mapped datapoints).
 */
import type { Store } from './store.js';
import { NAMESPACE, type IoBroker } from './iobroker.js';

export const SHOW_ID = `${NAMESPACE}.show`;
export const PLACES_ID = `${NAMESPACE}.places`;

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

export function setupShow(io: IoBroker, store: Store, panel: () => (HTMLElement & Shower) | undefined): void {
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
    // an instance installed before these states existed gets them with the next install of the adapter
    const exists = io.conn
        .getObject(SHOW_ID)
        .then(obj => !!obj)
        .catch(() => false);
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
        const text = await panel()?.fp3dPlaces?.();
        if (!text) {
            return;
        }
        const old = await io.conn.getState(PLACES_ID).catch(() => null);
        if (old?.val !== text) {
            await io.conn.setState(PLACES_ID, { val: text, ack: true });
        }
    };
    const later = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => void writePlaces().catch(e => console.warn('[home3d] places', e)), PLACES_DELAY);
    };
    store.onEvent(type => {
        if (type === 'home3d/building/subscribe' || type === 'iobroker/mappings') {
            later();
        }
    });
    later();
}

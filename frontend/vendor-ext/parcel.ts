// A parcel on the doormat after the doorbell rang (home-view.ts, home-fx.ts): it lies outside the front door until the
// door opens (somebody takes it in), at most PARCEL_MS; with no contact at the door it goes after PARCEL_NO_DOOR_MS.
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three';
import { shade } from './anchor';
import type { StateLike } from './home-data';

/** How long a parcel lies at most (ms), and without a contact at the door. */
export const PARCEL_MS = 4 * 3600_000;
export const PARCEL_NO_DOOR_MS = 3600_000;

const DEAD = new Set(['unavailable', 'unknown', '']);

/**
 * When the doorbell last rang (ms), null: unknown. An event entity's state is the time of its last press; a binary
 * sensor rang when it turned on (its last change while on, or the change back to off just after).
 */
export function ringAt(id: string, st: StateLike | undefined): number | null {
    if (!st || DEAD.has(String(st.state))) {
        return null;
    }
    const t = id.startsWith('event.') ? Date.parse(st.state) : Date.parse(st.last_changed ?? '');
    return Number.isFinite(t) ? t : null;
}

/** Whether the parcel still lies: rung lately and the door not opened since (open now counts as taken in). */
export function parcelWaits(ring: number | null, door: StateLike | null | undefined, now: number): boolean {
    if (ring === null || ring > now + 60_000) {
        return false;
    }
    if (!door || DEAD.has(String(door.state))) {
        return now - ring < PARCEL_NO_DOOR_MS;
    }
    if (now - ring >= PARCEL_MS) {
        return false;
    }
    const open = /^(on|open|true|1)$/i.test(String(door.state));
    const changed = Date.parse(door.last_changed ?? '');
    return !open && !(Number.isFinite(changed) && changed > ring);
}

/** Front doors first: the style of a front door (with or without glass, sidelights), then any outer door. */
export function frontRank(style: string | null | undefined): number {
    return style && /^(front|front_glass|sidelight|sidelights)$/.test(style) ? 0 : 1;
}

/** A cardboard parcel with its tape and a label, standing at the origin, its long side along x. */
export function buildParcel(light = true): Group {
    const g = new Group();
    g.name = 'fp3dParcel';
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, color: number): void => {
        g.add(
            new Mesh(
                shade(new BoxGeometry(w, h, d).translate(x, y, z), new Color(color)),
                new MeshBasicMaterial({ vertexColors: true }),
            ),
        );
    };
    const card = light ? 0xb98a52 : 0xd9a466;
    const tape = light ? 0xd9c9a8 : 0xf0e2c0;
    add(0.42, 0.26, 0.32, 0, 0.13, 0, card);
    // the tape across the lid and down both ends
    add(0.43, 0.004, 0.06, 0, 0.262, 0, tape);
    add(0.004, 0.1, 0.06, 0.212, 0.21, 0, tape);
    add(0.004, 0.1, 0.06, -0.212, 0.21, 0, tape);
    // the shipping label
    add(0.12, 0.003, 0.09, -0.11, 0.262, 0.08, 0xf4f4f0);
    // a smaller parcel on top, a little turned
    const small = new Mesh(
        shade(new BoxGeometry(0.24, 0.12, 0.18).translate(0, 0.32, 0), new Color(card)),
        new MeshBasicMaterial({ vertexColors: true }),
    );
    small.rotation.y = 0.35;
    small.position.set(0.04, 0, -0.02);
    g.add(small);
    return g;
}

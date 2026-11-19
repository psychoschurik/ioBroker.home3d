// A server: a 19" rack (glass door, servers with power and activity LEDs, a switch with port LEDs on top) or a NAS
// (drive bays with a LED each). Its LEDs follow its socket: dark while it is off, the power LED green while it is on,
// the activity LEDs flickering the faster the more power it draws; amber and slow when the socket cannot be read.
import { BoxGeometry, type BufferGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three';
import { isOn, type StateLike } from './home-data';
import { shade } from './anchor';

export const SERVER_KINDS = ['rack', 'nas'] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

/** Width, depth, height (m): a 24-unit rack on the floor, a NAS with four bays on a shelf or desk. */
export const SERVER_SIZES: Record<ServerKind, [number, number, number]> = {
    rack: [0.6, 0.8, 1.2],
    nas: [0.2, 0.25, 0.2],
};

/** Below this the socket counts as off (W): a plug in standby. */
export const SERVER_IDLE_W = 2;

export function serverKind(kind: string | null | undefined): ServerKind {
    return kind === 'nas' ? 'nas' : 'rack';
}

/** How a server runs: on, how often its activity LEDs flicker (per s), whether its socket cannot be read. */
export interface ServerLoad {
    on: boolean;
    rate: number;
    unknown: boolean;
}

/**
 * The load of a server from its socket: a power reading (W or kW) above SERVER_IDLE_W is on, its LEDs flicker faster
 * with more power (1 per s at idle up to 8 per s at 175 W and more); a switch on: a steady 2 per s. Without a socket
 * (null) it runs as a picture; unavailable: unknown.
 */
export function serverLoad(st: StateLike | null | undefined, linked: boolean): ServerLoad {
    if (!linked) {
        return { on: true, rate: 1.5, unknown: false };
    }
    const raw = String(st?.state ?? '').toLowerCase();
    if (!st || raw === 'unavailable' || raw === 'unknown' || raw === '') {
        return { on: false, rate: 0, unknown: true };
    }
    const u = st.attributes.unit_of_measurement;
    const unit = typeof u === 'string' ? u.trim() : '';
    if (/^k?W$/i.test(unit) || st.attributes.device_class === 'power') {
        const n = Number(raw.replace(',', '.'));
        if (!Number.isFinite(n)) {
            return { on: false, rate: 0, unknown: true };
        }
        const w = /^kW$/i.test(unit) ? n * 1000 : n;
        return w >= SERVER_IDLE_W
            ? { on: true, rate: 1 + Math.min(7, w / 25), unknown: false }
            : { on: false, rate: 0, unknown: false };
    }
    return isOn(st) ? { on: true, rate: 2, unknown: false } : { on: false, rate: 0, unknown: false };
}

/** A small hash of two numbers in 0 … 1. */
function hash(a: number, b: number): number {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/** What a LED does: the power LED, a drive's or a server's activity, a network port. */
export type LedRole = 'power' | 'act' | 'net';

/** Whether a LED is lit at time t (s). Activity and ports flicker in slots of 1/(2·rate) s, each its own way. */
export function ledLit(role: LedRole, seed: number, load: ServerLoad, t: number): boolean {
    if (load.unknown) {
        // the power LED blinks slowly, the rest stays dark
        return role === 'power' && Math.floor(t * 0.8) % 2 === 0;
    }
    if (!load.on) {
        return false;
    }
    if (role === 'power') {
        return true;
    }
    // a port is mostly lit and goes dark when traffic passes; a drive is mostly dark and lights when it works
    const slot = Math.floor(t * load.rate * 2 + seed * 13.7);
    const h = hash(slot, seed);
    return role === 'net' ? h > 0.25 : h < 0.35 + 0.04 * load.rate;
}

/** The colour of a lit LED. */
export function ledColor(role: LedRole, unknown: boolean): number {
    if (unknown) {
        return 0xffa020;
    }
    return role === 'power' ? 0x38e870 : role === 'net' ? 0xffc23a : 0x4ab4ff;
}

/** The colour of a dark LED. */
export const LED_OFF = 0x1c2026;

function part(g: Group, geo: BufferGeometry, color: number, opacity = 1): Mesh {
    const mat = new MeshBasicMaterial({
        vertexColors: true,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
    });
    const m = new Mesh(shade(geo, new Color(color)), mat);
    g.add(m);
    return m;
}

/** One LED: a tiny square in front of a face; its own material, so its colour can change. */
function led(g: Group, leds: ServerLed[], role: LedRole, x: number, y: number, z: number, size: number): void {
    const m = new Mesh(
        new BoxGeometry(size, size, 0.004).translate(x, y, z),
        new MeshBasicMaterial({ color: ledColor(role, false) }),
    );
    g.add(m);
    leds.push({ mesh: m, role, seed: leds.length + 1 });
}

export interface ServerLed {
    mesh: Mesh;
    role: LedRole;
    seed: number;
}

/**
 * A server standing at the origin, its front at +z: a rack with a glass door, its servers and a switch, or a NAS with
 * its bays. `userData.leds` lists the LEDs (all lit, as in the library picture, until the home looks drive them).
 */
export function buildServer(kind: ServerKind, w: number, d: number, h: number, light = true): Group {
    const g = new Group();
    g.name = 'fp3dServer';
    const leds: ServerLed[] = [];
    const body = light ? 0x24272c : 0x323a44;
    const unit = light ? 0x3a3f46 : 0x46505c;
    const front = d / 2;
    if (kind === 'rack') {
        const wall = 0.03;
        // the cabinet: sides, top, bottom and back; the door is glass
        part(g, new BoxGeometry(wall, h, d).translate(-w / 2 + wall / 2, h / 2, 0), body);
        part(g, new BoxGeometry(wall, h, d).translate(w / 2 - wall / 2, h / 2, 0), body);
        part(g, new BoxGeometry(w, wall, d).translate(0, h - wall / 2, 0), body);
        part(g, new BoxGeometry(w, 0.08, d).translate(0, 0.04, 0), body);
        part(g, new BoxGeometry(w, h, wall).translate(0, h / 2, -d / 2 + wall / 2), body);
        // the units from the top: a switch (1 U), then servers of 1 and 2 U with gaps, as far as they fit
        const U = 0.0445;
        const inner = w - wall * 2 - 0.02;
        const z = front - 0.06;
        let y = h - wall - 0.02;
        const sw = U;
        part(g, new BoxGeometry(inner, sw - 0.004, d * 0.7).translate(0, y - sw / 2, z - d * 0.35), unit);
        const ports = 12;
        for (let k = 0; k < ports; k++) {
            led(g, leds, 'net', -inner / 2 + 0.05 + (k * (inner - 0.1)) / (ports - 1), y - sw / 2, z + 0.003, 0.012);
        }
        y -= sw + 0.015;
        const heights = [2, 1, 1, 2, 1, 2, 1, 1];
        for (const n of heights) {
            const uh = n * U;
            if (y - uh < 0.12) {
                break;
            }
            part(g, new BoxGeometry(inner, uh - 0.004, d * 0.7).translate(0, y - uh / 2, z - d * 0.35), unit);
            led(g, leds, 'power', -inner / 2 + 0.03, y - uh / 2, z + 0.003, 0.014);
            led(g, leds, 'act', -inner / 2 + 0.06, y - uh / 2, z + 0.003, 0.014);
            if (n === 2) {
                // a 2 U server: its drive bays with a LED each
                for (let k = 0; k < 4; k++) {
                    led(g, leds, 'act', -inner / 2 + 0.14 + k * 0.09, y - uh / 2, z + 0.003, 0.011);
                }
            }
            y -= uh + 0.008;
        }
        // the glass door with its handle
        const glass = part(
            g,
            new BoxGeometry(w - wall, h - 0.1, 0.006).translate(0, h / 2 + 0.03, front - 0.003),
            light ? 0xa9c6d8 : 0x7fb8ff,
            0.18,
        );
        glass.renderOrder = 3;
        part(
            g,
            new BoxGeometry(0.015, 0.16, 0.02).translate(w / 2 - 0.05, h * 0.55, front + 0.008),
            light ? 0x9aa3ab : 0x8a96a2,
        );
    } else {
        // a NAS: the box with its bays side by side at the front, the power LED and button at the right
        part(g, new BoxGeometry(w, h, d).translate(0, h / 2, 0), body);
        const bays = w >= 0.15 ? 4 : 2;
        const side = 0.035;
        const bw = (w - side - 0.02) / bays;
        for (let k = 0; k < bays; k++) {
            const x = -w / 2 + 0.01 + bw / 2 + k * bw;
            part(g, new BoxGeometry(bw - 0.006, h * 0.8, 0.006).translate(x, h / 2, front + 0.002), unit);
            led(g, leds, 'act', x, h * 0.84, front + 0.007, 0.008);
        }
        led(g, leds, 'power', w / 2 - side / 2, h * 0.75, front + 0.003, 0.01);
        led(g, leds, 'net', w / 2 - side / 2, h * 0.6, front + 0.003, 0.008);
        part(g, new BoxGeometry(0.012, 0.012, 0.004).translate(w / 2 - side / 2, h * 0.3, front + 0.002), 0x5c636b);
    }
    g.userData.leds = leds;
    return g;
}

// A hot water or buffer store (home-view.ts, home-fx.ts): a window in its jacket shows the layers of its water coloured
// by their temperature, from its sensors at the top, the middle and the bottom; while it is heated a flame burns under it.
import type { Object3D } from 'three';
import {
    AdditiveBlending,
    BoxGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
} from 'three';
import { shade } from './anchor';
import { isOn, type StateLike } from './home-data';

/** Width, depth, height (m) of a 500 l buffer store. */
export const HEAT_STORE_SIZE: [number, number, number] = [0.75, 0.75, 1.9];

/** The layers shown in the window. */
export const STORE_LAYERS = 10;

/** Below this a heater counts as off (W). */
export const STORE_HEAT_W = 20;

/** The colour of a layer without a temperature. */
export const STORE_UNKNOWN = 0x8a939c;

const DEAD = /^(unavailable|unknown|)$/i;

/** A temperature (°C) from a datapoint, null: none or unknown. */
export function storeTemp(st: StateLike | null | undefined): number | null {
    if (!st || DEAD.test(String(st.state).trim())) {
        return null;
    }
    const n = Number(String(st.state).replace('°C', '').replace('°', '').replace(',', '.').trim());
    if (!Number.isFinite(n)) {
        return null;
    }
    const u = st.attributes.unit_of_measurement;
    return typeof u === 'string' && /°?F$/.test(u.trim()) ? ((n - 32) * 5) / 9 : n;
}

/**
 * The temperature of each layer, from the bottom up: between the known sensors (bottom, middle, top) it runs in a
 * straight line, above the highest and below the lowest it stays as that one; with none, all are null.
 */
export function storeLayers(
    top: number | null,
    mid: number | null,
    bottom: number | null,
    n = STORE_LAYERS,
): (number | null)[] {
    const known: [number, number][] = [];
    if (bottom !== null) {
        known.push([0, bottom]);
    }
    if (mid !== null) {
        known.push([0.5, mid]);
    }
    if (top !== null) {
        known.push([1, top]);
    }
    return Array.from({ length: n }, (_, i) => {
        if (!known.length) {
            return null;
        }
        const p = n === 1 ? 1 : i / (n - 1);
        if (p <= known[0][0]) {
            return known[0][1];
        }
        for (let k = 1; k < known.length; k++) {
            const [p0, t0] = known[k - 1];
            const [p1, t1] = known[k];
            if (p <= p1) {
                return t0 + ((t1 - t0) * (p - p0)) / (p1 - p0);
            }
        }
        return known[known.length - 1][1];
    });
}

/** The colour of water at a temperature: blue at 20 °C and below, through cyan, green and yellow to red at 70 °C. */
export function storeColor(t: number | null): number {
    if (t === null) {
        return STORE_UNKNOWN;
    }
    const k = Math.max(0, Math.min(1, (t - 20) / 50));
    return new Color().setHSL(0.64 * (1 - k), 0.85, 0.5).getHex();
}

/** Whether it is heated: a heater's power from 20 W (W, kW), a switch or burner on, a mode that names heating. */
export function storeHeating(st: StateLike | null | undefined): boolean {
    if (!st || DEAD.test(String(st.state).trim())) {
        return false;
    }
    const u = st.attributes.unit_of_measurement;
    const unit = typeof u === 'string' ? u.trim() : '';
    if (/^k?W$/i.test(unit) || st.attributes.device_class === 'power') {
        const n = Number(String(st.state).replace(',', '.'));
        return Number.isFinite(n) && (/^kW$/i.test(unit) ? n * 1000 : n) >= STORE_HEAT_W;
    }
    return /heat|heiz|burn|brenn|flame|flamme/i.test(String(st.state)) || isOn(st);
}

type Geo = BoxGeometry | CylinderGeometry | ConeGeometry | SphereGeometry;

function part(g: Object3D, geo: Geo, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    g.add(m);
    return m;
}

/**
 * A store standing at the origin, its window at the front (+z): an insulated jacket on a plinth with a domed lid, the
 * window with its layers (`userData.layers`, from the bottom up, each its own material), the burner's window at the
 * foot with its flame (`userData.flame`, hidden until it is heated; it flickers about its foot).
 */
export function buildHeatStore(w: number, d: number, h: number, light = true): Group {
    const g = new Group();
    g.name = 'fp3dHeatStore';
    const r = Math.min(w, d) / 2;
    const jacket = light ? 0xd7dce1 : 0x8d99a6;
    const dark = light ? 0x2a2f35 : 0x1a1f25;
    const plinth = Math.min(0.22, h * 0.12);
    // the burner's housing under it, the jacket, the lid
    part(g, new CylinderGeometry(r * 0.96, r * 0.96, plinth, 28), light ? 0xb9c0c7 : 0x6f7a86).position.set(
        0,
        plinth / 2,
        0,
    );
    const body = h - plinth - r * 0.25;
    part(g, new CylinderGeometry(r, r, body, 32), jacket).position.set(0, plinth + body / 2, 0);
    const lid = part(g, new SphereGeometry(r, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), jacket);
    lid.scale.y = 0.25 / 1;
    lid.position.set(0, plinth + body, 0);
    // the window in the jacket: a dark frame, the layers behind its glass
    const winW = r * 0.62;
    const y0 = plinth + body * 0.06;
    const y1 = plinth + body * 0.94;
    part(g, new BoxGeometry(winW + 0.05, y1 - y0 + 0.05, 0.02), dark).position.set(0, (y0 + y1) / 2, r - 0.004);
    const layers: Mesh[] = [];
    const lh = (y1 - y0) / STORE_LAYERS;
    for (let i = 0; i < STORE_LAYERS; i++) {
        const m = new Mesh(new BoxGeometry(winW, lh * 0.94, 0.012), new MeshBasicMaterial({ color: STORE_UNKNOWN }));
        m.position.set(0, y0 + lh * (i + 0.5), r + 0.01);
        g.add(m);
        layers.push(m);
    }
    // pipes at the side
    for (const y of [y0 + 0.1, (y0 + y1) / 2, y1 - 0.1]) {
        part(
            g,
            new CylinderGeometry(0.025, 0.025, 0.14, 10).rotateZ(Math.PI / 2),
            light ? 0xb87333 : 0xc98a4a,
        ).position.set(r + 0.06, y, 0);
    }
    // the burner's window and its flame
    part(g, new BoxGeometry(r * 0.7, plinth * 0.7, 0.02), dark).position.set(0, plinth / 2, r * 0.96 - 0.004);
    const flame = new Group();
    flame.position.set(0, plinth * 0.2, r * 0.96 + 0.012);
    const glow = (rad: number, hgt: number, color: number, x: number): Mesh => {
        const m = new Mesh(
            new ConeGeometry(rad, hgt, 10).translate(0, hgt / 2, 0),
            new MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9,
                blending: AdditiveBlending,
                depthWrite: false,
            }),
        );
        m.position.x = x;
        flame.add(m);
        return m;
    };
    const fh = plinth * 0.5;
    const tongues: Mesh[] = [];
    for (const x of [-r * 0.2, 0, r * 0.2]) {
        tongues.push(glow(r * 0.07, fh, 0xff6a1a, x));
        tongues.push(glow(r * 0.035, fh * 0.65, 0x4aa8ff, x));
    }
    flame.visible = false;
    g.add(flame);
    g.userData.layers = layers;
    g.userData.flame = flame;
    g.userData.tongues = tongues;
    g.userData.top = h;
    return g;
}

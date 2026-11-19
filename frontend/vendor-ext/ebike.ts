// An e-bike (home-view.ts, home-fx.ts): it stands where it is parked while it is home; the five LEDs on its battery show
// the charge, and while it charges the charger stands beside it with its cable and the next LED blinks.
import type { Object3D } from 'three';
import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, TorusGeometry } from 'three';
import { shade } from './anchor';
import { isOn, type StateLike } from './home-data';

/** Length, width (the handlebar), height (m). */
export const EBIKE_SIZE: [number, number, number] = [1.8, 0.62, 1.1];

/** Below this a charger counts as idle (W): its standby, a full battery kept topped up. */
export const EBIKE_CHARGE_W = 5;

/** The LEDs on the battery. */
export const EBIKE_LEDS = 5;

/** The LED colour when dark. */
export const EBIKE_LED_OFF = 0x1c2228;

const DEAD = /^(unavailable|unknown|)$/i;

/** The battery's charge from its datapoint (%), null: unknown. */
export function ebikeLevel(st: StateLike | null | undefined): number | null {
    if (!st || DEAD.test(String(st.state).trim())) {
        return null;
    }
    const n = Number(String(st.state).replace('%', '').replace(',', '.').trim());
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/** Whether it charges: the charger's power from 5 W (W, kW) or its switch on. */
export function ebikeCharging(st: StateLike | null | undefined): boolean {
    if (!st || DEAD.test(String(st.state).trim())) {
        return false;
    }
    const u = st.attributes.unit_of_measurement;
    const unit = typeof u === 'string' ? u.trim() : '';
    if (/^k?W$/i.test(unit) || st.attributes.device_class === 'power') {
        const n = Number(String(st.state).replace(',', '.'));
        return Number.isFinite(n) && (/^kW$/i.test(unit) ? n * 1000 : n) >= EBIKE_CHARGE_W;
    }
    return isOn(st);
}

/** How many LEDs are lit at a charge (one from the first percent, all five from 90 %). */
export function ebikeLit(level: number | null): number {
    if (level === null || level <= 0) {
        return 0;
    }
    return Math.max(1, Math.min(EBIKE_LEDS, Math.floor((level + 10) / 20)));
}

/** The colour of the lit LEDs: red when low, amber below half, else green. */
export function ebikeColor(level: number | null): number {
    if (level === null) {
        return 0x6a7684;
    }
    return level <= 20 ? 0xff3b30 : level < 50 ? 0xffb020 : 0x34d058;
}

type Geo = BoxGeometry | CylinderGeometry | TorusGeometry;

function part(g: Object3D, geo: Geo, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    g.add(m);
    return m;
}

/** A tube from (x0, y0) to (x1, y1) in the bike's plane (z = 0). */
function tube(g: Object3D, x0: number, y0: number, x1: number, y1: number, r: number, color: number): Mesh {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = part(g, new CylinderGeometry(r, r, len, 8), color);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
    return m;
}

/**
 * An e-bike standing at the origin along x (the front wheel at +x), on its wheels. `userData.leds` lists the battery's
 * LEDs (the first at the bottom), `userData.charger` the charger beside it with its cable (hidden until it charges).
 */
export function buildEbike(w: number, d: number, h: number, light = true): Group {
    const g = new Group();
    g.name = 'fp3dEbike';
    const frame = light ? 0x2d6a8f : 0x4a90c0;
    const dark = light ? 0x23272c : 0x15191d;
    const metal = light ? 0x9aa3ad : 0x7c8794;
    const r = Math.min(h * 0.33, w * 0.19);
    const rearX = -w / 2 + r + 0.02;
    const frontX = w / 2 - r - 0.02;
    for (const x of [rearX, frontX]) {
        part(g, new TorusGeometry(r, 0.028, 6, 32), dark).position.set(x, r, 0);
        part(g, new TorusGeometry(r * 0.84, 0.008, 4, 32), metal).position.set(x, r, 0);
        part(g, new CylinderGeometry(0.03, 0.03, 0.08, 10).rotateX(Math.PI / 2), metal).position.set(x, r, 0);
        for (let k = 0; k < 6; k++) {
            const s = part(g, new BoxGeometry(r * 1.66, 0.004, 0.004), metal);
            s.position.set(x, r, 0);
            s.rotation.z = (k * Math.PI) / 6;
        }
    }
    const bb: [number, number] = [rearX + (frontX - rearX) * 0.44, r * 0.95];
    const seat: [number, number] = [bb[0] - w * 0.07, h * 0.7];
    const headTop: [number, number] = [frontX - r * 0.5, h * 0.76];
    const headLow: [number, number] = [frontX - r * 0.4, h * 0.6];
    tube(g, bb[0], bb[1], seat[0], seat[1], 0.022, frame);
    tube(g, seat[0], seat[1], headTop[0], headTop[1], 0.022, frame);
    tube(g, bb[0], bb[1], rearX, r, 0.015, frame);
    tube(g, seat[0], seat[1], rearX, r, 0.013, frame);
    tube(g, headLow[0], headLow[1], headTop[0], headTop[1], 0.026, frame);
    tube(g, headLow[0], headLow[1], frontX, r, 0.016, metal);
    tube(g, bb[0], bb[1], headLow[0], headLow[1], 0.03, frame);
    // the motor at the cranks, the pedals
    part(g, new CylinderGeometry(0.075, 0.075, 0.09, 16).rotateX(Math.PI / 2), dark).position.set(bb[0], bb[1], 0);
    for (const s of [-1, 1]) {
        part(g, new BoxGeometry(0.1, 0.02, 0.06), dark).position.set(bb[0] + s * 0.13, bb[1] - s * 0.04, s * 0.09);
    }
    // the saddle and the handlebar
    tube(g, seat[0], seat[1], seat[0] - 0.02, seat[1] + 0.09, 0.012, metal);
    part(g, new BoxGeometry(0.26, 0.045, 0.13), dark).position.set(seat[0] - 0.04, seat[1] + 0.11, 0);
    const bar: [number, number] = [headTop[0] - 0.05, Math.min(h - 0.02, headTop[1] + 0.16)];
    tube(g, headTop[0], headTop[1], bar[0], bar[1], 0.014, metal);
    part(g, new CylinderGeometry(0.012, 0.012, d * 0.9, 8).rotateX(Math.PI / 2), dark).position.set(bar[0], bar[1], 0);
    for (const s of [-1, 1]) {
        part(g, new CylinderGeometry(0.018, 0.018, 0.11, 8).rotateX(Math.PI / 2), dark).position.set(
            bar[0],
            bar[1],
            s * d * 0.4,
        );
    }
    // the battery on the down tube with its LEDs
    const len = Math.hypot(headLow[0] - bb[0], headLow[1] - bb[1]);
    const battery = new Group();
    battery.position.set((bb[0] + headLow[0]) / 2, (bb[1] + headLow[1]) / 2, 0);
    battery.rotation.z = Math.atan2(headLow[1] - bb[1], headLow[0] - bb[0]);
    part(battery, new BoxGeometry(len * 0.7, 0.085, 0.085), light ? 0x30363d : 0x262b31).position.set(0, 0.055, 0);
    const leds: Mesh[] = [];
    for (let i = 0; i < EBIKE_LEDS; i++) {
        const led = new Mesh(
            new BoxGeometry(len * 0.07, 0.016, 0.092),
            new MeshBasicMaterial({ color: EBIKE_LED_OFF }),
        );
        led.position.set(-len * 0.25 + i * len * 0.11, 0.075, 0);
        battery.add(led);
        leds.push(led);
    }
    g.add(battery);
    // the kickstand
    tube(g, bb[0] - 0.08, bb[1] - 0.02, bb[0] - 0.16, 0.01, 0.01, metal);
    // the charger on the floor beside it and its cable up to the battery
    const charger = new Group();
    const cz = d * 0.45 + 0.08;
    part(charger, new BoxGeometry(0.18, 0.06, 0.1), dark).position.set(bb[0], 0.03, cz);
    const lamp = new Mesh(new BoxGeometry(0.03, 0.012, 0.03), new MeshBasicMaterial({ color: 0x34d058 }));
    lamp.position.set(bb[0] + 0.05, 0.065, cz);
    charger.add(lamp);
    const top: [number, number] = [battery.position.x, battery.position.y + 0.06];
    // down from the battery's side, then along the floor to the charger
    part(charger, new CylinderGeometry(0.008, 0.008, top[1], 6), dark).position.set(top[0], top[1] / 2, 0.05);
    const run = Math.hypot(top[0] - bb[0], cz - 0.05);
    const floor = part(charger, new CylinderGeometry(0.008, 0.008, run, 6).rotateX(Math.PI / 2), dark);
    floor.position.set((top[0] + bb[0]) / 2, 0.01, (cz + 0.05) / 2);
    floor.rotation.y = Math.atan2(top[0] - bb[0], cz - 0.05);
    charger.visible = false;
    g.add(charger);
    g.userData.leds = leds;
    g.userData.charger = charger;
    g.userData.top = h;
    return g;
}

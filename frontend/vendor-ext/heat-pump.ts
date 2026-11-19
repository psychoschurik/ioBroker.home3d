// The outdoor unit of a heat pump (home-view.ts, home-fx.ts): its fan turns the faster the more power the pump draws
// (or steadily while its switch is on) and runs down when it stops; while it defrosts, steam rises from it.
import type { Object3D } from 'three';
import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, TorusGeometry } from 'three';
import { shade } from './anchor';
import { isOn, type StateLike } from './home-data';

/** Width, depth, height (m) of a usual outdoor unit. */
export const HEAT_PUMP_SIZE: [number, number, number] = [1.0, 0.4, 0.85];

/** Below this the pump counts as off (W): standby, the crankcase heater. */
export const HEAT_PUMP_IDLE_W = 60;

/** How a heat pump runs: on, how fast its fan turns (turns per second), whether its datapoint is unknown. */
export interface HeatPumpRun {
    on: boolean;
    rate: number;
    unknown: boolean;
}

/** The run of a heat pump from its datapoint: a power reading (W, kW) or a switch; without one it stands still. */
export function heatPumpRun(st: StateLike | null | undefined): HeatPumpRun {
    if (!st) {
        return { on: false, rate: 0, unknown: false };
    }
    const raw = String(st.state ?? '').toLowerCase();
    if (raw === 'unavailable' || raw === 'unknown' || raw === '') {
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
        // slower than a real fan: three blades at 30 frames a second would seem to stand or turn back above ~5 turns
        // a second; 0.8 just running, up to 2.5 at 3 kW and more
        return w >= HEAT_PUMP_IDLE_W
            ? { on: true, rate: 0.8 + Math.min(1.7, (w / 3000) * 1.7), unknown: false }
            : { on: false, rate: 0, unknown: false };
    }
    return isOn(st) ? { on: true, rate: 1.6, unknown: false } : { on: false, rate: 0, unknown: false };
}

/** Whether it defrosts: a switch or flag that is on, or an operating mode that names it (defrost, Abtauen, enteisen). */
export function heatPumpDefrost(st: StateLike | null | undefined): boolean {
    if (!st) {
        return false;
    }
    const raw = String(st.state ?? '');
    return /defrost|abtau|enteis|оттай/i.test(raw) || /^(on|true|1)$/i.test(raw.trim());
}

function part(g: Object3D, geo: CylinderGeometry | BoxGeometry | TorusGeometry, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    g.add(m);
    return m;
}

/**
 * An outdoor unit standing at the origin, its front (the fan) at +z: the casing on two feet, one fan (two from 1.2 m
 * wide) behind a round grille, the service panel at the right. `userData.fans` lists the rotors (they turn about z),
 * `userData.top` the height steam rises from.
 */
export function buildHeatPump(w: number, d: number, h: number, light = true): Group {
    const g = new Group();
    g.name = 'fp3dHeatPump';
    const body = light ? 0xe9ecef : 0x9aa6b2;
    const dark = light ? 0x2a2f35 : 0x1a1f25;
    const blade = light ? 0x4a525c : 0x6a7684;
    const foot = 0.08;
    for (const x of [-w * 0.38, w * 0.38]) {
        part(g, new BoxGeometry(0.06, foot, d * 0.95), dark).position.set(x, foot / 2, 0);
    }
    part(g, new BoxGeometry(w, h - foot, d), body).position.set(0, foot + (h - foot) / 2, 0);
    const n = w >= 1.2 ? 2 : 1;
    const panel = Math.min(0.28, w * 0.25);
    const fanW = (w - panel) / n;
    const r = Math.min(fanW * 0.42, (h - foot) * 0.42);
    const fans: Object3D[] = [];
    for (let k = 0; k < n; k++) {
        const cx = -w / 2 + fanW * (k + 0.5);
        const cy = foot + (h - foot) / 2;
        // the dark opening, the rotor in it, the grille in front
        part(g, new CylinderGeometry(r, r, 0.01, 32).rotateX(Math.PI / 2), dark).position.set(cx, cy, d / 2 + 0.002);
        const rotor = new Group();
        rotor.position.set(cx, cy, d / 2 + 0.012);
        for (let b = 0; b < 3; b++) {
            const arm = new Group();
            arm.rotation.z = (b * 2 * Math.PI) / 3;
            part(arm, new BoxGeometry(r * 0.32, r * 0.86, 0.008), blade).position.set(0, r * 0.47, 0);
            rotor.add(arm);
        }
        part(rotor, new CylinderGeometry(r * 0.14, r * 0.14, 0.03, 16).rotateX(Math.PI / 2), dark);
        g.add(rotor);
        fans.push(rotor);
        for (const k2 of [1, 0.66, 0.33]) {
            part(g, new TorusGeometry(r * k2, 0.004, 4, 32), dark).position.set(cx, cy, d / 2 + 0.03);
        }
        part(g, new BoxGeometry(r * 2, 0.006, 0.006), dark).position.set(cx, cy, d / 2 + 0.03);
        part(g, new BoxGeometry(0.006, r * 2, 0.006), dark).position.set(cx, cy, d / 2 + 0.03);
    }
    // the service panel with its slits
    for (let i = 0; i < 4; i++) {
        part(g, new BoxGeometry(panel * 0.6, 0.006, 0.004), light ? 0xc4cad0 : 0x7e8a96).position.set(
            w / 2 - panel / 2,
            foot + (h - foot) * (0.25 + i * 0.08),
            d / 2 + 0.002,
        );
    }
    g.userData.fans = fans;
    g.userData.top = h;
    return g;
}

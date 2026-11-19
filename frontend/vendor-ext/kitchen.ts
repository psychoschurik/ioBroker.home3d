// The coffee machine: a small machine on the worktop (body, water tank, drip tray, spout and a cup) that steams over
// its cup while it brews. Brewing comes from its socket: a switch that is on, or a power sensor above BREW_W.
import { BoxGeometry, type BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { isOn, type StateLike } from './home-data';
import { shade } from './anchor';

/** Width, depth, height (m). */
export const COFFEE_SIZE: [number, number, number] = [0.28, 0.4, 0.38];

/** Above this the machine heats its water and brews (W); in standby it draws a few watts. */
export const BREW_W = 300;

/** Whether a coffee machine brews now: by the power of its socket (W or kW), else as a switch. */
export function brewing(st: StateLike | undefined): boolean {
    if (!st) {
        return false;
    }
    const u = st.attributes.unit_of_measurement;
    const unit = typeof u === 'string' ? u.trim() : '';
    const watts = /^k?W$/i.test(unit) || st.attributes.device_class === 'power';
    if (watts) {
        const n = Number(String(st.state).replace(',', '.'));
        if (!Number.isFinite(n)) {
            return false;
        }
        return (/^kW$/i.test(unit) ? n * 1000 : n) >= BREW_W;
    }
    return isOn(st);
}

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

/**
 * A coffee machine standing at the origin (its base), its front at +z: the dark body with the brew head over the drip
 * tray, the water tank at the back, a white cup under the spout. `cupTop` (in userData) is where the steam rises.
 */
export function buildCoffeeMachine(w: number, d: number, h: number, light = true): Group {
    const g = new Group();
    g.name = 'fp3dCoffee';
    const body = light ? 0x2d3136 : 0x3c4650;
    const metal = light ? 0xb9bec4 : 0x8fa3b5;
    // the back column with the tank, the head reaching forward over the tray
    const back = d * 0.55;
    part(g, new BoxGeometry(w, h, back).translate(0, h / 2, -d / 2 + back / 2), body);
    part(g, new BoxGeometry(w * 0.86, h * 0.72, d * 0.16).translate(0, h * 0.5, -d / 2 + d * 0.06), 0x6fa8c8, 0.55);
    part(g, new BoxGeometry(w, h * 0.22, d - back).translate(0, h - h * 0.11, d / 2 - (d - back) / 2), body);
    part(g, new BoxGeometry(w * 0.9, h * 0.06, d * 0.42).translate(0, h * 0.03, d / 2 - d * 0.21), metal);
    // the spout under the head
    part(
        g,
        new CylinderGeometry(0.018, 0.022, h * 0.06, 10).translate(0, h * 0.78 - h * 0.03, d / 2 - (d - back) / 2),
        metal,
    );
    // the cup on the tray
    const cupH = Math.min(0.09, h * 0.24);
    const cupR = Math.min(0.04, w * 0.16);
    const cupZ = d / 2 - (d - back) / 2;
    part(g, new CylinderGeometry(cupR, cupR * 0.82, cupH, 14).translate(0, h * 0.06 + cupH / 2, cupZ), 0xf4f1ec);
    part(
        g,
        new CylinderGeometry(cupR * 0.86, cupR * 0.86, 0.004, 14).translate(0, h * 0.06 + cupH - 0.004, cupZ),
        0x4a2c1a,
    );
    // the buttons and the display on the head
    part(
        g,
        new BoxGeometry(w * 0.5, h * 0.05, 0.004).translate(0, h * 0.92, d / 2 + 0.002),
        light ? 0x7fd3ff : 0x5be0ff,
    );
    // the coffee running from the spout into the cup while it brews (shown by the home looks)
    const spoutY = h * 0.78 - h * 0.06;
    const cupY = h * 0.06 + cupH - 0.004;
    const stream = part(
        g,
        new CylinderGeometry(0.004, 0.005, spoutY - cupY, 6).translate(0, (spoutY + cupY) / 2, cupZ),
        0x5a3420,
    );
    stream.name = 'fp3dCoffeeStream';
    stream.visible = false;
    g.userData.cupTop = [0, h * 0.06 + cupH, cupZ];
    // how far the head reaches out over the cup: the steam drifts out from under it
    g.userData.headFront = d / 2 - cupZ;
    return g;
}

// Wind indicators, drawn by the viewer (furniture type "wind_vane", added in tasks.ts) and turned by the wind every frame:
// - "windex": the arrow at a masthead, pointing into the wind;
// - "sock": a windsock in red and white that lifts with the wind (straight out from 15 kn) and streams downwind;
// - "flag": a flag that flies downwind and flutters, harder in gusts.
// Gusts make all of them swing.
import {
    BoxGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Sprite,
    type BufferAttribute,
    type BufferGeometry,
    type Object3D,
} from 'three';
import { labelSprite, shade } from './anchor';
import { sockLift } from './weather-data';

/** One wind indicator as the 3D view reports it. */
export interface VaneState {
    id: string;
    /** The floor it stands on. */
    floor: string;
    x: number;
    z: number;
    /** windex, sock or flag. */
    kind: string;
    /** Length of the arrow, the sock or the flag (m). */
    size: number;
    /** Height above the floor (m): the masthead, the top of the pole. */
    base: number;
    /** A mast or a pole carries it, from the floor up. */
    mast: boolean;
    /** The text over it; empty: none. */
    label: string;
    /** The label in a warning colour (a strong wind or gusts). */
    warn: boolean;
}

export interface VaneScene {
    /** Height of its floor. */
    floorY: number;
    /** A light look (day theme, natural style). */
    light: boolean;
}

/** The wind for the indicators: where it blows to in the plan (rad, clockwise from the top of the plan), m/s, gusts 0 … 1. */
export interface VaneWind {
    to: number;
    speed: number;
    gust: number;
}

/** What decides the look of an indicator: rebuilt when this changes (the wind only turns it). */
export function vaneKey(v: VaneState, s: VaneScene): string {
    return [
        v.id,
        v.kind,
        v.size.toFixed(2),
        v.x.toFixed(2),
        v.z.toFixed(2),
        v.base.toFixed(2),
        v.mast,
        v.label,
        v.warn,
        s.floorY.toFixed(2),
        s.light,
    ].join(',');
}

function part(group: Object3D, geo: BufferGeometry, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    group.add(m);
    return m;
}

/** Colours per vertex by a rule on its position (stripes of a windsock, the halves of a flag). */
function paint(geo: BufferGeometry, color: (x: number, y: number, z: number) => Color): BufferGeometry {
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        const c = color(p.getX(i), p.getY(i), p.getZ(i));
        // a little shading by the normal, as on the other gear (both sides of a cloth are lit alike)
        const k = 0.78 + 0.22 * Math.abs(n.getY(i) * 0.6 + n.getX(i) * 0.8);
        colors.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geo;
}

/** The arrow at a masthead: a black shaft pointing into the wind (local -z), red tip, a fin on each side of the tail. */
function windex(head: Group, l: number): void {
    part(head, new BoxGeometry(0.025, 0.025, l * 0.95).translate(0, 0, l * 0.0), 0x1e2227);
    part(head, new ConeGeometry(0.045, l * 0.16, 10).rotateX(-Math.PI / 2).translate(0, 0, -l * 0.55), 0xd8332a);
    for (const side of [-1, 1]) {
        const fin = new BoxGeometry(0.01, l * 0.18, l * 0.26)
            .translate(0, l * 0.09, 0)
            .rotateZ(side * 0.55)
            .translate(0, 0, l * 0.38);
        part(head, fin, 0xd8332a);
    }
    // the spindle it turns on
    part(head, new CylinderGeometry(0.018, 0.018, 0.16, 8).translate(0, -0.08, 0), 0x8d99a6);
}

/** A windsock: a red and white cone from its mouth at the pole (local origin) along -z. */
function sock(pitch: Group, l: number): void {
    const geo = new CylinderGeometry(l * 0.15, l * 0.06, l, 18, 5, true).rotateX(Math.PI / 2).translate(0, 0, -l / 2);
    geo.computeVertexNormals();
    const red = new Color(0xe8501f);
    const white = new Color(0xf4f4f4);
    paint(geo, (_x, _y, z) => (Math.min(4, Math.floor((-z / l) * 5 + 0.001)) % 2 ? white : red));
    const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
    m.name = 'fp3dVaneCloth';
    pitch.add(m);
    // the ring of the mouth
    part(pitch, new CylinderGeometry(l * 0.155, l * 0.155, 0.03, 18, 1, true).rotateX(Math.PI / 2), 0x9aa3ad);
}

/** A flag: a cloth from the pole (local origin, top edge) along -z, dark blue over white. */
function flag(pitch: Group, l: number): void {
    const h = l * 0.62;
    const geo = new PlaneGeometry(l, h, 14, 5).rotateY(Math.PI / 2).translate(0, -h / 2, -l / 2);
    const blue = new Color(0x1f4fbf);
    const white = new Color(0xf2f4f7);
    paint(geo, (_x, y) => (y > -h / 2 ? blue : white));
    const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
    m.name = 'fp3dVaneCloth';
    m.userData.fp3dRest = Float32Array.from((geo.getAttribute('position') as BufferAttribute).array);
    pitch.add(m);
}

/** Builds an indicator at its place; the wind turns it with animateVane. */
export function buildVane(v: VaneState, s: VaneScene): Group {
    const group = new Group();
    group.userData.fp3dVane = v.id;
    group.userData.fp3dVaneKind = v.kind;
    group.userData.fp3dSeed = (v.x * 7.3 + v.z * 3.1) % 6.28;
    group.position.set(v.x, s.floorY + v.base, v.z);
    const l = Math.min(6, Math.max(0.2, v.size));
    if (v.mast && v.base > 0.3) {
        // a mast (an arrow at its top) or a pole from the floor up
        const r = v.kind === 'windex' ? 0.075 : 0.035;
        const geo = new CylinderGeometry(r, r * 1.2, v.base, 12).translate(0, -v.base / 2, 0);
        part(group, v.kind === 'windex' ? geo.scale(1, 1, 1.45) : geo, s.light ? 0xc9cfd5 : 0x8d99a6);
    }
    const head = new Group();
    head.name = 'fp3dVaneHead';
    group.add(head);
    const pitch = new Group();
    pitch.name = 'fp3dVanePitch';
    head.add(pitch);
    if (v.kind === 'sock') {
        sock(pitch, l);
    } else if (v.kind === 'flag') {
        flag(pitch, l);
    } else {
        head.position.y = 0.16;
        windex(head, l);
    }
    if (v.label) {
        const label = labelSprite(v.label, s.light, v.warn ? 'warn' : null, 0.024);
        label.position.set(0, (v.kind === 'windex' ? 0.3 : 0.2) + l * 0.3, 0);
        group.add(label);
    }
    return group;
}

/**
 * Turns an indicator with the wind (`t`: seconds): the arrow into the wind, the sock and the flag downwind; the sock
 * lifts with the speed, the flag flutters; gusts swing them. Without a wind direction the sock and the flag hang.
 */
export function animateVane(group: Object3D, wind: VaneWind | null, t: number): void {
    const kind = group.userData.fp3dVaneKind as string;
    const seed = (group.userData.fp3dSeed as number) || 0;
    const head = group.getObjectByName('fp3dVaneHead');
    const pitch = group.getObjectByName('fp3dVanePitch');
    if (!head || !pitch) {
        return;
    }
    const speed = wind?.speed ?? 0;
    const gust = wind?.gust ?? 0;
    const moving = !!wind && speed > 0.3;
    // the swing: slow and small in a steady wind, wide and quick in gusts
    const swing = moving
        ? (Math.sin(t * 1.7 + seed) * 0.6 + Math.sin(t * 4.3 + seed * 2) * 0.4) * (0.03 + 0.2 * gust)
        : 0;
    if (wind) {
        head.rotation.y = kind === 'windex' ? -(wind.to - Math.PI) + swing : -wind.to + swing * 1.5;
    }
    if (kind === 'windex') {
        return;
    }
    // gusts blow it up for a moment
    const puff = 1 + gust * 0.4 * Math.max(0, Math.sin(t * 0.9 + seed));
    const lift = moving ? sockLift(speed * puff) : 0;
    const droop = (kind === 'flag' ? 1.35 : 1.4) * (1 - lift);
    pitch.rotation.x = -droop + (moving ? Math.sin(t * 3.1 + seed) * 0.04 * (0.4 + gust) : 0);
    if (kind !== 'flag') {
        return;
    }
    const cloth = group.getObjectByName('fp3dVaneCloth') as Mesh | undefined;
    const rest = cloth?.userData.fp3dRest as Float32Array | undefined;
    if (!cloth || !rest) {
        return;
    }
    const pos = cloth.geometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    let l = 0;
    for (let i = 2; i < rest.length; i += 3) {
        l = Math.max(l, -rest[i]);
    }
    // waves run from the pole to the free end, larger there and in gusts
    const amp = l * (moving ? 0.05 + 0.07 * gust + 0.02 * Math.min(1, speed / 10) : 0.015);
    const omega = 3 + Math.min(8, speed * 0.6) + gust * 4;
    const k = (Math.PI * 2) / (l * 0.7);
    for (let i = 0; i < rest.length; i += 3) {
        const d = -rest[i + 2];
        arr[i] = rest[i] + amp * Math.sin(d * k - t * omega + seed) * (d / l);
    }
    pos.needsUpdate = true;
}

/** Frees the geometries, materials and textures of the indicators (sprites share one geometry: it stays). */
export function disposeVanes(root: Object3D): void {
    root.traverse(o => {
        const m = o as Mesh;
        if (!(o instanceof Sprite) && m.geometry) {
            m.geometry.dispose();
        }
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mat of mats) {
            (mat as MeshBasicMaterial).map?.dispose();
            mat.dispose();
        }
    });
}

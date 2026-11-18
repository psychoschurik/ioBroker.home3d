// Cars as furniture: a saloon, a hatchback or a van in the colour chosen, standing where they are placed while
// their presence datapoint says the car is home (without one always). Drawn by home-fx.ts; low poly like the
// rest of the furniture, lit by the colours of its faces (shade), but with the parts that make a car read as one:
// rounded body with wheel arches, a cabin that narrows to the roof with pillars in the body's colour and glass that
// mirrors the sky, alloy wheels that turn while it drives, mirrors, door seams and handles, grille, lights and
// number plates, and a soft shadow under it.
import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    ExtrudeGeometry,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    RingGeometry,
    Shape,
    Vector2,
} from 'three';
import { shade } from './anchor';

export const CAR_KINDS = ['car_sedan', 'car_hatchback', 'car_van'] as const;
export type CarKind = (typeof CAR_KINDS)[number];

/** The colour a car starts with. */
export const CAR_COLORS: Record<CarKind, string> = {
    car_sedan: '#2e5c8a',
    car_hatchback: '#b8322a',
    car_van: '#e9ecef',
};

export const isCarKind = (type: string): type is CarKind => (CAR_KINDS as readonly string[]).includes(type);

/** The name of a wheel's mesh: home-fx.ts turns it while the car drives (`userData.fp3dR`: its radius). */
export const WHEEL = 'fp3dWheel';

type P = [number, number];

/** The points of a quadratic curve from `a` (not included) over the control `c` to `b`. */
function curve(a: P, c: P, b: P, n = 8): P[] {
    const out: P[] = [];
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
    return out;
}

/**
 * A side outline (points along the car: z, up: y) extruded across `width`, centred on x = 0; with `bevel` its edges
 * are rounded (the outline grows by the bevel all round). The car's front is local -z.
 */
function side(points: readonly P[], width: number, bevel = 0): BufferGeometry {
    const shape = new Shape(points.map(([z, y]) => new Vector2(z, y)));
    const depth = Math.max(0.005, width - 2 * bevel);
    let geo: BufferGeometry = new ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 8,
    });
    // outline x → car z, extrusion → car x
    geo.rotateY(-Math.PI / 2);
    geo.translate(depth / 2, 0, 0);
    if (geo.index) {
        geo = geo.toNonIndexed();
    }
    return geo;
}

/** Narrows a part towards its top (`k` at `y1` of the width at `y0`): the tumblehome of a cabin. */
function taper(geo: BufferGeometry, y0: number, y1: number, k: number): BufferGeometry {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
        const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
        p.setX(i, p.getX(i) * (1 - (1 - k) * t));
    }
    geo.computeVertexNormals();
    return geo;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry =>
    new BoxGeometry(w, h, d).translate(x, y, z);

/** The parts of one mesh, coloured per vertex (shade) and merged into one geometry: one draw for the lot. */
class Parts {
    private geos: BufferGeometry[] = [];

    /** Adds a part in `color`, its brightness changed by `light(y)` (a gradient from bottom to top). */
    add(geo: BufferGeometry, color: Color | number, light?: (y: number) => number): void {
        const g = geo.index ? geo.toNonIndexed() : geo;
        if (!g.getAttribute('normal')) {
            g.computeVertexNormals();
        }
        const pos = g.getAttribute('position');
        this.geos.push(
            shade(g, color instanceof Color ? color : new Color(color), light ? i => light(pos.getY(i)) : undefined),
        );
    }

    mesh(name = ''): Mesh {
        let count = 0;
        for (const g of this.geos) {
            count += g.getAttribute('position').count;
        }
        const position = new Float32Array(count * 3);
        const normal = new Float32Array(count * 3);
        const color = new Float32Array(count * 3);
        let at = 0;
        for (const g of this.geos) {
            position.set(g.getAttribute('position').array, at * 3);
            normal.set(g.getAttribute('normal').array, at * 3);
            color.set(g.getAttribute('color').array, at * 3);
            at += g.getAttribute('position').count;
            g.dispose();
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(position, 3));
        geo.setAttribute('normal', new Float32BufferAttribute(normal, 3));
        geo.setAttribute('color', new Float32BufferAttribute(color, 3));
        geo.computeBoundingSphere();
        const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, transparent: true }));
        m.name = name;
        return m;
    }
}

/** A wheel of radius `r` and width `tw` around the x axis, its alloy rim facing `sx` (outwards). */
function wheel(r: number, tw: number, sx: number, steel: boolean): Mesh {
    const p = new Parts();
    p.add(new CylinderGeometry(r, r, tw, 24).rotateZ(Math.PI / 2), 0x1b1d20);
    // the sidewall: a little narrower ring just outside the tread
    p.add(
        new CylinderGeometry(r * 0.93, r * 0.93, 0.01, 24).rotateZ(Math.PI / 2).translate(sx * (tw / 2 + 0.002), 0, 0),
        0x25282c,
    );
    const face = (geo: BufferGeometry, out: number, color: number): void => {
        p.add(geo.rotateY((sx * Math.PI) / 2).translate(sx * (tw / 2 + out), 0, 0), color);
    };
    const metal = steel ? 0x9aa2aa : 0xc9d0d7;
    face(new CircleGeometry(r * 0.66, 24), 0.006, 0x23272c);
    face(new RingGeometry(r * 0.55, r * 0.66, 24), 0.009, metal);
    const spokes = steel ? 8 : 5;
    for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const spoke = steel
            ? new BoxGeometry(0.008, r * 0.1, r * 0.1).translate(0, r * 0.42, 0)
            : new BoxGeometry(0.008, r * 0.42, r * 0.13).translate(0, r * 0.35, 0);
        p.add(spoke.rotateX(a).translate(sx * (tw / 2 + 0.01), 0, 0), steel ? 0x2c3035 : metal);
    }
    if (steel) {
        face(new CircleGeometry(r * 0.54, 24), 0.008, metal);
    }
    face(new CircleGeometry(r * 0.17, 14), 0.016, steel ? 0x7d858d : 0xaab2ba);
    face(new CircleGeometry(r * 0.07, 10), 0.018, 0x3a3f45);
    const m = p.mesh(WHEEL);
    m.userData.fp3dR = r;
    return m;
}

let shadowTex: CanvasTexture | null = null;

/** A soft dark patch under the car (null without a document, e.g. in tests). */
function shadow(w: number, d: number): Mesh | null {
    if (typeof document === 'undefined') {
        return null;
    }
    if (!shadowTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        if (!ctx) {
            return null;
        }
        const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
        g.addColorStop(0, 'rgba(0,0,0,0.55)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.38)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        shadowTex = new CanvasTexture(c);
        // one for all cars: home-fx.ts does not free it with a car
        shadowTex.userData.fp3dShared = true;
    }
    const m = new Mesh(
        new PlaneGeometry(w * 1.35, d * 1.12).rotateX(-Math.PI / 2).translate(0, 0.012, 0),
        new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    m.renderOrder = 1;
    // home-fx.ts fades it with the car but never lets it write depth
    m.userData.fp3dFlat = true;
    return m;
}

/** A car of `w` × `d` × `h` m standing on y = 0, its front towards local -z. */
export function buildCar(kind: CarKind, w: number, d: number, h: number, color: string | null | undefined): Group {
    const g = new Group();
    let paint: Color;
    try {
        paint = new Color(color || CAR_COLORS[kind]);
    } catch {
        paint = new Color(CAR_COLORS[kind]);
    }
    const van = kind === 'car_van';
    const sedan = kind === 'car_sedan';
    const glass = new Color(0x1f2b36);
    const trim = 0x16191d;
    const body = new Parts();

    const bevel = van ? 0.05 : 0.04;
    const r = Math.min(0.37, h * (van ? 0.16 : 0.225));
    const clear = r * 0.42 + bevel;
    const front = -d / 2 + bevel;
    const rear = d / 2 - bevel;
    const zA = -d / 2 + d * (van ? 0.16 : sedan ? 0.2 : 0.19);
    const zB = d / 2 - d * (van ? 0.2 : sedan ? 0.22 : 0.17);
    const ar = r * 1.1 + bevel;
    const belt = van ? h * 0.5 : h * (sedan ? 0.56 : 0.57);
    const top = h - bevel;

    // the bottom edge with the wheel arches cut out of it
    const arch = (z: number): P[] => {
        const a = Math.asin(Math.min(1, (r - clear) / ar));
        const out: P[] = [];
        for (let i = 0; i <= 12; i++) {
            const t = Math.PI + a - (i / 12) * (Math.PI + 2 * a);
            out.push([z + ar * Math.cos(t), r + ar * Math.sin(t)]);
        }
        return out;
    };
    // the body's paint: darker low on the sides, brighter towards the shoulder
    const lit = (y: number): number => 0.84 + 0.24 * Math.min(1, Math.max(0, (y - clear) / (belt - clear)));

    let zWs: number; // where the windscreen meets the body
    let noseTop: number;
    if (van) {
        const hood = h * 0.45;
        zWs = -d / 2 + d * 0.12;
        const zCab = -d / 2 + d * 0.27;
        noseTop = hood - 0.06;
        const outline: P[] = [
            [front + 0.16, clear],
            ...arch(zA),
            ...arch(zB),
            [rear - 0.1, clear],
            ...curve([rear - 0.1, clear], [rear, clear], [rear, clear + 0.12], 3),
            [rear, top - 0.14],
            ...curve([rear, top - 0.14], [rear, top], [rear - 0.14, top], 4),
            ...curve([rear - 0.14, top], [(rear + zCab) / 2, top + 0.03], [zCab + 0.12, top], 6),
            ...curve([zCab + 0.12, top], [zCab, top], [zCab - 0.04, top - 0.12], 3),
            [zWs, hood],
            ...curve([zWs, hood], [front + 0.06, hood - 0.02], [front, noseTop - 0.12], 5),
            [front, clear + 0.14],
            ...curve([front, clear + 0.14], [front, clear], [front + 0.16, clear], 3),
        ];
        body.add(side(outline, w, bevel), paint, lit);
        // the windscreen: a pane on the slope between the bonnet and the roof
        const along = (t: number): P => [zWs + (zCab - 0.04 - zWs) * t, hood + (top - 0.12 - hood) * t];
        const [ax, ay] = along(0.1);
        const [bx, by] = along(0.9);
        const nz = -(top - 0.12 - hood);
        const ny = zCab - 0.04 - zWs;
        const nl = Math.hypot(nz, ny);
        const o = (bevel + 0.008) / nl;
        body.add(
            side(
                [
                    [ax + nz * o, ay + ny * o],
                    [bx + nz * o, by + ny * o],
                    [bx - nz * o * 2, by - ny * o * 2],
                    [ax - nz * o * 2, ay - ny * o * 2],
                ],
                w * 0.86,
            ),
            glass,
            y => 0.8 + 0.6 * Math.min(1, Math.max(0, (y - hood) / (top - hood))),
        );
        // the cab's side windows and the seams of the doors (cab, sliding door, the rear doors)
        for (const sx of [-1, 1]) {
            const y0 = hood + 0.1;
            const y1 = top - 0.16;
            const zf = (y: number): number => zWs + ((zCab - 0.04 - zWs) * (y - hood)) / (top - 0.12 - hood) + 0.06;
            const win = side(
                [
                    [zf(y0), y0],
                    [zCab + 0.6, y0],
                    [zCab + 0.6, y1],
                    [zf(y1), y1],
                ],
                0.02,
            ).translate(sx * (w / 2 + 0.006), 0, 0);
            body.add(win, glass, y => 0.8 + 0.6 * Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));
            const x = sx * (w / 2 + 0.003);
            // the cab door ends behind its window; the sliding door runs from there to the rear arch, on its rail
            const z0 = zCab + 0.68;
            const z1 = zB - ar - 0.08;
            for (const z of [z0, z1]) {
                body.add(box(0.006, top - clear - 0.3, 0.014, x, (top + clear) / 2, z), trim);
            }
            body.add(box(0.008, 0.03, z1 - z0, x, y1 + 0.08, (z0 + z1) / 2), trim);
            body.add(box(0.012, 0.03, 0.13, sx * (w / 2 + 0.006), hood + 0.02, zCab + 0.5), 0x9aa1a8);
            body.add(box(0.012, 0.03, 0.13, sx * (w / 2 + 0.006), hood + 0.02, z0 + 0.18), 0x9aa1a8);
            // a dark sill between the arches
            body.add(box(0.02, 0.09, zB - zA - 2 * ar - 0.1, sx * (w / 2 + 0.004), clear + 0.03, (zA + zB) / 2), trim);
        }
        // the rear doors' middle seam and the tall rear lights
        body.add(box(0.014, top - clear - 0.25, 0.006, 0, (top + clear) / 2, rear + bevel + 0.002), trim);
        for (const sx of [-1, 1]) {
            body.add(box(w * 0.07, h * 0.24, 0.03, sx * (w / 2 - w * 0.06), clear + h * 0.2, rear + bevel), 0xd0222b);
            body.add(box(w * 0.07, h * 0.05, 0.034, sx * (w / 2 - w * 0.06), clear + h * 0.07, rear + bevel), 0xf2a33a);
        }
    } else {
        zWs = -d / 2 + d * (sedan ? 0.36 : 0.33);
        noseTop = belt - 0.07;
        const roofY = top - 0.03;
        const rise = roofY - belt;
        const zRoofF = zWs + rise * (sedan ? 1.35 : 1.25);
        const zRoofR = sedan ? d / 2 - d * 0.3 : rear - 0.42;
        const zRw = sedan ? d / 2 - d * 0.13 : rear - 0.08;
        // the lower body: bonnet, doors and boot
        const boot = sedan ? belt + 0.02 : belt;
        const outline: P[] = [
            [front + 0.18, clear],
            ...arch(zA),
            ...arch(zB),
            [rear - 0.16, clear],
            ...curve([rear - 0.16, clear], [rear, clear], [rear, clear + 0.16], 3),
            [rear, boot - 0.16],
            ...curve([rear, boot - 0.16], [rear, boot], [rear - 0.14, boot], 4),
            [zRw, boot],
            [zWs, belt],
            ...curve([zWs, belt], [front + 0.3, belt - 0.02], [front + 0.08, noseTop], 6),
            ...curve([front + 0.08, noseTop], [front, noseTop - 0.02], [front, noseTop - 0.14], 3),
            [front, clear + 0.16],
            ...curve([front, clear + 0.16], [front, clear], [front + 0.18, clear], 3),
        ];
        body.add(side(outline, w, bevel), paint, lit);

        // the cabin: glass all round, narrowing to the roof
        const wc = w * 0.88;
        const tk = 0.8;
        const screen = curve([zWs, belt - 0.02], [zRoofF - 0.16, roofY], [zRoofF, roofY], 8);
        const roofLine = curve([zRoofF, roofY], [(zRoofF + zRoofR) / 2, roofY + 0.05], [zRoofR, roofY], 8);
        const back = curve([zRoofR, roofY], [zRoofR + (sedan ? 0.3 : 0.2), roofY], [zRw, boot - 0.02], 8);
        const cabin: P[] = [[zWs, belt - 0.02], ...screen, ...roofLine, ...back];
        const sky = (y: number): number => 0.78 + 0.62 * Math.min(1, Math.max(0, (y - belt) / rise));
        body.add(taper(side(cabin, wc, 0.02), belt, roofY, tk), glass, sky);
        // the roof in the body's colour
        // it wraps round the top of the windscreen and of the rear window, so no glass shows above it
        const roofTop = [...screen.slice(-3), ...roofLine, ...back.slice(0, 2)].map(([z, y]): P => [z, y + 0.032]);
        const roof: P[] = [...roofTop, ...[...roofTop].reverse().map(([z, y]): P => [z, y - 0.09])];
        body.add(taper(side(roof, wc * 1.02, 0.012), belt, roofY, tk), paint, () => 1.04);
        // the pillars on both sides: A along the windscreen, B between the doors, C along the rear window
        const zBp = zWs + (zRw - zWs) * (sedan ? 0.36 : 0.42);
        const strip = (line: P[], dz: number): P[] => [...line, ...[...line].reverse().map(([z, y]): P => [z + dz, y])];
        const pillars: P[][] = [
            strip([[zWs, belt - 0.02], ...screen], 0.1),
            [
                [zBp - 0.045, belt - 0.02],
                [zBp + 0.045, belt - 0.02],
                [zBp + 0.045 - 0.06, roofY],
                [zBp - 0.045 - 0.06, roofY],
            ],
            strip([[zRoofR, roofY], ...back], sedan ? -0.26 : -0.34),
        ];
        for (const sx of [-1, 1]) {
            for (const pts of pillars) {
                const pillar = side(pts, 0.03).translate(sx * (wc / 2 + 0.018), 0, 0);
                body.add(taper(pillar, belt, roofY, tk), paint, lit);
            }
            const x = sx * (w / 2 + 0.002);
            // the seams of the doors and their handles
            const seams = sedan ? [zWs - 0.04, zBp, zB - ar - 0.03] : [zWs - 0.04, zBp, zB - ar - 0.02];
            for (const z of seams) {
                body.add(box(0.006, belt - clear - 0.14, 0.012, x, (belt + clear) / 2 + 0.03, z), trim);
            }
            for (const z of [zBp - 0.2, seams[2] - 0.2]) {
                body.add(
                    box(0.014, 0.026, 0.12, sx * (w / 2 + 0.008), belt - 0.1, z),
                    paint.clone().multiplyScalar(1.25),
                );
            }
            // a dark sill between the arches
            body.add(
                box(0.02, 0.08, zB - zA - 2 * ar - 0.08, sx * (w / 2 + 0.004), clear + 0.025, (zA + zB) / 2),
                trim,
            );
            // the mirror on its stalk, its glass facing back
            const mx = sx * (wc / 2 + 0.11);
            body.add(box(0.11, 0.025, 0.05, sx * (wc / 2 + 0.05), belt + 0.04, zWs + 0.16), trim);
            body.add(box(0.07, 0.09, 0.15, mx, belt + 0.09, zWs + 0.14), paint, lit);
            body.add(box(0.055, 0.07, 0.01, mx, belt + 0.09, zWs + 0.22), 0x3b4a58);
        }
        // the rear: a light band across the boot, brighter at both ends
        const yt = boot - 0.1;
        body.add(box(w * 0.86, 0.035, 0.03, 0, yt, rear + bevel), 0x7c0d14);
        for (const sx of [-1, 1]) {
            body.add(box(w * 0.18, 0.06, 0.034, sx * w * 0.36, yt, rear + bevel), 0xe0262e);
        }
    }
    // the front: grille, headlights with their daytime light, a dark bumper below
    const nose = -d / 2 - 0.004;
    const yl = van ? noseTop - 0.1 : noseTop - 0.07;
    body.add(box(w * 0.42, van ? 0.16 : 0.09, 0.03, 0, yl - (van ? 0.14 : 0.1), nose + 0.012), 0x121417);
    for (const sx of [-1, 1]) {
        body.add(box(w * 0.22, 0.07, 0.03, sx * w * 0.32, yl, nose + 0.014), 0xc9d6e3);
        body.add(box(w * 0.22, 0.014, 0.034, sx * w * 0.32, yl + 0.04, nose + 0.012), 0xffffff);
    }
    body.add(box(w * 0.98, 0.1, 0.14, 0, clear + 0.03, -d / 2 + 0.08), trim);
    body.add(box(w * 0.98, 0.1, 0.14, 0, clear + 0.03, d / 2 - 0.08), trim);
    // number plates front and back, with the blue strip at their left end
    const plate = (z: number, y: number, dir: number): void => {
        body.add(box(0.5, 0.11, 0.012, 0, y, z), 0xf1f1ec);
        body.add(box(0.045, 0.11, 0.014, -dir * 0.228, y, z), 0x1d3f9a);
    };
    plate(nose - 0.008, clear + 0.17, 1);
    plate(d / 2 + 0.012, van ? clear + 0.3 : clear + 0.24, -1);
    // the wheel arches dark inside
    const tw = Math.min(0.26, w * 0.12);
    for (const z of [zA, zB]) {
        body.add(box(w - 2 * tw - 0.06, r + ar - clear - 0.04, 2 * ar, 0, (r + ar + clear - 0.04) / 2, z), 0x101214);
    }
    g.add(body.mesh('fp3dCarBody'));
    // the wheels
    const xw = w / 2 - tw / 2 - 0.012;
    for (const sx of [-1, 1]) {
        for (const z of [zA, zB]) {
            const m = wheel(r, tw, sx, van);
            m.position.set(sx * xw, r, z);
            g.add(m);
        }
    }
    const s = shadow(w, d);
    if (s) {
        g.add(s);
    }
    return g;
}

/** The marking of the place where a car stands while it is away (four thin lines on the ground). */
export function buildBay(w: number, d: number): Group {
    const g = new Group();
    const t = 0.06;
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    for (const geo of [
        box(w + 0.3, 0.01, t, 0, 0.005, -d / 2 - 0.15),
        box(w + 0.3, 0.01, t, 0, 0.005, d / 2 + 0.15),
        box(t, 0.01, d + 0.3, -w / 2 - 0.15, 0.005, 0),
        box(t, 0.01, d + 0.3, w / 2 + 0.15, 0.005, 0),
    ]) {
        g.add(new Mesh(geo, mat));
    }
    return g;
}

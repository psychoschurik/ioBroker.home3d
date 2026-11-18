// Cars as furniture: a saloon, a hatchback or a van in the colour chosen, standing where they are placed while
// their presence datapoint says the car is home (without one always). Drawn by home-fx.ts; low poly like the
// rest of the furniture, lit by the colours of its faces (shade).
import {
    BoxGeometry,
    Color,
    CylinderGeometry,
    ExtrudeGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    Shape,
    Vector2,
} from 'three';
import type { BufferGeometry } from 'three';
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

function piece(g: Group, geo: BufferGeometry, color: Color | number): Mesh {
    const m = new Mesh(
        shade(geo, color instanceof Color ? color : new Color(color)),
        new MeshBasicMaterial({ vertexColors: true, transparent: true }),
    );
    g.add(m);
    return m;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry =>
    new BoxGeometry(w, h, d).translate(x, y, z);

/**
 * A side profile (points along the car: z, up: y) extruded across `width`, centred on x = 0. The car's front is local
 * -z.
 */
function profile(points: readonly [number, number][], width: number): BufferGeometry {
    const shape = new Shape(points.map(([z, y]) => new Vector2(z, y)));
    const geo = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    // shape x → car z, extrusion → car x
    geo.rotateY(-Math.PI / 2);
    geo.translate(width / 2, 0, 0);
    return geo;
}

/** A car of `w` × `d` × `h` m standing on y = 0, its front towards local -z. */
export function buildCar(kind: CarKind, w: number, d: number, h: number, color: string | null | undefined): Group {
    const g = new Group();
    let body: Color;
    try {
        body = new Color(color || CAR_COLORS[kind]);
    } catch {
        body = new Color(CAR_COLORS[kind]);
    }
    const glass = new Color(0x2a3540);
    const dark = new Color(0x1c2024);
    const van = kind === 'car_van';
    const r = Math.min(0.36, h * (van ? 0.15 : 0.22));
    const bottom = r * 0.55;
    const front = -d / 2;
    const rear = d / 2;
    // the wheels
    const wx = w / 2 - w * 0.08;
    const wz = d / 2 - Math.max(r * 1.7, d * 0.17);
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            piece(
                g,
                new CylinderGeometry(r, r, w * 0.14, 18).rotateZ(Math.PI / 2).translate(sx * wx, r, sz * wz),
                dark,
            );
        }
    }
    if (van) {
        // one body from the bonnet over the cab to the tall load box
        const hood = Math.min(0.9, d * 0.17);
        const slope = Math.min(0.45, d * 0.08);
        piece(
            g,
            profile(
                [
                    [front, bottom],
                    [rear, bottom],
                    [rear, h],
                    [front + hood + slope, h],
                    [front + hood, h * 0.5],
                    [front + 0.04, h * 0.46],
                    [front, h * 0.4],
                ],
                w,
            ),
            body,
        );
        // the windscreen and the cab's side windows, just outside the body
        const k = (y: number): number => front + hood + (slope * (y - 0.5 * h)) / (0.5 * h) - 0.02;
        piece(
            g,
            profile(
                [
                    [k(h * 0.53), h * 0.53],
                    [front + hood + slope + 0.55, h * 0.53],
                    [front + hood + slope + 0.55, h * 0.88],
                    [k(h * 0.88), h * 0.88],
                ],
                w * 1.012,
            ),
            glass,
        );
    } else {
        const belt = h * 0.55;
        // the lower body: bonnet, doors and boot, a little rounded at both ends
        piece(
            g,
            profile(
                [
                    [front, bottom],
                    [rear, bottom],
                    [rear, belt - 0.04],
                    [rear - 0.14, belt],
                    [front + 0.28, belt],
                    [front, belt - 0.1],
                ],
                w,
            ),
            body,
        );
        // the cabin: glass all round, its roof in the body's colour
        const sedan = kind === 'car_sedan';
        const zf = sedan ? -d * 0.17 : -d * 0.13;
        const zr = sedan ? d * 0.3 : rear - 0.06;
        const tf = zf + h * 0.33;
        const tr = sedan ? zr - h * 0.3 : zr - h * 0.12;
        const roof = h - 0.035;
        piece(
            g,
            profile(
                [
                    [zf, belt - 0.01],
                    [zr, belt - 0.01],
                    [tr, roof],
                    [tf, roof],
                ],
                w * 0.84,
            ),
            glass,
        );
        piece(g, box(w * 0.82, 0.04, tr - tf + 0.06, 0, roof + 0.015, (tf + tr) / 2), body);
    }
    // bumpers and lights
    piece(g, box(w * 1.01, h * 0.09, 0.1, 0, bottom + h * 0.05, front + 0.03), dark);
    piece(g, box(w * 1.01, h * 0.09, 0.1, 0, bottom + h * 0.05, rear - 0.03), dark);
    const lights = van ? h * 0.33 : h * 0.44;
    for (const sx of [-1, 1]) {
        piece(g, box(w * 0.18, h * 0.05, 0.03, sx * w * 0.34, lights, front - 0.004), 0xfff3c4);
        piece(g, box(w * 0.15, h * 0.05, 0.03, sx * w * 0.36, lights, rear + 0.004), 0xc8262c);
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

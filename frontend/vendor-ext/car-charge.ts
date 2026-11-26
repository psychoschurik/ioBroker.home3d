// A car at its wallbox (home-view.ts, home-fx.ts): a car parked within reach of a wallbox on its floor gets the
// wallbox's cable, from its holster under the box to the port above the wheel on the side facing it, while the
// wallbox says a car is plugged in. The ring round the port shows what the wallbox says, in the colours of its card:
// green and pulsing while it charges (the power running along the cable), green when the car is full, amber while it
// waits, red on an error. Every car gets one wallbox and every wallbox one car, the nearest pairs first.
import {
    AdditiveBlending,
    CatmullRomCurve3,
    Color,
    CylinderGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    RingGeometry,
    SphereGeometry,
    TubeGeometry,
    Vector3,
} from 'three';
import { shade } from './anchor';
import { type CarKind, chargePort } from './cars';
import type { WallboxPhase } from './device-cards';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** How far a wallbox's cable reaches: from its holster to the car's port in the plan (m). */
export const CABLE_REACH = 5;

/** What a wallbox says when a car is on its cable. */
export const PLUGGED_PHASES: ReadonlySet<WallboxPhase> = new Set<WallboxPhase>([
    'charging',
    'plugged',
    'full',
    'error',
]);

/** The colour of the ring round the port (those of the wallbox's card). */
export function portColor(phase: WallboxPhase): number {
    switch (phase) {
        case 'charging':
        case 'full':
            return 0x4cd97b;
        case 'plugged':
            return 0xffd166;
        case 'error':
            return 0xff5d5d;
        default:
            return 0x9fb3c8;
    }
}

/** A wallbox as the cars see it: where its cable leaves (floor coordinates, y above the floor) and what it says. */
export interface WallboxSpot {
    id: string;
    floor: string;
    at: Vec3;
    phase: WallboxPhase;
}

/** A car's place (floor coordinates; `angle`: turn in the plan, rad, clockwise; the front at local -z). */
export interface CarSpot {
    id: string;
    floor: string;
    kind: CarKind;
    x: number;
    z: number;
    y: number;
    angle: number;
    w: number;
    d: number;
    h: number;
}

/** The cable from a wallbox to a car: its course (floor coordinates), the port and which way the port faces. */
export interface CarCharge {
    /** The wallbox's furniture id. */
    box: string;
    /** From the wallbox's holster to the port. */
    path: Vec3[];
    port: Vec3;
    /** Out of the car's flank at the port (plan, unit). */
    normal: Vec2;
    phase: WallboxPhase;
}

/** The furniture a wallbox's holster is taken from. */
export interface WallboxLike {
    type: string;
    x: number;
    z: number;
    d: number;
    h: number;
    rotation: number;
    mount_y?: number | null;
}

/**
 * Where a wallbox's cable hangs out (floor coordinates): the built-in one hangs its box from 1 m (or its mount height)
 * with the coiled cable down to 0.42 m below it, at its front; another model at its front, a third up its height.
 */
export function wallboxOutlet(f: WallboxLike): Vec3 {
    const a = ((f.rotation ?? 0) * Math.PI) / 180;
    const builtIn = f.type === 'wallbox';
    const out = builtIn ? f.d / 2 - 0.025 : f.d / 2;
    const y = builtIn ? (f.mount_y ?? 1) - 0.385 : (f.mount_y ?? 1) + f.h * 0.3;
    // the front is local +z, turned by the plan's angle (clockwise)
    return [f.x - Math.sin(a) * out, y, f.z + Math.cos(a) * out];
}

/** A point of the car (local) in floor coordinates. */
function toFloor(c: CarSpot, p: Vec3): Vec3 {
    const cos = Math.cos(c.angle);
    const sin = Math.sin(c.angle);
    return [c.x + p[0] * cos - p[2] * sin, c.y + p[1], c.z + p[0] * sin + p[2] * cos];
}

/** A point of the plan in the car's local frame (x across, z along it). */
function toLocal(c: CarSpot, x: number, z: number): Vec2 {
    const dx = x - c.x;
    const dz = z - c.z;
    const cos = Math.cos(c.angle);
    const sin = Math.sin(c.angle);
    return [dx * cos + dz * sin, -dx * sin + dz * cos];
}

/**
 * The cable's course from the wallbox's holster `a` to the car's port: out of the flank first, round the car's end
 * when the wallbox stands ahead of it or behind it, hanging down towards the floor in between.
 */
export function cablePath(c: CarSpot, a: Vec3): { path: Vec3[]; port: Vec3; normal: Vec2 } {
    const [lx, lz] = toLocal(c, a[0], a[2]);
    const sx: 1 | -1 = lx >= 0 ? 1 : -1;
    const sz = lz < 0 ? -1 : 1;
    const portLocal = chargePort(c.kind, c.w, c.d, c.h, sx, lz < 0);
    const port = toFloor(c, portLocal);
    const out = toFloor(c, [portLocal[0] + sx * 0.22, portLocal[1], portLocal[2]]);
    const normal: Vec2 = [out[0] - port[0], out[2] - port[2]];
    const nl = Math.hypot(normal[0], normal[1]) || 1;
    normal[0] /= nl;
    normal[1] /= nl;
    // the course in the plan: holster, the corner of the car (when in the way), out of the flank, the port
    const plan: Vec2[] = [[a[0], a[2]]];
    if (Math.abs(lz) > c.d / 2 && Math.abs(lx) < c.w / 2 + 0.22) {
        const k = toFloor(c, [sx * (c.w / 2 + 0.25), 0, sz * (c.d / 2 + 0.25)]);
        plan.push([k[0], k[2]]);
    }
    plan.push([out[0], out[2]], [port[0], port[2]]);
    const lens = [0];
    for (let i = 1; i < plan.length; i++) {
        lens.push(lens[i - 1] + Math.hypot(plan[i][0] - plan[i - 1][0], plan[i][1] - plan[i - 1][1]));
    }
    const total = lens[lens.length - 1] || 1;
    // it hangs: the lower the further it runs, never through the floor
    const y0 = a[1];
    const y1 = port[1];
    const low = Math.max(0.04, Math.min(y0, y1) - (0.15 + 0.2 * total));
    const depth = Math.max(0, (y0 + y1) / 2 - low);
    const n = 24;
    const path: Vec3[] = [];
    let seg = 1;
    for (let i = 0; i <= n; i++) {
        const s = (i / n) * total;
        while (seg < plan.length - 1 && lens[seg] < s) {
            seg++;
        }
        const k = (s - lens[seg - 1]) / (lens[seg] - lens[seg - 1] || 1);
        const u = s / total;
        const x = plan[seg - 1][0] + (plan[seg][0] - plan[seg - 1][0]) * k;
        const z = plan[seg - 1][1] + (plan[seg][1] - plan[seg - 1][1]) * k;
        const y = Math.max(0.03, y0 + (y1 - y0) * u - depth * 4 * u * (1 - u));
        path.push([x, y, z]);
    }
    return { path, port, normal };
}

/**
 * Which car hangs on which wallbox: pairs on the same floor whose port is within the cable's reach, the nearest
 * first, every car and every wallbox once. The cars are those parked now.
 */
export function carCharges(cars: readonly CarSpot[], boxes: readonly WallboxSpot[]): Map<string, CarCharge> {
    const pairs: { car: CarSpot; box: WallboxSpot; dist: number; cable: ReturnType<typeof cablePath> }[] = [];
    for (const car of cars) {
        for (const box of boxes) {
            if (box.floor !== car.floor) {
                continue;
            }
            const cable = cablePath(car, box.at);
            const dist = Math.hypot(cable.port[0] - box.at[0], cable.port[2] - box.at[2]);
            if (dist <= CABLE_REACH) {
                pairs.push({ car, box, dist, cable });
            }
        }
    }
    pairs.sort((p, q) => p.dist - q.dist);
    const out = new Map<string, CarCharge>();
    const used = new Set<string>();
    for (const p of pairs) {
        if (out.has(p.car.id) || used.has(p.box.id)) {
            continue;
        }
        used.add(p.box.id);
        out.set(p.car.id, { box: p.box.id, ...p.cable, phase: p.box.phase });
    }
    return out;
}

/** The parts of a cable drawn: shown while the car is parked and plugged in. */
export interface CableParts {
    group: Group;
    ring: Mesh;
    /** The lights running along the cable while it charges. */
    pulses: Mesh[];
    curve: CatmullRomCurve3;
}

/** The cable, the plug in the port and the ring round it (floor coordinates; hidden until shown). */
export function buildCable(charge: CarCharge, light = true): CableParts {
    const group = new Group();
    group.name = 'fp3dCarCable';
    group.visible = false;
    // dark against a light floor, lighter against the dark theme's
    const dark = new Color(light ? 0x23272c : 0x4a525c);
    const curve = new CatmullRomCurve3(charge.path.map(p => new Vector3(...p)));
    const tube = new Mesh(
        shade(new TubeGeometry(curve, 48, 0.017, 8, false), dark),
        new MeshBasicMaterial({ vertexColors: true }),
    );
    group.add(tube);
    const [px, py, pz] = charge.port;
    const [nx, nz] = charge.normal;
    // the plug's handle, sticking out of the port
    const plug = new Mesh(
        shade(new CylinderGeometry(0.026, 0.03, 0.09, 10), dark),
        new MeshBasicMaterial({ vertexColors: true }),
    );
    plug.position.set(px + nx * 0.045, py, pz + nz * 0.045);
    plug.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(nx, 0, nz));
    group.add(plug);
    // the ring round the port, on the flank
    const ring = new Mesh(
        new RingGeometry(0.045, 0.095, 28),
        new MeshBasicMaterial({
            color: portColor(charge.phase),
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        }),
    );
    ring.position.set(px + nx * 0.006, py, pz + nz * 0.006);
    ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(nx, 0, nz));
    ring.renderOrder = 12;
    group.add(ring);
    const pulses: Mesh[] = [];
    for (let k = 0; k < 3; k++) {
        const m = new Mesh(
            new SphereGeometry(0.028, 10, 8),
            new MeshBasicMaterial({
                color: 0x7dffa8,
                transparent: true,
                depthWrite: false,
                blending: AdditiveBlending,
            }),
        );
        m.visible = false;
        m.renderOrder = 12;
        group.add(m);
        pulses.push(m);
    }
    return { group, ring, pulses, curve };
}

/** The ring's brightness while it charges at time `t` (s): it breathes once in 1.6 s. */
export function portPulse(t: number): number {
    return 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((t / 1.6) * Math.PI * 2));
}

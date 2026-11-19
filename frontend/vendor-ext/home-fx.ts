// The looks of home-data.ts in 3D, drawn by the viewer every frame (tasks.ts patches viewer3d.ts):
// air through open windows (warm air leaving red while the room heats), mould in cold corners, water standing in a
// room with a leak, rings of sound around a speaker or a noise sensor, water running at taps and showers, sprinklers,
// a robot mower driving its lanes and leaving stripes, dry lawns, the price glow round the house and the health
// badges of devices.
import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    DoubleSide,
    BufferAttribute,
    Float32BufferAttribute,
    Group,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Points,
    PointsMaterial,
    Raycaster,
    RingGeometry,
    SRGBColorSpace,
    Shape,
    ShapeGeometry,
    Sprite,
    Vector2,
    Vector3,
    type Camera,
    type Object3D,
} from 'three';
import { labelSprite, shade } from './anchor';
import { buildBay, buildCar, type CarKind, WHEEL } from './cars';
import { lanes, pathLength, pointAt, pointIn, type Corner, type MowerPhase, type Rgb, type Vec2 } from './home-data';
import { buildCoffeeMachine } from './kitchen';
import { buildRainTank, type RainTankKind } from './rain-tank';
import { buildParcel } from './parcel';
import { buildMailFlag, FLAG_DOWN, type MailShape } from './mail-flag';
import { buildServer, LED_OFF, ledColor, ledLit, type ServerKind, type ServerLed, type ServerLoad } from './server';

export interface AirState {
    id: string;
    floor: string;
    /** Middle of the opening on the wall line, the wall's outward normal, width, sill height and height (m). */
    x: number;
    z: number;
    nx: number;
    nz: number;
    w: number;
    y0: number;
    h: number;
    /** Air through it (m/s, positive into the room; about 0: warm air out at the top, cool air in at the bottom). */
    flow: number;
    /** The room heats: the air going out is warm (red). */
    heat: boolean;
}

export interface MouldState {
    id: string;
    floor: string;
    corners: Corner[];
    /** Height of the walls. */
    height: number;
    level: number;
    /** Text over the room ("Lüften"); empty: none. */
    label: string;
    cx: number;
    cz: number;
}

export interface FloodState {
    id: string;
    floor: string;
    points: Vec2[];
    /** Depth of the water (m). */
    level: number;
}

export interface SoundState {
    id: string;
    floor: string;
    x: number;
    y: number;
    z: number;
    /** 0 … 1. */
    level: number;
    kind: 'music' | 'noise';
}

export interface StreamState {
    id: string;
    floor: string;
    /** Where the water comes out and how far it falls (m); `spread`: a shower's width. */
    x: number;
    y: number;
    z: number;
    drop: number;
    spread: number;
}

export interface SprinklerState {
    id: string;
    floor: string;
    x: number;
    z: number;
    /** Height of the ground (m above the floor). */
    y: number;
    /** Reach (m). */
    r: number;
    on: boolean;
}

export interface LawnState {
    id: string;
    floor: string;
    points: Vec2[];
    /** Height of the lawn above the floor. */
    y: number;
    /** 0 moist … 1 dry. */
    dry: number;
    /** A mower drives on it: its stripes are drawn. */
    mown: boolean;
}

export interface MowerState {
    id: string;
    floor: string;
    /** The charging station and the way the mower faces in it (plan angle, rad). */
    dock: Vec2;
    dockAngle: number;
    /** The lawn it mows (an id among the lawns), null: none found. */
    lawn: string | null;
    phase: MowerPhase;
    /** Length of the mower (m). */
    size: number;
    /** Height of the ground (m above the floor). */
    y: number;
    /** Text over it (an error); empty: none. */
    label: string;
}

export interface BadgeState {
    id: string;
    floor: string;
    x: number;
    y: number;
    z: number;
    text: string;
    tone: 'warn' | 'alarm';
    /** Shown while the pointer is on the badge: the device, why, since when (lines). */
    tip?: string;
}

export interface GlowState {
    floor: string;
    /** Outline of the house (convex). */
    points: Vec2[];
    /** Height of the ground round it (floor coordinates). */
    y: number;
    color: Rgb;
}

/** A car at its place: shown while present; it drives in and out backwards along its length. */
export interface CarState {
    id: string;
    floor: string;
    kind: CarKind;
    x: number;
    z: number;
    y: number;
    /** Turn in the plan (rad, clockwise). */
    angle: number;
    w: number;
    d: number;
    h: number;
    color: string | null;
    /** The number plate's text (none: blank plates). */
    plate?: string | null;
    present: boolean;
    /** It has a presence datapoint: its place is marked while it is away. */
    sensed: boolean;
}

/** Smoke in a room whose smoke detector went off: it fills the room from the ceiling down. */
export interface SmokeState {
    id: string;
    floor: string;
    points: Vec2[];
    /** The ceiling's height above the floor (m). */
    top: number;
    /** How far the smoke has come down, 0 … 1 (it grows over the first minutes). */
    level: number;
}

/** Stale air in a room (CO₂): a haze through the whole room, its label when it is thick. */
export interface HazeState {
    id: string;
    floor: string;
    points: Vec2[];
    /** The ceiling's height above the floor (m). */
    top: number;
    /** How thick, 0 … 1. */
    level: number;
    /** The label over the room (empty: none). */
    label: string;
    cx: number;
    cz: number;
}

/** A coffee machine; while it brews, steam rises from its cup. */
export interface CoffeeState {
    id: string;
    floor: string;
    x: number;
    z: number;
    /** Its base above the floor (the worktop it stands on). */
    y: number;
    /** Turn in the plan (rad, clockwise). */
    angle: number;
    w: number;
    d: number;
    h: number;
    brewing: boolean;
}

/** A rainwater tank: a barrel on the ground or a cistern in it, filled to its level. */
export interface RainTankState {
    id: string;
    floor: string;
    kind: RainTankKind;
    x: number;
    z: number;
    /** The ground under it. */
    y: number;
    /** Turn in the plan (rad, clockwise). */
    angle: number;
    w: number;
    d: number;
    h: number;
    /** 0 … 1, null: no sensor. */
    fill: number | null;
    label: string | null;
    warn: boolean;
}

/** A parcel outside the front door after the doorbell rang. */
export interface ParcelState {
    id: string;
    floor: string;
    x: number;
    z: number;
    y: number;
    /** Along the wall (rad, as the plan turns). */
    angle: number;
    label: string;
}

/** A mailbox's flag: up while post lies in it. */
export interface MailFlagState {
    id: string;
    floor: string;
    shape: MailShape;
    x: number;
    z: number;
    y: number;
    /** Turn in the plan (rad, clockwise). */
    angle: number;
    w: number;
    d: number;
    h: number;
    up: boolean;
}

/** A server (rack or NAS) whose LEDs follow its socket. */
export interface ServerState {
    id: string;
    floor: string;
    kind: ServerKind;
    x: number;
    z: number;
    y: number;
    /** Turn in the plan (rad, clockwise). */
    angle: number;
    w: number;
    d: number;
    h: number;
    load: ServerLoad;
}

export interface HomeScene {
    airs: AirState[];
    moulds: MouldState[];
    floods: FloodState[];
    sounds: SoundState[];
    streams: StreamState[];
    sprinklers: SprinklerState[];
    lawns: LawnState[];
    mowers: MowerState[];
    badges: BadgeState[];
    cars: CarState[];
    smokes?: SmokeState[];
    hazes?: HazeState[];
    coffees?: CoffeeState[];
    rainTanks?: RainTankState[];
    servers?: ServerState[];
    mailFlags?: MailFlagState[];
    parcels?: ParcelState[];
    glow: GlowState | null;
}

export const EMPTY_HOME: HomeScene = {
    airs: [],
    moulds: [],
    floods: [],
    sounds: [],
    streams: [],
    sprinklers: [],
    lawns: [],
    mowers: [],
    badges: [],
    cars: [],
    glow: null,
};

/** Where a floor stands now and whether it shows. */
export interface FloorPlace {
    y: number;
    visible: boolean;
}

/** Mower speed (m/s) and the distance between its lanes (m). */
const MOWER_SPEED = 0.45;
const LANE = 0.32;

let dot: CanvasTexture | null = null;
/** A soft round dot for the particles. */
function dotTexture(): CanvasTexture {
    if (dot) {
        return dot;
    }
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
    dot = new CanvasTexture(c);
    return dot;
}

let puff: CanvasTexture | null = null;
/** A soft cloudy puff for smoke: no edge, a few lumps inside. */
function puffTexture(): CanvasTexture {
    if (puff) {
        return puff;
    }
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    for (const [x, y, r, a] of [[32, 32, 31, 0.9]]) {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(0.35, `rgba(255,255,255,${a * 0.55})`);
        gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.15})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
    }
    puff = new CanvasTexture(c);
    return puff;
}

/** Where n puffs stand in a room (x, z pairs), also in an L-shaped one: the same for the same room. */
function scatter(points: Vec2[], n: number): Float32Array {
    const xs = points.map(q => q[0]);
    const zs = points.map(q => q[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    const base = new Float32Array(n * 2);
    let seed = 7;
    const rnd = (): number => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let i = 0; i < n; i++) {
        let x = (x0 + x1) / 2;
        let z = (z0 + z1) / 2;
        for (let k = 0; k < 12; k++) {
            const cx = x0 + 0.2 + (x1 - x0 - 0.4) * rnd();
            const cz = z0 + 0.2 + (z1 - z0 - 0.4) * rnd();
            if (pointIn([cx, cz], points)) {
                x = cx;
                z = cz;
                break;
            }
        }
        base[i * 2] = x;
        base[i * 2 + 1] = z;
    }
    return base;
}

let mould: CanvasTexture | null = null;
/** Dark spots, dense at the corner (u = 0) and near floor and ceiling, thinning out along the wall. */
function mouldTexture(): CanvasTexture {
    if (mould) {
        return mould;
    }
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d')!;
    let seed = 7;
    const rnd = (): number => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let i = 0; i < 900; i++) {
        const u = Math.pow(rnd(), 2.2);
        // more at the top and the bottom of the wall
        const v0 = rnd();
        const v = v0 < 0.5 ? Math.pow(v0 * 2, 2.5) / 2 : 1 - Math.pow((1 - v0) * 2, 2.5) / 2;
        const edge = Math.min(v, 1 - v);
        if (rnd() < edge * 1.4 + u * 0.6) {
            continue;
        }
        const r = 1.5 + rnd() * 6 * (1 - u);
        g.fillStyle = `rgba(${30 + rnd() * 25},${38 + rnd() * 22},${28 + rnd() * 14},${(0.25 + rnd() * 0.5) * (1 - u)})`;
        g.beginPath();
        g.arc(u * 128, v * 256, r, 0, Math.PI * 2);
        g.fill();
    }
    mould = new CanvasTexture(c);
    mould.colorSpace = SRGBColorSpace;
    return mould;
}

/** A flat shape of a polygon at height 0 (x, z), with its uv from the bounding box. */
function flatShape(points: readonly Vec2[]): ShapeGeometry {
    const shape = new Shape(points.map(([x, z]) => new Vector2(x, z)));
    const geo = new ShapeGeometry(shape);
    const xs = points.map(p => p[0]);
    const zs = points.map(p => p[1]);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const w = Math.max(0.01, Math.max(...xs) - minX);
    const d = Math.max(0.01, Math.max(...zs) - minZ);
    const pos = geo.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (pos.getX(i) - minX) / w;
        uv[i * 2 + 1] = 1 - (pos.getY(i) - minZ) / d;
    }
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    // (x, y, 0) → (x, 0, y)
    geo.rotateX(Math.PI / 2);
    return geo;
}

interface Particles {
    points: Points;
    pos: Float32Array;
    col: Float32Array;
    seeds: Float32Array;
}

/**
 * Points of `size` m that stay at least `minPx` CSS pixels big from afar (else a window's air or a shower's water
 * would vanish in the overview).
 */
function particles(n: number, size: number, minPx = 3, map: CanvasTexture = dotTexture()): Particles {
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 4);
    // BufferAttribute keeps the arrays (Float32BufferAttribute would copy them): the frames write into them
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 4));
    const mat = new PointsMaterial({
        size,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        map,
    });
    const min = (minPx * (globalThis.devicePixelRatio || 1)).toFixed(1);
    mat.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <fog_vertex>',
            `gl_PointSize = max(gl_PointSize, ${min});\n#include <fog_vertex>`,
        );
    };
    mat.customProgramCacheKey = () => `fp3dMinPx${min}`;
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    const seeds = new Float32Array(n * 3);
    let s = 1;
    for (let i = 0; i < seeds.length; i++) {
        s = (s * 16807) % 2147483647;
        seeds[i] = s / 2147483647;
    }
    return { points, pos, col, seeds };
}

function flush(p: Particles): void {
    const geo = p.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
}

function part(group: Object3D, geo: BufferGeometry, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    group.add(m);
    return m;
}

/** A robot mower: grey body, orange cover, two big wheels at the back; its front is local -z. */
function buildMower(size: number): Group {
    const g = new Group();
    const k = Math.max(0.3, size) / 0.6;
    part(g, new BoxGeometry(0.42 * k, 0.1 * k, 0.6 * k).translate(0, 0.09 * k, 0), 0x3a3f44);
    part(g, new BoxGeometry(0.36 * k, 0.07 * k, 0.46 * k).translate(0, 0.17 * k, -0.02 * k), 0xe8731d);
    part(g, new BoxGeometry(0.12 * k, 0.03 * k, 0.1 * k).translate(0, 0.22 * k, 0.1 * k), 0x23272b);
    for (const side of [-1, 1]) {
        part(
            g,
            new CylinderGeometry(0.1 * k, 0.1 * k, 0.05 * k, 16)
                .rotateZ(Math.PI / 2)
                .translate(side * 0.23 * k, 0.1 * k, 0.17 * k),
            0x15181b,
        );
    }
    part(
        g,
        new CylinderGeometry(0.035 * k, 0.035 * k, 0.03 * k, 10)
            .rotateZ(Math.PI / 2)
            .translate(0, 0.035 * k, -0.25 * k),
        0x15181b,
    );
    return g;
}

/** The charging station: a plate and the post with the contacts at its back (local +z). */
function buildDock(size: number): Group {
    const g = new Group();
    const k = Math.max(0.3, size) / 0.6;
    part(g, new BoxGeometry(0.52 * k, 0.025 * k, 0.75 * k).translate(0, 0.012 * k, 0), 0x2b2f33);
    part(g, new BoxGeometry(0.5 * k, 0.22 * k, 0.1 * k).translate(0, 0.11 * k, 0.37 * k), 0x3a3f44);
    part(g, new BoxGeometry(0.12 * k, 0.03 * k, 0.01 * k).translate(0, 0.15 * k, 0.315 * k), 0x7ed957);
    return g;
}

/** A plan direction (unit) as the y rotation that turns local -z to it. */
const yaw = (dx: number, dz: number): number => -Math.atan2(dx, -dz);

interface MowerRun {
    path: Vec2[];
    total: number;
    d: number;
    pos: Vec2;
    heading: Vec2;
    lawnKey: string;
    lastPaint: Vec2 | null;
    lane: number;
}

interface LawnPaint {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    tex: CanvasTexture;
    minX: number;
    minZ: number;
    scale: number;
    key: string;
    faded: number;
}

/** Everything of the home looks: built anew when what stands changes, moved every frame. */
export class HomeFx {
    readonly group = new Group();
    private scene: HomeScene = EMPTY_HOME;
    private light = false;
    private sig = '';
    private floors = new Map<string, Group>();
    private airs = new Map<string, Particles>();
    private streams = new Map<string, Particles>();
    private sprays = new Map<string, Particles>();
    private rings = new Map<string, Mesh[]>();
    private floodMeshes = new Map<string, Mesh>();
    private mowerMeshes = new Map<string, Group>();
    private runs = new Map<string, MowerRun>();
    private paints = new Map<string, LawnPaint>();
    private carMeshes = new Map<string, { car: Group; bay: Group | null }>();
    /** Smoke: its particles and where each one stands in the room (x, z). */
    private smokeParts = new Map<string, { p: Particles; base: Float32Array }>();
    /** Stale air: its particles and where each one stands in the room (x, z). */
    private hazeParts = new Map<string, { p: Particles; base: Float32Array }>();
    /** Steam over a coffee machine's cup: its particles and where the cup is. */
    /** The LEDs of each server and the colour each shows now. */
    /** The arm of each mailbox's flag and how far up it stands (0 … 1); kept over a rebuild. */
    private mailFlags = new Map<string, { arm: Object3D; cur: number }>();
    private serverLeds = new Map<string, { leds: ServerLed[]; lit: number[] }>();
    private steamParts = new Map<
        string,
        { p: Particles; at: Vector3; fwd: Vector3; out: number; stream: Object3D | null }
    >();
    /** How far each car stood out of its place in the last frame (m): its wheels roll by the difference. */
    private carOut = new Map<string, number>();
    /** How far each car is in its place (0 away … 1 parked); kept across rebuilds. */
    private carIn = new Map<string, number>();
    /** The badges with a tip, for the pointer. */
    private tips: Sprite[] = [];
    private ray = new Raycaster();

    constructor() {
        this.group.name = 'fp3dHome';
    }

    set(scene: HomeScene, light: boolean): void {
        this.scene = scene;
        this.light = light;
    }

    /**
     * The piece of furniture drawn here (a car, a mower and its dock, a sprinkler, a coffee machine, a rainwater tank,
     * a server, a mailbox's flag) under a ray: its id and how far
     * away it is; null: none, or only hidden ones.
     */
    furnitureAt(ray: Raycaster): { id: string; distance: number } | null {
        for (const hit of ray.intersectObject(this.group, true)) {
            let id: unknown;
            let shown = true;
            for (let o: Object3D | null = hit.object; o; o = o.parent) {
                shown &&= o.visible;
                id ??= o.userData.fp3dFurniture;
            }
            if (shown && typeof id === 'string') {
                return { id, distance: hit.distance };
            }
        }
        return null;
    }

    /** The tip of the badge at a point of the view (-1 … 1 both ways), null: none there. */
    tipAt(x: number, y: number, camera: Camera): string | null {
        const shown = this.tips.filter(s => {
            for (let o: Object3D | null = s; o; o = o.parent) {
                if (!o.visible) {
                    return false;
                }
            }
            return true;
        });
        if (!shown.length) {
            return null;
        }
        this.ray.setFromCamera(new Vector2(x, y), camera);
        const hit = this.ray.intersectObjects(shown, false)[0];
        return hit ? String(hit.object.userData.fp3dTip ?? '') || null : null;
    }

    private floorGroup(id: string): Group {
        let g = this.floors.get(id);
        if (!g) {
            g = new Group();
            g.userData.fp3dFloor = id;
            this.floors.set(id, g);
            this.group.add(g);
        }
        return g;
    }

    /** Builds the parts again when the scene's shape changed (not its animated values). */
    private rebuild(): void {
        const s = this.scene;
        const sig = JSON.stringify([
            s.airs.map(a => [a.id, a.floor]),
            s.moulds,
            s.floods.map(f => [f.id, f.floor, f.points]),
            s.sounds.map(x => [x.id, x.floor, x.kind]),
            s.streams.map(x => [x.id, x.floor]),
            s.sprinklers.map(x => [x.id, x.floor, x.x, x.z, x.y]),
            s.lawns.map(l => [l.id, l.floor, l.points, l.y, Math.round(l.dry * 20), l.mown]),
            s.mowers.map(m => [m.id, m.floor, m.dock, m.dockAngle, m.size, m.y, m.label, m.lawn]),
            s.badges,
            s.cars.map(c => [
                c.id,
                c.floor,
                c.kind,
                c.x,
                c.z,
                c.y,
                c.angle,
                c.w,
                c.d,
                c.h,
                c.color,
                c.plate ?? null,
                c.sensed,
            ]),
            (s.smokes ?? []).map(x => [x.id, x.floor, x.points, x.top]),
            (s.hazes ?? []).map(x => [x.id, x.floor, x.points, x.top, x.label]),
            (s.coffees ?? []).map(c => [c.id, c.floor, c.x, c.z, c.y, c.angle, c.w, c.d, c.h]),
            (s.servers ?? []).map(v => [v.id, v.floor, v.kind, v.x, v.z, v.y, v.angle, v.w, v.d, v.h]),
            (s.parcels ?? []).map(v => [v.id, v.floor, v.x, v.z, v.y, v.angle, v.label]),
            (s.mailFlags ?? []).map(v => [v.id, v.floor, v.shape, v.x, v.z, v.y, v.angle, v.w, v.d, v.h]),
            (s.rainTanks ?? []).map(r => [
                r.id,
                r.floor,
                r.kind,
                r.x,
                r.z,
                r.y,
                r.angle,
                r.w,
                r.d,
                r.h,
                r.fill === null ? null : Math.round(r.fill * 200),
                r.label,
                r.warn,
            ]),
            s.glow,
            this.light,
        ]);
        if (sig === this.sig) {
            return;
        }
        this.sig = sig;
        this.clear(false);
        for (const a of s.airs) {
            const p = particles(40, 0.11, 4);
            this.floorGroup(a.floor).add(p.points);
            this.airs.set(a.id, p);
        }
        for (const sm of s.smokes ?? []) {
            const n = 110;
            const p = particles(n, 3.6, 30, puffTexture());
            this.floorGroup(sm.floor).add(p.points);
            this.smokeParts.set(sm.id, { p, base: scatter(sm.points, n) });
        }
        for (const hz of s.hazes ?? []) {
            const n = 70;
            const p = particles(n, 3.2, 26, puffTexture());
            this.floorGroup(hz.floor).add(p.points);
            this.hazeParts.set(hz.id, { p, base: scatter(hz.points, n) });
            if (hz.label) {
                const l = labelSprite(hz.label, this.light, hz.level >= 0.5 ? 'warn' : null, 0.024);
                l.position.set(hz.cx, hz.top + 0.3, hz.cz);
                this.floorGroup(hz.floor).add(l);
            }
        }
        for (const r of s.rainTanks ?? []) {
            const m = buildRainTank(r.kind, r.w, r.d, r.h, r.fill, this.light);
            m.userData.fp3dFurniture = r.id;
            m.position.set(r.x, r.y, r.z);
            m.rotation.y = -r.angle;
            if (r.label) {
                const label = labelSprite(r.label, this.light, r.warn ? 'warn' : null, 0.026);
                label.position.set(0, (r.kind === 'barrel' ? r.h : 0) + 0.4, 0);
                m.add(label);
            }
            this.floorGroup(r.floor).add(m);
        }
        for (const v of s.parcels ?? []) {
            const m = buildParcel(this.light);
            m.position.set(v.x, v.y, v.z);
            m.rotation.y = -v.angle;
            const l = labelSprite(v.label, this.light, null, 0.024);
            l.position.set(0, 0.75, 0);
            m.add(l);
            this.floorGroup(v.floor).add(m);
        }
        for (const v of s.mailFlags ?? []) {
            const m = buildMailFlag(v.shape, v.w, v.d, v.h, this.light);
            m.userData.fp3dFurniture = v.id;
            m.position.set(v.x, v.y, v.z);
            m.rotation.y = -v.angle;
            this.floorGroup(v.floor).add(m);
            // a rebuild keeps where the flag stood, so it does not swing again
            const was = this.mailFlags.get(v.id)?.cur;
            const cur = was ?? (v.up ? 1 : 0);
            this.mailFlags.set(v.id, { arm: m.userData.arm as Object3D, cur });
            (m.userData.arm as Object3D).rotation.x = FLAG_DOWN * (1 - cur);
        }
        for (const v of s.servers ?? []) {
            const m = buildServer(v.kind, v.w, v.d, v.h, this.light);
            m.userData.fp3dFurniture = v.id;
            m.position.set(v.x, v.y, v.z);
            m.rotation.y = -v.angle;
            this.floorGroup(v.floor).add(m);
            this.serverLeds.set(v.id, { leds: m.userData.leds as ServerLed[], lit: [] });
        }
        for (const c of s.coffees ?? []) {
            const m = buildCoffeeMachine(c.w, c.d, c.h, this.light);
            m.userData.fp3dFurniture = c.id;
            m.position.set(c.x, c.y, c.z);
            m.rotation.y = -c.angle;
            this.floorGroup(c.floor).add(m);
            const [cx, cy, cz] = m.userData.cupTop as [number, number, number];
            const up = new Vector3(0, 1, 0);
            const at = new Vector3(cx, cy, cz).applyAxisAngle(up, -c.angle).add(m.position);
            const fwd = new Vector3(0, 0, 1).applyAxisAngle(up, -c.angle);
            const p = particles(36, 0.11, 3, puffTexture());
            this.floorGroup(c.floor).add(p.points);
            this.steamParts.set(c.id, {
                p,
                at,
                fwd,
                out: (m.userData.headFront as number) + 0.03,
                stream: m.getObjectByName('fp3dCoffeeStream') ?? null,
            });
        }
        for (const st of s.streams) {
            const p = particles(32, 0.05, 2.5);
            this.floorGroup(st.floor).add(p.points);
            this.streams.set(st.id, p);
        }
        for (const sp of s.sprinklers) {
            const g = this.floorGroup(sp.floor);
            const head = part(
                g,
                new CylinderGeometry(0.035, 0.045, 0.06, 10).translate(sp.x, sp.y + 0.03, sp.z),
                0x2f4a2f,
            );
            head.userData.fp3dStatic = true;
            head.userData.fp3dFurniture = sp.id;
            const p = particles(170, 0.07, 2.5);
            g.add(p.points);
            this.sprays.set(sp.id, p);
        }
        for (const so of s.sounds) {
            const list: Mesh[] = [];
            for (let k = 0; k < 3; k++) {
                const m = new Mesh(
                    new RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2),
                    new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }),
                );
                m.position.set(so.x, so.y, so.z);
                this.floorGroup(so.floor).add(m);
                list.push(m);
            }
            this.rings.set(so.id, list);
        }
        for (const f of s.floods) {
            if (f.points.length < 3) {
                continue;
            }
            const m = new Mesh(
                flatShape(f.points),
                new MeshBasicMaterial({
                    color: new Color(0.22, 0.52, 0.95),
                    transparent: true,
                    opacity: 0.42,
                    depthWrite: false,
                    side: DoubleSide,
                }),
            );
            this.floorGroup(f.floor).add(m);
            this.floodMeshes.set(f.id, m);
        }
        for (const m of s.moulds) {
            const g = this.floorGroup(m.floor);
            const tex = mouldTexture();
            const W = Math.min(0.9, Math.max(0.4, m.height * 0.3));
            for (const c of m.corners) {
                for (const [along, other] of [
                    [c.a, c.b],
                    [c.b, c.a],
                ] as const) {
                    // into the room from this wall: the part of the other wall's direction across this one
                    const dotp = other[0] * along[0] + other[1] * along[1];
                    let nx = other[0] - dotp * along[0];
                    let nz = other[1] - dotp * along[1];
                    const nl = Math.hypot(nx, nz) || 1;
                    nx /= nl;
                    nz /= nl;
                    const geo = new PlaneGeometry(W, m.height);
                    geo.applyMatrix4(
                        new Matrix4().makeBasis(
                            new Vector3(along[0], 0, along[1]),
                            new Vector3(0, 1, 0),
                            new Vector3(nx, 0, nz),
                        ),
                    );
                    geo.translate(
                        c.x + along[0] * (W / 2) + nx * 0.015,
                        m.height / 2,
                        c.z + along[1] * (W / 2) + nz * 0.015,
                    );
                    const mesh = new Mesh(
                        geo,
                        new MeshBasicMaterial({
                            map: tex,
                            transparent: true,
                            opacity: m.level >= 2 ? 0.85 : 0.45,
                            depthWrite: false,
                            side: DoubleSide,
                        }),
                    );
                    mesh.userData.fp3dStatic = true;
                    g.add(mesh);
                }
            }
            if (m.label) {
                const l = labelSprite(m.label, this.light, m.level >= 2 ? 'warn' : null, 0.024);
                l.position.set(m.cx, m.height + 0.3, m.cz);
                g.add(l);
            }
        }
        for (const b of s.badges) {
            const l = labelSprite(b.text, this.light, b.tone, 0.022);
            l.position.set(b.x, b.y + 0.45, b.z);
            if (b.tip) {
                l.userData.fp3dTip = b.tip;
                this.tips.push(l);
            }
            this.floorGroup(b.floor).add(l);
        }
        for (const l of s.lawns) {
            if (l.points.length < 3) {
                continue;
            }
            const g = this.floorGroup(l.floor);
            if (l.dry > 0.05) {
                const m = new Mesh(
                    flatShape(l.points),
                    new MeshBasicMaterial({
                        color: new Color(0.78, 0.65, 0.3),
                        transparent: true,
                        opacity: 0.6 * l.dry,
                        depthWrite: false,
                        side: DoubleSide,
                    }),
                );
                m.position.y = l.y + 0.018;
                m.renderOrder = 1;
                g.add(m);
            }
            if (l.mown) {
                const paint = this.paintOf(l);
                const m = new Mesh(
                    flatShape(l.points),
                    new MeshBasicMaterial({ map: paint.tex, transparent: true, depthWrite: false, side: DoubleSide }),
                );
                m.position.y = l.y + 0.022;
                m.renderOrder = 2;
                g.add(m);
            }
        }
        for (const mo of s.mowers) {
            const g = this.floorGroup(mo.floor);
            const dock = buildDock(mo.size);
            dock.position.set(mo.dock[0], mo.y, mo.dock[1]);
            dock.rotation.y = -mo.dockAngle;
            dock.userData.fp3dFurniture = mo.id;
            g.add(dock);
            const mesh = buildMower(mo.size);
            mesh.userData.fp3dFurniture = mo.id;
            if (mo.label) {
                const l = labelSprite(mo.label, this.light, 'alarm', 0.022);
                l.position.set(0, 0.6, 0);
                mesh.add(l);
            }
            g.add(mesh);
            this.mowerMeshes.set(mo.id, mesh);
        }
        for (const c of s.cars) {
            const g = this.floorGroup(c.floor);
            const car = buildCar(c.kind, c.w, c.d, c.h, c.color, c.plate);
            car.userData.fp3dFurniture = c.id;
            g.add(car);
            let bay: Group | null = null;
            if (c.sensed) {
                bay = buildBay(c.w, c.d);
                bay.position.set(c.x, c.y, c.z);
                bay.rotation.y = -c.angle;
                g.add(bay);
            }
            this.carMeshes.set(c.id, { car, bay });
            // a car seen for the first time stands where it is (no drive on opening the page)
            if (!this.carIn.has(c.id)) {
                this.carIn.set(c.id, c.present ? 1 : 0);
            }
        }
        if (s.glow && s.glow.points.length >= 3) {
            const m = glowRibbon(s.glow.points, s.glow.color);
            m.position.y = s.glow.y + 0.03;
            this.floorGroup(s.glow.floor).add(m);
        }
    }

    /** The canvas a mower paints its stripes on (kept while the lawn stays the same). */
    private paintOf(l: LawnState): LawnPaint {
        const key = JSON.stringify(l.points);
        const old = this.paints.get(l.id);
        if (old && old.key === key) {
            return old;
        }
        old?.tex.dispose();
        const xs = l.points.map(p => p[0]);
        const zs = l.points.map(p => p[1]);
        const minX = Math.min(...xs);
        const minZ = Math.min(...zs);
        const w = Math.max(0.5, Math.max(...xs) - minX);
        const d = Math.max(0.5, Math.max(...zs) - minZ);
        const scale = Math.min(40, 1024 / Math.max(w, d));
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(w * scale);
        canvas.height = Math.ceil(d * scale);
        const ctx = canvas.getContext('2d')!;
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        const p: LawnPaint = { canvas, ctx, tex, minX, minZ, scale, key, faded: 0 };
        this.paints.set(l.id, p);
        return p;
    }

    /** Frees everything (and the mowers' state with `all`). */
    clear(all: boolean): void {
        for (const g of this.floors.values()) {
            g.traverse(o => {
                const m = o as Mesh;
                if (!(o instanceof Sprite) && m.geometry) {
                    m.geometry.dispose();
                }
                const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
                for (const mat of mats) {
                    const map = (mat as MeshBasicMaterial).map;
                    // the shared textures stay
                    if (
                        map &&
                        map !== dot &&
                        map !== puff &&
                        map !== mould &&
                        !map.userData.fp3dShared &&
                        ![...this.paints.values()].some(p => p.tex === map)
                    ) {
                        map.dispose();
                    }
                    mat.dispose();
                }
            });
            this.group.remove(g);
        }
        this.floors.clear();
        this.airs.clear();
        this.streams.clear();
        this.sprays.clear();
        this.rings.clear();
        this.floodMeshes.clear();
        this.mowerMeshes.clear();
        this.carMeshes.clear();
        this.smokeParts.clear();
        this.hazeParts.clear();
        this.steamParts.clear();
        this.serverLeds.clear();
        this.tips = [];
        if (all) {
            this.carIn.clear();
            for (const p of this.paints.values()) {
                p.tex.dispose();
            }
            this.paints.clear();
            this.runs.clear();
            this.sig = '';
        }
    }

    /**
     * Moves everything for time `t` (s, `dt` since the last frame); `calm`: air and water stand still (a weak device,
     * reduced motion). Returns whether something moves (frames must keep coming).
     */
    frame(t: number, dt: number, places: ReadonlyMap<string, FloorPlace>, calm: boolean): boolean {
        this.rebuild();
        const s = this.scene;
        for (const [id, g] of this.floors) {
            const p = places.get(id);
            g.visible = !!p?.visible;
            g.position.y = p?.y ?? 0;
        }
        let moving = false;
        // calm (a weak device, reduced motion): the air and the water stand still, as a picture of how they flow
        const tt = calm ? 1.7 : t;
        const shown = (floor: string): boolean => !!places.get(floor)?.visible;
        for (const a of s.airs) {
            const p = this.airs.get(a.id);
            if (!p) {
                continue;
            }
            if (!shown(a.floor)) {
                continue;
            }
            moving ||= !calm;
            this.air(p, a, tt);
        }
        for (const st of s.streams) {
            const p = this.streams.get(st.id);
            if (!p) {
                continue;
            }
            if (!shown(st.floor)) {
                continue;
            }
            moving ||= !calm;
            stream(p, st, tt);
        }
        for (const sp of s.sprinklers) {
            const p = this.sprays.get(sp.id);
            if (!p) {
                continue;
            }
            p.points.visible = sp.on;
            if (!sp.on || !shown(sp.floor)) {
                continue;
            }
            moving ||= !calm;
            spray(p, sp, tt);
        }
        for (const so of s.sounds) {
            const list = this.rings.get(so.id);
            if (!list) {
                continue;
            }
            const color = so.kind === 'music' ? new Color(0.45, 0.78, 1) : new Color(1, 0.85 - 0.6 * so.level, 0.25);
            list.forEach((m, k) => {
                const ph = calm ? 0.35 + k * 0.2 : (t * 0.55 + k / 3) % 1;
                const r = 0.25 + ph * (0.5 + 1.6 * so.level);
                m.scale.set(r, 1, r);
                const mat = m.material as MeshBasicMaterial;
                mat.color.copy(color);
                mat.opacity = (1 - ph) * (0.25 + 0.5 * so.level);
            });
            if (!calm && shown(so.floor)) {
                moving = true;
            }
        }
        for (const f of s.floods) {
            const m = this.floodMeshes.get(f.id);
            if (!m) {
                continue;
            }
            m.position.y = f.level + (calm ? 0 : 0.004 * Math.sin(t * 1.7));
            (m.material as MeshBasicMaterial).opacity = 0.38 + (calm ? 0 : 0.06 * Math.sin(t * 2.3));
            if (!calm && shown(f.floor)) {
                moving = true;
            }
        }
        for (const sm of s.smokes ?? []) {
            const e = this.smokeParts.get(sm.id);
            if (!e || !shown(sm.floor)) {
                continue;
            }
            moving ||= !calm;
            this.smoke(e.p, e.base, sm, tt);
        }
        for (const hz of s.hazes ?? []) {
            const e = this.hazeParts.get(hz.id);
            if (!e || !shown(hz.floor)) {
                continue;
            }
            moving ||= !calm;
            this.haze(e.p, e.base, hz, tt);
        }
        for (const v of s.mailFlags ?? []) {
            const e = this.mailFlags.get(v.id);
            if (!e) {
                continue;
            }
            const goal = v.up ? 1 : 0;
            if (e.cur === goal) {
                continue;
            }
            // it swings in about a second; calm: at once
            e.cur =
                calm || !shown(v.floor)
                    ? goal
                    : goal > e.cur
                      ? Math.min(goal, e.cur + dt * 1.2)
                      : Math.max(goal, e.cur - dt * 1.2);
            const k = e.cur * e.cur * (3 - 2 * e.cur);
            e.arm.rotation.x = FLAG_DOWN * (1 - k);
            moving ||= e.cur !== goal;
        }
        for (const v of s.servers ?? []) {
            const e = this.serverLeds.get(v.id);
            if (!e || !shown(v.floor)) {
                continue;
            }
            // calm: the LEDs stand as they are lit at rest (power on, the drives dark, the ports lit)
            if (!calm && (v.load.on || v.load.unknown)) {
                moving = true;
            }
            const lt = calm ? 0 : t;
            e.leds.forEach((l, k) => {
                const lit = calm && v.load.on ? l.role !== 'act' : ledLit(l.role, l.seed, v.load, lt);
                const color = lit ? ledColor(l.role, v.load.unknown) : LED_OFF;
                if (e.lit[k] !== color) {
                    e.lit[k] = color;
                    (l.mesh.material as MeshBasicMaterial).color.setHex(color);
                }
            });
        }
        for (const c of s.coffees ?? []) {
            const e = this.steamParts.get(c.id);
            if (!e) {
                continue;
            }
            e.p.points.visible = c.brewing;
            if (e.stream) {
                e.stream.visible = c.brewing;
            }
            if (!c.brewing || !shown(c.floor)) {
                continue;
            }
            moving ||= !calm;
            this.steam(e.p, e.at, e.fwd, e.out, tt);
        }
        for (const c of s.cars) {
            if (this.car(c, dt, calm)) {
                moving = true;
            }
        }
        for (const mo of s.mowers) {
            const mesh = this.mowerMeshes.get(mo.id);
            if (!mesh) {
                continue;
            }
            if (this.mower(mo, mesh, dt)) {
                moving = true;
            }
        }
        return moving;
    }

    /** Smoke under the ceiling: a layer that thickens downwards with the level, slowly rolling. */
    private smoke(p: Particles, base: Float32Array, sm: SmokeState, t: number): void {
        const n = p.pos.length / 3;
        const thick = 0.3 + sm.level * sm.top * 0.7;
        const c: Rgb = this.light ? [0.3, 0.3, 0.32] : [0.7, 0.7, 0.74];
        for (let i = 0; i < n; i++) {
            const a = p.seeds[i * 3];
            const b = p.seeds[i * 3 + 1];
            const ph = p.seeds[i * 3 + 2];
            const x = base[i * 2] + 0.3 * Math.sin(t * 0.19 + ph * 6.3) * (0.5 + a);
            const z = base[i * 2 + 1] + 0.3 * Math.cos(t * 0.15 + a * 6.3) * (0.5 + ph);
            const y = sm.top - 0.15 - thick * Math.pow(b, 0.8) + 0.06 * Math.sin(t * 0.45 + ph * 9);
            p.pos.set([x, Math.max(0.1, y), z], i * 3);
            // on a light ground grey smoke needs more cover to be seen
            const alpha =
                (0.22 + 0.3 * sm.level) *
                (this.light ? 1.9 : 1) *
                (0.75 + 0.25 * Math.sin(t * 0.35 + a * 12)) *
                (1 - 0.4 * b);
            p.col.set([c[0], c[1], c[2], alpha], i * 4);
        }
        flush(p);
    }

    /** Stale air: a faint, slowly drifting haze through the whole height of the room, denser with more CO₂. */
    private haze(p: Particles, base: Float32Array, hz: HazeState, t: number): void {
        const n = p.pos.length / 3;
        const c: Rgb = this.light ? [0.46, 0.42, 0.3] : [0.82, 0.77, 0.58];
        for (let i = 0; i < n; i++) {
            const a = p.seeds[i * 3];
            const b = p.seeds[i * 3 + 1];
            const ph = p.seeds[i * 3 + 2];
            const x = base[i * 2] + 0.25 * Math.sin(t * 0.11 + ph * 6.3) * (0.5 + a);
            const z = base[i * 2 + 1] + 0.25 * Math.cos(t * 0.09 + a * 6.3) * (0.5 + ph);
            const y = 0.35 + (hz.top - 0.7) * b + 0.08 * Math.sin(t * 0.3 + ph * 9);
            p.pos.set([x, y, z], i * 3);
            const alpha = (0.06 + 0.26 * hz.level) * (this.light ? 2 : 1.2) * (0.7 + 0.3 * Math.sin(t * 0.25 + a * 12));
            p.col.set([c[0], c[1], c[2], alpha], i * 4);
        }
        flush(p);
    }

    /** Steam from a cup: wisps that drift out from under the machine's head, rise, sway, widen and fade. */
    private steam(p: Particles, at: Vector3, fwd: Vector3, out: number, t: number): void {
        const n = p.pos.length / 3;
        const c: Rgb = this.light ? [0.97, 0.97, 0.98] : [0.86, 0.92, 1];
        for (let i = 0; i < n; i++) {
            const u = p.seeds[i * 3] - 0.5;
            const v = p.seeds[i * 3 + 1] - 0.5;
            const ph = p.seeds[i * 3 + 2];
            const s = (t * 0.42 + ph) % 1;
            const sway = Math.sin(t * 1.4 + ph * 7 + s * 4) * 0.025 * s;
            // out first, then up
            const o = out * Math.min(1, s * 2.6);
            const x = at.x + fwd.x * o + u * (0.02 + 0.08 * s) + sway;
            const z = at.z + fwd.z * o + v * (0.02 + 0.08 * s) + sway * 0.6;
            const y = at.y + 0.005 + 0.05 * Math.min(1, s * 2.6) + Math.max(0, s - 0.38) * 0.55;
            p.pos.set([x, y, z], i * 3);
            const alpha = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.3)), 1.3) * (1 - s) * 0.95;
            p.col.set([c[0], c[1], c[2], alpha], i * 4);
        }
        flush(p);
    }

    private air(p: Particles, a: AirState, t: number): void {
        const n = p.pos.length / 3;
        const ax = -a.nz;
        const az = a.nx;
        const strong = Math.abs(a.flow) >= 0.15;
        const cool: Rgb = this.light ? [0.2, 0.5, 0.95] : [0.7, 0.88, 1];
        const warm: Rgb = [1, 0.42, 0.18];
        const plain: Rgb = this.light ? [0.35, 0.55, 0.8] : [0.88, 0.94, 1];
        for (let i = 0; i < n; i++) {
            const u = p.seeds[i * 3] - 0.5;
            const v = p.seeds[i * 3 + 1];
            const ph = p.seeds[i * 3 + 2];
            // into the room (+1) or out (-1), and how fast
            let dir: number;
            let speed: number;
            if (strong) {
                dir = Math.sign(a.flow);
                speed = Math.min(1.2, Math.max(0.3, Math.abs(a.flow)));
            } else {
                dir = v < 0.5 ? 1 : -1;
                speed = 0.22;
            }
            const s = (t * speed * 0.6 + ph) % 1;
            const along = (s - 0.5) * 1.6 * dir;
            // the outward normal points out: into the room is -n
            const x = a.x + ax * u * a.w * 0.9 - a.nx * along;
            const z = a.z + az * u * a.w * 0.9 - a.nz * along;
            const y = a.y0 + (0.08 + 0.84 * v) * a.h + Math.sin(t * 2 + ph * 9) * 0.02;
            p.pos.set([x, y, z], i * 3);
            const c = dir < 0 ? (a.heat ? warm : plain) : a.heat ? cool : strong ? cool : plain;
            const alpha = Math.sin(Math.PI * s) * (a.heat && dir < 0 ? 0.95 : 0.7);
            p.col.set([c[0], c[1], c[2], alpha], i * 4);
        }
        flush(p);
    }

    /** Parks a car or takes it away: it drives backwards along its length (about 2 s); calm: at once. */
    private car(c: CarState, dt: number, calm: boolean): boolean {
        const m = this.carMeshes.get(c.id);
        if (!m) {
            return false;
        }
        const target = c.present ? 1 : 0;
        let k = this.carIn.get(c.id) ?? target;
        k = calm ? target : k < target ? Math.min(target, k + dt / 2.2) : Math.max(target, k - dt / 2.2);
        this.carIn.set(c.id, k);
        // eased: it slows down into its place and speeds up when it leaves
        const out = (1 - k) * (1 - k) * Math.max(4, c.d * 1.2);
        // backwards: local +z turned by the plan angle (clockwise)
        const bx = -Math.sin(c.angle);
        const bz = Math.cos(c.angle);
        m.car.position.set(c.x + bx * out, c.y, c.z + bz * out);
        m.car.rotation.y = -c.angle;
        m.car.visible = k > 0.001;
        // the wheels roll with the way it drove (backwards along local +z)
        const moved = out - (this.carOut.get(c.id) ?? out);
        this.carOut.set(c.id, out);
        const fade = Math.min(1, k * 4);
        m.car.traverse(o => {
            if (moved && o.name === WHEEL) {
                o.rotation.x += moved / ((o.userData.fp3dR as number) || 0.3);
            }
            const mat = (o as Mesh).material as MeshBasicMaterial | undefined;
            if (mat) {
                mat.opacity = fade;
                // the shadow under it never writes depth
                mat.depthWrite = fade >= 1 && !o.userData.fp3dFlat;
            }
        });
        if (m.bay) {
            m.bay.visible = k < 0.999;
        }
        return k !== target;
    }

    /** Drives a mower: its lanes while it mows, home when it returns; paints the stripes behind it. */
    private mower(mo: MowerState, mesh: Group, dt: number): boolean {
        const lawn = mo.lawn ? this.scene.lawns.find(l => l.id === mo.lawn) : undefined;
        const key = lawn ? JSON.stringify(lawn.points) : '';
        let run = this.runs.get(mo.id);
        if (!run || run.lawnKey !== key) {
            // the lanes run along the lawn's longest side
            let angle = 0;
            if (lawn) {
                let best = 0;
                for (let i = 0; i < lawn.points.length; i++) {
                    const a = lawn.points[i];
                    const b = lawn.points[(i + 1) % lawn.points.length];
                    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    if (l > best) {
                        best = l;
                        angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
                    }
                }
            }
            const path = lawn ? lanes(lawn.points, LANE, angle) : [];
            run = {
                path,
                total: pathLength(path),
                d: run?.d ?? 0,
                pos: run?.pos ?? [mo.dock[0], mo.dock[1]],
                heading: run?.heading ?? [Math.sin(mo.dockAngle), -Math.cos(mo.dockAngle)],
                lawnKey: key,
                lastPaint: null,
                lane: 0,
            };
            this.runs.set(mo.id, run);
        }
        const r = run;
        const step = MOWER_SPEED * Math.min(dt, 0.25);
        const goTo = (target: Vec2): boolean => {
            const dx = target[0] - r.pos[0];
            const dz = target[1] - r.pos[1];
            const l = Math.hypot(dx, dz);
            if (l < 0.02) {
                return true;
            }
            const k = Math.min(1, step / l);
            r.pos = [r.pos[0] + dx * k, r.pos[1] + dz * k];
            r.heading = [dx / l, dz / l];
            return l <= step;
        };
        let moving = false;
        if (mo.phase === 'mowing' && run.total > 0) {
            const at = pointAt(run.path, run.d);
            const off = Math.hypot(at.p[0] - run.pos[0], at.p[1] - run.pos[1]);
            if (off > 0.15) {
                // on its way to where it mows
                goTo(at.p);
                run.lastPaint = null;
            } else {
                run.d = (run.d + step) % run.total;
                const next = pointAt(run.path, run.d);
                run.pos = next.p;
                run.heading = next.dir;
                run.lane = next.lane;
                if (lawn) {
                    this.paintStripe(lawn, run);
                }
            }
            moving = true;
        } else if (mo.phase === 'returning' || mo.phase === 'docked') {
            moving = !goTo(mo.dock);
            if (!moving) {
                run.heading = [Math.sin(mo.dockAngle), -Math.cos(mo.dockAngle)];
            }
            run.lastPaint = null;
        }
        mesh.position.set(run.pos[0], mo.y, run.pos[1]);
        mesh.rotation.y = yaw(run.heading[0], run.heading[1]);
        if (lawn && this.paints.get(lawn.id)) {
            fade(this.paints.get(lawn.id)!, dt);
        }
        return moving;
    }

    private paintStripe(lawn: LawnState, run: MowerRun): void {
        const p = this.paints.get(lawn.id);
        if (!p) {
            return;
        }
        const to: Vec2 = [(run.pos[0] - p.minX) * p.scale, (run.pos[1] - p.minZ) * p.scale];
        const from = run.lastPaint;
        run.lastPaint = to;
        if (!from || Math.hypot(to[0] - from[0], to[1] - from[1]) > LANE * p.scale * 2) {
            return;
        }
        const ctx = p.ctx;
        ctx.lineCap = 'round';
        ctx.lineWidth = LANE * p.scale * 1.05;
        // the lanes one way bright, the other way dark, as a mown lawn looks
        ctx.strokeStyle = run.lane % 2 ? 'rgba(18,60,14,0.22)' : 'rgba(225,255,190,0.26)';
        ctx.beginPath();
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
        p.tex.needsUpdate = true;
    }
}

function stream(p: Particles, st: StreamState, t: number): void {
    const n = p.pos.length / 3;
    for (let i = 0; i < n; i++) {
        const s = (t * 1.6 + p.seeds[i * 3 + 2]) % 1;
        const ang = p.seeds[i * 3] * Math.PI * 2;
        const r = st.spread * s * (0.3 + 0.7 * p.seeds[i * 3 + 1]);
        p.pos.set([st.x + Math.cos(ang) * r, st.y - st.drop * s * s, st.z + Math.sin(ang) * r], i * 3);
        p.col.set([0.62, 0.84, 1, 0.85 * (1 - 0.4 * s)], i * 4);
    }
    flush(p);
}

function spray(p: Particles, sp: SprinklerState, t: number): void {
    const n = p.pos.length / 3;
    const T = 1.15;
    const hmax = 0.25 * sp.r + 0.2;
    for (let i = 0; i < n; i++) {
        const jet = i % 3;
        const a = (t / T + p.seeds[i * 3 + 2]) % 1;
        const launched = t - a * T;
        const ang = (jet * Math.PI * 2) / 3 + 0.7 * launched + (p.seeds[i * 3] - 0.5) * 0.12;
        const reach = sp.r * (0.55 + 0.45 * p.seeds[i * 3 + 1]) * a;
        p.pos.set(
            [sp.x + Math.sin(ang) * reach, sp.y + 0.08 + 4 * hmax * a * (1 - a), sp.z - Math.cos(ang) * reach],
            i * 3,
        );
        p.col.set([0.72, 0.9, 1, 0.85 * (1 - a * a * a)], i * 4);
    }
    flush(p);
}

/** The stripes fade over some hours. */
function fade(p: LawnPaint, dt: number): void {
    p.faded += dt;
    if (p.faded < 60) {
        return;
    }
    p.faded = 0;
    const ctx = p.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.012)';
    ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
    ctx.restore();
    p.tex.needsUpdate = true;
}

/** A soft band of colour round the house: strong at the walls, fading out within a metre. */
function glowRibbon(points: readonly Vec2[], color: Rgb): Mesh {
    const n = points.length;
    const pos: number[] = [];
    const col: number[] = [];
    // outward vertex normals of a convex outline (either winding)
    let area = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        area += a[0] * b[1] - b[0] * a[1];
    }
    const sign = area > 0 ? 1 : -1;
    const normal = (i: number): Vec2 => {
        const a = points[i];
        const b = points[(i + 1) % n];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(sign * (b[1] - a[1])) / l, (-sign * (b[0] - a[0])) / l];
    };
    const inner: Vec2[] = [];
    const outer: Vec2[] = [];
    for (let i = 0; i < n; i++) {
        const n0 = normal((i - 1 + n) % n);
        const n1 = normal(i);
        let vx = n0[0] + n1[0];
        let vz = n0[1] + n1[1];
        const l = Math.hypot(vx, vz) || 1;
        vx /= l;
        vz /= l;
        const p = points[i];
        inner.push([p[0] + vx * 0.08, p[1] + vz * 0.08]);
        outer.push([p[0] + vx * 1.1, p[1] + vz * 1.1]);
    }
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const quad: [Vec2, number][] = [
            [inner[i], 0.55],
            [outer[i], 0],
            [outer[j], 0],
            [inner[i], 0.55],
            [outer[j], 0],
            [inner[j], 0.55],
        ];
        for (const [p, a] of quad) {
            pos.push(p[0], 0, p[1]);
            col.push(color[0], color[1], color[2], a);
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 4));
    return new Mesh(
        geo,
        new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }),
    );
}

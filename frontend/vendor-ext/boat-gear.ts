// A boat's gear, drawn by the viewer from its sensors (furniture types added in tasks.ts):
// - "tank": a glass tank with the liquid at its fill level, in the colour of what it holds; gas is a bottle with its
//   valve and collar;
// - "rudder": the blade under the hull, turned by the rudder angle;
// - "propeller": a sail drive with a three-bladed propeller that spins with the engine speed;
// - "nav_light": a navigation light that glows while it is on, stronger at night, with its reflection on the water.
import {
    AdditiveBlending,
    BoxGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    EdgesGeometry,
    ExtrudeGeometry,
    Group,
    LatheGeometry,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Shape,
    Sprite,
    SpriteMaterial,
    Vector2,
    Vector3,
    type BufferGeometry,
    type Object3D,
    type Texture,
} from 'three';
import { labelSprite, shade } from './anchor';
import type { GearType } from './boat-kinds';

/** One item of gear as the 3D view reports it. */
export interface GearState {
    id: string;
    /** The floor it stands on. */
    floor: string;
    type: GearType;
    x: number;
    z: number;
    /** The item's rotation in degrees (its front, local +z, is aft at 0). */
    rotation: number;
    w: number;
    d: number;
    h: number;
    /** Height of its bottom above the floor (m). */
    base: number;
    /** What a tank holds, which light. */
    variant: string | null;
    /** Tank: fill 0–1; rudder: angle in ° (+: starboard); propeller: rpm; light: 1 on, 0 off; null: unknown. */
    value: number | null;
    /** The text over it; empty: none. */
    label: string;
    /** The label in a warning colour (a tank nearly empty, a holding tank nearly full). */
    warn: boolean;
    /** A light: a mast carries it, from the floor up. */
    mast: boolean;
    /** A hatch: how far it opens (°). */
    angle?: number;
    /** The sensor behind it: a tap opens its details with the history. */
    entity?: string | null;
}

/** Where the gear is in the scene. */
export interface GearScene {
    /** Height of its floor. */
    floorY: number;
    /** Height of the water surface; null: no sea. */
    waterY: number | null;
    /** A light look (day theme, natural style). */
    light: boolean;
    /** 0 by day, 1 at night. */
    night: number;
}

const TANK_COLORS: Record<string, number> = {
    water: 0x2f9be0,
    fuel: 0xd9a21b,
    gas: 0x9fbfd6,
    grey: 0x8c916c,
    black: 0x6b4f2e,
    oil: 0xc98a1c,
};
const WHITE_LIGHT = 0xfff1cf;
const LIGHT_COLORS: Record<string, number[]> = {
    anchor: [WHITE_LIGHT],
    steaming: [WHITE_LIGHT],
    stern: [WHITE_LIGHT],
    port: [0xff2b2b],
    starboard: [0x2bff66],
    bicolor: [0xff2b2b, 0x2bff66],
};

/** Revolutions per second the propeller is drawn with: real speeds would only flicker. */
export function spinRate(rpm: number | null): number {
    return rpm && rpm > 1 ? Math.min(4, 0.6 + rpm / 900) : 0;
}

/** What decides the look of an item: rebuilt when this changes (a propeller's speed only turns it). */
export function gearKey(g: GearState, s: GearScene): string {
    const r = (v: number | null, d = 2): string => (v === null ? '-' : v.toFixed(d));
    const value = g.type === 'propeller' ? String(spinRate(g.value) > 0) : r(g.value, g.type === 'tank' ? 3 : 1);
    return [
        g.id,
        g.type,
        r(g.x),
        r(g.z),
        g.rotation,
        r(g.w),
        r(g.d),
        r(g.h),
        r(g.base),
        g.variant,
        value,
        g.label,
        g.warn,
        r(s.floorY),
        r(s.waterY),
        s.light,
        g.type === 'nav_light' ? s.night.toFixed(1) : '',
        g.type === 'hatch' ? (g.angle ?? '') : '',
    ].join(':');
}

/** A soft round glow (additive) for a light's halo. */
function glowTexture(): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
}

/** A light's reflection on rippled water: a column of broken streaks, brightest at its middle. */
function reflectionTexture(): Texture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < 256; y += 6) {
        const k = 1 - Math.abs(y - 128) / 128;
        const w = 10 + 50 * k * (0.6 + 0.4 * Math.sin(y * 1.7));
        ctx.fillStyle = `rgba(255,255,255,${(0.15 + 0.85 * k * k).toFixed(3)})`;
        ctx.fillRect(32 - w / 2, y, w, 3);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
}

function glowSprite(map: Texture, color: number, opacity: number): Sprite {
    const s = new Sprite(
        new SpriteMaterial({
            map,
            color,
            transparent: true,
            opacity,
            blending: AdditiveBlending,
            depthWrite: false,
        }),
    );
    s.renderOrder = 6;
    return s;
}

function part(group: Object3D, geo: BufferGeometry, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    group.add(m);
    return m;
}

/**
 * Where a gas bottle's parts are, as fractions of its height: the foot ring up to `foot`, the glass body from there,
 * straight up to `shoulder`, rounded in to the neck at `neck`; the valve above it, the collar from `collar` to the top.
 */
export const BOTTLE = { foot: 0.06, shoulder: 0.66, neck: 0.84, valve: 0.92, collar: 0.78 } as const;

/** The outline of a gas bottle's body (radius, height from its foot), turned about its axis. */
export function bottleProfile(r: number, h: number): Vector2[] {
    const pts = [
        new Vector2(0, BOTTLE.foot * h),
        new Vector2(r * 0.8, BOTTLE.foot * h),
        new Vector2(r * 0.96, (BOTTLE.foot + 0.015) * h),
        new Vector2(r, (BOTTLE.foot + 0.04) * h),
    ];
    // the shoulder: a quarter ellipse from the body in to the neck
    const neckR = r * 0.2;
    for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        pts.push(
            new Vector2(
                neckR + (r - neckR) * Math.cos(a),
                (BOTTLE.shoulder + (BOTTLE.neck - BOTTLE.shoulder) * Math.sin(a)) * h,
            ),
        );
    }
    pts.push(new Vector2(0, BOTTLE.neck * h));
    return pts;
}

/** How high the liquid gas stands in a bottle of height h at a fill of 0–1: in the straight part of its body. */
export function bottleLevel(h: number, fill: number): number {
    const bottom = (BOTTLE.foot + 0.01) * h;
    return bottom + (BOTTLE.shoulder * h - bottom) * Math.min(1, Math.max(0, fill));
}

/** A gas bottle: the glass body with the liquid gas up to its level, the valve, the collar around it and the foot. */
function bottle(g: GearState, s: GearScene, group: Group, glass: MeshBasicMaterial, edge: LineBasicMaterial): void {
    const r = Math.min(g.w, g.d) / 2;
    const h = g.h;
    const level = Math.min(1, Math.max(0, g.value ?? 0));
    const body = new LatheGeometry(bottleProfile(r, h), 28);
    const shell = new Mesh(body, glass);
    shell.renderOrder = 3;
    group.add(shell);
    group.add(new LineSegments(new EdgesGeometry(body, 35), edge));
    if (level > 0.002) {
        const bottom = (BOTTLE.foot + 0.01) * h;
        const top = bottleLevel(h, level);
        const m = part(
            group,
            new CylinderGeometry(r * 0.92, r * 0.92, Math.max(0.004, top - bottom), 28).translate(
                0,
                (bottom + top) / 2,
                0,
            ),
            TANK_COLORS.gas,
        );
        (m.material as MeshBasicMaterial).transparent = true;
        (m.material as MeshBasicMaterial).opacity = 0.88;
        m.renderOrder = 2;
    }
    const metal = s.light ? 0x8d969e : 0xa9b4bf;
    // the foot ring and the collar that guards the valve, open on top
    part(
        group,
        new CylinderGeometry(r * 0.86, r * 0.9, BOTTLE.foot * h, 28, 1, true).translate(0, (BOTTLE.foot * h) / 2, 0),
        metal,
    );
    const collarH = (1 - BOTTLE.collar) * h;
    part(
        group,
        new CylinderGeometry(r * 0.6, r * 0.62, collarH, 28, 1, true).translate(0, BOTTLE.collar * h + collarH / 2, 0),
        metal,
    );
    // the valve: brass body and its hand wheel
    const valveH = (BOTTLE.valve - BOTTLE.neck) * h;
    part(
        group,
        new CylinderGeometry(r * 0.1, r * 0.12, valveH, 12).translate(0, BOTTLE.neck * h + valveH / 2, 0),
        0xc9a24a,
    );
    part(
        group,
        new CylinderGeometry(r * 0.28, r * 0.28, Math.max(0.01, h * 0.025), 16).translate(0, BOTTLE.valve * h, 0),
        s.light ? 0x3d4248 : 0x5b6670,
    );
}

/** A glass tank with the liquid up to its level; gas as a bottle. */
function tank(g: GearState, s: GearScene, group: Group): void {
    const level = Math.min(1, Math.max(0, g.value ?? 0));
    const glass = new MeshBasicMaterial({
        color: s.light ? 0xd6ecff : 0x9fd8ff,
        transparent: true,
        opacity: s.light ? 0.22 : 0.14,
        depthWrite: false,
    });
    const edge = new LineBasicMaterial({ color: s.light ? 0x5b7a90 : 0x8fd3ff, transparent: true, opacity: 0.85 });
    if (g.variant === 'gas') {
        bottle(g, s, group, glass, edge);
        return;
    }
    const body: BufferGeometry = new BoxGeometry(g.w, g.h, g.d).translate(0, g.h / 2, 0);
    const shell = new Mesh(body, glass);
    shell.renderOrder = 3;
    group.add(shell);
    group.add(new LineSegments(new EdgesGeometry(body, 30), edge));
    if (level > 0.002) {
        const inset = 0.025;
        const fill = Math.max(0.004, (g.h - inset * 2) * level);
        const m = part(
            group,
            new BoxGeometry(g.w - inset * 2, fill, g.d - inset * 2).translate(0, inset + fill / 2, 0),
            TANK_COLORS[g.variant ?? 'water'] ?? TANK_COLORS.water,
        );
        (m.material as MeshBasicMaterial).transparent = true;
        (m.material as MeshBasicMaterial).opacity = 0.88;
        m.renderOrder = 2;
    }
}

/** The rudder blade below the floor, turned about its stock (the item's position) by the rudder angle. */
function rudder(g: GearState, s: GearScene, group: Group): void {
    const color = s.light ? 0xe4e9ee : 0xb9c8d6;
    part(group, new CylinderGeometry(0.035, 0.035, 0.35, 10).translate(0, -0.12, -g.d * 0.3), 0x555c63);
    const blade = new Group();
    // a tapering blade: the stock at a fifth of the chord, the trailing edge aft (local +z)
    const geo = new BoxGeometry(Math.max(0.03, g.w * 0.6), g.h, g.d, 1, 4, 1);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / g.h + 0.5;
        // narrower and thinner towards the tip, the leading edge swept back a little
        const chord = 0.65 + 0.35 * y;
        const z = (pos.getZ(i) / g.d + 0.5) * g.d * chord - g.d * 0.2 + (1 - y) * g.d * 0.12;
        pos.setXYZ(i, pos.getX(i) * (0.55 + 0.45 * y), pos.getY(i), z);
    }
    geo.computeVertexNormals();
    part(blade, geo.translate(0, -0.25 - g.h / 2, 0), color);
    // the stock at 30 % of the length from the front, as in the plan symbol
    blade.position.z = -g.d * 0.3;
    blade.rotation.y = ((g.value ?? 0) * Math.PI) / 180;
    group.add(blade);
}

/** A sail drive leg from the floor down to the propeller, which spins about the boat's long axis. */
function propeller(g: GearState, s: GearScene, group: Group): void {
    const leg = s.light ? 0x3d4248 : 0x7a8794;
    const bronze = s.light ? 0xc8a34a : 0xe0bd62;
    const depth = Math.max(0.2, g.h);
    part(group, new BoxGeometry(0.07, depth, Math.max(0.12, g.d)).translate(0, -depth / 2, 0), leg);
    // the torpedo with the gearbox, along the boat
    part(group, new CylinderGeometry(0.06, 0.06, 0.34, 14).rotateX(Math.PI / 2).translate(0, -depth, 0.02), leg);
    const spin = new Group();
    spin.name = 'fp3dSpin';
    spin.position.set(0, -depth, 0.22);
    const r = Math.max(0.12, g.w / 2);
    part(spin, new SphereGeometry(0.055, 12, 10).scale(1, 1, 1.4), bronze);
    for (let i = 0; i < 3; i++) {
        const blade = new Group();
        blade.rotation.z = (i * Math.PI * 2) / 3;
        const m = part(blade, new SphereGeometry(1, 14, 8).scale(r * 0.32, r * 0.5, 0.018), bronze);
        m.position.y = r * 0.52;
        // the pitch: each blade turned about its own axis
        m.rotation.y = 0.55;
        spin.add(blade);
    }
    if (spinRate(g.value) > 0) {
        // the blur of the turning blades
        const disc = new Mesh(
            new CircleGeometry(r, 32),
            new MeshBasicMaterial({ color: bronze, transparent: true, opacity: 0.22, depthWrite: false }),
        );
        disc.renderOrder = 3;
        spin.add(disc);
    }
    group.add(spin);
}

/** A navigation light: a small lantern; while on, a halo and at night its reflection on the water. */
function navLight(g: GearState, s: GearScene, group: Group): void {
    const colors = LIGHT_COLORS[g.variant ?? 'anchor'] ?? LIGHT_COLORS.anchor;
    const on = (g.value ?? 0) > 0;
    part(group, new CylinderGeometry(0.045, 0.05, 0.03, 12).translate(0, 0.015, 0), 0x2b2f33);
    colors.forEach((c, i) => {
        const x = colors.length > 1 ? (i ? 0.03 : -0.03) : 0;
        const lens = part(group, new CylinderGeometry(0.04, 0.04, 0.07, 12).translate(x, 0.065, 0), on ? c : 0x9aa3ab);
        lens.scale.x = colors.length > 1 ? 0.5 : 1;
    });
    if (!on) {
        return;
    }
    const map = glowTexture();
    const halo = 0.5 + 2.6 * s.night;
    colors.forEach((c, i) => {
        const glow = glowSprite(map, c, 0.55 + 0.45 * s.night);
        glow.scale.set(halo, halo, 1);
        glow.position.set(colors.length > 1 ? (i ? 0.08 : -0.08) : 0, 0.065, 0);
        group.add(glow);
        // the core: white-hot in the middle of a coloured light
        const core = glowSprite(map, c === WHITE_LIGHT ? 0xffffff : c, 1);
        core.scale.set(0.35, 0.35, 1);
        core.position.copy(glow.position);
        group.add(core);
    });
    if (s.waterY !== null && s.night > 0.15) {
        // the reflection: a column of streaks around the mirror image of the light, in the water
        const height = group.position.y + 0.065 - s.waterY;
        if (height > 0.2) {
            const refl = reflectionTexture();
            colors.forEach((c, i) => {
                const r = new Sprite(
                    new SpriteMaterial({
                        map: refl,
                        color: c,
                        transparent: true,
                        opacity: 0.55 * s.night,
                        blending: AdditiveBlending,
                        depthWrite: false,
                    }),
                );
                r.renderOrder = 6;
                const tall = Math.min(14, Math.max(1.5, height * 1.1));
                r.scale.set(0.55 + 0.25 * s.night, tall, 1);
                r.position.set(colors.length > 1 ? (i ? 0.1 : -0.1) : 0, -height * 2 + 0.065, 0);
                group.add(r);
            });
        }
    }
}

/** The outline of a hatch in the floor plane (shape x → x, shape y → −z): a rounded square or a circle. */
function hatchOutline(round: boolean, w: number, d: number, inset: number): Shape {
    const s = new Shape();
    if (round) {
        s.absarc(0, 0, Math.max(0.02, Math.min(w, d) / 2 - inset), 0, Math.PI * 2, false);
        return s;
    }
    const hw = w / 2 - inset;
    const hd = d / 2 - inset;
    const r = Math.max(0.01, Math.min(hw, hd) * 0.28);
    s.moveTo(-hw + r, -hd);
    s.lineTo(hw - r, -hd);
    s.quadraticCurveTo(hw, -hd, hw, -hd + r);
    s.lineTo(hw, hd - r);
    s.quadraticCurveTo(hw, hd, hw - r, hd);
    s.lineTo(-hw + r, hd);
    s.quadraticCurveTo(-hw, hd, -hw, hd - r);
    s.lineTo(-hw, -hd + r);
    s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    return s;
}

/** A flat outline (with a hole) raised `depth` up from y = 0. */
function slab(outline: Shape, depth: number): BufferGeometry {
    return new ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 20 }).rotateX(-Math.PI / 2);
}

/** A thin rod from a to b. */
function rod(group: Object3D, a: Vector3, b: Vector3, r: number, color: number): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.01) {
        return;
    }
    const m = part(group, new CylinderGeometry(r, r, len, 8), color);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
}

/**
 * A deck hatch: a low aluminium frame round the opening and a lid of smoked acrylic hinged at its front edge (local −z,
 * forward at 0°); open, it stands up by its angle on two gas struts and shows the dark opening below.
 */
function hatch(g: GearState, s: GearScene, group: Group): void {
    const round = g.variant === 'round';
    const metal = s.light ? 0xc9cfd5 : 0x8d99a6;
    const rim = Math.min(0.05, Math.min(g.w, g.d) * 0.1);
    const fh = Math.min(0.12, Math.max(0.025, g.h));
    // the frame and the opening inside it
    const frame = hatchOutline(round, g.w, g.d, 0);
    frame.holes.push(hatchOutline(round, g.w, g.d, rim));
    part(group, slab(frame, fh), metal);
    const hole = part(group, slab(hatchOutline(round, g.w, g.d, rim), 0.004).translate(0, 0.004, 0), 0x161b20);
    hole.renderOrder = 1;
    // the lid, turned about its hinge at the front edge
    const open = Math.min(1, Math.max(0, g.value ?? 0));
    const a = (open * Math.min(110, Math.max(5, g.angle ?? 70)) * Math.PI) / 180;
    const lid = new Group();
    lid.position.set(0, fh, -g.d / 2);
    lid.rotation.x = -a;
    const lidRim = hatchOutline(round, g.w, g.d, 0);
    lidRim.holes.push(hatchOutline(round, g.w, g.d, rim * 0.8));
    part(lid, slab(lidRim, 0.022).translate(0, 0, g.d / 2), metal);
    const pane = part(
        lid,
        slab(hatchOutline(round, g.w, g.d, rim * 0.8), 0.012).translate(0, 0.005, g.d / 2),
        s.light ? 0x4a5866 : 0x2c3540,
    );
    const mat = pane.material as MeshBasicMaterial;
    mat.transparent = true;
    mat.opacity = 0.72;
    pane.renderOrder = 3;
    group.add(lid);
    if (a > 0.08) {
        // the gas struts: from the frame's sides to the lid
        const q = g.d * 0.42;
        for (const sx of [-1, 1]) {
            const x = sx * (g.w / 2 - rim / 2) * (round ? 0.75 : 1);
            const foot = new Vector3(x, fh, -g.d / 2 + g.d * 0.62);
            const top = new Vector3(x, fh + q * Math.sin(a), -g.d / 2 + q * Math.cos(a));
            rod(group, foot, top, 0.008, 0x3a3f45);
        }
    }
}

/** Builds one item in plan coordinates (the viewer's root). */
export function buildGear(g: GearState, s: GearScene): Group {
    const group = new Group();
    group.userData.fp3dGear = g.id;
    group.position.set(g.x, s.floorY + g.base, g.z);
    // the plan's rotation turns the item's front (local +z) to (−sin a, cos a)
    group.rotation.y = (-g.rotation * Math.PI) / 180;
    if (g.type === 'nav_light' && g.mast && g.base > 0.3) {
        // an aluminium mast from the floor up to the light, its profile longer fore and aft
        part(
            group,
            new CylinderGeometry(0.075, 0.09, g.base, 14).scale(1, 1, 1.45).translate(0, -g.base / 2, 0),
            s.light ? 0xc9cfd5 : 0x8d99a6,
        );
    }
    switch (g.type) {
        case 'tank':
            tank(g, s, group);
            break;
        case 'rudder':
            rudder(g, s, group);
            break;
        case 'propeller':
            propeller(g, s, group);
            break;
        case 'nav_light':
            navLight(g, s, group);
            break;
        case 'hatch':
            hatch(g, s, group);
            break;
    }
    if (g.type === 'tank') {
        // seen through: tanks lie under berths and floors; the glass, then the liquid, then the edges, over everything
        group.traverse(o => {
            const m = o as Mesh;
            if (m.material) {
                (m.material as MeshBasicMaterial).depthTest = false;
                (m.material as MeshBasicMaterial).depthWrite = false;
                m.renderOrder = o instanceof LineSegments ? 9 : m.renderOrder === 2 ? 8 : 7;
            }
        });
    } else if (g.type === 'rudder' || g.type === 'propeller') {
        // under water as in clear water: drawn after the sea (which writes no depth), still hidden by the hull
        group.traverse(o => {
            const m = o as Mesh;
            if (m.material) {
                const mat = m.material as MeshBasicMaterial;
                mat.transparent = true;
                mat.opacity = Math.min(mat.opacity, 0.92);
                m.renderOrder = 5;
            }
        });
    }
    if (g.label) {
        const label = labelSprite(g.label, s.light, g.warn ? 'warn' : null, 0.024);
        label.position.set(0, (g.type === 'tank' ? g.h : g.type === 'hatch' ? g.d * 0.6 : 0.2) + 0.3, 0);
        group.add(label);
    }
    return group;
}

/** The propellers to turn every frame: their spinning part and revolutions per second. */
export function spinners(root: Object3D, list: GearState[]): { part: Object3D; rate: number }[] {
    const out: { part: Object3D; rate: number }[] = [];
    root.traverse(o => {
        if (o.name !== 'fp3dSpin') {
            return;
        }
        const id = o.parent?.userData.fp3dGear;
        const rate = spinRate(list.find(g => g.id === id)?.value ?? null);
        if (rate > 0) {
            out.push({ part: o, rate });
        }
    });
    return out;
}

/** Frees the geometries, materials and textures of the gear (sprites share one geometry: it stays). */
export function disposeGear(root: Object3D): void {
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

// A boat's anchor (furniture type "anchor", placed at the bow roller): stowed at the roller, hanging on its chain, or
// on the seabed with the chain as a catenary from the roller down to the ground and lying on it up to the anchor. A
// label with the chain length and the depth, a sandy patch on the seabed and the alarm circle on the water.
import {
    CanvasTexture,
    CatmullRomCurve3,
    CircleGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    Group,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    RingGeometry,
    SphereGeometry,
    SRGBColorSpace,
    Sprite,
    SpriteMaterial,
    TorusGeometry,
    TubeGeometry,
    Vector3,
    type BufferGeometry,
    type Material,
    type Texture,
} from 'three';

/** One anchor as the 3D view reports it. */
export interface AnchorState {
    id: string;
    /** The floor it stands on (the deck). */
    floor: string;
    x: number;
    z: number;
    /** The item's rotation in degrees; its back (local −z) is where the chain leads out: the bow. */
    rotation: number;
    /** The item's length (m): the roller is at its back end. */
    length: number;
    /** Chain out (m); null: no sensor, the anchor shows stowed. */
    chain: number | null;
    /** Water depth (m, below the waterline); null: unknown. */
    depth: number | null;
    /** Horizontal distance boat → anchor (m, e.g. from the GPS); null: a chain with a little slack. */
    distance: number | null;
    /** Radius of the anchor alarm (m): a circle on the water; null: none. */
    radius: number | null;
    /** The anchor alarm has gone off. */
    alarm: boolean;
    /** The text over the bow; empty: none. */
    label: string;
}

/** Where the anchor is in the scene. */
export interface AnchorScene {
    /** Height of the floor the anchor stands on. */
    deckY: number;
    /** Height of the water surface. */
    waterY: number;
    /** A light look (day theme, natural style). */
    light: boolean;
}

/** Below this much chain the anchor counts as stowed. */
export const STOWED_CHAIN = 0.3;
/** Assumed depth without a sensor (m). */
const DEFAULT_DEPTH = 5;
/** Length of the anchor from the crown to the ring (m). */
const ANCHOR_SIZE = 0.85;
/** Height of the roller over the deck. */
const ROLLER_Y = 0.12;

/** How the chain runs: the hanging part is a catenary that touches the seabed tangentially, the rest lies on it. */
export interface ChainShape {
    /** Catenary parameter (horizontal tension per weight of a metre of chain); 0: no catenary. */
    a: number;
    /** Horizontal reach of the hanging part, roller → touchdown (m). */
    xs: number;
    /** Length of the hanging part (m). */
    s: number;
    /** Horizontal distance roller → anchor (m). */
    reach: number;
    /** The anchor lies on the seabed. */
    ground: boolean;
}

/**
 * The run of `length` m of chain from a roller `drop` m above the seabed. `target`: the wanted horizontal distance
 * to the anchor (clamped between the chain going straight down and the chain just lifting off the ground); null: in
 * between, a chain with some slack as on a calm day.
 */
export function chainShape(length: number, drop: number, target: number | null): ChainShape {
    if (drop <= 0.01) {
        return { a: 0, xs: 0, s: 0, reach: length, ground: true };
    }
    if (length <= drop) {
        return { a: 0, xs: 0, s: length, reach: 0, ground: false };
    }
    const xsOf = (a: number): number => a * Math.acosh(1 + drop / a);
    const sOf = (a: number): number => Math.sqrt(drop * drop + 2 * a * drop);
    const reachOf = (a: number): number => xsOf(a) + length - sOf(a);
    // the most tension that still leaves the chain on the ground at the anchor
    const aMax = (length * length - drop * drop) / (2 * drop);
    const lo = length - drop;
    const hi = xsOf(aMax);
    const want =
        target === null || !Number.isFinite(target) ? lo + 0.55 * (hi - lo) : Math.min(hi, Math.max(lo, target));
    // the reach grows with the tension: bisection
    let a0 = 1e-6;
    let a1 = aMax;
    for (let i = 0; i < 80; i++) {
        const m = (a0 + a1) / 2;
        if (reachOf(m) < want) {
            a0 = m;
        } else {
            a1 = m;
        }
    }
    const a = (a0 + a1) / 2;
    return { a, xs: xsOf(a), s: sOf(a), reach: reachOf(a), ground: true };
}

/** Points of the chain in the vertical plane of the bow: [h forward of the roller, v relative to the roller]. */
export function chainPoints(shape: ChainShape, length: number, drop: number): [number, number][] {
    if (!shape.ground) {
        return [0, 0.25, 0.5, 0.75, 1].map(k => [0, -length * k]);
    }
    const out: [number, number][] = [];
    if (shape.a > 0) {
        const n = 48;
        for (let i = 0; i <= n; i++) {
            // from the roller (q = xs) to the touchdown (q = 0), denser near the bottom where it bends
            const q = shape.xs * (1 - i / n) ** 1.3;
            out.push([shape.xs - q, -drop + shape.a * (Math.cosh(q / shape.a) - 1)]);
        }
    } else {
        out.push([0, 0], [0, -drop]);
    }
    const rest = shape.reach - shape.xs;
    const steps = Math.max(1, Math.ceil(rest / 2));
    for (let i = 1; i <= steps; i++) {
        out.push([shape.xs + (rest * i) / steps, -drop]);
    }
    return out;
}

const UP = new Vector3(0, 1, 0);
const LIGHT = new Vector3(0.35, 0.85, 0.4).normalize();

/** Colours by the light of a fixed sun (the scene uses unlit materials): a vertex colour per normal. */
export function shade(geo: BufferGeometry, base: Color, stripe?: (vertex: number) => number): BufferGeometry {
    const n = geo.getAttribute('normal');
    const colors = new Float32Array(n.count * 3);
    const v = new Vector3();
    for (let i = 0; i < n.count; i++) {
        v.fromBufferAttribute(n, i);
        const k = (0.5 + 0.5 * Math.max(0, v.dot(LIGHT))) * (stripe ? stripe(i) : 1);
        colors[i * 3] = base.r * k;
        colors[i * 3 + 1] = base.g * k;
        colors[i * 3 + 2] = base.b * k;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geo;
}

/** A classic anchor: crown at the origin, the shank up to the ring at +y, the arms in the x/y plane, the stock along z. */
function anchorModel(color: Color): Group {
    const g = new Group();
    const mat = new MeshBasicMaterial({ vertexColors: true });
    const part = (geo: BufferGeometry): void => {
        g.add(new Mesh(shade(geo, color), mat));
    };
    const s = ANCHOR_SIZE;
    part(new CylinderGeometry(0.03, 0.034, s * 0.94, 10).translate(0, s * 0.47, 0));
    part(new TorusGeometry(s * 0.08, 0.016, 8, 24).translate(0, s + s * 0.02, 0));
    part(new CylinderGeometry(0.022, 0.022, s * 0.6, 8).rotateX(Math.PI / 2).translate(0, s * 0.86, 0));
    for (const z of [-1, 1]) {
        part(new SphereGeometry(0.04, 10, 8).translate(0, s * 0.86, z * s * 0.3));
    }
    // the arms: half a ring below the crown's centre, the crown at its lowest point
    const r = s * 0.38;
    part(new TorusGeometry(r, 0.032, 8, 32, Math.PI).rotateZ(Math.PI).translate(0, r, 0));
    part(new SphereGeometry(0.05, 12, 10));
    // the flukes: flat blades at the tips of the arms
    for (const x of [-1, 1]) {
        part(
            new ConeGeometry(0.1, 0.24, 4)
                .scale(1, 1, 0.3)
                .rotateZ(-x * 0.5)
                .translate(x * (r + 0.03), r + 0.08, 0),
        );
    }
    return g;
}

/** Places the anchor model: its crown at `crown`, the shank along `shank` (crown → ring), the arms along `arms`. */
function orient(model: Group, crown: Vector3, shank: Vector3, arms: Vector3): void {
    const y = shank.clone().normalize();
    const x = arms
        .clone()
        .sub(y.clone().multiplyScalar(arms.dot(y)))
        .normalize();
    const z = new Vector3().crossVectors(x, y).normalize();
    model.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    model.position.copy(crown);
}

/** The chain as a tube along the points, its links as alternating light and dark rings. */
function chainMesh(points: Vector3[], color: Color): Mesh {
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    const length = curve.getLength();
    const segments = Math.max(8, Math.min(1200, Math.round(length / 0.1)));
    const radial = 6;
    const geo = new TubeGeometry(curve, segments, 0.03, radial, false);
    shade(geo, color, i => (Math.floor(i / (radial + 1)) % 2 ? 0.62 : 1));
    return new Mesh(geo, new MeshBasicMaterial({ vertexColors: true }));
}

/** A label as a sprite that always faces the camera, drawn over everything. */
export function labelSprite(
    text: string,
    light: boolean,
    tone: 'alarm' | 'warn' | null = null,
    height = 0.032,
): Sprite {
    const alarm = tone === 'alarm';
    const warn = tone === 'warn';
    const font = '600 46px system-ui, -apple-system, "Segoe UI", sans-serif';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 56;
    const h = 76;
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = alarm
        ? 'rgba(200,40,40,0.92)'
        : warn
          ? 'rgba(230,150,20,0.92)'
          : light
            ? 'rgba(255,255,255,0.9)'
            : 'rgba(12,22,36,0.86)';
    ctx.strokeStyle = alarm ? '#ff8a80' : warn ? '#ffd27a' : light ? 'rgba(20,60,90,0.35)' : 'rgba(110,200,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(2, 2, w - 4, h - 4, 18);
    } else {
        ctx.rect(2, 2, w - 4, h - 4);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = alarm || warn ? '#fff' : light ? '#123' : '#e6f4ff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 28, h / 2 + 2);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    // the same size on the screen at every distance, like the other labels (about 30 px high)
    const sprite = new Sprite(
        new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }),
    );
    sprite.scale.set((height * w) / h, height, 1);
    sprite.renderOrder = 20;
    return sprite;
}

/** A soft round patch of sand (a radial gradient) for the seabed around the anchor. */
function sandTexture(light: boolean): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    const sand = light ? '214,196,150' : '120,110,84';
    g.addColorStop(0, `rgba(${sand},0.95)`);
    g.addColorStop(0.6, `rgba(${sand},0.55)`);
    g.addColorStop(1, `rgba(${sand},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
}

/** What decides the look of an anchor: rebuilt when this changes. */
export function anchorKey(a: AnchorState, scene: AnchorScene): string {
    const r = (v: number | null): string => (v === null ? '-' : v.toFixed(2));
    return [
        a.id,
        r(a.x),
        r(a.z),
        a.rotation,
        r(a.length),
        r(a.chain),
        r(a.depth),
        r(a.distance),
        r(a.radius),
        a.alarm,
        a.label,
        r(scene.deckY),
        r(scene.waterY),
        scene.light,
    ].join(':');
}

/** Builds one anchor with its chain, label, sand and alarm circle, in plan coordinates (the viewer's root). */
export function buildAnchor(a: AnchorState, scene: AnchorScene): Group {
    const g = new Group();
    g.userData.fp3dAnchor = a.id;
    const rad = (a.rotation * Math.PI) / 180;
    // the item's back (local −z) is the bow: there the roller is and the chain leads out
    const dir = new Vector3(Math.sin(rad), 0, -Math.cos(rad));
    const side = new Vector3(Math.cos(rad), 0, Math.sin(rad));
    const roller = new Vector3(a.x, scene.deckY + ROLLER_Y, a.z).addScaledVector(dir, a.length / 2);
    const steel = new Color(a.alarm ? 0xd84a3a : scene.light ? 0x7d8792 : 0x9fb3c8);
    const chainColor = new Color(scene.light ? 0x5d6670 : 0x7f93a8);
    const model = anchorModel(steel);
    g.add(model);
    const chain = a.chain ?? 0;
    const stowed = a.chain === null || chain < STOWED_CHAIN;
    const depth = a.depth !== null && a.depth > 0 ? a.depth : DEFAULT_DEPTH;
    const seabed = scene.waterY - depth;
    let anchorAt = roller.clone();
    if (stowed) {
        // in the roller: the shank along the bow, the crown hanging out over the stem, the arms upright
        orient(model, roller.clone().addScaledVector(dir, 0.22), dir.clone().negate(), UP);
    } else {
        const drop = Math.max(0, roller.y - seabed);
        const shape = chainShape(chain, drop, a.distance);
        const pts = chainPoints(shape, chain, drop).map(([h, v]) =>
            roller
                .clone()
                .addScaledVector(dir, h)
                .add(new Vector3(0, v + (shape.ground && v <= -drop + 1e-6 ? 0.03 : 0), 0)),
        );
        g.add(chainMesh(pts, chainColor));
        const end = pts[pts.length - 1];
        anchorAt = end;
        if (shape.ground) {
            // on the ground: the shank towards the boat with the ring a little up, one fluke dug in
            const shank = dir
                .clone()
                .negate()
                .add(new Vector3(0, 0.22, 0));
            orient(model, end.clone().addScaledVector(shank.clone().normalize(), -ANCHOR_SIZE), shank, UP);
            // the sand around it
            const r = Math.max(2.5, Math.min(30, shape.reach * 0.55 + 1.5));
            const sand = new Mesh(
                new CircleGeometry(r, 48).rotateX(-Math.PI / 2),
                new MeshBasicMaterial({ map: sandTexture(scene.light), transparent: true, depthWrite: false }),
            );
            sand.position.set(end.x - (dir.x * shape.reach) / 3, seabed + 0.01, end.z - (dir.z * shape.reach) / 3);
            sand.renderOrder = 2;
            g.add(sand);
        } else {
            // hanging: the ring at the chain's end, the crown down
            orient(model, end.clone().add(new Vector3(0, -ANCHOR_SIZE, 0)), UP, side);
        }
    }
    if (a.radius !== null && a.radius > 0) {
        // the alarm circle on the water around the anchor
        const r = a.radius;
        const w = Math.max(0.12, r * 0.012);
        const ring = new Mesh(
            new RingGeometry(r - w, r, 160).rotateX(-Math.PI / 2),
            new MeshBasicMaterial({
                color: a.alarm ? 0xff3b30 : 0xffb300,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
            }),
        );
        ring.position.set(anchorAt.x, scene.waterY + 0.04, anchorAt.z);
        ring.renderOrder = 5;
        g.add(ring);
    }
    if (a.label) {
        const label = labelSprite(a.label, scene.light, a.alarm ? 'alarm' : null);
        label.position.copy(roller).add(new Vector3(0, 1.3, 0));
        g.add(label);
    }
    return g;
}

/** Frees the geometries, materials and textures of an anchor group (not the geometry all sprites share). */
export function disposeAnchor(g: Group): void {
    g.traverse(o => {
        const m = o as Partial<Mesh> & { isSprite?: boolean };
        if (!m.isSprite) {
            m.geometry?.dispose();
        }
        for (const mat of m.material ? ([] as Material[]).concat(m.material) : []) {
            (mat as MeshBasicMaterial).map?.dispose();
            mat.dispose();
        }
    });
}

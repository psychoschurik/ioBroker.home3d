// Trees and bushes as furniture outside: a broadleaf tree, a conifer, a fruit tree and a bush, dressed for the
// season (from the date and the hemisphere): bare branches in winter, fresh light green in spring, blossom on the
// fruit tree, dark green in summer, apples in late summer, yellow, orange and red leaves in autumn that fall in the
// wind, snow on crowns and branches. They sway in the wind: the trunk leans a little, the crown more, gusts shake
// them. Low poly like the rest of the furniture, lit by the colours of their faces (shade); two or three draws each.
import {
    BufferGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    Group,
    IcosahedronGeometry,
    Mesh,
    MeshBasicMaterial,
    type Object3D,
    Points,
    PointsMaterial,
    Quaternion,
    Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shade } from './anchor';

export const TREE_KINDS = ['tree', 'tree_conifer', 'tree_fruit', 'bush'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

/** Width (crown), depth, height (m). */
export const TREE_SIZES: Record<TreeKind, [number, number, number]> = {
    tree: [4.5, 4.5, 7],
    tree_conifer: [3, 3, 8],
    tree_fruit: [3.5, 3.5, 4.2],
    bush: [1.6, 1.6, 1.3],
};

export function isTreeKind(t: string): t is TreeKind {
    return (TREE_KINDS as readonly string[]).includes(t);
}

function smooth(e0: number, e1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** The season as the trees show it, each 0 … 1. */
export interface Season {
    /** How full the crown is (0: bare). */
    leaf: number;
    /** The light green of spring. */
    fresh: number;
    /** The colours of autumn. */
    autumn: number;
    /** Leaves falling. */
    fall: number;
    /** Blossom on the fruit tree. */
    blossom: number;
    /** Fruit on the fruit tree. */
    fruit: number;
}

/**
 * The season at time t (ms) for a latitude (°; south of the equator half a year later, in the tropics always green;
 * null: as in central Europe). By the day of the year, with soft passages.
 */
export function seasonOf(t: number, latitude: number | null): Season {
    const date = new Date(t);
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    let d = (t - start) / 86400000;
    const lat = latitude ?? 50;
    if (lat < 0) {
        d = (d + 182.6) % 365.25;
    }
    if (Math.abs(lat) < 23) {
        return { leaf: 1, fresh: 0.3, autumn: 0, fall: 0, blossom: 0, fruit: 0.5 };
    }
    return {
        leaf: smooth(88, 128, d) * (1 - smooth(286, 322, d)),
        fresh: smooth(95, 120, d) * (1 - smooth(150, 180, d)),
        autumn: smooth(255, 292, d),
        fall: smooth(278, 295, d) * (1 - smooth(310, 328, d)),
        blossom: smooth(92, 108, d) * (1 - smooth(122, 135, d)),
        fruit: smooth(205, 245, d) * (1 - smooth(290, 305, d)),
    };
}

export interface TreeSpec {
    id: string;
    floor: string;
    kind: TreeKind;
    x: number;
    z: number;
    /** Turn in the plan (rad, clockwise). */
    angle: number;
    w: number;
    d: number;
    h: number;
    season: Season;
    /** Snow on crowns and branches, 0 … 1. */
    snow: number;
    /** The ground it stands on above its floor (m): a lawn on a hill, a raised bed; missing: the floor itself. */
    y?: number;
}

/** What makes a tree be built anew (rounded: the season moves slowly). */
export function treeKey(t: TreeSpec, floorY: number): string {
    const s = t.season;
    const r = (v: number): string => (Math.round(v * 20) / 20).toFixed(2);
    return [
        t.id,
        t.kind,
        t.x.toFixed(2),
        t.z.toFixed(2),
        (floorY + (t.y ?? 0)).toFixed(2),
        t.angle.toFixed(2),
        t.w.toFixed(2),
        t.d.toFixed(2),
        t.h.toFixed(2),
        r(s.leaf),
        r(s.fresh),
        r(s.autumn),
        r(s.fall),
        r(s.blossom),
        r(s.fruit),
        r(t.snow),
    ].join(',');
}

/** A small random generator from a seed (the same tree looks the same every time). */
function random(seed: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    }
    let s = (h >>> 0) % 2147483646 || 1;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}

const WOOD = new Color(0x5b4636);
const SNOW = new Color(0xf4f7fb);
const AUTUMN = [0xe0b021, 0xdd7a1c, 0xc23b1f, 0x9a6a2a].map(c => new Color(c));

/** Lighter where it faces up, as snow lies on top. */
function snowOn(geo: BufferGeometry, snow: number): BufferGeometry {
    if (snow < 0.02) {
        return geo;
    }
    const n = geo.getAttribute('normal');
    const c = geo.getAttribute('color');
    for (let i = 0; i < n.count; i++) {
        const k = snow * smooth(0.3, 0.75, n.getY(i));
        c.setXYZ(
            i,
            c.getX(i) + (SNOW.r - c.getX(i)) * k,
            c.getY(i) + (SNOW.g - c.getY(i)) * k,
            c.getZ(i) + (SNOW.b - c.getZ(i)) * k,
        );
    }
    return geo;
}

/** Collects parts, each shaded in its colour, into one mesh. */
class Parts {
    private list: BufferGeometry[] = [];

    add(geo: BufferGeometry, color: Color, snow = 0): void {
        const g = geo.index ? geo.toNonIndexed() : geo;
        g.deleteAttribute('uv');
        g.computeVertexNormals();
        this.list.push(snowOn(shade(g, color), snow));
    }

    mesh(name: string): Mesh | null {
        if (!this.list.length) {
            return null;
        }
        const geo = mergeGeometries(this.list);
        for (const g of this.list) {
            g.dispose();
        }
        if (!geo) {
            return null;
        }
        const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true }));
        m.name = name;
        return m;
    }
}

/** A blob of leaves: a lumpy ball. */
function blob(r: number, rnd: () => number): BufferGeometry {
    const g = new IcosahedronGeometry(r, 1);
    const p = g.getAttribute('position');
    const v = new Vector3();
    // the same lump at the same place on both faces that share a corner
    const lumps = [0, 1, 2, 3].map(() => new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const u = v.clone().normalize();
        let k = 1;
        for (const l of lumps) {
            k += 0.12 * Math.max(0, u.dot(l)) ** 3;
        }
        v.multiplyScalar(k * (u.y < -0.4 ? 0.85 : 1));
        p.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
}

/** A branch from a to b, thinner towards its end. */
function branch(a: Vector3, b: Vector3, r0: number, r1: number): BufferGeometry {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const g = new CylinderGeometry(r1, r0, len, 6, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
}

/** The colour of the leaves for the season; `k` picks among the autumn colours. */
function leafColor(kind: TreeKind, s: Season, k: number): Color {
    if (kind === 'tree_conifer') {
        return new Color(0x2f5d3a);
    }
    const summer = new Color(kind === 'bush' ? 0x4a7f3c : 0x4f8a3a);
    const c = summer.clone().lerp(new Color(0x8cc63f), s.fresh * 0.8);
    const autumn = AUTUMN[Math.floor(k * AUTUMN.length) % AUTUMN.length];
    // a bush keeps more of its green, and in winter the leaves it keeps are green again
    return c.lerp(autumn, s.autumn * (kind === 'bush' ? 0.5 * Math.min(1, s.leaf * 2) : 0.9));
}

/** The bark in the dark looks: the blue of the furniture's wood there, a little lighter to stand out from the ground. */
export const NEON_BARK = 0x3a4d78;

/**
 * In the dark looks: leaves, blossom and fruit become shades of the looks' green, by their brightness; trunk and
 * branches shades of the furniture's dark blue (a bare tree in winter is no green skeleton), snow on them stays white.
 */
function neon(g: Object3D): void {
    const glow = new Color(0x3de0a0);
    const bark = new Color(NEON_BARK);
    const white = new Color(0xffffff);
    const tint = new Color();
    g.traverse(o => {
        const c = (o as Mesh).geometry?.getAttribute('color');
        if (!c) {
            return;
        }
        const wood = o.name === 'fp3dTreeWood' || o.name === 'fp3dTreeLimbs';
        for (let i = 0; i < c.count; i++) {
            const l = 0.3 * c.getX(i) + 0.59 * c.getY(i) + 0.11 * c.getZ(i);
            if (wood) {
                // the bark is dark (l about 0.1): around the blue itself; snow (l near 1) goes towards white
                tint.copy(bark)
                    .multiplyScalar(Math.min(1.2, 0.7 + 2.5 * l))
                    .lerp(white, Math.max(0, Math.min(1, (l - 0.35) * 1.6)));
                c.setXYZ(i, tint.r, tint.g, tint.b);
                continue;
            }
            const k = Math.min(1, 0.12 + 2.4 * l);
            c.setXYZ(i, glow.r * k, glow.g * k, glow.b * k);
        }
    });
}

/** A tree or bush in its season, standing at the origin (its base); its parts named for the wind. */
export function buildTree(t: TreeSpec, light = true): Group {
    const rnd = random(t.id);
    const s = t.season;
    const g = new Group();
    g.name = 'fp3dTree';
    // the trunk leans from its foot, the crown rocks about the top of the trunk
    const sway = new Group();
    sway.name = 'fp3dTreeSway';
    g.add(sway);
    const turn = new Group();
    turn.rotation.y = -t.angle;
    sway.add(turn);
    const rw = t.w / 2;
    const rd = t.d / 2;
    const wood = new Parts();
    // the branches move with the crown
    const limbs = new Parts();
    const leaves = new Parts();
    const extra = new Parts();
    // a bush keeps some leaves the winter through
    const leaf = t.kind === 'bush' ? Math.max(0.45, s.leaf) : t.kind === 'tree_conifer' ? 1 : s.leaf;
    let crownAt = 0;
    if (t.kind === 'tree_conifer') {
        // a short trunk, then cones stacked up to the top
        const trunkH = t.h * 0.18;
        wood.add(
            new CylinderGeometry(0.08 + t.w * 0.02, 0.12 + t.w * 0.03, trunkH, 7).translate(0, trunkH / 2, 0),
            WOOD,
        );
        const tiers = 4;
        const green = leafColor(t.kind, s, 0);
        for (let i = 0; i < tiers; i++) {
            const f = i / tiers;
            const y0 = trunkH * 0.8 + (t.h - trunkH) * f * 0.78;
            const hh = (t.h - trunkH) * (0.42 - f * 0.05);
            const r = rw * (1 - f * 0.68);
            const cone = new ConeGeometry(r, hh, 9, 1).translate(0, y0 + hh / 2, 0);
            cone.scale(1, 1, rd / rw);
            leaves.add(cone, green.clone().multiplyScalar(0.92 + 0.16 * rnd()), t.snow);
        }
        crownAt = trunkH;
    } else {
        const bush = t.kind === 'bush';
        const fruit = t.kind === 'tree_fruit';
        const trunkH = bush ? 0 : t.h * (fruit ? 0.38 : 0.42);
        const crownH = t.h - trunkH;
        const trunkR = bush ? 0 : 0.06 + t.w * (fruit ? 0.025 : 0.03);
        crownAt = trunkH;
        if (!bush) {
            wood.add(
                new CylinderGeometry(trunkR * 0.7, trunkR, trunkH * 1.05, 7).translate(0, trunkH * 0.52, 0),
                WOOD,
                t.snow * 0.3,
            );
        }
        // the branches: a few from the top of the trunk (from the ground for a bush), each with two twigs
        const nb = bush ? 6 : 5 + Math.floor(rnd() * 2);
        const tips: Vector3[] = [];
        for (let i = 0; i < nb; i++) {
            const a = (i / nb) * Math.PI * 2 + rnd() * 0.6;
            const out = 0.45 + 0.2 * rnd();
            const from = new Vector3(0, bush ? 0 : trunkH * 0.95, 0);
            const to = new Vector3(
                Math.cos(a) * rw * out,
                trunkH + crownH * (0.35 + 0.2 * rnd()),
                Math.sin(a) * rd * out,
            );
            limbs.add(branch(from, to, bush ? 0.025 : trunkR * 0.55, bush ? 0.01 : trunkR * 0.18), WOOD, t.snow);
            for (let k = 0; k < 2; k++) {
                const b = (k - 0.5) * 0.9 + (rnd() - 0.5) * 0.4;
                const tip = new Vector3(
                    Math.cos(a + b) * rw * (out + 0.12),
                    to.y + crownH * (0.08 + 0.12 * rnd()),
                    Math.sin(a + b) * rd * (out + 0.12),
                );
                const mid = from.clone().lerp(to, 0.7);
                limbs.add(branch(mid, tip, bush ? 0.012 : trunkR * 0.2, 0.008), WOOD, t.snow);
                tips.push(tip);
            }
        }
        // the crown: blobs of leaves around the branches; fewer and smaller as they fall
        if (leaf > 0.06) {
            // one on top, the others in a ring around it
            const nl = bush ? 6 : fruit ? 8 : 10;
            for (let i = 0; i < nl; i++) {
                const k = rnd();
                // in late autumn the crown thins out blob by blob
                if (rnd() > Math.min(1, leaf * 1.25)) {
                    continue;
                }
                const a = (i / (nl - 1)) * Math.PI * 2 + rnd() * 0.5;
                const rr = i === 0 ? 0 : 0.42 + 0.14 * rnd();
                const y = trunkH + crownH * (i === 0 ? 0.66 : (bush ? 0.38 : 0.42) + 0.22 * rnd());
                const size =
                    (i === 0 ? 1.2 : 1) *
                    (bush ? 0.46 : 0.44) *
                    Math.min(rw, rd) *
                    2 *
                    (0.75 + 0.35 * rnd()) *
                    (0.55 + 0.45 * leaf);
                const b = blob(size / 2, rnd);
                b.scale(rw / Math.min(rw, rd), Math.min(1, crownH / (rw * 1.6)) * 0.95, rd / Math.min(rw, rd));
                b.translate(Math.cos(a) * rw * rr, y, Math.sin(a) * rd * rr);
                leaves.add(b, leafColor(t.kind, s, k).multiplyScalar(0.9 + 0.2 * rnd()), t.snow);
            }
        }
        // blossom in spring, apples in late summer: small balls on the crown's skin
        const dots = (count: number, color: Color, r: number): void => {
            for (let i = 0; i < count; i++) {
                const a = rnd() * Math.PI * 2;
                const up = rnd() * 0.9 - 0.2;
                const c = Math.sqrt(1 - up * up);
                const p = new Vector3(
                    Math.cos(a) * c * rw * 0.8,
                    trunkH + crownH * (0.5 + up * 0.38),
                    Math.sin(a) * c * rd * 0.8,
                );
                extra.add(new IcosahedronGeometry(r, 0).translate(p.x, p.y, p.z), color);
            }
        };
        if (fruit && s.blossom > 0.08) {
            dots(Math.round(70 * s.blossom), new Color(0xfbe3ee), 0.07);
        }
        if (fruit && s.fruit > 0.08 && leaf > 0.2) {
            dots(Math.round(30 * s.fruit), new Color(0xc8261d), 0.1);
        }
        // the leaves that fall in the wind (moved by animateTree)
        if (!bush && s.fall > 0.05 && leaf > 0.05) {
            const n = Math.round(36 * s.fall);
            const pos = new Float32Array(n * 3);
            const col = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                pos.set([(rnd() - 0.5) * rw * 1.6, trunkH + rnd() * crownH, (rnd() - 0.5) * rd * 1.6], i * 3);
                const c = AUTUMN[Math.floor(rnd() * AUTUMN.length)];
                col.set([c.r, c.g, c.b], i * 3);
            }
            const geo = new BufferGeometry();
            geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
            geo.setAttribute('color', new Float32BufferAttribute(col, 3));
            const pg = new Points(geo, new PointsMaterial({ size: 0.13, vertexColors: true, sizeAttenuation: true }));
            pg.frustumCulled = false;
            pg.name = 'fp3dTreeLeaves';
            pg.userData.fp3dTop = trunkH + crownH;
            pg.userData.fp3dR = [rw, rd];
            g.add(pg);
        }
    }
    const w = wood.mesh('fp3dTreeWood');
    if (w) {
        turn.add(w);
    }
    // the crown rocks about the top of the trunk
    const crown = new Group();
    crown.name = 'fp3dTreeCrown';
    crown.position.y = crownAt;
    sway.add(crown);
    const crownTurn = new Group();
    crownTurn.rotation.y = -t.angle;
    crownTurn.position.y = -crownAt;
    crown.add(crownTurn);
    for (const m of [limbs.mesh('fp3dTreeLimbs'), leaves.mesh('fp3dTreeLeaf'), extra.mesh('fp3dTreeExtra')]) {
        if (m) {
            crownTurn.add(m);
        }
    }
    if (!light) {
        neon(g);
    }
    g.userData.fp3dKind = t.kind;
    g.userData.fp3dSeed = rnd() * 100;
    return g;
}

/** The wind for the trees: where it blows to (rad, clockwise from the top of the plan), m/s, gustiness 0 … 1. */
export interface TreeWind {
    to: number;
    speed: number;
    gust: number;
}

/** Sways a tree in the wind and lets its leaves fall; true while something moves. */
export function animateTree(g: Object3D, wind: TreeWind | null, t: number, dt: number): boolean {
    const sway = g.getObjectByName('fp3dTreeSway');
    const crown = g.getObjectByName('fp3dTreeCrown');
    if (!sway || !crown) {
        return false;
    }
    const kind = g.userData.fp3dKind as TreeKind;
    const seed = (g.userData.fp3dSeed as number) || 0;
    const speed = wind ? Math.min(30, wind.speed) : 0;
    // a conifer and a bush are stiffer
    const stiff = kind === 'tree_conifer' ? 0.55 : kind === 'bush' ? 0.5 : kind === 'tree_fruit' ? 0.85 : 1;
    const dx = wind ? Math.sin(wind.to) : 0;
    const dz = wind ? -Math.cos(wind.to) : 0;
    // gusts come and go
    const gust = wind ? wind.gust : 0;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.37 + seed) * Math.sin(t * 0.13 + seed * 0.7);
    const strength = speed * (1 + gust * 1.2 * pulse);
    const lean = stiff * Math.min(0.09, 0.0035 * strength);
    const lean2 = stiff * Math.min(0.12, 0.006 * strength);
    const amp = stiff * (0.003 + 0.0016 * strength) * (0.6 + 0.8 * pulse);
    const a1 = lean + amp * Math.sin(t * (1.1 + speed * 0.03) + seed);
    const a2 = lean2 + amp * 1.8 * Math.sin(t * (2.3 + speed * 0.05) + seed * 1.7);
    // side to side a little too
    const side = amp * 0.6 * Math.sin(t * 1.7 + seed * 2.3);
    sway.rotation.set(a1 * dz + side * dx, 0, -a1 * dx + side * dz);
    crown.rotation.set(a2 * dz, 0, -a2 * dx);
    // the leaves: they drift down with the wind and start again in the crown
    const lv = g.getObjectByName('fp3dTreeLeaves') as Points | undefined;
    let moving = speed > 0.3;
    if (lv && dt > 0) {
        const p = lv.geometry.getAttribute('position');
        const top = lv.userData.fp3dTop as number;
        const [rw, rd] = lv.userData.fp3dR as [number, number];
        const drift = 0.25 + speed * 0.35;
        for (let i = 0; i < p.count; i++) {
            let x = p.getX(i) + (dx * drift + Math.sin(t * 2 + i) * 0.3) * dt;
            let y = p.getY(i) - (0.45 + 0.15 * Math.sin(t * 3 + i * 1.3)) * dt;
            let z = p.getZ(i) + (dz * drift + Math.cos(t * 1.7 + i) * 0.3) * dt;
            if (y < 0.02 || Math.hypot(x, z) > Math.max(rw, rd) * 4) {
                x = Math.sin(i * 12.9 + t) * 0.5 * rw * 1.4;
                z = Math.cos(i * 7.3 + t) * 0.5 * rd * 1.4;
                y = top * (0.55 + 0.4 * Math.abs(Math.sin(i * 3.1 + t)));
            }
            p.setXYZ(i, x, y, z);
        }
        p.needsUpdate = true;
        moving = moving || speed > 1;
    }
    return moving;
}

/** Frees the geometry and materials of a group of trees. */
export function disposeTrees(group: Object3D): void {
    group.traverse(o => {
        const m = o as Mesh;
        if (m.geometry) {
            m.geometry.dispose();
        }
        const mat = m.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(mat)) {
            mat.forEach(x => x.dispose());
        } else {
            mat?.dispose();
        }
    });
}

// A rainwater tank in the garden: a rain barrel standing on the ground (green plastic, the water seen through it)
// or a cistern in the ground (seen through the earth as a glass body, its lid on the lawn). Its fill comes from a
// level sensor in %, litres, m³ or as a height (cm, m); while it rains, water runs in from above.
import {
    BoxGeometry,
    type BufferGeometry,
    Color,
    CylinderGeometry,
    EdgesGeometry,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    TorusGeometry,
} from 'three';
import { shade } from './anchor';

export const RAIN_TANK_KINDS = ['barrel', 'cistern'] as const;
export type RainTankKind = (typeof RAIN_TANK_KINDS)[number];

/** Width, depth, height (m): a 300 l barrel; a cistern in the ground (its depth is the height). */
export const RAIN_TANK_SIZES: Record<RainTankKind, [number, number, number]> = {
    barrel: [0.7, 0.7, 1],
    cistern: [2.2, 1.6, 1.5],
};

/** Below this fill (0 … 1) the tank shows its label in the warning colour. */
export const RAIN_LOW = 0.1;

export function rainTankKind(variant: string | null | undefined): RainTankKind {
    return variant === 'cistern' ? 'cistern' : 'barrel';
}

/** What the tank holds when full (l): a barrel is round, a cistern a box. */
export function rainTankCapacity(kind: RainTankKind, w: number, d: number, h: number): number {
    const m3 = kind === 'barrel' ? Math.PI * (Math.min(w, d) / 2) ** 2 * h : w * d * h;
    return Math.round(m3 * 1000 * 0.95);
}

/**
 * The fill (0 … 1) from a level sensor: in % (or a fraction without a unit), in litres or m³ of `capacity` (l), or as
 * the water's height in cm, mm or m of the tank's `depth` (m); null: no number.
 */
export function rainTankFill(
    state: string | null | undefined,
    unit: string,
    capacity: number,
    depth: number,
): number | null {
    const n = Number(String(state ?? '').replace(',', '.'));
    if (!String(state ?? '').trim() || !Number.isFinite(n)) {
        return null;
    }
    const u = unit.trim().toLowerCase();
    let f: number;
    if (u === '%') {
        f = n / 100;
    } else if (u === 'l' || u === 'liter' || u === 'litre') {
        f = n / Math.max(1, capacity);
    } else if (u === 'm³' || u === 'm3') {
        f = (n * 1000) / Math.max(1, capacity);
    } else if (u === 'cm') {
        f = n / 100 / Math.max(0.05, depth);
    } else if (u === 'mm') {
        f = n / 1000 / Math.max(0.05, depth);
    } else if (u === 'm') {
        f = n / Math.max(0.05, depth);
    } else {
        f = n > 1.0001 ? n / 100 : n;
    }
    return Math.min(1, Math.max(0, f));
}

const WATER = 0x3f9fdc;

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
 * A rain barrel or a cistern at the origin (the ground), its front at +z, filled to `fill` (null: unknown, no water
 * shown). `userData.inlet` is the height where the rain runs in.
 */
export function buildRainTank(
    kind: RainTankKind,
    w: number,
    d: number,
    h: number,
    fill: number | null,
    light = true,
): Group {
    const g = new Group();
    g.name = 'fp3dRainTank';
    const level = Math.min(1, Math.max(0, fill ?? 0));
    if (kind === 'barrel') {
        const r = Math.min(w, d) / 2;
        const green = light ? 0x3e7a3a : 0x4fae6a;
        // the water first, then the barrel's wall over it (seen through)
        if (fill !== null && level > 0.003) {
            const wh = Math.max(0.01, (h - 0.06) * level);
            const water = part(
                g,
                new CylinderGeometry(r * 0.93, r * 0.87, wh, 24).translate(0, 0.03 + wh / 2, 0),
                WATER,
                0.9,
            );
            water.renderOrder = 2;
        }
        // a barrel bulging a little in the middle
        const wall = new CylinderGeometry(r, r * 0.9, h, 28, 6, true);
        const pos = wall.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i) / h;
            const k = 1 + 0.06 * (1 - 4 * y * y);
            pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
        }
        const shell = part(g, wall.translate(0, h / 2, 0), green, 0.55);
        shell.renderOrder = 3;
        part(g, new CylinderGeometry(r * 0.9, r * 0.9, 0.03, 24).translate(0, 0.015, 0), green);
        // the hoops and the lid
        for (const y of [0.22, 0.78]) {
            part(g, new TorusGeometry(r * 1.04, 0.015, 6, 28).rotateX(Math.PI / 2).translate(0, h * y, 0), green);
        }
        part(
            g,
            new CylinderGeometry(r * 1.03, r * 1.03, 0.04, 28).translate(0, h + 0.02, 0),
            light ? 0x2f5f2c : 0x3d8f56,
        );
        // the tap at the front near the bottom
        part(
            g,
            new CylinderGeometry(0.02, 0.02, 0.09, 8).rotateX(Math.PI / 2).translate(0, 0.14, r * 0.98 + 0.03),
            0x9aa3ab,
        );
        part(g, new BoxGeometry(0.025, 0.05, 0.025).translate(0, 0.165, r * 0.98 + 0.07), 0x9aa3ab);
        g.userData.inlet = h + 0.04;
    } else {
        // a cistern in the ground: a glass body from -h to 0, seen through the earth, the water up to its level
        const glass = new MeshBasicMaterial({
            color: light ? 0xc9d6de : 0x9fd8ff,
            transparent: true,
            opacity: light ? 0.28 : 0.16,
            depthWrite: false,
            depthTest: false,
        });
        const body = new BoxGeometry(w, h, d).translate(0, -h / 2, 0);
        const shell = new Mesh(body, glass);
        shell.renderOrder = 7;
        g.add(shell);
        const edges = new LineSegments(
            new EdgesGeometry(body, 30),
            new LineBasicMaterial({
                color: light ? 0x5b7a90 : 0x8fd3ff,
                transparent: true,
                opacity: 0.8,
                depthTest: false,
            }),
        );
        edges.renderOrder = 9;
        g.add(edges);
        if (fill !== null && level > 0.003) {
            const wh = Math.max(0.01, (h - 0.05) * level);
            const water = part(
                g,
                new BoxGeometry(w - 0.05, wh, d - 0.05).translate(0, -h + 0.025 + wh / 2, 0),
                WATER,
                0.85,
            );
            (water.material as MeshBasicMaterial).depthTest = false;
            water.renderOrder = 8;
        }
        // the round lid on the ground and its shaft
        const lid = Math.min(w, d) * 0.32;
        const lidParts = [
            part(g, new CylinderGeometry(lid, lid, 0.05, 24).translate(0, 0.025, 0), light ? 0x2f5f2c : 0x3d8f56),
            part(
                g,
                new CylinderGeometry(lid * 0.6, lid * 0.6, 0.012, 20).translate(0, 0.056, 0),
                light ? 0x264d24 : 0x2f7044,
            ),
        ];
        // drawn after the glass, which goes over everything
        for (const m of lidParts) {
            m.renderOrder = 10;
        }
        g.userData.inlet = 0.06;
    }
    return g;
}

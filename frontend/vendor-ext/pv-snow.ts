// Snow on the solar modules of the roof (tasks.ts patches viewer3d.ts): a white cover over each field's modules while
// snow lies on the roof, gone from a field as soon as it produces (snow on dark glass slides off first, and a field
// that delivers power is clear anyway).
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';

type V3 = [number, number, number];

/** A field as the snow needs it: its id, the corners of its modules (lower left, lower right, upper right, upper left) and the normal. */
export interface PvSnowField {
    id: string;
    corners: V3[][];
    n: V3;
}

/** From this power (W) a field counts as clear of snow. */
export const PV_CLEAR_W = 30;

/** How far the snow lies over the glass (m). */
const LIFT = 0.03;

/** The snow over the fields' modules, lowered by `dy` into the local coordinates of their group (null: no module). */
export function buildPvSnow(fields: readonly PvSnowField[], dy: number, level: number): Group | null {
    const group = new Group();
    group.name = 'fp3dPvSnow';
    // over the living solar overlay (9): three.js sorts the children of a group by the group's own order
    group.renderOrder = 10;
    const mat = new MeshBasicMaterial({
        color: 0xf1f5ff,
        transparent: true,
        opacity: 0.92 * Math.max(0, Math.min(1, level)),
        side: DoubleSide,
        depthWrite: false,
    });
    for (const f of fields) {
        const len = Math.hypot(...f.n) || 1;
        const lift: V3 = [(f.n[0] / len) * LIFT, (f.n[1] / len) * LIFT, (f.n[2] / len) * LIFT];
        const at = (p: V3): number[] => [p[0] + lift[0], p[1] + lift[1] - dy, p[2] + lift[2]];
        const pos: number[] = [];
        for (const m of f.corners) {
            if (m.length < 4) {
                continue;
            }
            const [a, b, c, d] = m.map(at);
            pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        }
        if (!pos.length) {
            continue;
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
        const mesh = new Mesh(geo, mat);
        // over the living solar overlay and the power written on the modules
        mesh.renderOrder = 10;
        mesh.userData.fieldId = f.id;
        group.add(mesh);
    }
    return group.children.length ? group : null;
}

/** Clears the fields that produce now: their snow is hidden. */
export function writePvSnow(group: Group, watts: ReadonlyMap<string, number>): void {
    for (const m of group.children) {
        m.visible = !((watts.get(m.userData.fieldId as string) ?? 0) >= PV_CLEAR_W);
    }
}

// A robot mower and its charging station, as the 3D view draws them (home-fx.ts) and as the furniture library shows
// them (item pictures).
import {
    BoxGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    type BufferGeometry,
    type Object3D,
    Color,
} from 'three';
import { shade } from './anchor';

function part(group: Object3D, geo: BufferGeometry, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    group.add(m);
    return m;
}

/** A robot mower: grey body, orange cover, two big wheels at the back; its front is local -z. */
export function buildMower(size: number): Group {
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
export function buildDock(size: number): Group {
    const g = new Group();
    const k = Math.max(0.3, size) / 0.6;
    part(g, new BoxGeometry(0.52 * k, 0.025 * k, 0.75 * k).translate(0, 0.012 * k, 0), 0x2b2f33);
    part(g, new BoxGeometry(0.5 * k, 0.22 * k, 0.1 * k).translate(0, 0.11 * k, 0.37 * k), 0x3a3f44);
    part(g, new BoxGeometry(0.12 * k, 0.03 * k, 0.01 * k).translate(0, 0.15 * k, 0.315 * k), 0x7ed957);
    return g;
}

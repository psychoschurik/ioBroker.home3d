// The pictures in the editor's furniture library of the items the viewer draws itself, not as furniture: their
// library picture (viewer/preview.ts, patched in `boatPictures` of tasks.ts) stayed empty, so it is built the same
// way. A boat's anchor stowed in its roller, a tank half full of fresh water, the rudder straight, the propeller, a lit
// bicolour light (red and green), a closed hatch (anchor.ts, boat-gear.ts); a robot mower on its charging station, a
// sprinkler watering its circle, a wind indicator on its mast, a parking spot with a car in it. The awning is drawn by
// preview.ts itself.
import {
    BoxGeometry,
    CircleGeometry,
    Color,
    CylinderGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    TubeGeometry,
    QuadraticBezierCurve3,
    Vector3,
} from 'three';
import { buildAnchor, disposeAnchor, shade } from './anchor';
import { buildCar } from './cars';
import { buildGear, disposeGear } from './boat-gear';
import { isGear } from './boat-kinds';
import { buildDock, buildMower } from './mower-model';
import { buildVane, disposeVanes } from './wind-vane';

/** The items of the garden drawn here (not by boat-gear.ts). */
const GARDEN = new Set(['robot_mower', 'sprinkler', 'wind_vane', 'parking']);

/** A parking spot: its white marking on the asphalt, the arrow to the front, a car standing in it. */
function parkingPicture(w: number, d: number): Group {
    const g = new Group();
    const flat = (x: number, z: number, sx: number, sz: number, color: number, y = 0): void => {
        g.add(
            new Mesh(
                shade(new BoxGeometry(sx, 0.02, sz).translate(x, y + 0.01, z), new Color(color)),
                new MeshBasicMaterial({ vertexColors: true }),
            ),
        );
    };
    flat(0, 0, w, d, 0x4a4f55);
    const line = 0.1;
    for (const side of [-1, 1]) {
        flat((side * (w - line)) / 2, 0, line, d, 0xf2f2f2, 0.005);
    }
    flat(0, -(d - line) / 2, w, line, 0xf2f2f2, 0.005);
    const car = buildCar('car_sedan', Math.min(1.85, w * 0.72), Math.min(4.75, d * 0.88), 1.45, null);
    g.add(car);
    return g;
}

/** A robot mower on its charging station, half way in. */
function mowerPicture(w: number, d: number): Group {
    const g = new Group();
    const size = Math.max(0.3, Math.min(w, d));
    const dock = buildDock(size);
    const mower = buildMower(size);
    // the mower drives into the station backwards: its front (local -z) away from the post
    mower.position.set(0, 0.025, -0.05 * size);
    g.add(dock, mower);
    return g;
}

/** A sprinkler in the middle of its lawn, its jets bowing out to the edge of the circle it waters. */
function sprinklerPicture(w: number): Group {
    const g = new Group();
    const r = Math.max(0.5, w / 2);
    const lawn = new Mesh(
        shade(new CircleGeometry(r, 48).rotateX(-Math.PI / 2), new Color(0x6fae4c)),
        new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
    );
    g.add(lawn);
    const k = r / 3;
    const head = new Mesh(
        shade(new CylinderGeometry(0.1 * k, 0.13 * k, 0.16 * k, 16).translate(0, 0.08 * k, 0), new Color(0x2b2f33)),
        new MeshBasicMaterial({ vertexColors: true }),
    );
    g.add(head);
    const water = new MeshBasicMaterial({ color: 0x5fc3ff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const end = new Vector3(Math.sin(a) * r * 0.92, 0.02, -Math.cos(a) * r * 0.92);
        const curve = new QuadraticBezierCurve3(
            new Vector3(0, 0.16 * k, 0),
            new Vector3(end.x * 0.5, r * 0.45, end.z * 0.5),
            end,
        );
        g.add(new Mesh(new TubeGeometry(curve, 24, 0.025 * k, 6), water));
    }
    return g;
}

/** A wind indicator: the arrow of a masthead on its mast, pointing into a wind from the right. */
function vanePicture(w: number): Group {
    const g = buildVane(
        {
            id: 'picture',
            floor: '',
            x: 0,
            z: 0,
            kind: 'windex',
            flag: '',
            size: Math.max(0.3, w),
            base: Math.max(0.4, w * 0.8),
            mast: true,
            label: '',
            warn: false,
        },
        { floorY: 0, light: true },
    );
    const head = g.getObjectByName('fp3dVaneHead');
    if (head) {
        head.rotation.y = -Math.PI / 3;
    }
    return g;
}

/** The model for the picture of a boat's item; null: not one of them. */
export function boatPicture(type: string, w: number, d: number, h: number, variant: string | null): Group | null {
    if (type === 'anchor') {
        return buildAnchor(
            {
                id: 'picture',
                floor: '',
                x: 0,
                z: 0,
                rotation: 0,
                length: d,
                chain: null,
                depth: null,
                distance: null,
                radius: null,
                alarm: false,
                label: '',
            },
            { deckY: 0, waterY: -1, light: false },
        );
    }
    if (GARDEN.has(type)) {
        const g =
            type === 'robot_mower'
                ? mowerPicture(w, d)
                : type === 'sprinkler'
                  ? sprinklerPicture(w)
                  : type === 'parking'
                    ? parkingPicture(w, d)
                    : vanePicture(w);
        g.userData.fp3dItemPicture = type;
        return g;
    }
    if (!isGear(type)) {
        return null;
    }
    return buildGear(
        {
            id: 'picture',
            floor: '',
            type,
            x: 0,
            z: 0,
            rotation: 0,
            w,
            d,
            h,
            base: 0,
            variant: variant ?? (type === 'nav_light' ? 'bicolor' : null),
            value: type === 'tank' ? 0.6 : type === 'nav_light' ? 1 : 0,
            label: '',
            warn: false,
            mast: false,
        },
        { floorY: 0, waterY: null, light: false, night: 0 },
    );
}

/** Frees the model of a picture (the geometry all sprites share stays). */
export function disposeBoatPicture(group: Group): void {
    if (group.userData.fp3dItemPicture === 'wind_vane') {
        disposeVanes(group);
    } else if (group.userData.fp3dItemPicture) {
        group.traverse(o => {
            const m = o as Mesh;
            if (m.isMesh) {
                m.geometry.dispose();
                for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
                    mat.dispose();
                }
            }
        });
    } else if (group.userData.fp3dAnchor !== undefined) {
        disposeAnchor(group);
    } else {
        disposeGear(group);
    }
}

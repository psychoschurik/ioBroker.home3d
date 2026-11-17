// The power of every solar field written on its modules ("123 W"), added to the 3D frontend at build time (tasks.ts
// patches viewer3d.ts and view3d.ts). The text lies on the glass and turns in steps of 90° with the camera, so it reads
// upright from wherever the field is looked at.
import {
    type Camera,
    CanvasTexture,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    type Object3D,
    PlaneGeometry,
    SRGBColorSpace,
    Vector3,
} from 'three';

type V3 = [number, number, number];

/** A field as the text needs it: its id, the corners of its modules (lower left, lower right, upper right, upper left) and the normal. */
export interface SolarTextField {
    id: string;
    corners: V3[][];
    n: V3;
}

interface TextData {
    fieldId: string;
    text: string;
    canvas: HTMLCanvasElement;
    texture: CanvasTexture;
    center: Vector3;
    n: Vector3;
    /** The edges of the field: along the eave (u) and up the slope (v), with their lengths. */
    u: Vector3;
    v: Vector3;
    lu: number;
    lv: number;
}

const KEY = 'fp3dSolarText';
const W = 512;
const H = 256;

/** Text meshes over the fields, lowered by `dy` into the local coordinates of their group (null: no field). */
export function buildSolarText(fields: readonly SolarTextField[], dy: number): Group | null {
    const group = new Group();
    for (const f of fields) {
        const pts = f.corners.flat().map(p => new Vector3(p[0], p[1] - dy, p[2]));
        if (!pts.length) {
            continue;
        }
        const [a, b, , d] = f.corners[0].map(p => new Vector3(p[0], p[1] - dy, p[2]));
        const u = b.clone().sub(a).normalize();
        const v = d.clone().sub(a).normalize();
        const n = new Vector3(...f.n).normalize();
        const center = pts.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / pts.length);
        const extent = (axis: Vector3): number => {
            const proj = pts.map(p => p.clone().sub(center).dot(axis));
            return Math.max(...proj) - Math.min(...proj);
        };
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        const material = new MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            forceSinglePass: true,
        });
        const mesh = new Mesh(new PlaneGeometry(1, 1), material);
        mesh.renderOrder = 7;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        const data: TextData = {
            fieldId: f.id,
            text: '',
            canvas,
            texture,
            center: center.addScaledVector(n, 0.015),
            n,
            u,
            v,
            lu: extent(u),
            lv: extent(v),
        };
        mesh.userData[KEY] = data;
        mesh.onBeforeRender = (_r, _s, camera) => place(mesh, data, camera);
        group.add(mesh);
    }
    return group.children.length ? group : null;
}

const up = new Vector3();
const right = new Vector3();
const dir = new Vector3();

/** Turn the text in the plane of the field so that it reads upright for the camera (in steps of 90°). */
function place(mesh: Mesh, t: TextData, camera: Camera): void {
    // the camera's up on the screen, laid into the field (looking straight down: the way it looks)
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    up.addScaledVector(t.n, -up.dot(t.n));
    if (up.lengthSq() < 1e-4) {
        up.setFromMatrixColumn(camera.matrixWorld, 2).negate();
        up.addScaledVector(t.n, -up.dot(t.n));
    }
    const options: [Vector3, number, number][] = [
        [t.v, t.lu, t.lv],
        [t.v.clone().negate(), t.lu, t.lv],
        [t.u, t.lv, t.lu],
        [t.u.clone().negate(), t.lv, t.lu],
    ];
    let best = options[0];
    for (const o of options) {
        if (o[0].dot(up) > best[0].dot(up)) {
            best = o;
        }
    }
    const [textUp, width, height] = best;
    // the text box fits the field: at most 85 % of it, twice as wide as high
    const w = Math.min(width * 0.85, height * 0.85 * (W / H));
    const h = (w * H) / W;
    dir.copy(textUp);
    right.crossVectors(dir, t.n).normalize();
    // the field may face down (its normal points away from the viewer): mirror it so the text never reads backwards
    if (t.n.dot(up.setFromMatrixColumn(camera.matrixWorld, 2)) < 0) {
        right.negate();
    }
    mesh.matrix.makeBasis(right.multiplyScalar(w), dir.clone().multiplyScalar(h), t.n);
    mesh.matrix.setPosition(t.center);
    mesh.updateMatrixWorld(true);
}

/** Text of a power: "0 W", "312 W", "1,2 kW" (in the language of the browser). */
export function powerText(w: number, lang = navigator.language): string {
    const n = Math.max(0, w);
    return n >= 1000
        ? `${(n / 1000).toLocaleString(lang, { maximumFractionDigits: 1 })} kW`
        : `${Math.round(n).toLocaleString(lang)} W`;
}

/** Write the power of the fields (W) on their modules; a field without a value shows nothing. */
export function writeSolarText(root: Object3D, watts: ReadonlyMap<string, number>): void {
    root.traverse(o => {
        const t = o.userData[KEY] as TextData | undefined;
        if (!t) {
            return;
        }
        const w = watts.get(t.fieldId);
        const text = w === undefined || !Number.isFinite(w) ? '' : powerText(w);
        o.visible = !!text;
        if (text === t.text) {
            return;
        }
        t.text = text;
        const ctx = t.canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        ctx.clearRect(0, 0, W, H);
        if (!text) {
            return;
        }
        let size = 150;
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        const width = ctx.measureText(text).width;
        if (width > W * 0.92) {
            size = Math.floor((size * W * 0.92) / width);
            ctx.font = `700 ${size}px system-ui, sans-serif`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.14;
        ctx.strokeStyle = 'rgba(10, 16, 32, 0.75)';
        ctx.strokeText(text, W / 2, H / 2);
        ctx.fillStyle = '#ffd36b';
        ctx.fillText(text, W / 2, H / 2);
        t.texture.needsUpdate = true;
    });
}

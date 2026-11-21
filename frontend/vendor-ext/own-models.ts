// Own 3D objects (furniture type "model3d"): a model from Blender, SketchUp, Fusion, a scan of a real thing … as
// GLB (glTF 2.0, with its colours and textures), OBJ or STL (in one colour). It is read once: its parts are baked
// into one space (metres, y up, standing on y = 0, centred over x/z) and shaded by a fixed sun like the furniture –
// the scene has no lights. A piece of furniture scales it into its box (width, depth, height); in the dark looks it
// takes the furniture's dark blue with glowing edges. While it loads, or when its file is missing, a box stands there.
import {
    AdditiveBlending,
    Box3,
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    EdgesGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    Vector3,
    type InstancedMesh,
    type Material,
    type Object3D,
    type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { base64Bytes, MODEL_MAX_BYTES, MODEL_MAX_TRIS, type ModelExt } from './model-files';

export type ModelErrorCode = 'big' | 'tris' | 'format' | 'draco' | 'ktx2' | 'external' | 'empty';

/** Why a file cannot be shown; the editor names the reason by its code. */
export class ModelError extends Error {
    readonly code: ModelErrorCode;
    constructor(code: ModelErrorCode, message?: string) {
        super(message ?? code);
        this.code = code;
    }
}

/** One part of a model: its geometry (baked into the model's space, shaded) and how it is painted. */
interface ModelPart {
    geo: BufferGeometry;
    color: Color;
    map: Texture | null;
    opacity: number;
    transparent: boolean;
    alphaTest: number;
}

export interface ModelTemplate {
    parts: ModelPart[];
    /** The natural size: width (x), depth (z), height (y) in metres. */
    size: [number, number, number];
    tris: number;
    /** The materials of the light and the dark looks and the edges of the dark ones, made when first needed. */
    light?: Material[];
    dark?: Material[];
    edges?: (BufferGeometry | null)[];
}

/** Where an item stands and how large it is (from the furniture; `y` above its floor). */
export interface ModelSpec {
    id: string;
    floor: string;
    model: string | null;
    x: number;
    z: number;
    y: number;
    /** Radians, as the furniture's rotation. */
    angle: number;
    w: number;
    d: number;
    h: number;
    mirror: boolean;
}

/** The colour of OBJ and STL (they carry no materials worth showing). */
const MONO = 0xc9c4bb;
const SUN = new Vector3(0.35, 0.85, 0.4).normalize();
const KEEP = ['position', 'normal', 'uv', 'color'];
/** The dark looks: the furniture's faces, from dark to lighter blue by the model's own brightness. */
const DARK_LOW = new Color(0x131d31);
const DARK_HIGH = new Color(0x3a4d78);
const EDGE = new LineBasicMaterial({
    color: 0x37e0ff,
    transparent: true,
    opacity: 0.45,
    blending: AdditiveBlending,
    depthWrite: false,
});
/** No edges for a part this dense (a scan): they would only be noise. */
const EDGE_MAX_TRIS = 200_000;

// ------------------------------------------------------------------ reading

/** The JSON of a glTF: the text of a .gltf, the first chunk of a GLB. */
export function gltfJson(bytes: Uint8Array, ext: 'glb' | 'gltf'): any {
    if (ext === 'gltf') {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // "glTF", then the JSON chunk ("JSON")
    if (bytes.length < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) {
        throw new ModelError('format');
    }
    const length = dv.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

/** Refuses what the page cannot read: Draco or KTX2 compression without a fallback, files beside the glTF. */
export function checkGltf(json: any): void {
    const required: unknown[] = Array.isArray(json?.extensionsRequired) ? json.extensionsRequired : [];
    if (required.includes('KHR_draco_mesh_compression')) {
        throw new ModelError('draco');
    }
    if (required.includes('KHR_texture_basisu')) {
        throw new ModelError('ktx2');
    }
    const outside = (list: unknown): boolean =>
        Array.isArray(list) &&
        list.some(
            x => typeof (x as { uri?: unknown })?.uri === 'string' && !(x as { uri: string }).uri.startsWith('data:'),
        );
    if (outside(json?.buffers) || outside(json?.images)) {
        throw new ModelError('external');
    }
}

/**
 * OBJ and STL know no unit: millimetres, centimetres or metres by the size of the thing (a glTF is in metres). A
 * piece of furniture measures some 0.3 … 5 in metres, 30 … 500 in centimetres; an STL is mostly made for a 3D
 * printer, in millimetres. A wrong guess is corrected with the item's width, depth and height.
 */
export function unitScale(ext: ModelExt, largest: number): number {
    if (ext === 'glb' || ext === 'gltf') {
        return 1;
    }
    if (ext === 'stl') {
        return largest > 8 ? 0.001 : 1;
    }
    return largest > 500 ? 0.001 : largest > 8 ? 0.01 : 1;
}

/** A copy with only what is drawn, in plain (not interleaved) attributes, moved by `m`. */
function bake(geo: BufferGeometry, m: Matrix4): BufferGeometry {
    const g = new BufferGeometry();
    for (const k of KEEP) {
        const a = geo.getAttribute(k);
        if (!a) {
            continue;
        }
        const plain = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) {
            for (let c = 0; c < a.itemSize; c++) {
                plain[i * a.itemSize + c] = a.getComponent(i, c);
            }
        }
        g.setAttribute(k, new BufferAttribute(plain, a.itemSize));
    }
    if (geo.index) {
        g.setIndex(geo.index.clone());
    }
    for (const gr of geo.groups) {
        g.addGroup(gr.start, gr.count, gr.materialIndex);
    }
    g.applyMatrix4(m);
    return g;
}

/** A geometry with several materials, as one geometry per material. */
function byMaterial(geo: BufferGeometry, mats: Material[]): [BufferGeometry, Material | undefined][] {
    if (!geo.groups.length || mats.length < 2) {
        return [[geo, mats[0]]];
    }
    const flat = geo.index ? geo.toNonIndexed() : geo;
    return geo.groups.map(gr => {
        const g = new BufferGeometry();
        for (const [k, a] of Object.entries(flat.attributes)) {
            const s = a.itemSize;
            const arr = a.array as Float32Array;
            g.setAttribute(k, new BufferAttribute(arr.slice(gr.start * s, (gr.start + gr.count) * s), s));
        }
        return [g, mats[gr.materialIndex ?? 0] ?? mats[0]];
    });
}

/** How a part is painted: the material's colour and texture (OBJ and STL: one colour). */
function paint(mat: Material | undefined, mono: boolean): Omit<ModelPart, 'geo'> {
    const m = (mat ?? {}) as Partial<{
        color: Color;
        map: Texture | null;
        opacity: number;
        transparent: boolean;
        alphaTest: number;
        transmission: number;
    }>;
    // glass (KHR_materials_transmission) is not transparent to three's basic materials: see-through by its opacity
    const glass = (m.transmission ?? 0) > 0.2;
    return {
        color: mono || !m.color ? new Color(MONO) : m.color.clone(),
        map: mono ? null : (m.map ?? null),
        opacity: glass ? Math.min(m.opacity ?? 1, 0.35) : (m.opacity ?? 1),
        transparent: glass || !!m.transparent,
        alphaTest: m.alphaTest ?? 0,
    };
}

/** The parts of a loaded scene in its own space (instances unfolded); points and lines are left out. */
function partsOf(root: Object3D, mono: boolean): ModelPart[] {
    root.updateMatrixWorld(true);
    const parts: ModelPart[] = [];
    root.traverse(o => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) {
            return;
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
        const matrices: Matrix4[] = [];
        if (inst) {
            const m = new Matrix4();
            for (let i = 0; i < inst.count; i++) {
                inst.getMatrixAt(i, m);
                matrices.push(mesh.matrixWorld.clone().multiply(m));
            }
        } else {
            matrices.push(mesh.matrixWorld);
        }
        for (const matrix of matrices) {
            for (const [geo, mat] of byMaterial(bake(mesh.geometry, matrix), mats)) {
                parts.push({ geo, ...paint(mat, mono) });
            }
        }
    });
    return parts;
}

function triangles(geo: BufferGeometry): number {
    return Math.floor((geo.index ? geo.index.count : geo.getAttribute('position').count) / 3);
}

/** Colours by the light of a fixed sun, times the model's own vertex colours; the normals are not needed after. */
function shade(geo: BufferGeometry): void {
    if (!geo.getAttribute('normal')) {
        geo.computeVertexNormals();
    }
    const n = geo.getAttribute('normal');
    const own = geo.getAttribute('color');
    const out = new Float32Array(n.count * 3);
    const v = new Vector3();
    for (let i = 0; i < n.count; i++) {
        v.fromBufferAttribute(n, i);
        const k = 0.5 + 0.5 * Math.max(0, v.dot(SUN));
        out[i * 3] = k * (own ? own.getX(i) : 1);
        out[i * 3 + 1] = k * (own ? own.getY(i) : 1);
        out[i * 3 + 2] = k * (own ? own.getZ(i) : 1);
    }
    geo.setAttribute('color', new Float32BufferAttribute(out, 3));
    geo.deleteAttribute('normal');
}

/**
 * Moves the parts so the model stands on y = 0 centred over x/z, in metres (`unit` from the file's units); its
 * natural size. An STL stands on z (as a 3D printer builds it): turned so that z is up.
 */
function normalize(parts: ModelPart[], ext: ModelExt): [number, number, number] {
    if (ext === 'stl') {
        const up = new Matrix4().makeRotationX(-Math.PI / 2);
        for (const p of parts) {
            p.geo.applyMatrix4(up);
        }
    }
    const box = new Box3();
    for (const p of parts) {
        p.geo.computeBoundingBox();
        box.union(p.geo.boundingBox!);
    }
    const size = box.getSize(new Vector3());
    const unit = unitScale(ext, Math.max(size.x, size.y, size.z));
    const centre = box.getCenter(new Vector3());
    const m = new Matrix4()
        .makeScale(unit, unit, unit)
        .multiply(new Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
    for (const p of parts) {
        p.geo.applyMatrix4(m);
        p.geo.computeBoundingBox();
        p.geo.computeBoundingSphere();
    }
    const round = (n: number): number => Math.max(0.01, Math.round(n * unit * 1000) / 1000);
    return [round(size.x), round(size.z), round(size.y)];
}

/** Reads a model file; throws a `ModelError` for what the page cannot show. */
export async function readModel(data: ArrayBuffer | Uint8Array, ext: ModelExt): Promise<ModelTemplate> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > MODEL_MAX_BYTES) {
        throw new ModelError('big');
    }
    // a copy of exactly these bytes: the loaders read the whole buffer
    const buffer = bytes.slice().buffer;
    let parts: ModelPart[];
    try {
        if (ext === 'glb' || ext === 'gltf') {
            checkGltf(gltfJson(bytes, ext));
            const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
            const gltf = await loader.parseAsync(ext === 'gltf' ? new TextDecoder().decode(bytes) : buffer, '');
            parts = partsOf(gltf.scene, false);
        } else if (ext === 'obj') {
            parts = partsOf(new OBJLoader().parse(new TextDecoder().decode(bytes)), true);
        } else {
            const geo = new STLLoader().parse(buffer);
            parts = partsOf(new Mesh(geo), true);
        }
    } catch (e) {
        throw e instanceof ModelError ? e : new ModelError('format', (e as Error)?.message);
    }
    parts = parts.filter(p => triangles(p.geo) > 0);
    const tris = parts.reduce((n, p) => n + triangles(p.geo), 0);
    if (!tris) {
        throw new ModelError('empty');
    }
    if (tris > MODEL_MAX_TRIS) {
        throw new ModelError('tris');
    }
    const size = normalize(parts, ext);
    for (const p of parts) {
        shade(p.geo);
    }
    return { parts, size, tris };
}

// ------------------------------------------------------------------ the models of the page

type Reader = (id: string) => Promise<{ data: string; ext: ModelExt }>;
let reader: Reader | null = null;
const cache = new Map<string, { state: 'loading' | 'ready' | 'failed'; template?: ModelTemplate }>();
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
    version++;
    for (const fn of listeners) {
        fn();
    }
}

/** Where the files come from (the store of the frame, through the 3D view's connection). */
export function setModelReader(fn: Reader): void {
    reader = fn;
}

/** A model just read (an upload in the editor): no need to load it again. */
export function cacheModel(id: string, template: ModelTemplate): void {
    cache.set(id, { state: 'ready', template });
    changed();
}

/** Counts every model that was loaded or failed: the 3D view builds its objects again. */
export function modelsVersion(): number {
    return version;
}

export function onModelChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** The model, once loaded; "loading" starts the loading; null: none chosen, missing or unreadable. */
export function modelTemplate(id: string | null | undefined): ModelTemplate | 'loading' | null {
    if (!id) {
        return null;
    }
    const known = cache.get(id);
    if (known) {
        return known.state === 'ready' ? known.template! : known.state === 'loading' ? 'loading' : null;
    }
    if (!reader) {
        return null;
    }
    cache.set(id, { state: 'loading' });
    reader(id)
        .then(r => readModel(base64Bytes(r.data), r.ext))
        .then(
            template => cache.set(id, { state: 'ready', template }),
            () => cache.set(id, { state: 'failed' }),
        )
        .finally(changed);
    return 'loading';
}

// ------------------------------------------------------------------ building

/** What makes an item be built anew. */
export function modelKey(s: ModelSpec, floorY: number): string {
    return [
        s.id,
        s.model ?? '',
        s.x.toFixed(3),
        s.z.toFixed(3),
        (floorY + s.y).toFixed(3),
        s.angle.toFixed(3),
        s.w.toFixed(3),
        s.d.toFixed(3),
        s.h.toFixed(3),
        s.mirror ? 1 : 0,
    ].join(',');
}

function materials(t: ModelTemplate, light: boolean): Material[] {
    if (light) {
        return (t.light ??= t.parts.map(
            p =>
                new MeshBasicMaterial({
                    vertexColors: true,
                    color: p.color,
                    map: p.map,
                    transparent: p.transparent || p.opacity < 1,
                    opacity: p.opacity,
                    alphaTest: p.alphaTest,
                    depthWrite: p.opacity >= 0.9,
                    side: DoubleSide,
                }),
        ));
    }
    return (t.dark ??= t.parts.map(p => {
        const l = p.map ? 0.55 : 0.3 * p.color.r + 0.59 * p.color.g + 0.11 * p.color.b;
        return new MeshBasicMaterial({
            vertexColors: true,
            color: DARK_LOW.clone().lerp(DARK_HIGH, Math.min(1, l)),
            transparent: p.opacity < 1,
            opacity: Math.max(0.3, p.opacity),
            depthWrite: p.opacity >= 0.9,
            side: DoubleSide,
        });
    }));
}

function edgesOf(t: ModelTemplate): (BufferGeometry | null)[] {
    return (t.edges ??= t.parts.map(p => (triangles(p.geo) > EDGE_MAX_TRIS ? null : new EdgesGeometry(p.geo, 30))));
}

/** Lines are not tapped (three's raycaster takes a whole metre around a line). */
function untappable(line: LineSegments): LineSegments {
    line.raycast = () => {};
    return line;
}

/** Into the item's box, turned and mirrored as the furniture. */
function place(inner: Object3D, s: ModelSpec, size: [number, number, number]): Group {
    inner.scale.set((s.w / size[0]) * (s.mirror ? -1 : 1), s.h / size[2], s.d / size[1]);
    inner.rotation.y = -s.angle;
    const g = new Group();
    g.name = 'fp3dModel';
    g.userData.fp3dFurniture = s.id;
    g.add(inner);
    return g;
}

/** The model of an item, scaled into its box. */
export function buildModel(t: ModelTemplate, s: ModelSpec, light: boolean): Group {
    const inner = new Group();
    const mats = materials(t, light);
    t.parts.forEach((p, i) => inner.add(new Mesh(p.geo, mats[i])));
    if (!light) {
        for (const e of edgesOf(t)) {
            if (e) {
                inner.add(untappable(new LineSegments(e, EDGE)));
            }
        }
    }
    return place(inner, s, t.size);
}

let box: { geo: BufferGeometry; edges: BufferGeometry; light: Material; dark: Material; line: Material } | null = null;

/** A box where the model is not (yet) there: while it loads, without a model, or when its file is missing. */
export function buildPlaceholder(s: ModelSpec, light: boolean): Group {
    if (!box) {
        const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
        const edges = new EdgesGeometry(geo);
        shade(geo);
        box = {
            geo,
            edges,
            light: new MeshBasicMaterial({
                vertexColors: true,
                color: 0xb9c6d3,
                transparent: true,
                opacity: 0.45,
                depthWrite: false,
            }),
            dark: new MeshBasicMaterial({
                vertexColors: true,
                color: DARK_HIGH,
                transparent: true,
                opacity: 0.5,
                depthWrite: false,
            }),
            line: new LineBasicMaterial({ color: 0x5b6b7c }),
        };
    }
    const inner = new Group();
    inner.add(new Mesh(box.geo, light ? box.light : box.dark));
    inner.add(untappable(new LineSegments(box.edges, light ? box.line : EDGE)));
    return place(inner, s, [1, 1, 1]);
}

/** The item as it can be shown now (a model still loading starts loading). */
export function buildModelItem(s: ModelSpec, light: boolean): Group {
    const t = modelTemplate(s.model);
    return t && t !== 'loading' ? buildModel(t, s, light) : buildPlaceholder(s, light);
}

/** The furniture id of a tapped part of an own object, null for anything else. */
export function modelFurniture(o: Object3D | null): string | null {
    for (let p: Object3D | null = o; p; p = p.parent) {
        const id: unknown = p.userData.fp3dFurniture;
        if (typeof id === 'string') {
            return id;
        }
    }
    return null;
}

/** The library's picture of an own object: a box with a cube on it (its own geometry, freed with the picture). */
export function modelPreview(w: number, d: number, h: number): Group {
    const g = new Group();
    const body = new BoxGeometry(w, h * 0.55, d).translate(0, h * 0.275, 0).toNonIndexed();
    const top = new BoxGeometry(w * 0.45, h * 0.45, d * 0.45)
        .rotateY(Math.PI / 4)
        .translate(0, h * 0.775, 0)
        .toNonIndexed();
    shade(body);
    shade(top);
    g.add(new Mesh(body, new MeshBasicMaterial({ vertexColors: true, color: 0xa9b8c8 })));
    g.add(new Mesh(top, new MeshBasicMaterial({ vertexColors: true, color: 0x6fb2e0 })));
    return g;
}

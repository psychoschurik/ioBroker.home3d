// The files of own 3D objects (furniture type "model3d"), without three.js: the frame's store keeps them below
// `models/` of the instance, the editor uploads them, the 3D view loads them (own-models.ts).

/** The furniture type of an own 3D object. */
export const MODEL_TYPE = 'model3d';
/** GLB and glTF (with its data inside) keep colours and textures; OBJ and STL are shown in one colour. */
export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'stl'] as const;
export type ModelExt = (typeof MODEL_EXTS)[number];
/** Larger files are refused: they travel through the socket of web and every open view loads them. */
export const MODEL_MAX_BYTES = 20 * 1024 * 1024;
/** More triangles than this slow down a wall tablet: the editor warns. */
export const MODEL_MANY_TRIS = 300_000;
/** More than this are refused. */
export const MODEL_MAX_TRIS = 2_000_000;

/** A model as the store lists it. `size`: its natural width (x), depth (z) and height (y) in metres. */
export interface ModelInfo {
    id: string;
    name: string;
    ext: ModelExt;
    bytes: number;
    tris: number;
    size: [number, number, number];
    /** A plan places it (the store refuses to delete it then). */
    used?: boolean;
}

/** The type of a file by its name, null for anything else. */
export function modelExt(fileName: string): ModelExt | null {
    const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
    return (MODEL_EXTS as readonly string[]).includes(ext ?? '') ? (ext as ModelExt) : null;
}

/** A natural size as the store keeps it: three measures from 1 cm to 1 km, else null. */
export function modelSize(v: unknown): [number, number, number] | null {
    return Array.isArray(v) &&
        v.length === 3 &&
        v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0.01 && n <= 1000)
        ? [v[0], v[1], v[2]]
        : null;
}

/** Bytes as base64, in pieces (a whole file at once would overflow the call stack of `String.fromCharCode`). */
export function bytesBase64(bytes: Uint8Array): string {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(raw);
}

/** The bytes of base64 or of a data URL. */
export function base64Bytes(data: string): Uint8Array {
    const raw = atob(data.replace(/^data:[^,]*,/, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

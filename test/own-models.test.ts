import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, type Object3D } from 'three';
import { base64Bytes, bytesBase64, modelExt, modelSize } from '../frontend/vendor-ext/model-files';
import {
    buildModel,
    buildPlaceholder,
    checkGltf,
    gltfJson,
    ModelError,
    modelFurniture,
    modelKey,
    readModel,
    unitScale,
    type ModelSpec,
} from '../frontend/vendor-ext/own-models';

/** The 12 triangles of a box from (0, 0, 0) to (x, y, z). */
function boxTris(x: number, y: number, z: number): number[][] {
    const c = (i: number): number[] => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
    const quads = [
        [0, 1, 3, 2],
        [4, 6, 7, 5],
        [0, 4, 5, 1],
        [2, 3, 7, 6],
        [0, 2, 6, 4],
        [1, 5, 7, 3],
    ];
    return quads.flatMap(([a, b, cc, d]) => [
        [...c(a), ...c(b), ...c(cc)],
        [...c(a), ...c(cc), ...c(d)],
    ]);
}

/** A binary STL. */
function stl(tris: number[][]): Uint8Array {
    const b = new Uint8Array(84 + tris.length * 50);
    const dv = new DataView(b.buffer);
    dv.setUint32(80, tris.length, true);
    tris.forEach((t, i) => t.forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
    return b;
}

/** A GLB with one mesh of triangles, a colour and a node moved by `move`. */
function glb(tris: number[][], color: number[], move: number[]): Uint8Array {
    const pos = new Float32Array(tris.flat());
    const min = [0, 1, 2].map(k => Math.min(...tris.flatMap(t => [t[k], t[k + 3], t[k + 6]])));
    const max = [0, 1, 2].map(k => Math.max(...tris.flatMap(t => [t[k], t[k + 3], t[k + 6]])));
    const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, translation: move }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1] } }],
        accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max }],
        bufferViews: [{ buffer: 0, byteLength: pos.byteLength }],
        buffers: [{ byteLength: pos.byteLength }],
    };
    let text = JSON.stringify(json);
    while (text.length % 4) {
        text += ' ';
    }
    const jsonBytes = new TextEncoder().encode(text);
    const bin = new Uint8Array(pos.buffer);
    const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + bin.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.length, true);
    dv.setUint32(12, jsonBytes.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(jsonBytes, 20);
    dv.setUint32(20 + jsonBytes.length, bin.length, true);
    dv.setUint32(24 + jsonBytes.length, 0x004e4942, true);
    out.set(bin, 28 + jsonBytes.length);
    return out;
}

const spec = (over: Partial<ModelSpec> = {}): ModelSpec => ({
    id: 'f1',
    floor: 'eg',
    model: 'model_a',
    x: 0,
    z: 0,
    y: 0,
    angle: 0,
    w: 1,
    d: 1,
    h: 1,
    mirror: false,
    ...over,
});

test('own models: file types, sizes and base64', () => {
    assert.equal(modelExt('Sessel.GLB'), 'glb');
    assert.equal(modelExt('teil.stl'), 'stl');
    assert.equal(modelExt('bild.png'), null);
    assert.deepEqual(modelSize([0.8, 0.9, 1.1]), [0.8, 0.9, 1.1]);
    assert.equal(modelSize([0, 1, 1]), null);
    assert.equal(modelSize('1x1x1'), null);
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) & 255);
    assert.deepEqual(base64Bytes(bytesBase64(bytes)), bytes);
    assert.deepEqual(base64Bytes(`data:model/gltf-binary;base64,${bytesBase64(bytes.subarray(0, 5))}`), bytes.subarray(0, 5));
});

test('own models: OBJ and STL know no unit, a glTF is in metres', () => {
    assert.equal(unitScale('glb', 300), 1);
    assert.equal(unitScale('stl', 40), 0.001);
    assert.equal(unitScale('stl', 2), 1);
    assert.equal(unitScale('obj', 900), 0.001);
    assert.equal(unitScale('obj', 90), 0.01);
    assert.equal(unitScale('obj', 450), 0.01);
    assert.equal(unitScale('obj', 0.9), 1);
});

test('own models: a glTF the page cannot read is refused with the reason', () => {
    const code = (fn: () => void): string => {
        try {
            fn();
        } catch (e) {
            return (e as ModelError).code;
        }
        return 'ok';
    };
    assert.equal(code(() => checkGltf({ extensionsRequired: ['KHR_draco_mesh_compression'] })), 'draco');
    assert.equal(code(() => checkGltf({ extensionsRequired: ['KHR_texture_basisu'] })), 'ktx2');
    assert.equal(code(() => checkGltf({ buffers: [{ uri: 'scene.bin' }] })), 'external');
    assert.equal(code(() => checkGltf({ images: [{ uri: 'wood.png' }] })), 'external');
    // used with a fallback, or data inside the file: fine
    assert.equal(code(() => checkGltf({ extensionsUsed: ['KHR_draco_mesh_compression'], buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }] })), 'ok');
    assert.equal(code(() => gltfJson(new Uint8Array(40), 'glb')), 'format');
});

test('own models: an STL in millimetres stands up, in metres, on the floor', async () => {
    // 40 × 20 mm, 10 mm high along z (as a 3D printer builds it)
    const t = await readModel(stl(boxTris(40, 20, 10)), 'stl');
    assert.equal(t.tris, 12);
    assert.deepEqual(t.size, [0.04, 0.02, 0.01]);
    t.parts[0].geo.computeBoundingBox();
    const box = t.parts[0].geo.boundingBox!;
    assert.ok(Math.abs(box.min.y) < 1e-9 && Math.abs(box.max.y - 0.01) < 1e-9);
    assert.ok(Math.abs(box.min.x + 0.02) < 1e-9 && Math.abs(box.max.x - 0.02) < 1e-9);
    // shaded by the sun: the top lighter than a side facing away
    assert.ok(t.parts[0].geo.getAttribute('color'));
    assert.equal(t.parts[0].geo.getAttribute('normal'), undefined);
});

test('own models: an OBJ in one colour, empty files are refused', async () => {
    const obj = ['v 0 0 0', 'v 0.8 0 0', 'v 0.8 0.75 1.2', 'v 0 0.75 1.2', 'f 1 2 3', 'f 1 3 4'].join('\n');
    const t = await readModel(new TextEncoder().encode(obj), 'obj');
    assert.equal(t.tris, 2);
    assert.deepEqual(t.size, [0.8, 1.2, 0.75]);
    assert.equal(t.parts[0].map, null);
    await assert.rejects(readModel(new TextEncoder().encode('v 0 0 0\nv 1 0 0'), 'obj'), (e: ModelError) => e.code === 'empty');
    await assert.rejects(readModel(new Uint8Array(21 * 1024 * 1024), 'stl'), (e: ModelError) => e.code === 'big');
});

test('own models: a GLB keeps its colour, its node is baked in and centred', async () => {
    const t = await readModel(glb(boxTris(2, 1, 0.5), [1, 0, 0], [5, 3, -7]), 'glb');
    assert.equal(t.tris, 12);
    assert.deepEqual(t.size, [2, 0.5, 1]);
    assert.ok(t.parts[0].color.r > 0.9 && t.parts[0].color.g < 0.1);
    t.parts[0].geo.computeBoundingBox();
    const box = t.parts[0].geo.boundingBox!;
    assert.ok(Math.abs(box.min.y) < 1e-6 && Math.abs(box.min.x + 1) < 1e-6 && Math.abs(box.max.z - 0.25) < 1e-6);
});

test('own models: an item scales the model into its box, a tap finds its furniture', async () => {
    const t = await readModel(glb(boxTris(2, 1, 0.5), [0.5, 0.5, 0.5], [0, 0, 0]), 'glb');
    const g = buildModel(t, spec({ w: 4, d: 1, h: 2, angle: Math.PI / 2, mirror: true }), true);
    const inner = g.children[0];
    assert.deepEqual([inner.scale.x, inner.scale.y, inner.scale.z], [-2, 2, 2]);
    assert.equal(inner.rotation.y, -Math.PI / 2);
    const mesh = inner.children.find(c => (c as Mesh).isMesh) as Object3D;
    assert.equal(modelFurniture(mesh), 'f1');
    assert.equal(modelFurniture(null), null);
    // the dark looks: glowing edges, which a tap goes through
    const dark = buildModel(t, spec(), false);
    assert.ok(dark.children[0].children.length > t.parts.length);
    // without its model: a box of the item's size
    const box = buildPlaceholder(spec({ w: 0.5, d: 0.6, h: 0.7 }), true);
    assert.deepEqual([box.children[0].scale.x, box.children[0].scale.z, box.children[0].scale.y], [0.5, 0.6, 0.7]);
    assert.notEqual(modelKey(spec(), 0), modelKey(spec({ model: 'model_b' }), 0));
    assert.notEqual(modelKey(spec(), 0), modelKey(spec(), 2.8));
});

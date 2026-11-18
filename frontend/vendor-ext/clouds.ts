// The clouds over the plot, drawn where their shadows fall (sky-shade.ts): the same noise, the same drift with the
// wind, shifted towards the sun by their height. How many and what kind follow the cloud cover and the weather (fair
// cumulus, a grey deck when it rains, towers in a storm); their colour follows the time of day (white by day, pink
// and orange around sunrise and sunset, dark blue grey at night). Over the house they fade, so they never hide it.
// One mesh, one draw: every puff is a quad turned to the camera in the vertex shader.
import {
    BufferGeometry,
    CanvasTexture,
    Float32BufferAttribute,
    Mesh,
    NormalBlending,
    ShaderMaterial,
    type Texture,
    Vector2,
    Vector3,
} from 'three';
import { CLOUD_SCALE, cloudThreshold } from './sky-shade';

type Rgb = [number, number, number];

const fr = Math.fround;

function fract(x: number): number {
    return x - Math.floor(x);
}

/** The hash of the shadow shader, in 32-bit floats like the GPU, so the clouds lie over their shadows. */
function hash(px: number, py: number): number {
    let x = fr(fract(fr(px * fr(123.34))));
    let y = fr(fract(fr(py * fr(456.21))));
    const d = fr(fr(x * fr(x + fr(45.32))) + fr(y * fr(y + fr(45.32))));
    x = fr(x + d);
    y = fr(y + d);
    return fract(fr(x * y));
}

function noise(px: number, py: number): number {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a + (d - c) * ux - (b - a) * ux) * uy;
}

/** The cloud noise at a point of the pattern (m, before the drift): as `fp3dCloudShade` in sky-shade.ts. */
export function cloudNoise(x: number, z: number): number {
    const px = x / CLOUD_SCALE;
    const py = z / CLOUD_SCALE;
    return (
        0.55 * noise(px, py) +
        0.3 * noise(px * 2.1 + 3.7, py * 2.1 + 3.7) +
        0.15 * noise(px * 4.3 + 9.1, py * 4.3 + 9.1)
    );
}

function smooth(e0: number, e1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** What the sky is like: cloud cover, rain and storm 0 … 1. */
export interface CloudWeather {
    cover: number;
    rain: number;
    storm: number;
}

/** fair: cumulus with gaps; deck: a flat grey layer (overcast, rain); tower: thunderstorm clouds. */
export type CloudKind = 'fair' | 'deck' | 'tower';

export function cloudKind(w: CloudWeather): CloudKind {
    if (w.storm > 0.3) {
        return 'tower';
    }
    if (w.rain > 0.05 || w.cover >= 0.8) {
        return 'deck';
    }
    return 'fair';
}

/** Colour of the side towards the sun, of the base, and the opacity. */
export interface CloudLook {
    lit: Rgb;
    base: Rgb;
    alpha: number;
}

/**
 * The colour of the clouds by the sun's elevation (°, null: unknown, taken as day) and the weather: white by day,
 * pink and orange while the sun is low (strongest a little above the horizon), dark blue grey at night; rain and
 * storm make them grey.
 */
export function cloudLook(elevation: number | null, w: CloudWeather): CloudLook {
    const el = elevation ?? 45;
    const day = smooth(-7, 6, el);
    const grey = Math.min(0.78, w.rain * 0.7 + w.storm * 0.65 + Math.max(0, w.cover - 0.7) * 0.9);
    const dayLit = mix([1, 1, 1], [0.52, 0.55, 0.6], grey);
    const dayBase = mix([0.62, 0.67, 0.77], [0.3, 0.32, 0.37], grey);
    // at night grey blue and thinner: a dark mass would weigh on a light backdrop
    let lit = mix([0.5, 0.53, 0.63], dayLit, day);
    let base = mix([0.3, 0.33, 0.43], dayBase, day);
    // the sunset glow: the sun just over (or just under) the horizon lights the clouds from below
    const glow = Math.max(0, 1 - Math.abs(el - 2) / 8) * (1 - grey);
    lit = mix(lit, [1, 0.7, 0.7], glow * 0.75);
    base = mix(base, [0.64, 0.52, 0.7], glow * 0.6);
    return { lit, base, alpha: 0.55 + 0.4 * day };
}

/** One puff: its middle in the pattern (x, z; m before the drift) at height y, its half size and shading. */
export interface Puff {
    x: number;
    y: number;
    z: number;
    size: number;
    /** 0 at the base of its cloud … 1 at the top. */
    shade: number;
    /** Mirrors the puff's picture above 0.5 (0 … 1). */
    seed: number;
}

export interface FieldParams {
    /** The middle of the field in the pattern (m). */
    cx: number;
    cz: number;
    /** Its radius (m). */
    r: number;
    cover: number;
    kind: CloudKind;
    /** Height of the cloud base (m). */
    base: number;
    /** Size of the puffs (1: of a cell). */
    scale?: number;
}

/** The cells of the pattern (m): one cloud at most per cell. */
export const CELL = 11;

/**
 * The puffs of the clouds around a point of the pattern: a cloud in every cell where the shadow noise lies above the
 * threshold of the cover, the bigger the deeper inside a patch. The same cell always gives the same cloud, so a field
 * built anew after the drift keeps its clouds. Sorted from low to high (drawn in that order).
 */
export function cloudField(p: FieldParams): Puff[] {
    const out: Puff[] = [];
    if (p.cover < 0.05) {
        return out;
    }
    const th = cloudThreshold(p.cover);
    const i0 = Math.floor((p.cx - p.r) / CELL);
    const i1 = Math.floor((p.cx + p.r) / CELL);
    const j0 = Math.floor((p.cz - p.r) / CELL);
    const j1 = Math.floor((p.cz + p.r) / CELL);
    for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
            const x = (i + 0.5) * CELL;
            const z = (j + 0.5) * CELL;
            if (Math.hypot(x - p.cx, z - p.cz) > p.r) {
                continue;
            }
            const n = cloudNoise(x, z);
            if (n < th - 0.01) {
                continue;
            }
            // how deep inside its patch: thin at the edge, thick in the middle
            const s = smooth(th - 0.01, th + 0.14, n);
            const h = (k: number): number => hash(i * 7.13 + k * 1.37, j * 3.71 + k * 2.19);
            const count = p.kind === 'deck' ? 3 : p.kind === 'tower' ? 4 + Math.round(3 * s) : 2 + Math.round(3 * s);
            const ext = p.kind === 'deck' ? 1.2 : p.kind === 'tower' ? 4 + 11 * s : 1 + 5 * s;
            for (let k = 0; k < count; k++) {
                const a = h(k) * Math.PI * 2;
                const d = CELL * 0.5 * h(k + 10);
                const up = count > 1 ? k / (count - 1) : 0;
                const big = p.kind === 'deck' ? 1.05 : 0.55 + 0.45 * s;
                const size =
                    CELL *
                    (p.scale ?? 1) *
                    big *
                    (0.75 + 0.4 * h(k + 20)) *
                    (1 - 0.35 * up * (p.kind === 'deck' ? 0 : 1));
                out.push({
                    x: x + Math.cos(a) * d,
                    y: p.base + ext * up * (0.7 + 0.3 * h(k + 30)) + (p.kind === 'deck' ? 0 : size * 0.25),
                    z: z + Math.sin(a) * d,
                    size,
                    shade: up,
                    seed: h(k + 40),
                });
            }
        }
    }
    return out.sort((a, b) => a.y - b.y);
}

const VERT = /* glsl */ `
uniform vec2 uOff;
uniform vec3 uHouse;
uniform float uHouseR;
uniform float uFieldR;
uniform vec3 uSun;
uniform float uAlpha;
attribute vec3 aPos;
attribute vec2 aCorner;
attribute float aSize;
attribute float aShade;
attribute float aSeed;
varying vec2 vUv;
varying float vShade;
varying float vSun;
varying float vAlpha;
varying float vY;
varying float vAbove;
void main() {
  vec3 c = vec3(aPos.x + uOff.x, aPos.y, aPos.z + uOff.y);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  vec4 pc = projectionMatrix * mv;
  // at the rim of the field the clouds come and go softly
  float fade = 1.0 - smoothstep(uFieldR * 0.65, uFieldR, length(c.xz - uHouse.xz));
  // none right in front of the camera
  fade *= smoothstep(aSize * 0.6, aSize * 2.2, -mv.z);
  // the house stays clear: a puff that lies in front of it on the screen fades
  vec4 hc = projectionMatrix * (modelViewMatrix * vec4(uHouse, 1.0));
  if (hc.w > 0.0 && pc.w > 0.0 && pc.w < hc.w + uHouseR) {
    vec2 d = pc.xy / pc.w - hc.xy / hc.w;
    d.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
    float rh = uHouseR * projectionMatrix[1][1] / hc.w;
    float rp = aSize * projectionMatrix[1][1] / pc.w;
    fade *= smoothstep(rh * 1.25 + rp * 0.1, rh * 1.6 + rp * 0.6 + 0.03, length(d));
  }
  // nor big and blurred in the front half between the camera and the house
  if (hc.w > 0.0) fade *= smoothstep(0.3 * hc.w, 0.65 * hc.w, pc.w);
  vAlpha = uAlpha * fade;
  // the side towards the sun is lighter
  vec3 sv = (viewMatrix * vec4(uSun, 0.0)).xyz;
  vSun = length(sv.xy) > 0.001 ? dot(aCorner, normalize(sv.xy)) * 0.5 + 0.5 : 0.5;
  vShade = aShade;
  vY = aCorner.y * 0.5 + 0.5;
  // seen from above one sees the sunlit tops, from below the grey bases
  vAbove = smoothstep(-4.0, 10.0, cameraPosition.y - c.y);
  // upright (the flat base below), mirrored for half of them
  vUv = vec2(aSeed > 0.5 ? -aCorner.x : aCorner.x, aCorner.y) * 0.5 + 0.5;
  mv.xy += aCorner * aSize;
  gl_Position = projectionMatrix * mv;
  if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uLit;
uniform vec3 uBase;
varying vec2 vUv;
varying float vShade;
varying float vSun;
varying float vAlpha;
varying float vY;
varying float vAbove;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  // the base of a cloud and of each puff is darker than its top, the sun's side lighter, a puff's middle lighter
  float below = 0.05 + 0.3 * vShade + 0.4 * smoothstep(0.15, 0.8, vY) + 0.3 * vSun;
  float above = 0.5 + 0.2 * vShade + 0.15 * smoothstep(0.0, 0.7, vY) + 0.35 * vSun;
  float g = clamp(mix(below, above, vAbove), 0.0, 1.0);
  vec3 col = mix(uBase, uLit, g) * (0.9 + 0.1 * t.r);
  gl_FragColor = vec4(col, a);
}
`;

let puffTexture: Texture | null = null;

/** A soft puff: a few round blobs, lighter in their middles (red channel), shared by every cloud layer. */
function puff(): Texture | null {
    if (puffTexture) {
        return puffTexture;
    }
    if (typeof document === 'undefined') {
        return null;
    }
    const n = 256;
    const cv = document.createElement('canvas');
    cv.width = n;
    cv.height = n;
    const g = cv.getContext('2d');
    if (!g) {
        return null;
    }
    const blob = (x: number, y: number, r: number, a: number): void => {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(0.6, `rgba(215,215,215,${a * 0.85})`);
        gr.addColorStop(0.85, `rgba(180,180,180,${a * 0.35})`);
        gr.addColorStop(1, 'rgba(160,160,160,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
    };
    // a round body with bumps along its upper rim and two lobes at its sides, lighter in their middles; flat below
    blob(n * 0.5, n * 0.55, n * 0.34, 0.85);
    let r = 7;
    const rnd = (): number => {
        r = (r * 16807) % 2147483647;
        return r / 2147483647;
    };
    for (let k = 0; k < 13; k++) {
        const a = Math.PI * (1.05 + (0.9 * k) / 12) + (rnd() - 0.5) * 0.2;
        const d = n * (0.25 + 0.06 * rnd());
        blob(n * 0.5 + Math.cos(a) * d * 1.15, n * 0.55 + Math.sin(a) * d, n * (0.1 + 0.07 * rnd()), 0.8);
    }
    blob(n * 0.27, n * 0.6, n * 0.17, 0.75);
    blob(n * 0.73, n * 0.6, n * 0.17, 0.75);
    // the base: cut a little flatter
    g.globalCompositeOperation = 'destination-out';
    const cut = g.createLinearGradient(0, n * 0.72, 0, n * 0.86);
    cut.addColorStop(0, 'rgba(0,0,0,0)');
    cut.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = cut;
    g.fillRect(0, n * 0.72, n, n * 0.28);
    g.globalCompositeOperation = 'source-over';
    puffTexture = new CanvasTexture(cv);
    puffTexture.userData.fp3dShared = true;
    return puffTexture;
}

/** What the layer needs every frame. */
export interface CloudFrame extends CloudWeather {
    /** The sun's elevation (°) and the direction towards it in the world (x, z unit vector); null: unknown. */
    elevation: number | null;
    toSun: [number, number] | null;
    /** The drift of the clouds (sky-shade's uFp3dCloudOff). */
    off: Vector2;
    /** The middle of the house and its radius (m), its height (m). */
    house: Vector3;
    houseR: number;
    top: number;
}

export class CloudLayer {
    readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
    private key = '';
    private at: [number, number] | null = null;

    constructor() {
        const mat = new ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uOff: { value: new Vector2() },
                uHouse: { value: new Vector3() },
                uHouseR: { value: 10 },
                uFieldR: { value: 100 },
                uSun: { value: new Vector3(0, 1, 0) },
                uAlpha: { value: 1 },
                uLit: { value: new Vector3(1, 1, 1) },
                uBase: { value: new Vector3(0.7, 0.75, 0.85) },
                uTex: { value: puff() },
            },
            transparent: true,
            depthWrite: false,
            blending: NormalBlending,
            fog: false,
        });
        this.mesh = new Mesh(new BufferGeometry(), mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 5;
        this.mesh.name = 'fp3dClouds';
    }

    /** Places the clouds for this frame; false when none show. */
    update(f: CloudFrame): boolean {
        const u = this.mesh.material.uniforms;
        if (f.cover < 0.05 || !u.uTex.value) {
            this.mesh.visible = false;
            return false;
        }
        const kind = cloudKind(f);
        // the base of the clouds: above the roof, low enough to show behind the house in the usual view (a model, not
        // to scale), lower when it rains
        const base = f.top + (3 + Math.min(25, f.houseR * 0.6)) * (kind === 'deck' && f.rain > 0 ? 0.8 : 1);
        // puffs about as big as the house, not bigger (a small house under a big cloud is lost)
        const scale = Math.min(1, Math.max(0.55, f.houseR / 12));
        const fieldR = Math.min(170, Math.max(80, f.houseR * 5));
        // the clouds lie towards the sun from their shadows, by their height (not too far when the sun is low)
        const el = Math.max(22, f.elevation ?? 90) * (Math.PI / 180);
        const shift = f.toSun ? (base + 3) / Math.tan(el) : 0;
        const ox = f.off.x + (f.toSun ? f.toSun[0] * shift : 0);
        const oz = f.off.y + (f.toSun ? f.toSun[1] * shift : 0);
        const cx = f.house.x - ox;
        const cz = f.house.z - oz;
        const key = `${f.cover.toFixed(2)},${kind},${base.toFixed(1)},${fieldR.toFixed(0)},${scale.toFixed(2)}`;
        if (key !== this.key || !this.at || Math.hypot(cx - this.at[0], cz - this.at[1]) > CELL) {
            this.key = key;
            this.at = [cx, cz];
            this.build(cloudField({ cx, cz, r: fieldR, cover: f.cover, kind, base, scale }));
        }
        const look = cloudLook(f.elevation, f);
        u.uOff.value.set(ox, oz);
        u.uHouse.value.copy(f.house);
        u.uHouseR.value = f.houseR;
        u.uFieldR.value = fieldR;
        u.uAlpha.value = look.alpha;
        u.uLit.value.set(...look.lit);
        u.uBase.value.set(...look.base);
        const sel = ((f.elevation ?? 45) * Math.PI) / 180;
        if (f.toSun) {
            u.uSun.value.set(f.toSun[0] * Math.cos(sel), Math.sin(sel), f.toSun[1] * Math.cos(sel));
        } else {
            u.uSun.value.set(0, 1, 0);
        }
        this.mesh.visible = this.mesh.geometry.index !== null && this.mesh.geometry.index.count > 0;
        return this.mesh.visible;
    }

    private build(puffs: Puff[]): void {
        const n = puffs.length;
        const pos = new Float32Array(n * 12);
        const corner = new Float32Array(n * 8);
        const size = new Float32Array(n * 4);
        const shade = new Float32Array(n * 4);
        const seed = new Float32Array(n * 4);
        const index: number[] = [];
        const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
        puffs.forEach((p, i) => {
            for (let k = 0; k < 4; k++) {
                const v = i * 4 + k;
                pos.set([p.x, p.y, p.z], v * 3);
                corner.set([corners[k * 2], corners[k * 2 + 1]], v * 2);
                size[v] = p.size;
                shade[v] = p.shade;
                seed[v] = p.seed;
            }
            const v0 = i * 4;
            index.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        });
        const g = new BufferGeometry();
        // three needs a position attribute to draw; the shader places the corners from aPos
        g.setAttribute('position', new Float32BufferAttribute(pos, 3));
        g.setAttribute('aPos', new Float32BufferAttribute(pos, 3));
        g.setAttribute('aCorner', new Float32BufferAttribute(corner, 2));
        g.setAttribute('aSize', new Float32BufferAttribute(size, 1));
        g.setAttribute('aShade', new Float32BufferAttribute(shade, 1));
        g.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
        g.setIndex(index);
        this.mesh.geometry.dispose();
        this.mesh.geometry = g;
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

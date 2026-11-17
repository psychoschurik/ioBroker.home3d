// The sea around a boat: a water surface at the waterline with waves of the measured height and length, added to the
// 3D frontend at build time (tasks.ts patches viewer3d.ts, view3d.ts, editor.ts and model.ts). The bow points to the
// top of the plan (-z), as for the compass heading: the waves come from ahead and run to the stern (+z).
// The surface is a ring around the hull, so no water stands inside the boat; it is dense at the hull and coarse far
// out, where it fades. The waves are Gerstner waves moved in the vertex shader: no work on the CPU per frame.
import { BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { SKY_GLSL, skyUniforms } from './sky-shade';
import { whitecaps } from './weather-data';

type Vec2 = [number, number];

export interface SeaParams {
    /** Height of the water surface (m, in plan heights: the floor with elevation 0 stands at 0). */
    level: number;
    /** Significant wave height (m, crest to trough); 0 = calm. */
    height: number;
    /** Wave length (m). */
    length: number;
    /** Speed through the water (m/s, ahead): the water streams past the hull, with a bow wave and a wake; 0 or none: lying still. */
    speed?: number;
}

/** How strong the wake is drawn at a speed (m/s): from about half a knot, full at about 7 knots. */
export function wakeStrength(speed: number | undefined): number {
    return Math.min(1, Math.max(0, ((speed ?? 0) - 0.25) / 3.4));
}

/** Wave length when no datapoint gives one (m). */
export const DEFAULT_WAVE_LENGTH = 20;

/** The main wave from ahead, two smaller ones across it: angle from the stern direction (°), length and amplitude as parts of the main wave. */
const WAVES = [
    { angle: 0, len: 1, amp: 0.3 },
    { angle: 24, len: 0.61, amp: 0.13 },
    { angle: -33, len: 0.37, amp: 0.07 },
];

/** Angles around the hull, rings out to the edge. */
const SIDES = 128;
const RINGS = 44;

const VERT = /* glsl */ `
  uniform float uTime;
  uniform vec4 uWave[3];
  uniform float uSteep;
  uniform float uAmp;
  uniform float uDrift;
  attribute float aFar;
  varying float vFar;
  varying vec2 vPlan;
  varying float vCrest;
  varying vec3 vNormal;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec3 p = position;
    vec3 n = vec3(0.0, 1.0, 0.0);
    float y = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 w = uWave[i];
      if (w.w <= 0.0) continue;
      float k = w.z;
      // the water streams aft past a moving boat: the waves are carried with it
      float ph = k * dot(w.xy, position.xz - vec2(0.0, uDrift)) - sqrt(9.81 * k) * uTime;
      float c = cos(ph);
      float s = sin(ph);
      float wa = k * w.w;
      // the water moves in circles at most as wide as the wave is high: a calm sea does not sway sideways
      float q = min(1.0, uSteep / (wa * 3.0));
      p.x += q * w.w * w.x * c;
      p.z += q * w.w * w.y * c;
      y += w.w * s;
      n.x -= w.x * wa * c;
      n.z -= w.y * wa * c;
      n.y -= q * wa * s;
    }
    p.y += y;
    vFar = aFar;
    vPlan = position.xz;
    vCrest = uAmp > 0.0 ? y / uAmp : 0.0;
    vNormal = n;
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform vec3 uFoam;
  uniform float uAlpha;
  uniform float uFoamAmount;
  uniform float uWake;
  uniform float uDrift;
  uniform float uReach;
  uniform vec4 uHull;
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform float uWindVis;
  uniform float uWhite;
  uniform float uGust;
  uniform float uRain;
  varying vec3 vWorld;
  varying float vFar;
  varying float vCrest;
  varying vec3 vNormal;
  varying vec2 vPlan;
  #include <fog_pars_fragment>
${SKY_GLSL}
  void main() {
    vec3 n = normalize(vNormal);
    // light from ahead and above: the faces of the waves turned to it are lighter
    float lit = clamp(dot(n, normalize(vec3(0.3, 0.85, -0.45))), 0.0, 1.0);
    vec3 col = mix(uDeep, uLight, pow(lit, 3.0));
    // the crests foam in a rough sea only (calm water has none, however its ripples go)
    float foam = smoothstep(0.55, 1.0, vCrest) * uFoamAmount;
    if (uWake > 0.0) {
      // uHull: x of the middle, z of the bow and of the stern, half the beam (the bow points to -z)
      float side = abs(vPlan.x - uHull.x);
      float flow = vPlan.y - uDrift;
      // streaks along the flow (fine lengthwise lines that wander a little), patchy as the water carries them aft
      float lines = 0.5 + 0.5 * sin((vPlan.x - uHull.x) * 11.0 + sin(flow * 0.35) * 2.2);
      float patches = 0.75 + 0.25 * sin(flow * 0.9 + sin((vPlan.x - uHull.x) * 1.7) * 1.3);
      float streak = (0.45 + 0.55 * lines) * patches;
      // the turbulent water behind the stern, narrowing and fading
      float aft = vPlan.y - uHull.z;
      float trail = aft > 0.0
        ? (1.0 - smoothstep(uHull.w * 0.45, uHull.w * 0.8 + aft * 0.03, side)) * exp(-aft / (6.0 + 30.0 * uWake)) * streak
        : 0.0;
      // the Kelvin arms: from the bow at 19.5 degrees to both sides
      float fromBow = vPlan.y - uHull.y;
      float arm = abs(side - fromBow * 0.354);
      float arms = fromBow > 0.0
        ? (1.0 - smoothstep(0.0, 0.18 + fromBow * 0.02, arm)) * exp(-fromBow / (14.0 + 50.0 * uWake)) * patches
        : 0.0;
      // the bow wave along the hull, strongest at the bow
      float fore = clamp((uHull.z - vPlan.y) / max(uHull.z - uHull.y, 1.0), 0.0, 1.0);
      float hull = (1.0 - smoothstep(0.0, 0.2 + 0.8 * uWake, vFar * uReach)) * (0.3 + 0.7 * fore * fore);
      foam = max(foam, uWake * max(max(trail, arms * 0.75), hull));
    }
    vec2 wp = vWorld.xz;
    // metres per pixel: fine things (rings of rain) only close up, where they do not shimmer
    float near = 1.0 - smoothstep(0.03, 0.12, fwidth(wp.x) + fwidth(wp.y));
    vec2 across = vec2(-uWindDir.y, uWindDir.x);
    if (uGust > 0.0 || uWhite > 0.0) {
      // gusts: darker patches of ruffled water running with the wind
      vec2 q = (wp - uWindDir * uTime * uWindVis) / 9.0;
      float g = fp3dSkyNoise(q) * 0.65 + fp3dSkyNoise(q * 2.3 + 5.1) * 0.35;
      col *= 1.0 - 0.17 * smoothstep(0.55, 0.75, g) * (0.3 + 0.7 * uGust);
    }
    if (uWhite > 0.0) {
      // whitecaps: short white streaks across the wind that come and go, more in a stronger wind
      // (two patterns drifting at different speeds: where both are high a cap breaks, then it fades again)
      vec2 r = vec2(dot(wp, uWindDir), dot(wp, across));
      float caps = fp3dSkyNoise(vec2(r.x / 0.55 - uTime * 0.9, r.y / 1.5)) * fp3dSkyNoise(vec2(r.x / 0.9 - uTime * 0.35 + 7.3, r.y / 2.2 + 2.9));
      float th = mix(0.62, 0.44, uWhite);
      // torn: fine holes in the foam
      float torn = 0.45 + 0.55 * fp3dSkyNoise(wp / 0.3 + uTime * 0.2);
      foam = max(foam, smoothstep(th, th + 0.1, caps) * torn * (0.55 + 0.45 * uWhite) * (0.6 + 0.4 * clamp(vCrest + 0.5, 0.0, 1.0)));
    }
    if (uRain > 0.0 && near > 0.0) {
      // rain: rings spreading where the drops fall
      float rings = 0.0;
      for (int k = 0; k < 2; k++) {
        float sz = k == 0 ? 0.8 : 0.53;
        vec2 cp = wp / sz + float(k) * 0.37;
        vec2 cell = floor(cp);
        float h = fp3dSkyHash(cell + float(k) * 17.0);
        if (h > 0.25 + 0.7 * uRain) continue;
        vec2 c = vec2(0.5) + (vec2(fp3dSkyHash(cell + 3.1), fp3dSkyHash(cell + 7.9)) - 0.5) * 0.2;
        float ph = fract(uTime * (0.9 + 0.5 * h) + h * 7.0);
        float d = abs(length(fract(cp) - c) - ph * 0.32) * sz;
        rings += (1.0 - smoothstep(0.0, 0.012 + fwidth(wp.x), d)) * (1.0 - ph);
      }
      col *= 1.0 - 0.1 * uRain;
      foam = max(foam, clamp(rings, 0.0, 1.0) * 0.5 * near * min(1.0, uRain * 1.5));
    }
    foam = clamp(foam, 0.0, 1.0);
    col = mix(col, uFoam, foam) * fp3dCloudShade(wp);
    gl_FragColor = vec4(col, max(uAlpha, foam * 0.95) * (1.0 - smoothstep(0.45, 1.0, vFar)));
    #include <fog_fragment>
  }
`;

/** Convex hull of points (monotone chain), counter-clockwise in plan coordinates. */
export function convexHull(points: Vec2[]): Vec2[] {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) {
        return p;
    }
    const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: Vec2[] = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) {
            lower.pop();
        }
        lower.push(q);
    }
    const upper: Vec2[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) {
            upper.pop();
        }
        upper.push(q);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/** A convex polygon grown outwards by `margin` (m). */
function grow(poly: Vec2[], margin: number): Vec2[] {
    const n = poly.length;
    const normal = (a: Vec2, b: Vec2): Vec2 => {
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        // counter-clockwise in a plan whose z points down: the outside lies to the right of each edge
        return [dz / l, -dx / l];
    };
    return poly.map((p, i) => {
        const n1 = normal(poly[(i - 1 + n) % n], p);
        const n2 = normal(p, poly[(i + 1) % n]);
        const bx = n1[0] + n2[0];
        const bz = n1[1] + n2[1];
        const bl = Math.hypot(bx, bz) || 1;
        const cos = Math.max(0.3, (bx / bl) * n1[0] + (bz / bl) * n1[1]);
        return [p[0] + (bx / bl) * (margin / cos), p[1] + (bz / bl) * (margin / cos)];
    });
}

/** Where a ray from `c` in direction `u` leaves the convex polygon (distance along u). */
function exit(poly: Vec2[], c: Vec2, u: Vec2): number {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const den = u[0] * ez - u[1] * ex;
        if (Math.abs(den) < 1e-9) {
            continue;
        }
        const ax = a[0] - c[0];
        const az = a[1] - c[1];
        const t = (ax * ez - az * ex) / den;
        const s = (ax * u[1] - az * u[0]) / den;
        if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6) {
            best = Math.min(best, t);
        }
    }
    return Number.isFinite(best) ? best : 0;
}

/** The outline the water keeps away from: the hull of every room of every floor, grown by half the outer wall. */
export function seaOutline(rooms: Vec2[][], wall: number): Vec2[] {
    const hull = convexHull(rooms.flat());
    return hull.length >= 3 ? grow(hull, wall / 2 + 0.02) : [];
}

/** Colours by the look: light water by day and with real materials, dark water with the night and neon looks. */
export function seaColors(light: boolean): { deep: number[]; light: number[]; foam: number[]; alpha: number } {
    return light
        ? { deep: [0.07, 0.36, 0.55], light: [0.42, 0.74, 0.86], foam: [0.95, 0.98, 1], alpha: 0.8 }
        : { deep: [0.02, 0.1, 0.2], light: [0.1, 0.42, 0.6], foam: [0.62, 0.9, 1], alpha: 0.84 };
}

/** The sea as a mesh in plan coordinates at height 0 (the caller places it at the waterline); `time` is the shared clock in seconds. */
export function buildSea(outline: Vec2[], params: SeaParams, time: { value: number }, light: boolean): Mesh | null {
    if (outline.length < 3) {
        return null;
    }
    const length = Math.min(500, Math.max(1, params.length || DEFAULT_WAVE_LENGTH));
    const height = Math.min(20, Math.max(0, params.height || 0));
    let cx = 0;
    let cz = 0;
    for (const [x, z] of outline) {
        cx += x;
        cz += z;
    }
    const c: Vec2 = [cx / outline.length, cz / outline.length];
    let size = 0;
    for (const [x, z] of outline) {
        size = Math.max(size, Math.hypot(x - c[0], z - c[1]));
    }
    // the hull's extent for the wake: the middle, bow and stern, half the beam
    const xs = outline.map(p => p[0]);
    const zs = outline.map(p => p[1]);
    const hull = [
        (Math.min(...xs) + Math.max(...xs)) / 2,
        Math.min(...zs),
        Math.max(...zs),
        (Math.max(...xs) - Math.min(...xs)) / 2,
    ];
    // a few wave lengths of sea, at least so much that the edge is far from the boat
    const reach = Math.min(600, Math.max(60, size * 8, length * 3));
    // the corners of the hull are among the angles, so the inner ring is the hull itself
    const angles = new Set<number>();
    for (let i = 0; i < SIDES; i++) {
        angles.add(Math.round((i / SIDES) * Math.PI * 2 * 1e6) / 1e6);
    }
    for (const [x, z] of outline) {
        const a = Math.atan2(z - c[1], x - c[0]);
        angles.add(Math.round((a < 0 ? a + Math.PI * 2 : a) * 1e6) / 1e6);
    }
    const sorted = [...angles].sort((a, b) => a - b);
    const pos: number[] = [];
    const far: number[] = [];
    for (const a of sorted) {
        const u: Vec2 = [Math.cos(a), Math.sin(a)];
        const r = exit(outline, c, u);
        for (let k = 0; k <= RINGS; k++) {
            const t = Math.pow(k / RINGS, 2.2);
            const d = r + reach * t;
            pos.push(c[0] + u[0] * d, 0, c[1] + u[1] * d);
            far.push(t);
        }
    }
    const index: number[] = [];
    const per = RINGS + 1;
    for (let j = 0; j < sorted.length; j++) {
        const a = j * per;
        const b = ((j + 1) % sorted.length) * per;
        for (let k = 0; k < RINGS; k++) {
            index.push(a + k, b + k, a + k + 1, b + k, b + k + 1, a + k + 1);
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aFar', new Float32BufferAttribute(far, 1));
    geo.setIndex(index);
    const waves = WAVES.map(w => {
        const a = (w.angle * Math.PI) / 180;
        // running towards the stern (+z), turned by the angle
        return [Math.sin(a), Math.cos(a), (Math.PI * 2) / (length * w.len), height * w.amp];
    });
    const colors = seaColors(light);
    const uniforms = UniformsUtils.merge([
        UniformsLib.fog,
        {
            uWave: { value: waves.flat() },
            uSteep: { value: 0.55 },
            uAmp: { value: WAVES.reduce((s, w) => s + w.amp, 0) * height },
            uDeep: { value: colors.deep },
            uLight: { value: colors.light },
            uFoam: { value: colors.foam },
            uAlpha: { value: colors.alpha },
            // foam from about 0.3 m of wave height, full at 1.5 m
            uFoamAmount: { value: 0.55 * Math.min(1, Math.max(0, (height - 0.3) / 1.2)) },
            // set every frame by the viewer (setSeaMotion): the speed changes without building the sea anew
            uWake: { value: 0 },
            uDrift: { value: 0 },
            uReach: { value: reach },
            uHull: { value: hull },
            // the weather, set every frame by the viewer (setSeaWeather)
            uWindDir: { value: [0, 1] },
            uWindVis: { value: 0 },
            uWhite: { value: 0 },
            uGust: { value: 0 },
            uRain: { value: 0 },
        },
    ]);
    // the clock and the sky are shared with the viewer (merge copies, so they are set afterwards)
    uniforms.uTime = time;
    Object.assign(uniforms, skyUniforms);
    const mesh = new Mesh(
        geo,
        new ShaderMaterial({
            uniforms,
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            fog: true,
        }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.userData.fp3dSea = seaKey(outline, params, light);
    mesh.userData.fp3dWaves = waves;
    mesh.userData.fp3dDir = [0, 1];
    return mesh;
}

/** The water streaming past at a speed (m/s): `drift` is how far it has moved aft since the start (m). */
export function setSeaMotion(mesh: Mesh, speed: number | undefined, drift: number): void {
    const u = (mesh.material as ShaderMaterial).uniforms;
    u.uWake.value = wakeStrength(speed);
    u.uDrift.value = drift;
}

/** The weather on the sea: the wind (m/s) and where it blows to in the plan, gusts and rain (0 … 1). */
export interface SeaWeather {
    /** Where the wind blows to in the plan (x, z; unit length); null: no wind, the waves come from ahead. */
    dir: [number, number] | null;
    /** Wind speed (m/s). */
    wind: number;
    /** How hard it gusts (0 … 1). */
    gust: number;
    /** How hard it rains (0 … 1). */
    rain: number;
}

/**
 * The waves turn slowly to run with the wind (`dt`: seconds since the last frame), the whitecaps come from 4 Bft on,
 * gusts ruffle the water, raindrops make rings.
 */
export function setSeaWeather(mesh: Mesh, w: SeaWeather, dt: number): void {
    const u = (mesh.material as ShaderMaterial).uniforms;
    const cur = mesh.userData.fp3dDir as [number, number];
    const target = w.dir && w.wind >= 1 ? w.dir : [0, 1];
    const k = Math.min(1, Math.max(0, dt) * 0.4);
    let dx = cur[0] + (target[0] - cur[0]) * k;
    let dz = cur[1] + (target[1] - cur[1]) * k;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) {
        // turned right round: step across first
        dx = -cur[1];
        dz = cur[0];
    } else {
        dx /= l;
        dz /= l;
    }
    mesh.userData.fp3dDir = [dx, dz];
    // each wave of the set (running to +z, turned by its angle) turned so that +z points with the wind
    const base = mesh.userData.fp3dWaves as number[][];
    u.uWave.value = base.flatMap(([x, z, kk, a]) => [dz * x + dx * z, -dx * x + dz * z, kk, a]);
    u.uWindDir.value = [dx, dz];
    u.uWindVis.value = Math.min(5, 0.4 + 0.25 * w.wind);
    u.uWhite.value = whitecaps(w.wind);
    u.uGust.value = w.wind >= 1 ? Math.min(1, Math.max(0, w.gust)) : 0;
    u.uRain.value = Math.min(1, Math.max(0, w.rain));
}

/** What the sea is built from: a mesh with another key is built anew (the level and the speed only change uniforms). */
export function seaKey(outline: Vec2[], params: SeaParams, light: boolean): string {
    return `${outline.map(p => p.map(v => v.toFixed(2)).join(',')).join(';')}|${(params.length || 0).toFixed(1)}|${(params.height || 0).toFixed(2)}|${light ? 1 : 0}`;
}

/** Frees the sea's geometry and material. */
export function disposeSea(mesh: Mesh): void {
    mesh.geometry.dispose();
    (mesh.material as ShaderMaterial).dispose();
}

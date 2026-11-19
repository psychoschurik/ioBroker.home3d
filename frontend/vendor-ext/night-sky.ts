// The night sky: stars that come out as it gets dark (fewer behind clouds and in bright moonlight), turning about
// the celestial pole with the sidereal time, and the moon in its direction with its phase, its lit side towards the
// sun. Both lie at infinity, so they travel with the camera (only the direction counts). The view looks down on a
// model, where the real sky lies above the picture: the stars fill the upper part of the picture, and the moon is
// drawn bigger than it is and no higher than just under the top edge, so it shows whenever one looks its way (over
// the sea around a boat too, and faintly through an overcast sky).
// One draw for the stars, one for the moon, one for its halo.
import {
    BufferGeometry,
    CanvasTexture,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshBasicMaterial,
    type PerspectiveCamera,
    PlaneGeometry,
    Points,
    Quaternion,
    ShaderMaterial,
    Vector3,
} from 'three';

const RAD = Math.PI / 180;

/** The moon as `sun.sun` tells it (frontend/moon.ts) and the sky it turns in. */
export interface MoonView {
    elevation: number;
    azimuth: number;
    phase: number;
    fraction: number;
    /** Local sidereal time (°) and latitude (°): how the stars stand. */
    sidereal: number;
    latitude: number;
}

/** What the sky needs every frame. */
export interface NightFrame {
    moon: MoonView | null;
    /** The sun's elevation and azimuth (°); null: unknown. */
    sun: { elevation: number; azimuth: number } | null;
    /** Where north lies in the plan (° clockwise from up). */
    north: number;
    /** Cloud cover 0 … 1. */
    cover: number;
    camera: PerspectiveCamera;
    /** Seconds, for the twinkling. */
    time: number;
}

function smooth(e0: number, e1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** How strongly the stars show (0 … 1): from nautical dusk on, fewer behind clouds and in bright moonlight. */
export function starStrength(
    sunElevation: number | null,
    cover: number,
    moonFraction: number,
    moonUp: boolean,
): number {
    if (sunElevation === null) {
        return 0;
    }
    const dark = smooth(-3, -12, sunElevation);
    return dark * (1 - smooth(0.2, 0.95, cover)) * (moonUp ? 1 - 0.35 * moonFraction : 1);
}

/**
 * How strongly the moon shows (0 … 1) while it is up: pale by day, full at night. Clouds dim it but never hide it
 * quite: under an overcast sky it still shows faintly with its phase (a sky that is always cloudy would otherwise
 * never show the moon at all).
 */
export function moonStrength(sunElevation: number | null, cover: number, moonElevation: number): number {
    if (sunElevation === null || moonElevation <= -1) {
        return 0;
    }
    const night = smooth(2, -6, sunElevation);
    return (0.45 + 0.55 * night) * (1 - 0.7 * smooth(0.5, 0.95, cover)) * smooth(-1, 1.5, moonElevation);
}

/**
 * Render order of the halo and the moon: after the sea (4, see-through without depth: drawn later, it covered the
 * moon, which stands just under the top edge of the picture and so below the horizon when one looks down on a boat),
 * before the clouds (5), which pass in front of it. Whatever stands in front still hides it by depth.
 */
export const MOON_ORDER = 4.5;

/** Radius of the drawn moon (°): far bigger than the real half degree. */
export const MOON_R = 2.6;

/**
 * The elevation the moon is drawn at (°): as it stands, but no higher than just under the top edge of the picture
 * (`top`, the elevation of the upper edge), and not deep down when one looks steeply down.
 */
export function drawnElevation(elevation: number, top: number): number {
    return Math.max(-35, Math.min(elevation, top - MOON_R * 1.6));
}

/** A direction in the plan from an azimuth (° from north, clockwise) and an elevation (°). */
export function skyDir(azimuth: number, elevation: number, north: number): Vector3 {
    const a = (north + azimuth) * RAD;
    const e = elevation * RAD;
    return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/**
 * Which part of a moon disc is lit, lit from +x: for a point (x, y) of the unit disc, 1 lit, 0 dark. q is the phase
 * folded to the waxing half (0 new … 0.5 full); the terminator is a half ellipse.
 */
export function litAt(x: number, y: number, q: number): boolean {
    const half = Math.sqrt(Math.max(0, 1 - y * y));
    return x > Math.cos(2 * Math.PI * q) * half;
}

let random = 12345;
function rnd(): number {
    random = (random * 16807) % 2147483647;
    return random / 2147483647;
}

const STAR_VERT = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uPx;
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
varying float vA;
varying vec3 vColor;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 dir = normalize(world.xyz - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
  // the upper part of the picture is the sky; deep below the horizon none
  float sky = smoothstep(-0.3, 0.6, gl_Position.y / gl_Position.w) * smoothstep(-0.95, -0.15, dir.y);
  float twinkle = 0.75 + 0.25 * sin(uTime * (1.3 + aBright * 2.0) + position.x * 37.0 + position.z * 11.0);
  vA = uAlpha * aBright * sky * twinkle;
  vColor = aColor;
  gl_PointSize = aSize * uPx;
  if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const STAR_FRAG = /* glsl */ `
varying float vA;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  // light with its own opacity (not added): the canvas is see-through, a light backdrop simply hides them
  gl_FragColor = vec4(vColor, min(1.0, vA * 1.7 * (1.0 - d)));
}
`;

function moonTexture(q: number): CanvasTexture | null {
    if (typeof document === 'undefined') {
        return null;
    }
    const n = 128;
    const cv = document.createElement('canvas');
    cv.width = n;
    cv.height = n;
    const g = cv.getContext('2d');
    if (!g) {
        return null;
    }
    const img = g.createImageData(n, n);
    // a few dark seas (the maria), as seen from the earth
    const maria: [number, number, number, number][] = [
        [-0.28, -0.32, 0.26, 0.28],
        [0.12, -0.3, 0.2, 0.22],
        [-0.45, 0.12, 0.3, 0.2],
        [0.25, 0.05, 0.15, 0.2],
        [0.05, 0.35, 0.16, 0.12],
    ];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const x = ((i + 0.5) / n) * 2 - 1;
            const y = ((j + 0.5) / n) * 2 - 1;
            const r = Math.hypot(x, y);
            const k = (j * n + i) * 4;
            if (r > 1) {
                continue;
            }
            let sea = 0;
            for (const [mx, my, mr, a] of maria) {
                sea = Math.max(sea, a * (1 - smooth(mr * 0.5, mr, Math.hypot(x - mx, y - my))));
            }
            // the terminator a little soft, the limb a little darker
            const half = Math.sqrt(Math.max(0, 1 - y * y));
            const lit = smooth(-0.04, 0.04, x - Math.cos(2 * Math.PI * q) * half);
            const tone = (1 - sea) * (0.9 + 0.1 * Math.sqrt(1 - r * r));
            const edge = 1 - smooth(0.96, 1, r);
            // the dark side faintly in the earthshine
            const v = lit * tone + (1 - lit) * 0.12;
            img.data[k] = 255 * v * 0.98;
            img.data[k + 1] = 255 * v * 0.97;
            img.data[k + 2] = 255 * v * (0.9 + 0.1 * (1 - lit) * 2);
            img.data[k + 3] = 255 * edge * (lit + (1 - lit) * 0.18);
        }
    }
    g.putImageData(img, 0, 0);
    return new CanvasTexture(cv);
}

function haloTexture(): CanvasTexture | null {
    if (typeof document === 'undefined') {
        return null;
    }
    const n = 128;
    const cv = document.createElement('canvas');
    cv.width = n;
    cv.height = n;
    const g = cv.getContext('2d');
    if (!g) {
        return null;
    }
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(210,222,255,0.55)');
    gr.addColorStop(0.3, 'rgba(170,190,240,0.22)');
    gr.addColorStop(1, 'rgba(120,140,200,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, n, n);
    return new CanvasTexture(cv);
}

export class NightSky {
    readonly group = new Group();
    /** Turns with the sky (pole, sidereal time); holds the stars. */
    private readonly sky = new Group();
    private readonly stars: Points<BufferGeometry, ShaderMaterial>;
    private readonly moon: Mesh<PlaneGeometry, MeshBasicMaterial>;
    private readonly halo: Mesh<PlaneGeometry, MeshBasicMaterial>;
    private moonQ = -1;

    constructor() {
        this.group.name = 'fp3dNightSky';
        const n = 3200;
        const pos = new Float32Array(n * 3);
        const size = new Float32Array(n);
        const bright = new Float32Array(n);
        const color = new Float32Array(n * 3);
        random = 12345;
        for (let i = 0; i < n; i++) {
            // evenly over the sphere (the stars of the far side too: the sky turns)
            const z = rnd() * 2 - 1;
            const a = rnd() * Math.PI * 2;
            const s = Math.sqrt(1 - z * z);
            pos.set([Math.cos(a) * s, z, Math.sin(a) * s], i * 3);
            // many faint, few bright
            const b = Math.pow(rnd(), 3);
            size[i] = 2 + 3.5 * b;
            bright[i] = 0.55 + 0.45 * b;
            const tint = rnd();
            color.set(tint < 0.15 ? [1, 0.85, 0.7] : tint < 0.3 ? [0.75, 0.85, 1] : [1, 1, 1], i * 3);
        }
        // the pole star, bright, near the pole
        pos.set([0.012, 0.9999, 0.006], 0);
        size[0] = 3.6;
        bright[0] = 1;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
        geo.setAttribute('aSize', new Float32BufferAttribute(size, 1));
        geo.setAttribute('aBright', new Float32BufferAttribute(bright, 1));
        geo.setAttribute('aColor', new Float32BufferAttribute(color, 3));
        this.stars = new Points(
            geo,
            new ShaderMaterial({
                vertexShader: STAR_VERT,
                fragmentShader: STAR_FRAG,
                uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 } },
                transparent: true,
                depthWrite: false,
                fog: false,
            }),
        );
        this.stars.frustumCulled = false;
        this.stars.renderOrder = -2;
        this.sky.add(this.stars);
        this.group.add(this.sky);
        this.moon = new Mesh(
            new PlaneGeometry(2, 2),
            new MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }),
        );
        this.moon.renderOrder = MOON_ORDER;
        this.moon.frustumCulled = false;
        this.halo = new Mesh(
            new PlaneGeometry(2, 2),
            new MeshBasicMaterial({
                map: haloTexture(),
                transparent: true,
                depthWrite: false,
                fog: false,
            }),
        );
        // just before the moon, so the moon lies on its glow
        this.halo.renderOrder = MOON_ORDER - 0.1;
        this.halo.frustumCulled = false;
        this.group.add(this.halo, this.moon);
    }

    /** Places stars and moon for this frame; false when neither shows. */
    update(f: NightFrame, pixelRatio: number): boolean {
        const m = f.moon;
        const sunEl = f.sun?.elevation ?? null;
        const moonUp = !!m && m.elevation > -1;
        // the stars: centred on the dome, turned so that the pole stands at the latitude in the north
        const stars = starStrength(sunEl, f.cover, m?.fraction ?? 0, moonUp);
        const su = this.stars.material.uniforms;
        su.uAlpha.value = stars;
        su.uTime.value = f.time;
        su.uPx.value = pixelRatio;
        this.stars.visible = stars > 0.01;
        // at infinity: around the camera, within its far plane
        const cam = f.camera;
        const r = cam.far * 0.8;
        this.sky.position.copy(cam.position);
        this.sky.scale.setScalar(r);
        const lat = m?.latitude ?? 50;
        const pole = skyDir(0, lat, f.north);
        const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -(m?.sidereal ?? 0) * RAD);
        this.sky.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), pole).multiply(spin);
        // the moon: while it is up; pale by day, faint behind thick clouds
        const moonA = m ? moonStrength(sunEl, f.cover, m.elevation) : 0;
        this.moon.visible = moonA > 0.01;
        this.halo.visible = this.moon.visible && sunEl !== null && sunEl < -2;
        if (this.moon.visible && m) {
            const q = m.phase <= 0.5 ? m.phase : 1 - m.phase;
            const qk = Math.round(q * 48) / 48;
            if (qk !== this.moonQ) {
                this.moonQ = qk;
                this.moon.material.map?.dispose();
                this.moon.material.map = moonTexture(qk);
                this.moon.material.needsUpdate = true;
            }
            const look = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const top = Math.asin(Math.min(1, Math.max(-1, look.y))) / RAD + cam.fov / 2;
            const dir = skyDir(m.azimuth, drawnElevation(m.elevation, top), f.north);
            const at = cam.position.clone().addScaledVector(dir, r * 0.9);
            const size = r * 0.9 * Math.tan(MOON_R * RAD);
            this.moon.position.copy(at);
            this.moon.scale.setScalar(size);
            this.moon.material.opacity = moonA;
            // facing the camera, the lit side (+x of the picture) turned towards the sun
            this.moon.quaternion.copy(cam.quaternion);
            if (f.sun) {
                const sunDir = skyDir(f.sun.azimuth, f.sun.elevation, f.north);
                const toSun = sunDir.sub(skyDir(m.azimuth, m.elevation, f.north));
                const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
                const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
                // the picture is lit from +x: turn +x towards the sun
                const turn = Math.atan2(toSun.dot(up), toSun.dot(right));
                this.moon.rotateZ(turn);
            }
            this.halo.position.copy(at);
            this.halo.quaternion.copy(cam.quaternion);
            this.halo.scale.setScalar(size * 4);
            this.halo.material.opacity = moonA * (0.3 + 0.7 * m.fraction) * (1 - f.cover * 0.7);
        }
        this.group.visible = this.stars.visible || this.moon.visible;
        return this.group.visible;
    }

    dispose(): void {
        this.stars.geometry.dispose();
        this.stars.material.dispose();
        this.moon.material.map?.dispose();
        this.moon.material.dispose();
        this.moon.geometry.dispose();
        this.halo.material.map?.dispose();
        this.halo.material.dispose();
        this.halo.geometry.dispose();
    }
}

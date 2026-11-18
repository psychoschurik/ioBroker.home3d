// A rainbow: it shows when the sun is low (under 42°), shines (not behind a closed cover) and it rains, or rained a
// few minutes ago, and stands opposite the sun around the antisolar point: the primary bow violet inside, red
// outside, the fainter secondary bow with its colours reversed, the darker band between them, the sky a little
// lighter inside. At infinity like the moon (only the direction counts); in the model drawn smaller than the real 42°
// and with its top just under the top edge of the picture, so it arches behind the house when one looks away from
// the sun. One draw.
import { Mesh, type PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

const RAD = Math.PI / 180;

/** The drawn radius of the primary bow (°; the real one is 42°) and of the secondary one. */
export const BOW = 15;
export const BOW2 = BOW * (51 / 42);
/** How long a rainbow lasts after the rain (ms). */
export const AFTER_RAIN = 10 * 60000;

function smooth(e0: number, e1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * How strongly a rainbow shows (0 … 1): the sun low but up, not hidden by the cover, and rain now (`rain` > 0) or
 * a short while ago (`sinceRain` ms, null: not in this session).
 */
export function rainbowStrength(
    sunElevation: number | null,
    cover: number,
    rain: number,
    sinceRain: number | null,
): number {
    if (sunElevation === null) {
        return 0;
    }
    const low = smooth(0.5, 4, sunElevation) * (1 - smooth(32, 42, sunElevation));
    const sun = 1 - smooth(0.75, 0.97, cover);
    const wet = rain > 0 ? 1 : sinceRain === null ? 0 : 1 - smooth(0, AFTER_RAIN, sinceRain);
    return low * sun * wet;
}

/**
 * The elevation of the bow's centre as drawn (°): the antisolar point (minus the sun's elevation), lowered so that
 * the top of the bow stays just under the top edge of the picture (`top`).
 */
export function bowCentre(sunElevation: number, top: number): number {
    return Math.min(-sunElevation, top - BOW - 2);
}

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uBow;
uniform float uBow2;
varying vec2 vP;
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
// across a bow from its inner edge (0) to its outer one (1): violet to red
vec3 spectrum(float t) {
  return mix(vec3(1.0), hue((1.0 - t) * 0.78), 0.86);
}
void main() {
  // the angle from the centre (the plane lies at distance 1)
  float a = degrees(atan(length(vP)));
  float w = uBow * 0.075;
  float t1 = (a - (uBow - w)) / (2.0 * w);
  float b1 = smoothstep(0.0, 0.2, t1) * (1.0 - smoothstep(0.8, 1.0, t1));
  float w2 = uBow2 * 0.08;
  float t2 = (a - (uBow2 - w2)) / (2.0 * w2);
  float b2 = smoothstep(0.0, 0.25, t2) * (1.0 - smoothstep(0.75, 1.0, t2));
  vec3 col = spectrum(clamp(t1, 0.0, 1.0)) * b1 + spectrum(1.0 - clamp(t2, 0.0, 1.0)) * b2 * 0.45;
  float alpha = b1 * 0.62 + b2 * 0.24;
  // the sky a little lighter inside the bow
  float inside = (1.0 - smoothstep(uBow - w * 1.5, uBow - w * 0.5, a)) * 0.07;
  col += vec3(inside);
  alpha += inside;
  // its feet fade towards the ground of the model: the upper arch stands out
  float tb = tan(radians(uBow));
  float feet = smoothstep(0.0, 0.65 * tb, vP.y);
  gl_FragColor = vec4(col / max(alpha, 0.001), alpha * uAlpha * feet);
}
`;

/** What the rainbow needs every frame. */
export interface BowFrame {
    sun: { elevation: number; azimuth: number } | null;
    /** Where north lies in the plan (° clockwise from up). */
    north: number;
    cover: number;
    rain: number;
    camera: PerspectiveCamera;
    /** Now (ms). */
    now: number;
}

export class Rainbow {
    readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
    private lastRain: number | null = null;

    constructor() {
        // a square plane at distance 1 along its axis, big enough for the secondary bow
        const half = Math.tan((BOW2 + 6) * RAD);
        this.mesh = new Mesh(
            new PlaneGeometry(2 * half, 2 * half),
            new ShaderMaterial({
                vertexShader: VERT,
                fragmentShader: FRAG,
                uniforms: {
                    uAlpha: { value: 0 },
                    uBow: { value: BOW },
                    uBow2: { value: BOW2 },
                },
                transparent: true,
                depthWrite: false,
                fog: false,
            }),
        );
        this.mesh.name = 'fp3dRainbow';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -1;
        this.mesh.visible = false;
    }

    /** Places the bow for this frame; false when it does not show. */
    update(f: BowFrame): boolean {
        if (f.rain > 0) {
            this.lastRain = f.now;
        }
        const s = rainbowStrength(
            f.sun?.elevation ?? null,
            f.cover,
            f.rain,
            this.lastRain === null ? null : f.now - this.lastRain,
        );
        this.mesh.visible = s > 0.01 && !!f.sun;
        if (!this.mesh.visible || !f.sun) {
            return false;
        }
        const cam = f.camera;
        const look = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const top = Math.asin(Math.min(1, Math.max(-1, look.y))) / RAD + cam.fov / 2;
        const el = bowCentre(f.sun.elevation, top);
        const az = (f.north + f.sun.azimuth + 180) * RAD;
        const dir = new Vector3(
            Math.sin(az) * Math.cos(el * RAD),
            Math.sin(el * RAD),
            -Math.cos(az) * Math.cos(el * RAD),
        );
        const d = cam.far * 0.7;
        this.mesh.position.copy(cam.position).addScaledVector(dir, d);
        this.mesh.scale.setScalar(d);
        // facing the camera along its axis, upright (the plane's +y towards the sky)
        this.mesh.lookAt(cam.position);
        this.mesh.material.uniforms.uAlpha.value = s;
        return true;
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

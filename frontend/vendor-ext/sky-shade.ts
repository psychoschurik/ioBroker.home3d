// What the sky does to the surfaces under it, shared by every themed material (tasks.ts patches theme.ts) and by the sea:
// shadows of clouds that drift with the wind (by day, under a broken sky) and the wet look of rain. Only the surfaces
// above `uFp3dSkyMinY` lie under the open sky: the deck of a boat, the roofs of a house, not the rooms inside.
import { Vector2 } from 'three';

/** The uniforms, one object for all materials: the viewer sets them once per frame. */
export const skyUniforms = {
    /** Strength of the cloud shadows (0: none). */
    uFp3dCloud: { value: 0 },
    /** Cloud cover 0 … 1: how much of the ground lies in shadow. */
    uFp3dCover: { value: 0 },
    /** How far the clouds have drifted (world x, z in m). */
    uFp3dCloudOff: { value: new Vector2() },
    /** Surfaces higher than this (world y) lie under the open sky. */
    uFp3dSkyMinY: { value: 1e6 },
    /** Rain: wet surfaces, darker with a sheen at grazing angles (0 … 1). */
    uFp3dWet: { value: 0 },
};

/** Size of the cloud shadows (m): patches of about this size. */
export const CLOUD_SCALE = 26;

/** The share of the ground in shadow for a cloud cover (the threshold of the noise, see GLSL). */
export function cloudThreshold(cover: number): number {
    return 0.5 + (0.5 - Math.min(1, Math.max(0, cover))) * 0.55;
}

/** Declarations and functions, inserted before the themed shader code (`cameraPosition` is a built-in uniform). */
export const SKY_GLSL = /* glsl */ `
uniform float uFp3dCloud;
uniform float uFp3dCover;
uniform vec2 uFp3dCloudOff;
uniform float uFp3dSkyMinY;
uniform float uFp3dWet;
float fp3dSkyHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float fp3dSkyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fp3dSkyHash(i), fp3dSkyHash(i + vec2(1.0, 0.0)), u.x), mix(fp3dSkyHash(i + vec2(0.0, 1.0)), fp3dSkyHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 1 in the sun, darker in the shadow of a cloud; the clouds drift with the wind
float fp3dCloudShade(vec2 xz) {
  if (uFp3dCloud <= 0.0) return 1.0;
  vec2 p = (xz - uFp3dCloudOff) / ${CLOUD_SCALE.toFixed(1)};
  float n = 0.55 * fp3dSkyNoise(p) + 0.3 * fp3dSkyNoise(p * 2.1 + 3.7) + 0.15 * fp3dSkyNoise(p * 4.3 + 9.1);
  float th = 0.5 + (0.5 - uFp3dCover) * 0.55;
  return 1.0 - 0.34 * uFp3dCloud * smoothstep(th - 0.035, th + 0.05, n);
}
// a surface under the open sky: in the shadow of the clouds, wet in the rain (darker, a sheen where one looks along it)
vec3 fp3dSky(vec3 c, vec3 n, vec3 w) {
  if (w.y < uFp3dSkyMinY) return c;
  c *= fp3dCloudShade(w.xz);
  if (uFp3dWet > 0.0 && n.y > 0.6) {
    float f = pow(1.0 - clamp(dot(n, normalize(cameraPosition - w)), 0.0, 1.0), 4.0);
    c = mix(c * (1.0 - 0.22 * uFp3dWet), vec3(0.6, 0.66, 0.74), f * 0.55 * uFp3dWet);
  }
  return c;
}
`;

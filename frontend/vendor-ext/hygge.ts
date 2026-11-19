// The look "Hygge" (a cosy diorama): walls of vertical boards with a skirting board along the floor, in natural
// materials. tasks.ts marks the wall faces in a floor's wall geometry (build.ts puts the walls first, then outdoor parts
// and furniture into the same buffer) and adds the boards to the style shader (theme.ts); the warm, soft picture over
// it is the screen-space look "cozy" of post.ts.
import { Float32BufferAttribute, type BufferGeometry } from 'three';

/** Vertex attribute: 1 on the faces of walls, 0 on what follows them in the buffer (outdoor parts, furniture). */
export const WALL_ATTRIBUTE = 'fp3dWall';

/** Marks the first `tris` triangles of a floor's wall geometry as walls. */
export function markWalls(geometry: BufferGeometry, tris: number): BufferGeometry {
    const count = geometry.getAttribute('position').count;
    const mark = new Float32Array(count);
    mark.fill(1, 0, Math.max(0, Math.min(count, tris * 3)));
    geometry.setAttribute(WALL_ATTRIBUTE, new Float32BufferAttribute(mark, 1));
    return geometry;
}

/**
 * GLSL of the style shader (theme.ts, after its uniforms, uStWalls among them, and fp3dHash): the brightness factor of a wall face. Boards
 * of 12 cm with a groove and a slightly different tone each, a skirting board of 9 cm with a shadow line on top. A
 * groove is at least a pixel wide (else it vanished between the pixels from afar); the boards fade out only where
 * one is narrower than about three pixels, so nothing shimmers. Tops and the undersides of lintels stay plain.
 */
export const WALL_GLSL = /* glsl */ `
float fp3dStyleWall(vec3 n) {
  if (uStWalls <= 0.0 || uFloorY < -999.0 || abs(n.y) > 0.3) return 1.0;
  vec2 t = normalize(vec2(-n.z, n.x));
  float s = dot(vFp3dWorld.xz, t);
  float h = vFp3dWorld.y - uFloorY;
  float fs = max(fwidth(s), 1e-5);
  float fh = max(fwidth(h), 1e-5);
  float fade = (1.0 - smoothstep(0.025, 0.05, fs)) * uStWalls;
  float k;
  if (h < 0.09) {
    // the skirting board: a little lighter, a shadow line along its top
    k = 1.04 * mix(0.82, 1.0, smoothstep(0.0, max(0.006, fh), 0.09 - h));
    fade = (1.0 - smoothstep(0.02, 0.04, fh)) * uStWalls;
  } else {
    float w = 0.12;
    float f = fract(s / w) * w;
    float groove = smoothstep(0.0, max(0.005, fs), min(f, w - f));
    k = (0.96 + 0.06 * fp3dHash(vec2(floor(s / w), 7.7))) * mix(0.84, 1.0, groove);
  }
  return mix(1.0, k, fade);
}
`;

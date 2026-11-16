// Screen-space looks of the 3D view, added to the 3D frontend at build time (tasks.ts patches viewer3d.ts):
//   toon     thick dark outlines where the depth jumps (silhouettes, furniture against walls), like a comic
//   gouache  opaque watercolour: Kuwahara filter (flat, painted colour areas), wobbling brush edges, darker pigment at
//            the edges of areas and paper grain
// The scene is drawn into a texture with its depth, then one full-screen pass draws it onto the canvas. The canvas is
// transparent (the stage behind it is CSS): colours stay premultiplied like a direct render, so nothing changes there.
// Frames are only drawn when something changes, so the pass costs nothing while the view stands still.
import {
    DepthTexture,
    HalfFloatType,
    LinearFilter,
    Mesh,
    NearestFilter,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    UnsignedIntType,
    Vector2,
    Vector3,
    WebGLRenderTarget,
    type Camera,
    type IUniform,
    type PerspectiveCamera,
    type WebGLRenderer,
} from 'three';

export type PostLook = 'toon' | 'gouache';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
#include <common>
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uScale;
uniform float uNear;
uniform float uFar;
uniform int uOrtho;
varying vec2 vUv;
float viewDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = uOrtho == 1 ? orthographicDepthToViewZ(d, uNear, uFar) : perspectiveDepthToViewZ(d, uNear, uFar);
  return -z;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 0 inside a surface, 1 on an edge: where the depth jumps relative to the distance, or where the house ends
float edge(vec2 uv, float r) {
  float c = viewDepth(uv);
  float a = texture2D(tColor, uv).a;
  float e = 0.0;
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * 0.78539816;
    vec2 o = vec2(cos(ang), sin(ang)) * r * uTexel;
    float d = viewDepth(uv + o);
    float na = texture2D(tColor, uv + o).a;
    // only the nearer side of a jump draws, so a line is not doubled
    e = max(e, smoothstep(0.012, 0.04, (d - c) / max(c, 0.001)) * step(0.5, a));
    e = max(e, smoothstep(0.3, 0.7, a - na));
  }
  return e;
}
// 0 on a flat surface, 1 where two surfaces meet at an angle (wall and floor, the sides of a cabinet): 1/depth changes
// evenly across a plane on screen, so its second difference is zero there and not at a crease
float crease(vec2 uv, float r) {
  float c = viewDepth(uv);
  if (texture2D(tColor, uv).a < 0.5) return 0.0;
  float ic = 1.0 / max(c, 0.001);
  float e = 0.0;
  for (int i = 0; i < 4; i++) {
    float ang = float(i) * 0.78539816;
    vec2 o = vec2(cos(ang), sin(ang)) * r * uTexel;
    float i1 = 1.0 / max(viewDepth(uv + o), 0.001);
    float i2 = 1.0 / max(viewDepth(uv - o), 0.001);
    e = max(e, smoothstep(0.0025, 0.008, abs(i1 + i2 - 2.0 * ic) / ic));
  }
  return e;
}`;

const TOON = /* glsl */ `
${COMMON}
uniform vec3 uInk;
void main() {
  vec4 c = texture2D(tColor, vUv);
  // bold outlines where something stands in front, thinner ones where surfaces meet, like an inked drawing
  float e = max(edge(vUv, 1.5 * uScale), edge(vUv, 2.6 * uScale) * 0.9);
  e = max(e, crease(vUv, 1.2 * uScale) * 0.75);
  vec4 ink = vec4(uInk, 1.0);
  gl_FragColor = mix(c, ink, e);
  #include <colorspace_fragment>
}`;

const GOUACHE = /* glsl */ `
${COMMON}
uniform int uRadius;
uniform vec3 uPigment;
void main() {
  // brush: the picture is sampled a little off, following slow noise, so edges wobble like painted ones
  vec2 px = vUv / uTexel;
  vec2 wob = vec2(noise(px / (18.0 * uScale)), noise(px / (18.0 * uScale) + 7.3)) - 0.5;
  vec2 uv = vUv + wob * uTexel * 2.6 * uScale;
  // Kuwahara: of the four quadrants around the pixel, the one with the least change gives the colour
  vec4 m[4];
  vec3 s[4];
  for (int k = 0; k < 4; k++) {
    m[k] = vec4(0.0);
    s[k] = vec3(0.0);
  }
  float n = 0.0;
  for (int j = 0; j <= 6; j++) {
    if (j > uRadius) break;
    for (int i = 0; i <= 6; i++) {
      if (i > uRadius) break;
      vec2 o = vec2(float(i), float(j)) * uTexel * uScale;
      vec4 c0 = texture2D(tColor, uv + vec2(-o.x, -o.y));
      vec4 c1 = texture2D(tColor, uv + vec2(o.x, -o.y));
      vec4 c2 = texture2D(tColor, uv + vec2(-o.x, o.y));
      vec4 c3 = texture2D(tColor, uv + vec2(o.x, o.y));
      m[0] += c0; s[0] += c0.rgb * c0.rgb;
      m[1] += c1; s[1] += c1.rgb * c1.rgb;
      m[2] += c2; s[2] += c2.rgb * c2.rgb;
      m[3] += c3; s[3] += c3.rgb * c3.rgb;
      n += 1.0;
    }
  }
  vec4 col = m[0] / n;
  float best = 1e9;
  for (int k = 0; k < 4; k++) {
    vec4 mean = m[k] / n;
    vec3 v = s[k] / n - mean.rgb * mean.rgb;
    float sigma = v.r + v.g + v.b;
    if (sigma < best) {
      best = sigma;
      col = mean;
    }
  }
  if (col.a > 0.001) {
    vec3 rgb = col.rgb / col.a;
    // gouache is opaque and a little chalky: more saturation, lifted darks
    float l = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(l), rgb, 1.18);
    rgb = mix(rgb, vec3(1.0), 0.04);
    // pigment collects at the edges of a painted area
    float e = edge(uv, 1.4 * uScale);
    rgb = mix(rgb, rgb * uPigment, e * 0.55);
    // paper: fine grain and a few fibres
    float grain = noise(px / (1.6 * uScale)) * 0.6 + noise(px / (5.0 * uScale)) * 0.4;
    rgb *= 0.95 + 0.08 * grain;
    col = vec4(clamp(rgb, 0.0, 1.0) * col.a, col.a);
  }
  gl_FragColor = col;
  #include <colorspace_fragment>
}`;

/** The uniforms both passes share. */
const uniforms = (): Record<string, IUniform> => ({
    tColor: { value: null },
    tDepth: { value: null },
    uTexel: { value: new Vector2(1, 1) },
    uScale: { value: 1 },
    uNear: { value: 0.1 },
    uFar: { value: 400 },
    uOrtho: { value: 0 },
});

export class PostFx {
    private target: WebGLRenderTarget | null = null;
    private owner: WebGLRenderer | null = null;
    private readonly size = new Vector2();
    private readonly scene = new Scene();
    private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private readonly quad = new Mesh(new PlaneGeometry(2, 2));
    private readonly toon = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: TOON,
        uniforms: { ...uniforms(), uInk: { value: new Vector3(0.11, 0.09, 0.08) } },
        depthTest: false,
        depthWrite: false,
    });
    private readonly gouache = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: GOUACHE,
        uniforms: { ...uniforms(), uRadius: { value: 4 }, uPigment: { value: new Vector3(0.72, 0.62, 0.55) } },
        depthTest: false,
        depthWrite: false,
    });

    constructor() {
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
    }

    /**
     * Draws the scene with a look; false when there is none (the caller draws the scene itself). `low`: a weak device,
     * the painted look uses a smaller brush.
     */
    render(
        renderer: WebGLRenderer,
        scene: Scene,
        camera: Camera,
        look: PostLook | null | undefined,
        low = false,
    ): boolean {
        if (!look) {
            return false;
        }
        renderer.getDrawingBufferSize(this.size);
        const w = Math.max(1, Math.floor(this.size.x));
        const h = Math.max(1, Math.floor(this.size.y));
        if (this.owner !== renderer) {
            // another renderer (the quality was changed): its own target
            this.disposeTarget();
            this.owner = renderer;
        }
        if (!this.target) {
            this.target = new WebGLRenderTarget(w, h, {
                type: HalfFloatType,
                minFilter: LinearFilter,
                magFilter: LinearFilter,
                samples: low ? 0 : 4,
                depthTexture: new DepthTexture(w, h, UnsignedIntType),
            });
            this.target.depthTexture!.minFilter = NearestFilter;
            this.target.depthTexture!.magFilter = NearestFilter;
        } else if (this.target.width !== w || this.target.height !== h) {
            this.target.setSize(w, h);
        }
        const material = look === 'toon' ? this.toon : this.gouache;
        const u = material.uniforms;
        u.tColor.value = this.target.texture;
        u.tDepth.value = this.target.depthTexture;
        (u.uTexel.value as Vector2).set(1 / w, 1 / h);
        // sizes are in CSS pixels: the same look on a phone and a 4K screen
        u.uScale.value = renderer.getPixelRatio();
        const cam = camera as PerspectiveCamera | OrthographicCamera;
        u.uNear.value = cam.near;
        u.uFar.value = cam.far;
        u.uOrtho.value = (cam as OrthographicCamera).isOrthographicCamera ? 1 : 0;
        if (look === 'gouache') {
            u.uRadius.value = low ? 2 : 4;
        }
        this.quad.material = material;
        const before = renderer.getRenderTarget();
        renderer.setRenderTarget(this.target);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(before);
        renderer.render(this.scene, this.camera);
        return true;
    }

    private disposeTarget(): void {
        this.target?.depthTexture?.dispose();
        this.target?.dispose();
        this.target = null;
    }

    dispose(): void {
        this.disposeTarget();
        this.toon.dispose();
        this.gouache.dispose();
        this.quad.geometry.dispose();
        this.owner = null;
    }
}

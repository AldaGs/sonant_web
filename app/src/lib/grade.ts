// Colour grading for video strips: basic adjustments plus an optional 3D LUT (.cube), on the GPU (WebGL2).
// b, c, s, temp are -1..1 with 0 = unchanged.
export type Color = { b?: number; c?: number; s?: number; temp?: number; lut?: string; lutMix?: number };
export type Lut = { id: string; name: string; size: number; data: Uint8Array }; // RGBA8, r fastest

export const COLOR_PRESETS: Record<string, Color> = {
  warm: { temp: 0.45, s: 0.1 },
  cool: { temp: -0.45, s: 0.05 },
  vivid: { s: 0.4, c: 0.15 },
  punchy: { c: 0.3, s: 0.2, b: -0.03 },
  faded: { c: -0.3, b: 0.06, s: -0.25 },
  moody: { b: -0.08, c: 0.18, s: -0.3, temp: -0.15 },
  mono: { s: -1, c: 0.12 },
};
export const isNeutral = (c?: Color) => !c || (!c.b && !c.c && !c.s && !c.temp && !c.lut);

// Parse an Adobe/Resolve .cube 3D LUT into RGBA8 (domain assumed 0..1).
export function parseCube(text: string, name: string): Lut {
  let size = 0;
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (m) { size = +m[1]; continue; }
    if (/^[A-Z_]/i.test(line)) continue; // TITLE, DOMAIN_MIN/MAX, LUT_1D_SIZE…
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) vals.push(p[0], p[1], p[2]);
  }
  if (!size || vals.length < size ** 3 * 3) throw new Error('err.badLut');
  const data = new Uint8Array(size ** 3 * 4);
  for (let i = 0; i < size ** 3; i++) {
    for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, vals[i * 3 + k])) * 255);
    data[i * 4 + 3] = 255;
  }
  return { id: crypto.randomUUID(), name, size, data };
}

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform sampler3D lut;
uniform float b, c, s, temp, mixL, useLut, size;
void main() {
  vec3 col = texture(src, uv).rgb;
  if (useLut > .5) {
    vec3 q = clamp(col, 0., 1.) * (size - 1.) / size + .5 / size; // sample texel centres
    col = mix(col, texture(lut, q).rgb, mixL);
  }
  col += b * .3;
  col = (col - .5) * (1. + c) + .5;
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, 1. + s);
  col += vec3(.08, .02, -.08) * temp;
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

type Canvas = HTMLCanvasElement | OffscreenCanvas;
export class Grader {
  private canvas: Canvas;
  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  private lutId = '';
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    const gl = this.gl;
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const x = gl.createShader(type)!;
      gl.shaderSource(x, src);
      gl.compileShader(x);
      return x;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.gl = null;
      return;
    }
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['src', 'lut', 'b', 'c', 's', 'temp', 'mixL', 'useLut', 'size']) this.u[n] = gl.getUniformLocation(p, n);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.lutTex = gl.createTexture();
    gl.uniform1i(this.u.src, 0);
    gl.uniform1i(this.u.lut, 1);
  }

  get ok() { return !!this.gl; }

  // Graded copy of `src` (w×h), or `src` itself when there's nothing to do or no WebGL2.
  apply(src: CanvasImageSource, w: number, h: number, color: Color | undefined, lut?: Lut): CanvasImageSource {
    const gl = this.gl;
    if (!gl || isNeutral(color) || !w || !h) return src;
    const c = color!;
    if (this.canvas.width !== w || this.canvas.height !== h) ((this.canvas.width = w), (this.canvas.height = h));
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    const useLut = !!(c.lut && lut && lut.id === c.lut);
    if (useLut && this.lutId !== lut!.id) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut!.size, lut!.size, lut!.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut!.data);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
      for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
      this.lutId = lut!.id;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.uniform1f(this.u.b, c.b ?? 0);
    gl.uniform1f(this.u.c, c.c ?? 0);
    gl.uniform1f(this.u.s, c.s ?? 0);
    gl.uniform1f(this.u.temp, c.temp ?? 0);
    gl.uniform1f(this.u.mixL, c.lutMix ?? 1);
    gl.uniform1f(this.u.useLut, useLut ? 1 : 0);
    gl.uniform1f(this.u.size, useLut ? lut!.size : 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

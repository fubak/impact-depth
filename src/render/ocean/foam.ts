import * as THREE from 'three';
import { disposeMaterial, disposeTarget, SimulationPass, simulationMaterial } from './resources';

const PASS_VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * Persistent breaking-wave foam. R=slope x, G=slope z, B=foam, A=slope energy.
 * Jittered dual advection plus patchy jacobian persistence so FFT basins do not fill honeycomb plates.
 */
export const FOAM_DERIVE_GLSL = /* glsl */ `
uniform sampler2D uDisplacement, uPrevious;
uniform float uSize, uLength, uDelta, uFoamStorm;
float foamHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize, texel = vec2(1.0 / uSize, 0.0);
  vec3 dx = (texture2D(uDisplacement, uv + texel.xy).xyz - texture2D(uDisplacement, uv - texel.xy).xyz) * uSize / (2.0 * uLength);
  vec3 dz = (texture2D(uDisplacement, uv + texel.yx).xyz - texture2D(uDisplacement, uv - texel.yx).xyz) * uSize / (2.0 * uLength);
  vec3 n = cross(vec3(dz.x, dz.y, 1.0 + dz.z), vec3(1.0 + dx.x, dx.y, dx.z));
  n *= inversesqrt(max(dot(n, n), 1e-12));
  vec2 slope = clamp(-n.xz / max(.25, n.y), vec2(-4.0), vec2(4.0));
  float jacobian = (1.0 + dx.x) * (1.0 + dz.z) - dx.z * dz.x;
  vec2 cell = floor(uv * uSize);
  float h0 = foamHash(cell);
  float h1 = foamHash(cell + 17.0);
  float h2 = foamHash(uv * 13.7 + cell * 0.11);
  float angle = h0 * 6.283185307;
  vec2 dir = vec2(cos(angle), sin(angle)) * (0.55 + 0.45 * h1);
  vec2 wind = vec2(0.35, 0.82);
  vec2 advect = (dir * 1.35 + wind) * uDelta / uLength;
  vec2 uvA = fract(uv - advect);
  vec2 uvB = fract(uv - vec2(advect.y, -advect.x) * 0.62);
  float previous = mix(texture2D(uPrevious, uvA).b, texture2D(uPrevious, uvB).b, 0.28 + 0.44 * h0);
  float jacBreak = smoothstep(.68, .94, 1.0 - jacobian);
  float slopeBreak = smoothstep(0.55, 1.8, dot(slope, slope));
  float foamPatch = mix(0.06, 1.0, h2);
  float breaking = jacBreak * slopeBreak * foamPatch;
  float decay = exp(-uDelta * mix(1.35, .55, clamp(uFoamStorm, 0.0, 1.0)));
  float persist = previous * decay * mix(0.28, 1.0, foamHash(cell + uv * 9.0));
  gl_FragColor = vec4(slope, max(persist, breaking * 0.26), dot(slope, slope));
}`;

export function clearFoamTargets(
  pass: SimulationPass,
  renderer: THREE.WebGLRenderer,
  targets: readonly THREE.WebGLRenderTarget[],
): void {
  const clear = simulationMaterial({}, 'void main() { gl_FragColor = vec4(0.0); }', PASS_VERTEX);
  try {
    for (const target of targets) pass.run(renderer, clear, target);
  } finally {
    disposeMaterial(clear);
  }
}

export function disposeFoamTargets(targets: readonly THREE.WebGLRenderTarget[]): void {
  for (const target of targets) disposeTarget(target);
}

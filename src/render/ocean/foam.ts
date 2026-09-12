import * as THREE from 'three';
import { disposeMaterial, disposeTarget, SimulationPass, simulationMaterial } from './resources';
import { PASS_VERTEX_GLSL } from './spectrum';

/** Persistent breaking-wave foam. R=slope x, G=slope z, B=foam, A=slope energy. */
export const FOAM_DERIVE_GLSL = /* glsl */ `
uniform sampler2D uDisplacement, uPrevious;
uniform float uSize, uLength, uDelta, uFoamStorm;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize, texel = vec2(1.0 / uSize, 0.0);
  vec3 dx = (texture2D(uDisplacement, uv + texel.xy).xyz - texture2D(uDisplacement, uv - texel.xy).xyz) * uSize / (2.0 * uLength);
  vec3 dz = (texture2D(uDisplacement, uv + texel.yx).xyz - texture2D(uDisplacement, uv - texel.yx).xyz) * uSize / (2.0 * uLength);
  vec3 n = normalize(cross(vec3(dz.x, dz.y, 1.0 + dz.z), vec3(1.0 + dx.x, dx.y, dx.z)));
  vec2 slope = clamp(-n.xz / max(.25, n.y), vec2(-4.0), vec2(4.0));
  float jacobian = (1.0 + dx.x) * (1.0 + dz.z) - dx.z * dz.x;
  float previous = texture2D(uPrevious, uv - vec2(1.9, .8) * uDelta / uLength).b;
  float breaking = smoothstep(.22, .48, 1.0 - jacobian);
  float decay = exp(-uDelta * mix(.62, .35, clamp(uFoamStorm, 0.0, 1.0)));
  gl_FragColor = vec4(slope, max(previous * decay, breaking), dot(slope, slope));
}`;

export function clearFoamTargets(
  pass: SimulationPass,
  renderer: THREE.WebGLRenderer,
  targets: readonly THREE.WebGLRenderTarget[],
): void {
  const clear = simulationMaterial({}, 'void main() { gl_FragColor = vec4(0.0); }', PASS_VERTEX_GLSL);
  try {
    for (const target of targets) pass.run(renderer, clear, target);
  } finally {
    disposeMaterial(clear);
  }
}

export function disposeFoamTargets(targets: readonly THREE.WebGLRenderTarget[]): void {
  for (const target of targets) disposeTarget(target);
}

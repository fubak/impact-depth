/** Shared displaced-world sampling for water, GPU probes and caustic projection. */
export const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uCoastal;
uniform float uCoastalEnabled;
uniform vec2 uCoastalOrigin;
uniform float uCoastalExtent;
uniform vec2 uSwellDirection;
vec4 coastAt(vec2 p) {
  return uCoastalEnabled > .5 ? texture2D(uCoastal, clamp((p-uCoastalOrigin)/uCoastalExtent, 0.0, 1.0)) : vec4(0.0,uSwellDirection,1.0);
}
vec3 oceanDisplacement(vec2 p) {
  float bed = texture2D(uBedTex, clamp((p-uBedOrigin)/uBedExtent, 0.0, 1.0)).r;
  float depth = max(0.0, -bed);
  vec4 coast = coastAt(p);
  vec2 delayed = p - uSwellDirection * coast.x;
  vec3 swell = texture2D(uDisplacement0, cascadeUv(delayed,uCascadeLength.x)).xyz;
  vec3 wind = texture2D(uDisplacement1, cascadeUv(p,uCascadeLength.y)).xyz;
  vec3 chop = texture2D(uDisplacement2, cascadeUv(p,uCascadeLength.z)).xyz;
  float shallow = smoothstep(.15, 2.0, depth);
  float coverage = 1.0 - smoothstep(-uWetBand, uWetBand, bed);
  return (swell*1.25 + (wind*1.15+chop*1.35)*shallow) *
    (.62+uWaveHeight*.85) * mix(.22,1.0,coast.w) * coverage;
}
vec3 oceanNormal(vec2 p) {
  float e=.45;
  vec3 dx=vec3(2.0*e,0,0)+oceanDisplacement(p+vec2(e,0))-oceanDisplacement(p-vec2(e,0));
  vec3 dz=vec3(0,0,2.0*e)+oceanDisplacement(p+vec2(0,e))-oceanDisplacement(p-vec2(0,e));
  return normalize(cross(dz,dx));
}
float oceanFoam(vec2 p) {
  vec4 coast=coastAt(p);
  vec2 delayed=p-uSwellDirection*coast.x;
  return clamp(texture2D(uSlope0,cascadeUv(delayed,uCascadeLength.x)).b+
    texture2D(uSlope1,cascadeUv(p,uCascadeLength.y)).b+
    texture2D(uSlope2,cascadeUv(p,uCascadeLength.z)).b,0.0,1.0);
}
`;

export const SURFACE_UNIFORM_NAMES = ['uDisplacement0','uDisplacement1','uDisplacement2',
  'uSlope0','uSlope1','uSlope2','uCascadeLength','uCascadeSize','uCoastal','uCoastalEnabled',
  'uCoastalOrigin','uCoastalExtent','uSwellDirection','uBedTex','uBedOrigin','uBedExtent',
  'uWetBand','uWaveHeight','uSpectral','uTime','uSunDir'] as const;

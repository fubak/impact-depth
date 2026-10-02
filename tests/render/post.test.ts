import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  bloomEnabledFor,
  PostPipeline,
  type BloomRig,
} from '../../src/render/post';

/**
 * Bloom costs a full-res HDR target plus a mip chain — it must only run on the
 * high profile unless a test URL forces it, and never silently re-enable after
 * an auto-quality downgrade.
 */
describe('bloomEnabledFor', () => {
  it('enables bloom only on high quality without a flag', () => {
    expect(bloomEnabledFor('high', '')).toBe(true);
    expect(bloomEnabledFor('medium', '')).toBe(false);
    expect(bloomEnabledFor('low', '')).toBe(false);
    expect(bloomEnabledFor('high', '?quality=high')).toBe(true);
  });

  it('lets ?bloom=0 force bloom off on high and ?bloom=1 force it on anywhere', () => {
    expect(bloomEnabledFor('high', '?bloom=0')).toBe(false);
    expect(bloomEnabledFor('high', '?bloom=0&quality=high')).toBe(false);
    expect(bloomEnabledFor('low', '?bloom=1')).toBe(true);
    expect(bloomEnabledFor('medium', '?bloom=1&quality=medium')).toBe(true);
  });
});

describe('PostPipeline', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const fakeRenderer = {
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(1440, 900),
  } as unknown as THREE.WebGLRenderer;

  function fakeRig() {
    const calls: { sizes: [number, number][]; dprs: number[]; renders: number } = {
      sizes: [],
      dprs: [],
      renders: 0,
    };
    const composer: BloomRig = {
      render: () => {
        calls.renders += 1;
      },
      setSize: (w, h) => {
        calls.sizes.push([w, h]);
      },
      setPixelRatio: (d) => {
        calls.dprs.push(d);
      },
      dispose: () => {
        calls.sizes.push([-1, -1]);
      },
    };
    return { composer, calls };
  }

  it('builds the bloom rig lazily at the drawing-buffer size on first render', () => {
    const { composer, calls } = fakeRig();
    let built: { w: number; h: number } | null = null;
    const pipe = new PostPipeline(fakeRenderer, (_r, w, h) => {
      built = { w, h };
      return composer;
    });
    pipe.setEnabled(true);
    pipe.render(scene, camera);
    expect(built).toEqual({ w: 1440, h: 900 });
    expect(calls.renders).toBe(1);
  });

  it('propagates resize and DPR changes into the bloom rig', () => {
    const { composer, calls } = fakeRig();
    const pipe = new PostPipeline(fakeRenderer, () => composer);
    pipe.setEnabled(true);
    pipe.render(scene, camera);
    pipe.setSize(1920, 1080);
    pipe.setPixelRatio(1.5);
    expect(calls.sizes).toContainEqual([1920, 1080]);
    expect(calls.dprs).toContain(1.5);
  });

  it('applies a resize that arrived before the bloom rig existed', () => {
    const { composer, calls } = fakeRig();
    const pipe = new PostPipeline(fakeRenderer, () => composer);
    pipe.setSize(800, 600);
    pipe.setPixelRatio(2);
    pipe.setEnabled(true);
    pipe.render(scene, camera);
    expect(calls.sizes).toContainEqual([800, 600]);
    expect(calls.dprs).toContain(2);
  });

  it('disposes the bloom rig when disabled and rebuilds after reset', () => {
    const built: BloomRig[] = [];
    const pipe = new PostPipeline(fakeRenderer, () => {
      const { composer } = fakeRig();
      built.push(composer);
      return composer;
    });
    pipe.setEnabled(true);
    pipe.render(scene, camera);
    pipe.setEnabled(false);
    expect(built).toHaveLength(1);
    pipe.setEnabled(true);
    pipe.render(scene, camera);
    expect(built).toHaveLength(2);
  });
});

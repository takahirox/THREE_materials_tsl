import { Texture, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace } from 'three';
import { TextureNode, TextureSizeNode, MaxMipLevelNode } from 'three/webgpu';
import { Texture as SourceTexture } from 'three/src/textures/Texture.js';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

export const isTextureNodeOp = (op: string) => ['TextureNode', 'TextureSizeNode', 'MaxMipLevelNode'].includes(op);
type TextureState = {
  channel: number; colorSpace: string; offset: number[]; repeat: number[]; center: number[];
  rotation: number; matrix: number[]; matrixAutoUpdate: boolean; generateMipmaps: boolean; anisotropy: number;
};
const pending = new WeakMap<object, { op: string; state?: TextureState; index?: number }>();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Invalid 2D texture node arguments, links or resource');
}
const vector = (v: unknown, size: number): v is number[] => Array.isArray(v) && v.length === size && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export function resolveTextureNode(op: string, raw?: JsonValue, links: Record<string, unknown> = {}) {
  check(record(raw));
  const args = raw;
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
  check(args.precision === null || ['low', 'medium', 'high'].includes(args.precision as string));
  const fields = ['name', 'global', 'parents', 'precision'];
  let allowed: string[];
  let required: string[];
  let node;
  let state;
  let index;
  if (op === 'TextureNode') {
    fields.push('sampler', 'updateMatrix', 'texture');
    check(typeof args.sampler === 'boolean' && typeof args.updateMatrix === 'boolean');
    allowed = ['value', 'referenceNode', 'uvNode', 'levelNode', 'biasNode', 'offsetNode'];
    required = links.referenceNode === undefined ? ['value'] : ['referenceNode'];
    if (links.referenceNode === undefined) {
      const texture = args.texture;
      check(record(texture));
      check(Object.keys(texture).length === 10 && Object.keys(texture).every((key) => ['channel', 'colorSpace', 'offset', 'repeat', 'center', 'rotation', 'matrix', 'matrixAutoUpdate', 'generateMipmaps', 'anisotropy'].includes(key)));
      check(typeof texture.channel === 'number' && Number.isInteger(texture.channel) && texture.channel >= 0 && texture.channel <= 3);
      check(([NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace] as unknown[]).includes(texture.colorSpace));
      check(vector(texture.offset, 2) && vector(texture.repeat, 2) && vector(texture.center, 2) && vector(texture.matrix, 9));
      check(typeof texture.rotation === 'number' && Number.isFinite(texture.rotation));
      check(typeof texture.matrixAutoUpdate === 'boolean' && typeof texture.generateMipmaps === 'boolean');
      check(typeof texture.anisotropy === 'number' && Number.isFinite(texture.anisotropy) && texture.anisotropy >= 1);
      state = texture as TextureState;
      index = (links.value as { $refTex: number })?.$refTex;
    } else {
      check(args.texture === undefined && links.value === undefined);
    }
    node = new TextureNode();
    // Let Three.js deserialize its own scalar sampling fields. Resource and
    // input links are hydrated separately by the plugin after validation.
    const placeholder = node.value;
    node.deserialize({ sampler: args.sampler, updateMatrix: args.updateMatrix, precision: args.precision,
      nodeType: null, value: placeholder.uuid,
      updateType: 'none', meta: { textures: { [placeholder.uuid]: placeholder } } } as never);
  } else if (op === 'TextureSizeNode') {
    check(args.precision === null);
    allowed = ['textureNode', 'levelNode']; required = ['textureNode'];
    node = new TextureSizeNode(new TextureNode());
  } else {
    allowed = required = ['_textureNode'];
    node = new MaxMipLevelNode(new TextureNode());
  }
  check(Object.keys(args).every((key) => fields.includes(key)));
  check(required.every((key) => Object.prototype.hasOwnProperty.call(links, key)));
  for (const [key, link] of Object.entries(links)) {
    check(allowed.includes(key) && record(link) && Object.keys(link).length === 1);
    check(key === 'value' ? typeof link.$refTex === 'number' && Number.isInteger(link.$refTex) && link.$refTex >= 0 : typeof link.$ref === 'string');
  }
  node.name = args.name as string;
  node.global = args.global;
  node.parents = args.parents;
  if ('precision' in node) node.precision = args.precision as typeof node.precision;
  pending.set(node, { op, state, index });
  return node;
}

// Only instances created by the default resolver participate. Custom adapters
// retain their own hydration behavior. This runs privately before publication.
export function finishTextureNode(value: object, textures: Map<number, Map<string, Texture>>) {
  const info = pending.get(value);
  if (!info) return;
  const node = value as TextureNode & { textureNode?: TextureNode };
  if (info.op !== 'TextureNode') {
    check(node.textureNode?.type === 'TextureNode' && node.textureNode.value?.isTexture);
  } else if (node.referenceNode) {
    check(node.referenceNode.type === 'TextureNode' && node.value?.isTexture);
  } else {
    const source = node.value;
    const image = source?.image as { width?: number; height?: number } | undefined;
    check(source?.isTexture && [Texture, SourceTexture].includes(source.constructor as typeof Texture) && image && image.width! > 0 && image.height! > 0);
    check(!source.isRenderTargetTexture && !source.isArrayTexture);
    const state = info.state!;
    const key = JSON.stringify([state.channel, state.colorSpace, state.offset, state.repeat, state.center,
      state.rotation, state.matrix, state.matrixAutoUpdate, state.generateMipmaps, state.anisotropy]);
    let variants = textures.get(info.index!);
    if (!variants) textures.set(info.index!, variants = new Map());
    let texture = variants.get(key);
    if (!texture) {
      // Never mutate parser resources: core/KHR material slots may share them,
      // may already set colorSpace, or may be clones with texture-info transforms.
      texture = source.clone();
      texture.channel = state.channel;
      texture.colorSpace = state.colorSpace;
      texture.offset.fromArray(state.offset);
      texture.repeat.fromArray(state.repeat);
      texture.center.fromArray(state.center);
      texture.rotation = state.rotation;
      texture.matrix.fromArray(state.matrix);
      texture.matrixAutoUpdate = state.matrixAutoUpdate;
      texture.generateMipmaps = state.generateMipmaps;
      texture.anisotropy = state.anisotropy;
      texture.flipY = false;
      texture.needsUpdate = true;
      variants.set(key, texture);
    }
    node.value = texture;
  }
  pending.delete(value);
}

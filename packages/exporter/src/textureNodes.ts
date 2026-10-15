import { Texture, Matrix3, UVMapping, RGBAFormat, UnsignedByteType, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace,
  ClampToEdgeWrapping, RepeatWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter,
  NearestMipmapNearestFilter, NearestMipmapLinearFilter, LinearMipmapNearestFilter, LinearMipmapLinearFilter } from 'three';
import { objectGroup } from 'three/tsl';
import { objectGroup as sourceObjectGroup } from 'three/src/nodes/core/UniformGroupNode.js';
import { Texture as SourceTexture } from 'three/src/textures/Texture.js';
import type { Node } from 'three/webgpu';
import type { Material } from 'three';
import type { NodeExport, JsonValue } from './types.js';
import { validateNodeLinks } from './nodeLinks.js';

export const isTextureNodeOp = (op: string) => ['TextureNode', 'TextureSizeNode', 'MaxMipLevelNode'].includes(op);
function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Unsupported or invalid 2D texture node/resource; supply paired adapters');
}

// r186 declarations omit some fields (including offsetNode and private query
// inputs). Describe only the fields this adapter actually reads.
type TextureGraphNode = Node & Record<string, unknown> & {
  value: Texture; precision?: string | null; groupNode?: unknown;
  sampler: boolean; updateMatrix: boolean; referenceNode: TextureGraphNode | null;
  textureNode?: TextureGraphNode;
};

export function validateTextureFallback(material: Material) {
  // r186 writes offset/repeat/rotation to texture-info, ignoring center and a
  // manually authored matrix. KHR uses T*R*S whereas Texture uses T*S*R.
  // Compare against r186 GLTFLoader's KHR matrix, including on repeated exports.
  for (const [key, value] of Object.entries(material)) {
    if (!(key === 'map' || key.endsWith('Map')) || ['envMap', 'lightMap', 'alphaMap'].includes(key)) continue;
    const texture = value as Texture | null;
    if (!texture?.isTexture) continue;
    const { offset, repeat, center, rotation } = texture;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const represented = new Matrix3().set(repeat.x * c, repeat.y * s, offset.x,
      -repeat.x * s, repeat.y * c, offset.y, 0, 0, 1);
    const actual = texture.matrixAutoUpdate ? new Matrix3().setUvTransform(offset.x, offset.y, repeat.x, repeat.y, rotation, center.x, center.y) : texture.matrix;
    if (!actual.elements.every((v, i) => Math.abs(v - represented.elements[i]) < 1e-10)) {
      throw new Error(`Unsupported ordinary texture transform in ${key}; author a glTF-compatible fallback map (zero center, uniform scale when rotating, or a matching KHR matrix)`);
    }
  }
}

function textureState(texture: Texture) {
  // Restrict the resource to ordinary image-backed RGBA8 Texture, including
  // Three.js's separate source/build classes. Never decompress renderer resources.
  check(texture?.isTexture && [Texture, SourceTexture].includes(texture.constructor as typeof Texture));
  const t = texture as Texture & Record<string, unknown>;
  check(!Object.values(t).some((value) => typeof value === 'function'));
  check(!Object.entries(t).some(([key, value]) => key.startsWith('is') && key !== 'isTexture' && value === true));
  check(!t.renderTarget && !t.onUpdate && !t.normalized && !t.compareFunction && !t.internalFormat);
  check(t.mapping === UVMapping && t.format === RGBAFormat && t.type === UnsignedByteType);
  check(!t.premultiplyAlpha && t.mipmaps.length === 0 && t.updateRanges.length === 0);
  const image = t.image as { width: number; height: number; data?: unknown } | null;
  check(image && Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0 && !image.data);
  check(([NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace] as string[]).includes(t.colorSpace));
  check(Number.isInteger(t.channel) && t.channel >= 0 && t.channel <= 3);
  check(Number.isFinite(t.anisotropy) && t.anisotropy >= 1 && typeof t.generateMipmaps === 'boolean');
  check([ClampToEdgeWrapping, RepeatWrapping, MirroredRepeatWrapping].includes(t.wrapS) && [ClampToEdgeWrapping, RepeatWrapping, MirroredRepeatWrapping].includes(t.wrapT));
  check([NearestFilter, LinearFilter].includes(t.magFilter));
  check([NearestFilter, LinearFilter, NearestMipmapNearestFilter, NearestMipmapLinearFilter, LinearMipmapNearestFilter, LinearMipmapLinearFilter].includes(t.minFilter));
  check(typeof t.matrixAutoUpdate === 'boolean' && typeof t.flipY === 'boolean');
  // GLTFExporter bakes flipY into the image; the parser restores flipY=false.
  // Save transform parameters AND the matrix, even when auto updates are enabled.
  const state = { channel: t.channel, colorSpace: t.colorSpace, offset: t.offset.toArray(), repeat: t.repeat.toArray(),
    center: t.center.toArray(), rotation: t.rotation, matrix: t.matrix.toArray(), matrixAutoUpdate: t.matrixAutoUpdate,
    generateMipmaps: t.generateMipmaps, anisotropy: t.anisotropy };
  check([...state.offset, ...state.repeat, ...state.center, state.rotation, ...state.matrix].every(Number.isFinite));
  // Application metadata is not a sampler setting. Reject it instead of losing
  // arbitrary objects; mimeType is consumed/preserved by the writer/parser.
  check(Object.keys(t.userData).every((key) => key === 'mimeType'));
  check(t.userData.mimeType === undefined || ['image/png', 'image/jpeg', 'image/webp'].includes(t.userData.mimeType));
  return state;
}

export function serializeTextureNode(value: object): NodeExport | null {
  const node = value as TextureGraphNode;
  if (!isTextureNodeOp(node.type)) return null;
  check(Object.prototype.hasOwnProperty.call(node.constructor, 'type'));
  check(node.nodeType === (node.type === 'TextureSizeNode' ? 'uvec2' : null));
  check(node.name == null || node.name === '' || (typeof node.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.name)));
  check(typeof node.global === 'boolean' && typeof node.parents === 'boolean');
  check(node.precision == null || ['low', 'medium', 'high'].includes(node.precision));
  if (node.type === 'TextureSizeNode') check(node.precision == null);
  if (node.type !== 'TextureSizeNode') check(node.groupNode === objectGroup || node.groupNode === sourceObjectGroup);
  const args: Record<string, JsonValue> = { name: node.name, global: node.global, parents: node.parents, precision: node.precision ?? null };
  const links: Record<string, unknown> = {};
  const inputs = node.type === 'TextureNode' ? ['uvNode', 'levelNode', 'biasNode', 'offsetNode', 'referenceNode'] :
    node.type === 'TextureSizeNode' ? ['textureNode', 'levelNode'] : ['_textureNode'];
  if (node.type === 'TextureNode') {
    check(node.compareNode === null && node.depthNode === null && node.gradNode === null && node.gatherNode === null && !node._samplerComparison);
    check(typeof node.sampler === 'boolean' && typeof node.updateMatrix === 'boolean');
    check(['none', 'object'].includes(node.updateType));
    check(node.referenceNode === null || node.referenceNode.type === 'TextureNode');
    args.sampler = node.sampler;
    args.updateMatrix = node.updateMatrix;
    if (node.referenceNode === null) {
      args.texture = textureState(node.value);
      links.value = { texture: node.value };
      // Preseed caches so Three.js serializes only this node's fields. The graph
      // writer handles children/resources/identity instead of Three.js UUID JSON.
      const nodes = Object.fromEntries([...node.getSerializeChildren()].map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
      const data: Record<string, unknown> = { meta: { nodes, textures: { [node.value.uuid]: { uuid: node.value.uuid } }, images: {} } };
      node.serialize(data as never);
      args.precision = data.precision as JsonValue;
    }
    // Do not dereference a derived node's value here. DFS must detect cycles in
    // referenceNode links before the Three.js recursive value getter runs.
  } else {
    check(node.updateType === (node.type === 'MaxMipLevelNode' ? 'frame' : 'none'));
    check(node.textureNode?.type === 'TextureNode');
  }
  for (const input of inputs) {
    const child = node[input];
    if (child === null) continue;
    check(child && typeof child === 'object' && (child as Node).isNode === true);
    links[input] = { node: child };
  }
  // Ignore only Three.js-owned shader-build caches, not other attached graphs.
  validateNodeLinks(node, [...inputs, 'groupNode', '_matrixUniform', '_flipYUniform']);
  return { op: node.type, args, links };
}

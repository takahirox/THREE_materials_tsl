import { BufferAttribute, Mesh, FloatType, StaticDrawUsage } from 'three';
import { BufferAttributeNode } from 'three/webgpu';
import type { Object3D } from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Invalid or unsupported static BufferAttributeNode accessor or geometry binding');
}
const pending = new WeakMap<object, number>();
const types = ['float', 'vec2', 'vec3', 'vec4'];
const shapes = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'];
const attributeDefaults = new BufferAttribute(new Float32Array(1), 1);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function resolveBufferAttributeNode(raw: JsonValue | undefined, links: Record<string, unknown> = {}) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const args = raw as Record<string, unknown>;
  check(Object.keys(args).length === 1 && Object.prototype.hasOwnProperty.call(args, 'bufferType'));
  check(args.bufferType === null || types.includes(args.bufferType as string));
  check(Object.keys(links).length === 1 && Object.prototype.hasOwnProperty.call(links, 'value'));
  const ref = links.value as Record<string, unknown>;
  check(ref && typeof ref === 'object' && !Array.isArray(ref) && Object.keys(ref).length === 1 && uint(ref.$refAccessor));
  // A null value avoids retaining a constructor-created placeholder attribute.
  const node = new BufferAttributeNode(null as never, args.bufferType as string | null);
  pending.set(node, ref.$refAccessor);
  return node;
}

// Validate raw metadata before asking GLTFParser to allocate/hydrate a view.
export function validateBufferAttributeAccessor(node: object, parser: GLTFParser) {
  const ref = pending.get(node);
  if (ref === undefined) return;
  const json = parser.json, def = json.accessors?.[ref];
  check(def && def.componentType === 5126 && shapes.includes(def.type) && uint(def.count) && def.count > 0 && def.count <= 4096);
  check(def.normalized === undefined || def.normalized === false);
  check(def.sparse === undefined && def.extensions === undefined);
  check(uint(def.bufferView));
  const view = json.bufferViews?.[def.bufferView];
  check(view && uint(view.buffer) && view.byteStride === undefined && view.target === undefined && view.extensions === undefined);
  const buffer = json.buffers?.[view.buffer];
  const offset = def.byteOffset ?? 0, start = view.byteOffset ?? 0;
  check(uint(offset) && offset % 4 === 0 && uint(start) && start % 4 === 0);
  check(uint(view.byteLength) && buffer && uint(buffer.byteLength) && start + view.byteLength <= buffer.byteLength);
  check(offset + def.count * (shapes.indexOf(def.type) + 1) * 4 <= view.byteLength);
  const type = (node as BufferAttributeNode<unknown>).bufferType;
  check(type === null || type === types[shapes.indexOf(def.type)]);
}

export async function finishBufferAttributeNode(node: object, index: number, objects: ReadonlySet<Object3D>, parser: GLTFParser, sources: Set<BufferAttribute>) {
  const ref = pending.get(node);
  if (ref === undefined) return;
  const n = node as BufferAttributeNode<unknown>, data = n.value as BufferAttribute;
  const def = parser.json.accessors[ref], width = shapes.indexOf(def.type) + 1;
  check(data && Object.getPrototypeOf(data) === BufferAttribute.prototype && data.itemSize === width && data.count === def.count);
  check(Object.getOwnPropertySymbols(data).length === 0);
  for (const key of Object.getOwnPropertyNames(data)) {
    const field = Object.getOwnPropertyDescriptor(data, key)!;
    check('value' in field && typeof field.value !== 'function' && Object.prototype.hasOwnProperty.call(attributeDefaults, key));
    if (!['id', 'array', 'itemSize', 'count', 'version', 'updateRanges'].includes(key)) {
      check(field.value === (attributeDefaults as unknown as Record<string, unknown>)[key]);
    }
  }
  for (const key of Object.keys(attributeDefaults)) check(Object.prototype.hasOwnProperty.call(data, key));
  check(uint(data.version));
  check(Array.isArray(data.updateRanges) && Object.getPrototypeOf(data.updateRanges) === Array.prototype &&
    Object.getOwnPropertyNames(data.updateRanges).length === 1 && Object.getOwnPropertySymbols(data.updateRanges).length === 0);
  check(data.normalized === false && data.usage === StaticDrawUsage && data.gpuType === FloatType && data.name === '' && data.updateRanges.length === 0);
  check(Object.getPrototypeOf(data.array.buffer) === ArrayBuffer.prototype && Object.getOwnPropertySymbols(data.array).length === 0 && Object.getOwnPropertyNames(data.array).length === data.array.length);
  check(Object.getPrototypeOf(data.array) === Float32Array.prototype && data.array.length === width * def.count && Array.from(data.array).every(Number.isFinite));
  check(data === await parser.getDependency('accessor', ref));
  for (const bound of ['min', 'max']) {
    if (def[bound] === undefined) continue;
    check(Array.isArray(def[bound]) && def[bound].length === width);
    for (let c = 0; c < width; c++) {
      let value = bound === 'min' ? Infinity : -Infinity;
      for (let i = c; i < data.array.length; i += width) value = Math[bound === 'min' ? 'min' : 'max'](value, data.array[i]);
      check(def[bound][c] === value);
    }
  }
  for (const other of sources) check(other === data || other.array.buffer !== data.array.buffer);
  sources.add(data);
  // Reproduce the real constructor's derived fields after link hydration.
  const native = new BufferAttributeNode(data, n.bufferType);
  n.attribute = native.attribute; n.usage = native.usage; n.instanced = native.instanced;
  check(n.attribute === data);

  let uses = 0;
  for (const [meshIndex, mesh] of (parser.json.meshes ?? []).entries()) {
    if (!mesh.primitives.some((p: { material?: number }) => p.material === index)) continue;
    uses++;
    for (const owner of parser.json.nodes ?? []) {
      if (owner.mesh === meshIndex) check(owner.skin === undefined && owner.camera === undefined && owner.extensions === undefined);
    }
    check(mesh.primitives.length === 1 && [undefined, 4].includes(mesh.primitives[0].mode));
    const primitive = mesh.primitives[0];
    check(!primitive.targets && !primitive.extensions);
    const position = parser.json.accessors?.[primitive.attributes?.POSITION];
    check(position?.count === data.count && position.type === 'VEC3');
    // Geometry aliases require a separate identity contract.
    check(!Object.values(primitive.attributes).includes(ref) && primitive.indices !== ref);
  }
  check(uses > 0 && objects.size > 0);
  for (const object of objects) {
    const mesh = object as Mesh;
    check(Object.getPrototypeOf(mesh) === Mesh.prototype && !Array.isArray(mesh.material));
    check(!(mesh.material as import('three').MeshBasicMaterial).wireframe && mesh.pivot === null);
    const geometry = mesh.geometry;
    check(!(geometry as import('three').InstancedBufferGeometry).isInstancedBufferGeometry && Object.keys(geometry.morphAttributes).length === 0);
    check(geometry.attributes.position?.itemSize === 3 && geometry.attributes.position.count === data.count);
    check(geometry.indirect === null);
    check(geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity);
    check(!Object.values(geometry.attributes).some((a) => a === data || a.array?.buffer === data.array.buffer));
    const indices = geometry.index;
    check((indices?.count ?? data.count) % 3 === 0);
    if (indices) check(!indices.normalized && Array.from(indices.array).every((i) => Number.isInteger(i) && i >= 0 && i < data.count));
  }
  pending.delete(node);
}

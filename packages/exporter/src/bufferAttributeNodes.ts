import { BufferAttribute, Float32BufferAttribute, Mesh } from 'three';
import { BufferAttributeNode } from 'three/webgpu';
import SourceBufferAttributeNode from 'three/src/nodes/accessors/BufferAttributeNode.js';
import type { NodeExport } from './types.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Invalid or unsupported static BufferAttributeNode data, state or geometry binding; supply paired accessor/geometry adapters');
}
const attribute = new BufferAttribute(new Float32Array(3), 3);
const templates = [new BufferAttributeNode(attribute), new SourceBufferAttributeNode(attribute)];
const runtime = ['id', 'version', '_uuid', '_cacheKey', '_cacheKeyVersion', '_cache', 'stackTrace'];
const adapted = new WeakSet<object>();
const types = ['float', 'vec2', 'vec3', 'vec4'];

function state(value: object, template: object, inputs: string[], ignored: string[]) {
  check(Object.getOwnPropertySymbols(value).length === 0);
  for (const key of Object.getOwnPropertyNames(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    check('value' in field && typeof field.value !== 'function');
    if (ignored.includes(key)) continue;
    check(Object.prototype.hasOwnProperty.call(template, key));
    if (!inputs.includes(key)) check(field.value === (template as Record<string, unknown>)[key]);
  }
  for (const key of Object.keys(template)) check(Object.prototype.hasOwnProperty.call(value, key));
}
export function serializeBufferAttributeNode(value: object): NodeExport | null {
  const node = value as BufferAttributeNode<unknown>;
  if (node.type !== 'BufferAttributeNode') return null;
  const template = templates.find((n) => Object.getPrototypeOf(n) === Object.getPrototypeOf(node));
  check(template);
  state(node, template, ['value', 'attribute', 'bufferType', 'nodeType', 'name'], runtime);
  check(Number.isSafeInteger(node.version) && node.version >= 0);
  check(node.name === '' || /^nodeAttribute\d+$/.test(node.name));
  const data = node.value as BufferAttribute;
  check(data && [BufferAttribute.prototype, Float32BufferAttribute.prototype].includes(Object.getPrototypeOf(data)));
  state(data, attribute, ['array', 'itemSize', 'count', 'updateRanges'], ['id', 'version']);
  check(Number.isSafeInteger(data.version) && data.version >= 0);
  check(Array.isArray(data.updateRanges) && data.updateRanges.length === 0 && Object.getPrototypeOf(data.updateRanges) === Array.prototype &&
    Object.getOwnPropertyNames(data.updateRanges).length === 1 && Object.getOwnPropertySymbols(data.updateRanges).length === 0);
  check(Number.isInteger(data.itemSize) && data.itemSize >= 1 && data.itemSize <= 4);
  check(Number.isInteger(data.count) && data.count > 0 && data.count <= 4096);
  const array = data.array;
  check(array && Object.getPrototypeOf(array) === Float32Array.prototype && Object.getPrototypeOf(array.buffer) === ArrayBuffer.prototype);
  check(array.length === data.count * data.itemSize && Object.getOwnPropertySymbols(array).length === 0 && Object.getOwnPropertyNames(array).length === array.length);
  check(Array.from(array).every(Number.isFinite));
  check(node.attribute === data);
  const type = types[data.itemSize - 1];
  check(node.nodeType === null || node.nodeType === type);
  // Native inference mutates bufferType, but leaves nodeType null. Normalize
  // that derived state back to its portable constructor input.
  check(node.bufferType === type || (node.nodeType === null && node.bufferType === null));
  adapted.add(node);
  return { op: 'BufferAttributeNode', args: { bufferType: node.nodeType }, links: { value: { accessor: data } } };
}

export function validateBufferAttributeMesh(value: object, object: object) {
  if (!adapted.has(value)) return;
  const node = value as BufferAttributeNode<unknown>, mesh = object as Mesh;
  check(Object.getPrototypeOf(mesh) === Mesh.prototype && !Array.isArray(mesh.material));
  check(!(mesh.material as import('three').MeshBasicMaterial).wireframe && mesh.pivot === null);
  const geometry = mesh.geometry, count = (node.value as BufferAttribute).count;
  check(!(geometry as import('three').InstancedBufferGeometry).isInstancedBufferGeometry && Object.keys(geometry.morphAttributes).length === 0);
  check(geometry.attributes.position?.itemSize === 3 && geometry.attributes.position.count === count);
  check(geometry.indirect === null);
  check(geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity);
  check(!Object.values(geometry.attributes).some((a) => a === node.value || a.array?.buffer === (node.value as BufferAttribute).array.buffer));
  const index = geometry.index;
  check(!index || index.array.buffer !== (node.value as BufferAttribute).array.buffer);
  check((index?.count ?? count) % 3 === 0);
  if (index) check(!index.normalized && Array.from(index.array).every((i) => Number.isInteger(i) && i >= 0 && i < count));
}

export function validateBufferAttributeTransport(value: object, object: object, meshDef: { primitives?: { mode?: number }[] } | undefined) {
  if (!adapted.has(value)) return;
  validateBufferAttributeMesh(value, object);
  check(meshDef?.primitives?.length === 1 && meshDef.primitives[0].mode === 4);
}

export function validateBufferAttributeAliases(value: object, attributes: Iterable<BufferAttribute>) {
  if (!adapted.has(value)) return;
  const data = (value as BufferAttributeNode<unknown>).value as BufferAttribute;
  // Distinct attribute objects sharing host memory need an alias/ownership
  // contract. Repeated references to the exact attribute reuse one accessor.
  for (const other of attributes) check(other === data || other.array.buffer !== data.array.buffer);
}

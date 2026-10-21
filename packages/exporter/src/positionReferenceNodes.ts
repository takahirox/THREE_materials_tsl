import { Mesh, Matrix4, Quaternion, Vector3 } from 'three';
import { ReferenceNode, UniformNode } from 'three/webgpu';
import { validateNodeLinks } from './nodeLinks.js';
import { objectGroup } from 'three/tsl';
import { validateUniformGroup, validateUniformNode } from './uniformGroups.js';
import type { NodeExport } from './types.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Unsupported current-object position ReferenceNode state or transform; supply paired adapters');
}
const defaults = new ReferenceNode('position', 'vec3');
const adapted = new WeakSet<object>();
export const isPositionReferenceNode = (node: object) => adapted.has(node);
const runtime = ['id', 'version', '_uuid', '_cacheKey', '_cacheKeyVersion', '_cache', 'stackTrace'];

export function serializePositionReferenceNode(value: object): NodeExport | null {
  if ((value as ReferenceNode<unknown, unknown>).type !== 'ReferenceNode') return null;
  // @types/three does not model the precise lazy native uniform type.
  const node = value as ReferenceNode<unknown, unknown> & { node: UniformNode<unknown, unknown> | null };
  check(Object.getPrototypeOf(node) === ReferenceNode.prototype);
  check(Object.getOwnPropertySymbols(node).length === 0);
  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
    check('value' in descriptor && typeof descriptor.value !== 'function');
    if (runtime.includes(key)) {
      if (key === '_uuid') check(descriptor.value === null || typeof descriptor.value === 'string');
      continue;
    }
    check(Object.prototype.hasOwnProperty.call(defaults, key));
    if (!['properties', 'reference', 'node'].includes(key)) {
      check(descriptor.value === (defaults as unknown as Record<string, unknown>)[key]);
    }
  }
  for (const key of Object.keys(defaults)) check(Object.prototype.hasOwnProperty.call(node, key));
  check(Number.isSafeInteger(node.version) && node.version >= 0);
  // Inspect the selector cache without invoking accessors or accepting extra state.
  check(Array.isArray(node.properties) && Object.getPrototypeOf(node.properties) === Array.prototype);
  check(Object.getOwnPropertySymbols(node.properties).length === 0 && Object.getOwnPropertyNames(node.properties).length === 2);
  const property = Object.getOwnPropertyDescriptor(node.properties, '0');
  check(property && 'value' in property && property.value === 'position' && node.properties.length === 1);
  check(node.reference === null || (typeof node.reference === 'object' && node.reference !== null));
  // The resolved render object is an opaque runtime cache, overwritten by native
  // updateReference(builder/frame). Never inspect it, its position, or its children.
  const descriptors = Object.getOwnPropertyDescriptors(node);
  // Stack/debug/build caches can also hold live objects. They are opaque here.
  for (const key of runtime) {
    if (descriptors[key]) descriptors[key] = { ...descriptors[key], value: Object.getOwnPropertyDescriptor(defaults, key)?.value ?? null };
  }
  descriptors.reference = { ...descriptors.reference, value: null };
  const graphView = Object.create(ReferenceNode.prototype, descriptors) as ReferenceNode<unknown, unknown>;
  check(Object.values(Object.getOwnPropertyDescriptors(objectGroup)).every((field) => 'value' in field));
  check(validateUniformGroup(objectGroup) === 'objectGroup');
  if (node.node !== null) {
    check(Object.getPrototypeOf(node.node) === UniformNode.prototype);
    check(Object.values(Object.getOwnPropertyDescriptors(node.node)).every((field) => 'value' in field));
    check(validateUniformNode(node.node) === 'objectGroup');
    check(node.node.nodeType === 'vec3' && node.node.precision === null);
    // Native serialize uses the child's UUID as a cache key. Never coerce an
    // app object installed in that otherwise runtime-only slot.
    const uuid = Object.getOwnPropertyDescriptor(node.node, '_uuid');
    check(uuid && 'value' in uuid && (uuid.value === null || typeof uuid.value === 'string'));
    if (node.node.value !== null) vector(node.node.value);
  }
  // Validate caches before discovery can read their isNode/type fields.
  validateNodeLinks(graphView, ['node']);
  // Native Node serialization discovers the lazy uniform but omits
  // the selector. Preseed children so it never serializes runtime uniform values.
  const children = [...graphView.getSerializeChildren()];
  const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  graphView.serialize({ meta: { nodes, textures: {}, images: {} } } as never);
  adapted.add(node);
  return { op: 'ReferenceNode', args: { property: 'position', uniformType: 'vec3' } };
}

// Deliberately translation-only: no decomposition tolerance or position snapshot.
const scalar = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);
function vector(value: unknown): number[] {
  check(value && Object.getPrototypeOf(value) === Vector3.prototype);
  return ['x', 'y', 'z'].map((key) => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    check(field && 'value' in field && scalar(field.value));
    return field.value;
  });
}
function array(value: unknown, count: number): number[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length === count);
  check(Object.getOwnPropertySymbols(value).length === 0 && Object.getOwnPropertyNames(value).length === count + 1);
  return Array.from({ length: count }, (_, i) => {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    check(field && 'value' in field && scalar(field.value));
    return field.value;
  });
}
export type PositionNodeDefinition = {
  mesh?: number; matrix?: unknown; translation?: unknown; rotation?: unknown; scale?: unknown;
  skin?: unknown; camera?: unknown; extensions?: unknown; extras?: { pivot?: unknown };
};
export type PositionMeshDefinition = { primitives?: { mode?: number; material?: number; targets?: unknown }[]; weights?: unknown; extensions?: unknown };
export function validatePositionMesh(node: object, object: object) {
  if (!adapted.has(node)) return;
  const mesh = object as Mesh;
  check(Object.getPrototypeOf(mesh) === Mesh.prototype && !Array.isArray(mesh.material));
  check(mesh.pivot === null && !(mesh.material as import('three').MeshBasicMaterial).wireframe);
  const geometry = mesh.geometry;
  check(!(geometry as import('three').InstancedBufferGeometry).isInstancedBufferGeometry && Object.keys(geometry.morphAttributes).length === 0);
  check(geometry.indirect === null && geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity);
  check(geometry.attributes.position?.itemSize === 3 && geometry.attributes.position.count > 0);
  check((geometry.index?.count ?? geometry.attributes.position.count) % 3 === 0);
  const position = vector(mesh.position);
  check(position.some((n) => n !== 0)); // Native writer otherwise omits the entire transform.
  check(vector(mesh.scale).every((n) => n === 1));
  check(Object.getPrototypeOf(mesh.quaternion) === Quaternion.prototype);
  for (const [i, key] of ['_x', '_y', '_z', '_w'].entries()) {
    const field = Object.getOwnPropertyDescriptor(mesh.quaternion, key);
    check(field && 'value' in field && scalar(field.value) && field.value === (i === 3 ? 1 : 0));
  }
  check(typeof mesh.matrixAutoUpdate === 'boolean' && Object.getPrototypeOf(mesh.matrix) === Matrix4.prototype);
  if (!mesh.matrixAutoUpdate) {
    const expected = new Matrix4().makeTranslation(...position as [number, number, number]).elements;
    check(array(mesh.matrix.elements, 16).every((n, i) => n === expected[i]));
  }
  // Native pivot reconstruction can rewrite a child's position from node extras.
  for (let current: import('three').Object3D | null = mesh; current; current = current.parent) {
    check(current.pivot === null && !Object.prototype.hasOwnProperty.call(current.userData, 'pivot'));
  }
}
function translation(def: PositionNodeDefinition): number[] {
  check(def.skin === undefined && def.camera === undefined && def.extensions === undefined && def.extras?.pivot === undefined);
  if (def.matrix !== undefined) {
    check(def.translation === undefined && def.rotation === undefined && def.scale === undefined);
    const matrix = array(def.matrix, 16);
    const expected = new Matrix4().makeTranslation(matrix[12], matrix[13], matrix[14]).elements;
    check(matrix.every((n, i) => n === expected[i]));
    const result = matrix.slice(12, 15);
    check(result.some((n) => n !== 0));
    return result;
  }
  const result = array(def.translation, 3);
  check(result.some((n) => n !== 0));
  check(def.rotation === undefined || array(def.rotation, 4).every((n, i) => n === (i === 3 ? 1 : 0)));
  check(def.scale === undefined || array(def.scale, 3).every((n) => n === 1));
  return result;
}
export function validatePositionTransport(node: object, object: object, def: PositionNodeDefinition | undefined, meshDef: PositionMeshDefinition | undefined, meshIndex: number | undefined, materialIndex: number | undefined) {
  if (!adapted.has(node)) return;
  validatePositionMesh(node, object);
  check(def && meshDef?.primitives?.length === 1 && meshDef.primitives[0].mode === 4);
  check(meshIndex !== undefined && def.mesh === meshIndex && materialIndex !== undefined && meshDef.primitives[0].material === materialIndex);
  check(meshDef.primitives[0].targets === undefined && meshDef.weights === undefined && meshDef.extensions === undefined);
  check(translation(def).every((n, i) => n === vector((object as Mesh).position)[i]));
}

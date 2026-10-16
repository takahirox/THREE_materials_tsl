import { Mesh } from 'three';
import { UserDataNode } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { validateNodeLinks } from './nodeLinks.js';
import { validateUniformNode } from './uniformGroups.js';
import type { NodeExport } from './types.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Unsupported current-object UserDataNode binding or state; supply paired adapters');
}
const defaults = new UserDataNode('', 'float');
const adapted = new WeakSet<object>();
const runtime = ['id', 'version', '_uuid', '_cacheKey', '_cacheKeyVersion', '_cache', 'stackTrace'];
const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype', 'name', 'gltfExtensions', 'toJSON']);
const scalar = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
export const userDataProperty = (node: object): string | undefined =>
  adapted.has(node) ? (node as UserDataNode).property : undefined;

export function serializeUserDataNode(value: object): NodeExport | null {
  if ((value as Node).type !== 'UserDataNode') return null;
  const node = value as UserDataNode;
  check(Object.getPrototypeOf(node) === UserDataNode.prototype);
  check(Object.getOwnPropertySymbols(node).length === 0);
  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
    check('value' in descriptor && typeof descriptor.value !== 'function');
    if (runtime.includes(key)) continue;
    check(Object.prototype.hasOwnProperty.call(defaults, key));
    if (!['property', 'properties', 'reference', 'node'].includes(key)) {
      check(descriptor.value === (defaults as unknown as Record<string, unknown>)[key]);
    }
  }
  for (const key of Object.keys(defaults)) check(Object.prototype.hasOwnProperty.call(node, key));
  check(typeof node.property === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.property) && !reserved.has(node.property));
  validatePassiveJSON(node.properties);
  check(Array.isArray(node.properties) && node.properties.length === 1 && Object.getOwnPropertyNames(node.properties).length === 2 && node.properties[0] === node.property);
  if (node.reference !== null) validatePassiveJSON(node.reference);
  check(Number.isSafeInteger(node.version) && node.version >= 0);
  validateNodeLinks(node, ['node']);
  if (node.node !== null) {
    check(validateUniformNode(node.node) === 'objectGroup');
    const uniform = node.node as Node & { precision: unknown; value: unknown };
    check(uniform.nodeType === 'float' && uniform.precision === null);
    check(scalar(uniform.value));
  }
  // Native serialization only discovers the lazily created uniform; neither
  // ReferenceNode nor UserDataNode serializes its selector or binding fields.
  const children = [...node.getSerializeChildren()];
  const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  node.serialize({ meta: { nodes, textures: {}, images: {} } } as never);
  adapted.add(node);
  return { op: 'UserDataNode', args: { property: node.property, uniformType: 'float' } };
}

// Native JSON serialization must not execute user callbacks or silently erase
// the value. Other extras may be passive JSON trees, but never custom objects.
function validatePassiveJSON(value: unknown, visiting = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || scalar(value)) return;
  check(value && typeof value === 'object');
  const object = value as object;
  check(Array.isArray(object) ? Object.getPrototypeOf(object) === Array.prototype :
    [Object.prototype, null].includes(Object.getPrototypeOf(object)));
  check(!('toJSON' in object));
  check(!visiting.has(object) && Object.getOwnPropertySymbols(object).length === 0);
  visiting.add(object);
  for (const key of Object.getOwnPropertyNames(object)) {
    if (Array.isArray(object) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    check(key !== 'toJSON' && 'value' in descriptor && descriptor.enumerable);
    validatePassiveJSON(descriptor.value, visiting);
  }
  visiting.delete(object);
}

export function validateUserDataMesh(node: object, object: object) {
  const property = userDataProperty(node);
  if (property === undefined) return;
  const mesh = object as Mesh;
  check(Object.getPrototypeOf(mesh) === Mesh.prototype && !Array.isArray(mesh.material));
  check(mesh.pivot === null && !(mesh.material as import('three').MeshBasicMaterial).wireframe && Object.keys(mesh.geometry.morphAttributes).length === 0);
  const descriptor = Object.getOwnPropertyDescriptor(mesh, 'userData');
  check(descriptor && 'value' in descriptor);
  const data = descriptor!.value;
  check(data && [Object.prototype, null].includes(Object.getPrototypeOf(data)));
  const field = Object.getOwnPropertyDescriptor(data, property);
  check(field && 'value' in field && field.enumerable && scalar(field.value));
  validatePassiveJSON(data);
}

export type UserDataNodeDefinition = { mesh?: number; extras?: object; skin?: unknown; camera?: unknown; extensions?: unknown };
export type UserDataMeshDefinition = { primitives?: { mode?: number }[] };

export function validateUserDataTransport(node: object, object: object, nodeDef: UserDataNodeDefinition | undefined, meshDef: UserDataMeshDefinition | undefined) {
  const property = userDataProperty(node);
  if (property === undefined) return;
  validateUserDataMesh(node, object);
  check(meshDef?.primitives?.length === 1 && meshDef.primitives[0].mode === 4);
  check(nodeDef);
  check(nodeDef.skin === undefined && nodeDef.camera === undefined && nodeDef.extensions === undefined);
  const field = nodeDef.extras && Object.getOwnPropertyDescriptor(nodeDef.extras, property);
  check(field && 'value' in field && scalar(field.value));
  check(Object.is(field.value, (object as Mesh).userData[property]));
}

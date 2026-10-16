import { Mesh } from 'three';
import { UserDataNode } from 'three/webgpu';
import type { Object3D } from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Unsupported current-object UserDataNode binding or state; supply paired adapters');
}
const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype', 'name', 'gltfExtensions', 'toJSON']);
const adapted = new WeakSet<object>();
const scalar = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
function valueAt(data: unknown, property: string): number {
  check(data && typeof data === 'object' && !Array.isArray(data) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(data)));
  const field = Object.getOwnPropertyDescriptor(data!, property);
  check(field && 'value' in field && field.enumerable && scalar(field.value));
  return field!.value;
}

export function resolveUserDataNode(raw: JsonValue | undefined, links?: Record<string, unknown>) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const args = raw as Record<string, unknown>;
  check(Object.keys(args).length === 2 && Object.keys(args).every((key) => ['property', 'uniformType'].includes(key)));
  check(typeof args.property === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.property) && !reserved.has(args.property));
  check(args.uniformType === 'float' && (!links || Object.keys(links).length === 0));
  const node = new UserDataNode(args.property as string, 'float');
  adapted.add(node);
  return node;
}

// Check all definitions using this material, and the exact rendered objects in
// every loaded scene. Parent, mesh and primitive extras are never substitutes
// for node extras. Custom resolvers own their binding contracts.
export async function validateUserDataObjects(node: object, index: number, objects: ReadonlySet<Object3D>, parser: GLTFParser) {
  if (!adapted.has(node)) return;
  const property = (node as UserDataNode).property;
  const json = parser.json;
  const expected = new Set<number>();
  for (const [meshIndex, meshDef] of (json.meshes ?? []).entries()) {
    if (!meshDef.primitives.some((primitive: { material?: number }) => primitive.material === index)) continue;
    check(meshDef.primitives.length === 1 && [undefined, 4].includes(meshDef.primitives[0].mode));
    let uses = 0;
    for (const [nodeIndex, nodeDef] of (json.nodes ?? []).entries()) {
      if (nodeDef.mesh !== meshIndex) continue;
      check(nodeDef.skin === undefined && nodeDef.camera === undefined && nodeDef.extensions === undefined);
      valueAt(nodeDef.extras, property);
      expected.add(nodeIndex);
      uses++;
    }
    check(uses > 0);
  }
  check(expected.size > 0);
  // loadScene prunes parser.associations per scene. Cached node dependencies
  // still identify the exact native object that received each node's extras.
  const owners = new Map<Object3D, number>();
  for (const nodeIndex of expected) {
    const owner: Object3D = await parser.getDependency('node', nodeIndex);
    check(objects.has(owner) && !owners.has(owner));
    owners.set(owner, nodeIndex);
  }
  for (const object of objects) {
    check(Object.getPrototypeOf(object) === Mesh.prototype && !Array.isArray((object as Mesh).material));
    const association = parser.associations.get(object);
    const nodeIndex = owners.get(object);
    check(nodeIndex !== undefined);
    const nodeDef = json.nodes[nodeIndex!];
    if (association) check(association.nodes === nodeIndex && association.meshes === nodeDef.mesh && association.primitives === 0);
    check(Object.keys((object as Mesh).geometry.morphAttributes).length === 0);
    const data = Object.getOwnPropertyDescriptor(object, 'userData');
    check(data && 'value' in data);
    check(Object.is(valueAt(data.value, property), valueAt(nodeDef.extras, property)));
  }
}

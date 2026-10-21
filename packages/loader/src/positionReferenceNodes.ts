import { Mesh, Matrix4, Quaternion, Vector3 } from 'three';
import { ReferenceNode } from 'three/webgpu';
import type { Object3D } from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Unsupported current-object position ReferenceNode binding or transform; supply paired adapters');
}
const adapted = new WeakSet<object>();
export function resolvePositionReferenceNode(raw: JsonValue | undefined, links?: Record<string, unknown>) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const args = raw as Record<string, unknown>;
  check(Object.keys(args).length === 2 && args.property === 'position' && args.uniformType === 'vec3');
  check(!links || Object.keys(links).length === 0);
  const node = new ReferenceNode('position', 'vec3');
  adapted.add(node);
  return node;
}
const scalar = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);
function array(value: unknown, count: number): number[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length === count);
  check(Object.getOwnPropertySymbols(value).length === 0 && Object.getOwnPropertyNames(value).length === count + 1);
  return Array.from({ length: count }, (_, i) => {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    check(field && 'value' in field && scalar(field.value));
    return field.value;
  });
}
// Require an explicit, nonzero translation. An omitted native identity transform
// is deferred so missing transform data cannot silently retarget a nonzero read.
function translation(def: Record<string, unknown>): number[] {
  check(def.skin === undefined && def.camera === undefined && def.extensions === undefined);
  check(!(def.extras && Object.prototype.hasOwnProperty.call(def.extras, 'pivot')));
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
function vector(object: Object3D, key: 'position' | 'scale'): number[] {
  const field = Object.getOwnPropertyDescriptor(object, key);
  check(field && 'value' in field && Object.getPrototypeOf(field.value) === Vector3.prototype);
  return ['x', 'y', 'z'].map((key) => {
    const component = Object.getOwnPropertyDescriptor(field.value, key);
    check(component && 'value' in component && scalar(component.value));
    return component.value;
  });
}

// Match every material use to the exact cached node dependency. A wrapper,
// primitive child or scene clone cannot stand in for that native render object.
export async function validatePositionObjects(node: object, index: number, objects: ReadonlySet<Object3D>, parser: GLTFParser) {
  if (!adapted.has(node)) return;
  const json = parser.json;
  const expected = new Set<number>();
  for (const [meshIndex, meshDef] of (json.meshes ?? []).entries()) {
    if (!meshDef.primitives.some((primitive: { material?: number }) => primitive.material === index)) continue;
    check(meshDef.primitives.length === 1 && [undefined, 4].includes(meshDef.primitives[0].mode));
    check(meshDef.weights === undefined && meshDef.extensions === undefined && meshDef.primitives[0].targets === undefined);
    let uses = 0;
    for (const [nodeIndex, nodeDef] of (json.nodes ?? []).entries()) {
      if (nodeDef.mesh !== meshIndex) continue;
      check(nodeDef.skin === undefined && nodeDef.camera === undefined && nodeDef.extensions === undefined);
      translation(nodeDef);
      expected.add(nodeIndex);
      uses++;
    }
    check(uses > 0);
  }
  check(expected.size > 0);
  // loadScene prunes parser.associations per scene. Cached node dependencies
  // still identify the exact native object that received each node's transform.
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
    const geometry = (object as Mesh).geometry;
    check(Object.keys(geometry.morphAttributes).length === 0 && !(geometry as import('three').InstancedBufferGeometry).isInstancedBufferGeometry);
    check(geometry.attributes.position?.itemSize === 3 && geometry.attributes.position.count > 0);
    check((geometry.index?.count ?? geometry.attributes.position.count) % 3 === 0);
    check(object.pivot === null && vector(object, 'scale').every((n) => n === 1));
    check(Object.getPrototypeOf(object.quaternion) === Quaternion.prototype);
    for (const [i, key] of ['_x', '_y', '_z', '_w'].entries()) {
      const field = Object.getOwnPropertyDescriptor(object.quaternion, key);
      check(field && 'value' in field && scalar(field.value) && field.value === (i === 3 ? 1 : 0));
    }
    const position = vector(object, 'position');
    check(translation(nodeDef).every((n, i) => n === position[i]));
  }
}

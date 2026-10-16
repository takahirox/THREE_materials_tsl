import { UniformNode, UniformGroupNode } from 'three/webgpu';
import SourceUniformNode from 'three/src/nodes/core/UniformNode.js';
import SourceUniformGroupNode, { objectGroup as sourceObjectGroup } from 'three/src/nodes/core/UniformGroupNode.js';
import { objectGroup, renderGroup, frameGroup } from 'three/tsl';
import type { Node } from 'three/webgpu';

const check = (valid: unknown) => {
  if (!valid) throw new Error('Unsupported UniformNode or uniform group state; supply paired adapters');
};
// Version/needsUpdate and build caches are live Three.js state, never file data.
const runtime = ['id', 'version', '_uuid', '_cacheKey', '_cacheKeyVersion', '_cache', 'stackTrace'];
function validateState(node: Node, defaults: Node, inputs: string[]) {
  check(Object.getOwnPropertySymbols(node).length === 0);
  check(Number.isSafeInteger(node.version) && node.version >= 0);
  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
    check('value' in descriptor);
    if (runtime.includes(key)) continue;
    check(Object.prototype.hasOwnProperty.call(defaults, key));
    if (!inputs.includes(key)) check(descriptor.value === (defaults as unknown as Record<string, unknown>)[key]);
  }
  for (const key of Object.keys(defaults)) {
    if (!runtime.includes(key)) check(Object.prototype.hasOwnProperty.call(node, key));
  }
}

const groups = ([
  [objectGroup, 'objectGroup', 'object', false, 1, 'object'],
  [renderGroup, 'renderGroup', 'render', true, 0, 'render'],
  [frameGroup, 'frameGroup', 'frame', true, 0, 'frame'],
  // Retain the previously accepted source-module UniformNode native default.
  [sourceObjectGroup, 'objectGroup', 'object', false, 1, 'object']
] as const).map(([group, op, name, shared, order, updateType]) => {
  const Ctor = group === sourceObjectGroup ? SourceUniformGroupNode : UniformGroupNode;
  return { group, op, Ctor, defaults: new Ctor(name, shared, order, updateType) };
});

export function validateUniformGroup(node: unknown): string {
  const config = groups.find(({ group }) => group === node);
  check(config);
  const { group, op, Ctor, defaults } = config!;
  check(Object.getPrototypeOf(group) === Ctor.prototype);
  validateState(group, defaults, []);
  return op;
}

const uniformDefaults = new UniformNode(0);
export function validateUniformNode(node: Node & { groupNode?: unknown }) {
  check([UniformNode.prototype, SourceUniformNode.prototype].includes(Object.getPrototypeOf(node)));
  validateState(node, uniformDefaults, ['value', 'nodeType', 'precision', 'groupNode']);
  return validateUniformGroup(node.groupNode);
}

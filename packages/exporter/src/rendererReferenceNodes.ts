import { RendererReferenceNode, UniformNode } from 'three/webgpu';
import { renderGroup } from 'three/tsl';
import { validateNodeLinks } from './nodeLinks.js';
import { validateUniformGroup, validateUniformNode } from './uniformGroups.js';
import type { NodeExport } from './types.js';

function check(valid: unknown): asserts valid {
  if (!valid) throw new Error('Unsupported current-renderer RendererReferenceNode state; supply paired adapters');
}
const defaults = new RendererReferenceNode('toneMappingExposure', 'float');
const runtime = ['id', 'version', '_uuid', '_cacheKey', '_cacheKeyVersion', '_cache', 'stackTrace'];

export function serializeRendererReferenceNode(value: object): NodeExport | null {
  if ((value as RendererReferenceNode).type !== 'RendererReferenceNode') return null;
  // @types/three r186 declares the older ReferenceNode inheritance and omits
  // ReferenceBaseNode.group and the precise lazy uniform type.
  const node = value as RendererReferenceNode & { group: unknown; node: UniformNode<unknown, unknown> | null };
  check(Object.getPrototypeOf(node) === RendererReferenceNode.prototype);
  check(Object.getOwnPropertySymbols(node).length === 0);
  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
    check('value' in descriptor && typeof descriptor.value !== 'function');
    if (runtime.includes(key)) continue;
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
  check(property && 'value' in property && property.value === 'toneMappingExposure' && node.properties.length === 1);
  check(node.reference === null || (typeof node.reference === 'object' && node.reference !== null));
  // The resolved renderer is an opaque runtime cache, overwritten by native
  // updateReference(builder/frame). Never inspect it, its exposure, or its children.
  const descriptors = Object.getOwnPropertyDescriptors(node);
  descriptors.reference = { ...descriptors.reference, value: null };
  const graphView = Object.create(RendererReferenceNode.prototype, descriptors) as RendererReferenceNode;
  validateNodeLinks(graphView, ['group', 'node']);
  check(node.group === renderGroup && validateUniformGroup(node.group) === 'renderGroup');
  if (node.node !== null) {
    check(Object.getPrototypeOf(node.node) === UniformNode.prototype);
    check(validateUniformNode(node.node) === 'renderGroup');
    check(node.node.groupNode === node.group && node.node.nodeType === 'float' && node.node.precision === null);
    check(node.node.value === null || (typeof node.node.value === 'number' && Number.isFinite(node.node.value)));
  }
  // Native Node serialization discovers the group and lazy uniform but omits
  // the selector. Preseed children so it never serializes runtime uniform values.
  const children = [...graphView.getSerializeChildren()];
  const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  graphView.serialize({ meta: { nodes, textures: {}, images: {} } } as never);
  return { op: 'RendererReferenceNode', args: { property: 'toneMappingExposure', uniformType: 'float' } };
}

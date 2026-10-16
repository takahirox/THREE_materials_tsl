import { BufferNode, ArrayElementNode, ConstNode, NodeBuilder } from 'three/webgpu';
import SourceBufferNode from 'three/src/nodes/accessors/BufferNode.js';
import SourceArrayElementNode from 'three/src/nodes/utils/ArrayElementNode.js';
import { objectGroup } from 'three/tsl';
import { objectGroup as sourceObjectGroup } from 'three/src/nodes/core/UniformGroupNode.js';
import type { Node } from 'three/webgpu';
import type { NodeExport } from './types.js';
import { validateArrayIndex } from './uniformArrayNodes.js';
import { validateNodeLinks } from './nodeLinks.js';
import { validateUniformGroup } from './uniformGroups.js';

const check = (valid: unknown) => {
  if (!valid) throw new Error('Invalid or unsupported BufferNode/ArrayElementNode data, state or links; supply paired adapters');
};
const defaults = [new BufferNode(new Float32Array(4), 'vec4', 1), new SourceBufferNode(new Float32Array(4), 'vec4', 1)];
const elements = [new ArrayElementNode(new ConstNode(0) as never, new ConstNode(0) as never),
  new SourceArrayElementNode(new ConstNode(0) as never, new ConstNode(0) as never)];
function validateState(node: Node & Record<string, unknown>, templates: Node[], inputs: string[]) {
  const template = templates.find((n) => Object.getPrototypeOf(n) === Object.getPrototypeOf(node));
  check(template);
  const runtime = ['id', 'version', '_uuid', '_cacheKey', '_cacheKeyVersion', '_cache', 'stackTrace'];
  check(Object.getOwnPropertySymbols(node).length === 0);
  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
    check('value' in descriptor && typeof descriptor.value !== 'function');
    if (runtime.includes(key)) continue;
    check(Object.prototype.hasOwnProperty.call(template, key));
    if (!inputs.includes(key)) check(descriptor.value === (template as unknown as Record<string, unknown>)[key]);
  }
  for (const key of Object.keys(template!)) check(Object.prototype.hasOwnProperty.call(node, key));
  check(Number.isSafeInteger(node.version) && node.version >= 0);
}
export function serializeBufferNode(value: object): NodeExport | null {
  const node = value as Node & Record<string, unknown>;
  if (node.type !== 'BufferNode') return null;
  validateState(node, defaults, ['value', 'nodeType', 'bufferType', 'bufferCount', 'name', 'groupNode', 'updateRanges']);
  check(node.name === '' || node.name === `NodeBuffer_${node.id}`);
  check([objectGroup, sourceObjectGroup].includes(node.groupNode as typeof objectGroup));
  validateUniformGroup(node.groupNode);
  validateNodeLinks(node, ['groupNode']);
  check(Array.isArray(node.updateRanges) && node.updateRanges.length === 0 && Object.getPrototypeOf(node.updateRanges) === Array.prototype &&
    Object.getOwnPropertyNames(node.updateRanges).length === 1 && Object.getOwnPropertySymbols(node.updateRanges).length === 0);
  const width = node.bufferType === 'vec4' ? 4 : node.bufferType === 'mat4' ? 16 : 0;
  check(width && node.nodeType === node.bufferType && Number.isInteger(node.bufferCount) &&
    (node.bufferCount as number) > 0 && (node.bufferCount as number) * width <= 16384);
  const data = node.value;
  // Native bindings consume bytes directly. Ordinary JS arrays have no byteLength;
  // other typed arrays reinterpret those bytes rather than convert components.
  check(data && Object.getPrototypeOf(data) === Float32Array.prototype);
  const array = data as Float32Array;
  check(Object.getPrototypeOf(array.buffer) === ArrayBuffer.prototype && array.length === (node.bufferCount as number) * width);
  check(Object.getOwnPropertySymbols(array).length === 0 && Object.getOwnPropertyNames(array).length === array.length);
  const snapshot = Array.from(array);
  check(snapshot.every((v) => Number.isFinite(v) && !Object.is(v, -0)));
  return { op: 'BufferNode', args: { value: snapshot, bufferType: node.bufferType as string, bufferCount: node.bufferCount as number } };
}

export function validateArrayElement(node: Node & { node: Node; indexNode: Node }) {
  validateState(node as unknown as Node & Record<string, unknown>, elements, ['node', 'indexNode', 'name', 'global', 'parents']);
  validateNodeLinks(node, ['node', 'indexNode']);
  const parent = node.node as Node & Record<string, unknown>;
  check(parent?.isNode === true);
  let count: number;
  if (parent.type === 'BufferNode') {
    serializeBufferNode(parent);
    count = parent.bufferCount as number;
  } else if (parent.type === 'ArrayNode') count = parent.count as number;
  else if (parent.type === 'UniformArrayNode') {
    check(Array.isArray(parent.array));
    count = (parent.array as unknown[]).length;
  } else {
    const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder;
    const type = parent.getNodeType(new TypeBuilder());
    const shape = /^(?:[biu]?vec|mat)([234])$/.exec(type);
    check(shape);
    count = Number(shape![1]);
  }
  validateArrayIndex(node.indexNode, count);
}

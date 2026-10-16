import { BufferNode, NodeBuilder } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';
import { validateArrayIndex } from './uniformArrayNodes.js';

const check = (valid: unknown) => {
  if (!valid) throw new Error('Invalid or unsupported BufferNode/ArrayElementNode arguments or links');
};
export function resolveBufferNode(raw: JsonValue | undefined, links: Record<string, unknown> = {}) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const args = raw as Record<string, unknown>;
  check(Object.keys(args).length === 3 && Object.keys(args).every((key) => ['value', 'bufferType', 'bufferCount'].includes(key)));
  check(Object.keys(links).length === 0);
  const width = args.bufferType === 'vec4' ? 4 : args.bufferType === 'mat4' ? 16 : 0;
  check(width && Number.isInteger(args.bufferCount) && (args.bufferCount as number) > 0 && (args.bufferCount as number) * width <= 16384);
  const data = args.value;
  check(Array.isArray(data) && data.length === (args.bufferCount as number) * width && Array.from(data).every((v) =>
    typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0) && Math.fround(v) === v));
  return new BufferNode(new Float32Array(data as number[]), args.bufferType as string, args.bufferCount as number);
}
const pending = new WeakSet<object>();
export function prepareArrayElement(node: Node) { pending.add(node); }
export function finishArrayElement(value: object) {
  if (!pending.has(value)) return;
  const node = value as Node & { node: Node & { bufferCount: number; count: number; array: unknown[] }; indexNode: Node };
  check(node.nodeType === null);
  const parent = node.node;
  check(parent?.isNode === true);
  let count: number;
  if (parent.type === 'BufferNode') count = parent.bufferCount;
  else if (parent.type === 'ArrayNode') count = parent.count;
  else if (parent.type === 'UniformArrayNode') count = parent.array.length;
  else {
    const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder;
    const shape = /^(?:[biu]?vec|mat)([234])$/.exec(parent.getNodeType(new TypeBuilder()));
    check(shape);
    count = Number(shape![1]);
  }
  validateArrayIndex(node.indexNode, count);
  pending.delete(value);
}

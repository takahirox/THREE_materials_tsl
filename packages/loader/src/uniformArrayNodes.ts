import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';
import { Color, Vector2, Vector3, Vector4 } from 'three';
import { UniformArrayNode, ConstNode, NodeBuilder } from 'three/webgpu';
import type { Node } from 'three/webgpu';

// Keep the data contract paired in exporter/loader. No GPU packing lives here.
const sizes: Record<string, number> = { float: 1, int: 1, uint: 1, color: 3, vec2: 2, vec3: 3, vec4: 4 };
const classes = { color: Color, vec2: Vector2, vec3: Vector3, vec4: Vector4 };
const fields = ['nodeType', 'name', 'global', 'parents'];
export const isUniformArrayNodeOp = (op: string) => op === 'UniformArrayNode' || op === 'UniformArrayElementNode';
const check = (valid: unknown) => {
  if (!valid) throw new Error('Invalid or unsupported uniform array arguments, state or links; supply paired adapters');
};
const numeric = (value: unknown, type: string) => typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) &&
  (type === 'int' ? Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 :
    type === 'uint' ? Number.isInteger(value) && value >= 0 && value <= 4294967295 : Number.isFinite(Math.fround(value)));
function validateArgs(op: string, args: Record<string, unknown>) {
  check(Object.keys(args).every((key) => [...fields, ...(op === 'UniformArrayNode' ? ['elementType', 'array', 'precision'] : [])].includes(key)));
  check(args.nodeType === null);
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
  if (op !== 'UniformArrayNode') return;
  check(args.name === ''); // native GLSL owns the generated buffer block name
  check(args.precision === null || ['low', 'medium', 'high'].includes(args.precision as string));
  const type = args.elementType as string;
  check(Object.prototype.hasOwnProperty.call(sizes, type));
  const array = args.array;
  // Bound decoded data to 64 KiB of native four-component elements. Actual
  // renderer/device uniform limits remain the application's responsibility.
  check(Array.isArray(array) && array.length > 0 && array.length <= 4096);
  for (const value of array as unknown[]) {
    if (sizes[type] === 1) check(numeric(value, type));
    else check(Array.isArray(value) && value.length === sizes[type] && Array.from(value).every((v) => numeric(v, 'float')));
  }
}

type Element = Node & { node: UniformArrayNode<unknown>; indexNode: Node };
function validateIndexValues(index: Node, builder: NodeBuilder, seen = new Set<Node>()) {
  if (seen.has(index)) return;
  seen.add(index);
  for (const { childNode } of index.getSerializeChildren()) validateIndexValues(childNode, builder, seen);
  if (index.type === 'ConstNode' || index.type === 'UniformNode') {
    const type = index.getNodeType(builder);
    // InputNode's explicit shader type and stored JS value are independent.
    // Check descendants too so a wrapper cannot hide an incompatible input.
    if (['float', 'int', 'uint'].includes(type)) check(numeric((index as Node & { value: unknown }).value, type));
  }
}
function validateElement(node: Element) {
  check(node.node?.type === 'UniformArrayNode' && node.indexNode?.isNode === true);
  const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder;
  const builder = new TypeBuilder();
  validateIndexValues(node.indexNode, builder);
  check(['float', 'int', 'uint'].includes(node.indexNode.getNodeType(builder)));
  // Native indexing converts scalar floats to uint. Static indices must already
  // be integral and in range; dynamic scalar expressions retain native semantics.
  let index = node.indexNode as Node & Record<string, unknown>;
  const seen = new Set<Node>();
  while (['VarNode', 'ConvertNode', 'SubBuild'].includes(index.type)) {
    check(!seen.has(index)); seen.add(index);
    index = index.node as typeof index;
    check(index?.isNode);
  }
  if (index.type === 'ConstNode') {
    check(typeof index.value === 'number' && Number.isInteger(index.value) && !Object.is(index.value, -0) && index.value >= 0 && index.value < node.node.array.length);
  }
}
const pending = new WeakSet<object>();
export function resolveUniformArrayNode(op: string, raw: JsonValue | undefined, links: Record<string, unknown> = {}): Node {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const args = raw as Record<string, unknown>;
  validateArgs(op, args);
  const required = op === 'UniformArrayNode' ? [] : ['node', 'indexNode'];
  check(Object.keys(links).length === required.length && required.every((key) => {
    const ref = links[key];
    return ref && typeof ref === 'object' && !Array.isArray(ref) && Object.keys(ref).length === 1 && typeof (ref as { $ref?: unknown }).$ref === 'string';
  }));
  let node;
  if (op === 'UniformArrayNode') {
    const type = args.elementType as string;
    const Ctor = classes[type as keyof typeof classes];
    const array = (args.array as (number | number[])[]).map((v) => Ctor ? new Ctor().fromArray(v as number[]) : v);
    node = new UniformArrayNode(array, type);
    node.precision = args.precision as typeof node.precision;
  } else {
    // UniformArrayElementNode is not exported as a constructor in r186. Use its
    // native factory on the shared bundled TSL stack, then hydrate both links.
    node = new UniformArrayNode([0]).element(new ConstNode(0) as never);
    pending.add(node);
  }
  node.name = args.name as string;
  node.global = args.global as boolean;
  node.parents = args.parents as boolean;
  return node;
}
export function finishUniformArrayNode(node: object) {
  if (!pending.has(node)) return;
  validateElement(node as Element);
  pending.delete(node);
}

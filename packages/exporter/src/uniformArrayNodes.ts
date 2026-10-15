import SourceUniformArrayNode from 'three/src/nodes/accessors/UniformArrayNode.js';
import { objectGroup } from 'three/tsl';
import { objectGroup as sourceObjectGroup } from 'three/src/nodes/core/UniformGroupNode.js';
import { validateNodeLinks } from './nodeLinks.js';
import { getSharedTSLNodeName } from './sharedNodes.js';
import type { JsonValue, NodeExport } from './types.js';
import * as NativeNodes from 'three/webgpu';
import * as SourceNodes from 'three/src/nodes/Nodes.js';

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
// Match native prototypes, not constructor names or forgeable static type IDs.
// Source and bundled Three.js classes are distinct but both are supported.
const nativeIndexTypes = new Map<object, string>();
for (const Ctor of [...Object.values(NativeNodes), ...Object.values(SourceNodes)]) {
  if (typeof Ctor === 'function' && Ctor.prototype && Object.prototype.hasOwnProperty.call(Ctor, 'type')) {
    nativeIndexTypes.set(Ctor.prototype, (Ctor as unknown as { type: string }).type);
  }
}
function validateIndexGraph(index: Node, builder: NodeBuilder, seen = new Set<Node>()) {
  if (seen.has(index)) return;
  seen.add(index);
  // Shared exports retain native behavior and are never reconstructed as ordinary nodes.
  if (getSharedTSLNodeName(index)) return;
  check(nativeIndexTypes.get(Object.getPrototypeOf(index)) === index.type ||
    elementTemplates.some((template) => Object.getPrototypeOf(index) === Object.getPrototypeOf(template)));
  for (const { childNode } of index.getSerializeChildren()) validateIndexGraph(childNode, builder, seen);
  if (index.type === 'ConstNode' || index.type === 'UniformNode') {
    const type = index.getNodeType(builder);
    // An explicit scalar shader type does not make a vector/bool input scalar.
    // Inspect every input, including those under wrappers and expressions.
    if (['float', 'int', 'uint'].includes(type)) check(numeric((index as Node & { value: unknown }).value, type));
  }
}
function validateElement(node: Element) {
  check(node.node?.type === 'UniformArrayNode' && node.indexNode?.isNode === true);
  const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder;
  const builder = new TypeBuilder();
  validateIndexGraph(node.indexNode, builder);
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

const templates = [new UniformArrayNode([0]), new SourceUniformArrayNode([0])];
const elementTemplates = templates.map((n) => n.element(new ConstNode(0) as never));
export function serializeUniformArrayNode(value: object): NodeExport | null {
  const node = value as Node & Record<string, unknown>;
  if (!isUniformArrayNodeOp(node.type)) return null;
  const arrayNode = node.type === 'UniformArrayNode';
  const template = (arrayNode ? templates : elementTemplates).find((n) => Object.getPrototypeOf(node) === Object.getPrototypeOf(n));
  check(template); // Exact native prototypes, including subclasses with forged IDs.
  check(Object.getOwnPropertySymbols(node).length === 0);
  for (const key of Object.keys(template!).filter((key) => key.startsWith('is'))) check(node[key] === true);
  const allowed = [...Object.getOwnPropertyNames(template!), '_cache'];
  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)!;
    check(allowed.includes(key) && !descriptor.get && !descriptor.set && typeof descriptor.value !== 'function');
  }
  check(node.updateType === (arrayNode ? 'render' : 'none') && node.updateBeforeType === 'none' && node.updateAfterType === 'none');
  check(node._beforeNodes === null);
  const args: Record<string, JsonValue> = {};
  for (const key of fields) args[key] = node[key] as JsonValue;
  const links: Record<string, unknown> = {};
  if (arrayNode) {
    check(node.name === '' || node.name === `NodeBuffer_${node.id}`);
    args.name = ''; // GLSL mutates this into a runtime buffer block name
    check([objectGroup, sourceObjectGroup].includes(node.groupNode as typeof objectGroup));
    check(Array.isArray(node.updateRanges) && node.updateRanges.length === 0);
    const type = node.elementType as string;
    args.elementType = type;
    args.precision = node.precision as JsonValue;
    check(Array.isArray(node.array) && Object.getPrototypeOf(node.array) === Array.prototype);
    check((node.array as unknown[]).length > 0 && (node.array as unknown[]).length <= 4096);
    check(Object.getOwnPropertySymbols(node.array as object).length === 0);
    for (const key of Object.getOwnPropertyNames(node.array)) {
      const descriptor = Object.getOwnPropertyDescriptor(node.array, key)!;
      check((key === 'length' || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (node.array as unknown[]).length)) && 'value' in descriptor);
    }
    // Read ordinary component data only. Reject decorated/subclassed objects,
    // accessors and callbacks rather than calling an app-defined toArray().
    args.array = Array.from(node.array as unknown[], (value) => {
      if (['float', 'int', 'uint'].includes(type)) return value as JsonValue;
      const Ctor = classes[type as keyof typeof classes];
      check(Ctor && value && Object.getPrototypeOf(value) === Ctor.prototype);
      const componentKeys = type === 'color' ? ['r', 'g', 'b'] : ['x', 'y', 'z', 'w'].slice(0, sizes[type]);
      check(Object.getOwnPropertySymbols(value).length === 0);
      if (type === 'color') check(Object.getOwnPropertyDescriptor(value, 'isColor')?.value === true);
      check(Object.getOwnPropertyNames(value).every((key) => [...componentKeys, ...(type === 'color' ? ['isColor'] : [])].includes(key)));
      return componentKeys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        check(descriptor && 'value' in descriptor);
        return descriptor!.value as number;
      });
    });
    validateArgs(node.type, args);
    const native = node as unknown as UniformArrayNode<unknown>;
    check(node.paddedType === native.getPaddedType());
    // Accept native unbuilt or built state; generated contents are never saved.
    const Buffer = type === 'int' ? Int32Array : type === 'uint' ? Uint32Array : Float32Array;
    check(node.value === null ? node.bufferCount === 0 && node.bufferType === undefined :
      node.value instanceof Buffer && node.value.length === (node.array as unknown[]).length * 4 &&
      node.bufferCount === (node.array as unknown[]).length && node.bufferType === node.paddedType);
    validateNodeLinks(node, ['groupNode']);
  } else {
    validateArgs(node.type, args);
    validateNodeLinks(node, ['node', 'indexNode']);
    validateElement(node as unknown as Element);
    links.node = { node: node.node };
    links.indexNode = { node: node.indexNode };
  }
  return { op: node.type, args, links };
}

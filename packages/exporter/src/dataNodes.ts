import { InterpolationSamplingType, InterpolationSamplingMode } from 'three';
import type { Node } from 'three/webgpu';
import type { JsonValue, NodeExport } from './types.js';

type Adapter = { fields: string[]; inputs: string[]; optional?: string[] };
// Only data fields missing from Three.js serialization are read directly. Keep
// this allowlist paired with loader/dataNodes.ts; no shader semantics live here.
const adapters: Record<string, Adapter> = {
  VarNode: { fields: ['readOnly', 'intent'], inputs: ['node'] },
  SplitNode: { fields: ['components'], inputs: ['node'] },
  JoinNode: { fields: ['nodeType'], inputs: ['nodes'] },
  ConvertNode: { fields: ['convertTo'], inputs: ['node'] },
  SetNode: { fields: ['components'], inputs: ['sourceNode', 'targetNode'] },
  FlipNode: { fields: ['components'], inputs: ['sourceNode'] },
  ArrayNode: { fields: ['nodeType', 'count'], inputs: [], optional: ['values'] },
  ArrayElementNode: { fields: [], inputs: ['node', 'indexNode'] },
  ConditionalNode: { fields: [], inputs: ['condNode', 'ifNode'], optional: ['elseNode'] },
  RotateNode: { fields: ['order'], inputs: ['positionNode', 'rotationNode'] },
  // Three.js r186 calls the serialized operation "SubBuild", not "SubBuildNode".
  SubBuild: { fields: ['name', 'nodeType'], inputs: ['node'] },
  VaryingNode: { fields: ['name', 'interpolationType', 'interpolationSampling'], inputs: ['node'] }
};

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && (value as Node).isNode === true;

export function serializeDataNode(value: object): NodeExport | null {
  const node = value as Node & Record<string, unknown>;
  const adapter = Object.prototype.hasOwnProperty.call(adapters, node.type) ? adapters[node.type] : undefined;
  if (!adapter) return null;
  // Reject subclasses inheriting a built-in ID. Constructor names/instanceof
  // would break with minification or Three.js's separate source/build modules.
  if (!Object.prototype.hasOwnProperty.call(node.constructor, 'type')) throw new Error(`Unsupported subclass of ${node.type}; supply explicit adapters`);

  const inputs = [...adapter.inputs, ...(adapter.optional ?? [])];
  const children = [...node.getSerializeChildren()];
  // Preseed Three.js's cache: serialize this node's fields without recursively
  // serializing descendants. The graph writer owns traversal/identity/cycles.
  const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  const data: Record<string, unknown> = { meta: { nodes, textures: {}, images: {} } };
  node.serialize(data as never);
  const args: Record<string, JsonValue> = {};
  for (const field of adapter.fields) args[field] = (data[field] ?? node[field]) as JsonValue;
  // These base properties affect runtime naming and caching, and are not saved
  // by Node.serialize(). Preserve them rather than silently resetting them.
  args.nodeType = node.nodeType;
  args.name = node.name;
  args.global = node.global;
  args.parents = node.parents;

  const links: Record<string, unknown> = {};
  for (const input of inputs) {
    const child = node[input];
    if (child == null && !adapter.inputs.includes(input)) continue;
    if (Array.isArray(child) !== ['nodes', 'values'].includes(input)) throw new Error(`Invalid ${node.type}.${input}`);
    if (Array.isArray(child)) {
      if (!child.length || Array.from(child).some((item) => !isNode(item))) throw new Error(`Invalid ${node.type}.${input}`);
      links[input] = child.map((item) => ({ node: item }));
    } else {
      if (!isNode(child)) throw new Error(`Invalid ${node.type}.${input}`);
      links[input] = { node: child };
    }
  }
  // Discovery must agree with the adapter. Extra child slots require an
  // explicit adapter instead of being discarded by a scalar-field allowlist.
  for (const { property } of children) {
    if (!inputs.includes(property)) throw new Error(`Unsupported ${node.type} link "${property}"`);
  }
  const containsNode = (child: unknown, seen = new Set<unknown>()): boolean => {
    if (isNode(child)) return true;
    if (!child || typeof child !== 'object' || seen.has(child)) return false;
    seen.add(child);
    return (Array.isArray(child) || Object.getPrototypeOf(child) === Object.prototype) && Object.values(child).some((item) => containsNode(item, seen));
  };
  for (const [property, child] of Object.entries(node)) {
    if (containsNode(child) && !inputs.includes(property)) throw new Error(`Unsupported ${node.type} link "${property}"`);
  }
  const valueType = (type: unknown) => typeof type === 'string' && /^(?:float|int|uint|bool|color|[biu]?vec[234]|mat[234])$/.test(type);
  const check = (valid: boolean) => { if (!valid) throw new Error(`Invalid ${node.type} arguments`); };
  const validComponents = typeof args.components === 'string' && /^[xyzw]{1,4}$/.test(args.components);
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
  check(args.nodeType === null || valueType(args.nodeType));
  switch (node.type) {
    case 'VarNode':
      check(typeof args.readOnly === 'boolean' && typeof args.intent === 'boolean'); break;
    case 'SplitNode':
      check(validComponents); break;
    case 'SetNode':
    case 'FlipNode':
      check(validComponents && ['x', 'y', 'z', 'w'].filter((c) => (args.components as string).includes(c)).join('') === args.components); break;
    case 'ConvertNode':
      check(typeof args.convertTo === 'string' && args.convertTo.split('|').every(valueType)); break;
    case 'RotateNode':
      check(['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'].includes(args.order as string)); break;
    case 'ArrayNode':
      check(Number.isInteger(args.count) && (args.count as number) > 0);
      check(node.values == null ? node.nodeType !== null : (node.values as unknown[]).length === node.count); break;
    case 'SubBuild':
      check(typeof args.name === 'string' && args.name.length > 0); break;
    case 'VaryingNode':
      check(args.interpolationType === null || Object.values(InterpolationSamplingType).includes(args.interpolationType as never));
      check(args.interpolationSampling === null || Object.values(InterpolationSamplingMode).includes(args.interpolationSampling as never)); break;
  }
  return { op: node.type, args, links };
}

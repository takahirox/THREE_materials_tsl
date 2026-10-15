import { InterpolationSamplingType, InterpolationSamplingMode } from 'three';
import {
  ArrayNode, ArrayElementNode, ConditionalNode, ConvertNode, FlipNode, JoinNode,
  RotateNode, SetNode, SplitNode, SubBuildNode, VaryingNode, VarNode, ConstNode
} from 'three/webgpu';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

const ops = new Set([
  'VarNode', 'SplitNode', 'JoinNode', 'ConvertNode', 'SetNode', 'FlipNode', 'ArrayNode',
  'ArrayElementNode', 'ConditionalNode', 'RotateNode', 'SubBuild', 'VaryingNode'
]);
export const isDataNodeOp = (op: string) => ops.has(op);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const ref = (value: unknown) => record(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string';
// Accept only built-in value types/identifiers, never shader snippets or code.
const valueType = (value: unknown) => typeof value === 'string' && /^(?:float|int|uint|bool|color|[biu]?vec[234]|mat[234])$/.test(value);
const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const components = (value: unknown) => typeof value === 'string' && /^[xyzw]{1,4}$/.test(value);

export function resolveDataNode(op: string, raw: JsonValue | undefined, rawLinks?: Record<string, unknown>) {
  if (raw !== undefined && !record(raw)) throw new Error(`Invalid ${op} arguments`);
  const args = (raw ?? {}) as Record<string, unknown>;
  const links = rawLinks ?? {};
  // Inputs are replaced only after the encoded link shape has been checked.
  // Some r186 declarations lag the JS constructors (SetNode even uses DOM Node);
  // the narrow casts below bridge those declarations, not shader behavior.
  const placeholder = new ConstNode(0);
  let fields: string[] = [];
  let required: string[] = [];
  let optional: string[] = [];
  let node;
  const check = (valid: boolean) => { if (!valid) throw new Error(`Invalid ${op} arguments or links`); };
  const nodeType = args.nodeType ?? null;
  check(nodeType === null || valueType(nodeType));
  switch (op) {
    case 'VarNode':
      fields = ['readOnly', 'intent']; required = ['node'];
      check(typeof args.readOnly === 'boolean' && typeof args.intent === 'boolean');
      node = new VarNode(placeholder, args.name as string | null, args.readOnly as boolean);
      node.setIntent(args.intent as boolean); break;
    case 'SplitNode':
      fields = ['components']; required = ['node'];
      check(components(args.components));
      node = new SplitNode(placeholder, args.components as string); break;
    case 'JoinNode':
      fields = ['nodeType']; required = ['nodes'];
      check(nodeType === null || valueType(nodeType));
      node = new JoinNode([]);
      node.nodeType = nodeType as never; break;
    case 'ConvertNode':
      fields = ['convertTo']; required = ['node'];
      check(typeof args.convertTo === 'string' && args.convertTo.split('|').every(valueType));
      node = new ConvertNode(placeholder, args.convertTo as string); break;
    case 'SetNode':
    case 'FlipNode':
      fields = ['components']; required = op === 'SetNode' ? ['sourceNode', 'targetNode'] : ['sourceNode'];
      // Component setters/flips use sorted, unique component names.
      check(components(args.components) && ['x', 'y', 'z', 'w'].filter((c) => (args.components as string).includes(c)).join('') === args.components);
      node = op === 'SetNode' ? new SetNode(placeholder as never, args.components as never, placeholder as never) : new FlipNode(placeholder, args.components as string); break;
    case 'ArrayNode':
      fields = ['nodeType', 'count']; optional = ['values'];
      check(Number.isInteger(args.count) && (args.count as number) > 0 && (nodeType === null || valueType(nodeType)));
      check(links.values === undefined ? nodeType !== null : Array.isArray(links.values) && links.values.length === args.count);
      node = new ArrayNode(nodeType as never, args.count as number); break;
    case 'ArrayElementNode':
      required = ['node', 'indexNode'];
      node = new ArrayElementNode(placeholder as never, placeholder as never); break;
    case 'ConditionalNode':
      required = ['condNode', 'ifNode']; optional = ['elseNode'];
      node = new ConditionalNode(placeholder as never, placeholder); break;
    case 'RotateNode':
      fields = ['order']; required = ['positionNode', 'rotationNode'];
      check(['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'].includes(args.order as string));
      node = new RotateNode(placeholder as never, placeholder as never, args.order as never);
      node.deserialize({ order: args.order } as never); break;
    case 'SubBuild':
      fields = ['nodeType']; required = ['node'];
      check(identifier(args.name) && (nodeType === null || valueType(nodeType)));
      node = new SubBuildNode(placeholder, args.name as string, nodeType as never); break;
    case 'VaryingNode':
      fields = ['interpolationType', 'interpolationSampling']; required = ['node'];
      check(args.name == null || identifier(args.name) || args.name === '');
      check(args.interpolationType == null || Object.values(InterpolationSamplingType).includes(args.interpolationType as never));
      check(args.interpolationSampling == null || Object.values(InterpolationSamplingMode).includes(args.interpolationSampling as never));
      node = new VaryingNode(placeholder, args.name as string | null);
      node.setInterpolation((args.interpolationType ?? null) as never, (args.interpolationSampling ?? null) as never); break;
    default: return null;
  }
  check(Object.keys(args).every((key) => [...fields, 'nodeType', 'name', 'global', 'parents'].includes(key)));
  check(args.name == null || args.name === '' || identifier(args.name));
  check(args.parents === undefined || typeof args.parents === 'boolean');
  check(args.global === undefined || typeof args.global === 'boolean');
  check(required.every((key) => Object.prototype.hasOwnProperty.call(links, key)));
  for (const [key, value] of Object.entries(links)) {
    check([...required, ...optional].includes(key));
    if (key === 'nodes' || key === 'values') {
      check(Array.isArray(value) && value.length > 0 && value.every(ref));
    } else check(ref(value));
  }
  node.nodeType = nodeType as never;
  if (args.name !== undefined) node.name = args.name as string;
  if (args.parents !== undefined) node.parents = args.parents as boolean;
  if (args.global !== undefined) node.global = args.global as boolean;
  return node;
}

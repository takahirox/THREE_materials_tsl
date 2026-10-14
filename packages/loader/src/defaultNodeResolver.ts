import * as TSL from 'three/tsl';
import { ConstNode } from 'three/webgpu';
import AttributeNode from 'three/src/nodes/core/AttributeNode.js';
import UniformNode from 'three/src/nodes/core/UniformNode.js';
import MathNode from 'three/src/nodes/math/MathNode.js';
import OperatorNode from 'three/src/nodes/math/OperatorNode.js';
import type { MathNodeMethod } from 'three/src/nodes/math/MathNode.js';
import type { OperatorNodeOp } from 'three/src/nodes/math/OperatorNode.js';

import type { JsonValue, NodeResolver } from './THREEMaterialsTSLLoaderPlugin.js';

type ResolverOptions = {
  overrides?: Record<string, unknown>;
};

// Only shared node objects and explicitly adapted classes are supported. TSL
// functions do not in general accept serialized object arguments.
const registry = Object.fromEntries(Object.entries(TSL).filter(([, value]) =>
  value && typeof value === 'object' && (value as { isNode?: boolean }).isNode === true
));

export const createDefaultNodeResolver = (options: ResolverOptions = {}): NodeResolver => {
  const overrides = options.overrides ?? {};
  return (op: string, _args?: JsonValue) => {
    if (Object.prototype.hasOwnProperty.call(overrides, op)) return overrides[op];
    if (op === 'ConstNode' || op === 'UniformNode') {
      const args = _args as Record<string, unknown> | undefined;
      if (!args) return null;
      const sizes: Record<string, number> = { color: 3, vec2: 2, vec3: 3, vec4: 4, mat2: 4, mat3: 9, mat4: 16 };
      const size = sizes[args.valueType as string];
      const valid = size ? Array.isArray(args.value) && args.value.length === size && args.value.every((v) => typeof v === 'number' && Number.isFinite(v)) :
        args.valueType === 'float' ? typeof args.value === 'number' && Number.isFinite(args.value) :
        args.valueType === 'bool' && typeof args.value === 'boolean';
      if (!valid) return null;
      const node = op === 'ConstNode' ? new ConstNode(0) : new UniformNode(0);
      // Three.js owns the value and precision serialization semantics.
      // InputNode infers its type only from null, not undefined.
      node.deserialize({ ...args, nodeType: args.nodeType ?? null } as never);
      return node;
    }
    if (op === 'AttributeNode') {
      const args = _args as { attributeName?: string; nodeType?: string | null } | undefined;
      return new AttributeNode(args?.attributeName ?? 'uv', args?.nodeType ?? null);
    }
    if (op === 'MathNode') {
      const args = _args as { method?: MathNodeMethod } | undefined;
      const placeholder = new ConstNode(0, 'float');
      if (!args?.method || !Object.values(MathNode).includes(args.method)) return null;
      const MathNodeCtor = MathNode as unknown as new (method: MathNodeMethod, a: ConstNode<number>) => MathNode;
      return new MathNodeCtor(args.method, placeholder);
    }
    if (op === 'OperatorNode') {
      const args = _args as { op?: OperatorNodeOp | '!' | '~' } | undefined;
      const placeholder = new ConstNode(0, 'float');
      if (args?.op === '!' || args?.op === '~') {
        // r182 supports unary operators, but its declarations require two inputs.
        // Leave bNode undefined so it is neither built nor exported as a link.
        const UnaryOperatorNode = OperatorNode as unknown as new (op: '!' | '~', a: ConstNode<number>) => OperatorNode;
        return new UnaryOperatorNode(args.op, placeholder);
      }
      if (!args?.op || !['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '&&', '||', '^^', '&', '|', '^', '<<', '>>'].includes(args.op)) return null;
      return new OperatorNode(args.op, placeholder, placeholder);
    }
    return Object.prototype.hasOwnProperty.call(registry, op) ? registry[op] : null;
  };
};

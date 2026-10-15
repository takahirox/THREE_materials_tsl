import { resolveReferenceNode, isReferenceNodeOp } from './referenceNodes.js';
import * as TSL from 'three/tsl';
import { resolveShadingNode, isShadingNodeOp } from './shadingNodes.js';
import { resolveDataNode, isDataNodeOp } from './dataNodes.js';
import { resolveTextureNode, isTextureNodeOp } from './textureNodes.js';
// Keep reconstructed nodes on the same TSL stack as three/tsl. Mixing source
// and bundled node modules breaks derivative and function-backed shader setup.
import { ConstNode, AttributeNode, UniformNode, MathNode, OperatorNode } from 'three/webgpu';
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

const validInputs = (links: Record<string, unknown> | undefined, required: string[], optional: string[] = []) =>
  !!links && required.every((key) => Object.prototype.hasOwnProperty.call(links, key)) &&
  Object.entries(links).every(([key, value]) =>
    [...required, ...optional].includes(key) && !!value && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).length === 1 &&
    typeof (value as { $ref?: unknown }).$ref === 'string'
  );

// r186's MathNode input categories; atan additionally accepts a second input.
const binaryMath = ['equals', 'min', 'max', 'step', 'reflect', 'distance', 'difference', 'dot', 'cross', 'pow', 'transformDirection'];
const ternaryMath = ['mix', 'clamp', 'refract', 'smoothstep', 'faceforward'];

export const createDefaultNodeResolver = (options: ResolverOptions = {}): NodeResolver => {
  const overrides = options.overrides ?? {};
  return (op: string, _args?: JsonValue, links?: Record<string, unknown>) => {
    if (Object.prototype.hasOwnProperty.call(overrides, op)) return overrides[op];
    if (isReferenceNodeOp(op)) return resolveReferenceNode(op, _args, links);
    if (isShadingNodeOp(op)) return resolveShadingNode(op, _args, links);
    if (isDataNodeOp(op)) return resolveDataNode(op, _args, links);
    if (isTextureNodeOp(op)) return resolveTextureNode(op, _args, links);
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
      const required = ternaryMath.includes(args.method) ? ['aNode', 'bNode', 'cNode'] :
        binaryMath.includes(args.method) ? ['aNode', 'bNode'] : ['aNode'];
      if (!validInputs(links, required, args.method === 'atan' ? ['bNode'] : [])) return null;
      const MathNodeCtor = MathNode as unknown as new (method: MathNodeMethod, a: typeof placeholder) => MathNode;
      return new MathNodeCtor(args.method, placeholder);
    }
    if (op === 'OperatorNode') {
      const args = _args as { op?: OperatorNodeOp | '!' | '~' } | undefined;
      const placeholder = new ConstNode(0, 'float');
      if (args?.op === '!' || args?.op === '~') {
        if (!validInputs(links, ['aNode'])) return null;
        // Three.js supports unary operators, but its declarations require two inputs.
        // Leave bNode undefined so it is neither built nor exported as a link.
        const UnaryOperatorNode = OperatorNode as unknown as new (op: '!' | '~', a: typeof placeholder) => OperatorNode;
        return new UnaryOperatorNode(args.op, placeholder);
      }
      if (!args?.op || !['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '&&', '||', '^^', '&', '|', '^', '<<', '>>'].includes(args.op)) return null;
      if (!validInputs(links, ['aNode', 'bNode'])) return null;
      return new OperatorNode(args.op, placeholder, placeholder);
    }
    // Shared identities have no file-supplied state. Ignoring arguments here
    // could silently discard a producer's intended behavior.
    return Object.prototype.hasOwnProperty.call(registry, op) && _args === undefined ? registry[op] : null;
  };
};

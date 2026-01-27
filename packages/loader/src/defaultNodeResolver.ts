import * as TSL from 'three/src/nodes/TSL.js';
import { Color, Vector2, Vector3 } from 'three';
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

const buildRegistry = () => {
  const registry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(TSL)) {
    registry[key] = value;
  }
  registry.ConstNode = ConstNode;
  registry.AttributeNode = AttributeNode;
  registry.UniformNode = UniformNode;
  registry.MathNode = MathNode;
  registry.OperatorNode = OperatorNode;
  return registry;
};

const registry = buildRegistry();

export const createDefaultNodeResolver = (options: ResolverOptions = {}): NodeResolver => {
  const overrides = options.overrides ?? {};
  return (op: string, _args?: JsonValue) => {
    if (op in overrides) return overrides[op];
    if (op === 'TimeNode') {
      return (TSL as { time?: unknown }).time ?? null;
    }
    if (op === 'ConstNode') {
      const args = _args as { value?: unknown; valueType?: string; nodeType?: string } | undefined;
      if (!args) return null;
      if (args.valueType === 'color' && Array.isArray(args.value)) {
        const [r, g, b] = args.value as number[];
        return new ConstNode(new Color(r, g, b), args.nodeType ?? 'color');
      }
      if (args.valueType === 'vec2' && Array.isArray(args.value)) {
        const [x, y] = args.value as number[];
        return new ConstNode(new Vector2(x, y), args.nodeType ?? 'vec2');
      }
      if (args.valueType === 'vec3' && Array.isArray(args.value)) {
        const [x, y, z] = args.value as number[];
        return new ConstNode(new Vector3(x, y, z), args.nodeType ?? 'vec3');
      }
      if (args.valueType === 'float') {
        return new ConstNode(args.value as number, args.nodeType ?? 'float');
      }
    }
    if (op === 'UniformNode') {
      const args = _args as { value?: unknown; valueType?: string; nodeType?: string } | undefined;
      if (!args) return null;
      if (args.valueType === 'color' && Array.isArray(args.value)) {
        const [r, g, b] = args.value as number[];
        return new UniformNode(new Color(r, g, b), args.nodeType ?? 'color');
      }
      if (args.valueType === 'vec2' && Array.isArray(args.value)) {
        const [x, y] = args.value as number[];
        return new UniformNode(new Vector2(x, y), args.nodeType ?? 'vec2');
      }
      if (args.valueType === 'vec3' && Array.isArray(args.value)) {
        const [x, y, z] = args.value as number[];
        return new UniformNode(new Vector3(x, y, z), args.nodeType ?? 'vec3');
      }
      return new UniformNode(args.value, args.nodeType ?? null);
    }
    if (op === 'AttributeNode') {
      const args = _args as { attributeName?: string; nodeType?: string | null } | undefined;
      return new AttributeNode(args?.attributeName ?? 'uv', args?.nodeType ?? null);
    }
    if (op === 'MathNode') {
      const args = _args as { method?: MathNodeMethod } | undefined;
      const placeholder = new ConstNode(0, 'float');
      if (!args?.method) return new MathNode(MathNode.SIN, placeholder);
      const MathNodeCtor = MathNode as unknown as new (method: MathNodeMethod, a: ConstNode<number>) => MathNode;
      return new MathNodeCtor(args.method, placeholder);
    }
    if (op === 'OperatorNode') {
      const args = _args as { op?: OperatorNodeOp } | undefined;
      const placeholder = new ConstNode(0, 'float');
      if (!args?.op) return new OperatorNode('*', placeholder, placeholder);
      return new OperatorNode(args.op, placeholder, placeholder);
    }
    return registry[op] ?? null;
  };
};

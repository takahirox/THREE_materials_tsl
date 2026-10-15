import type { JsonValue } from './types.js';
import type { NodeExport } from './types.js';
import { getSharedTSLNodeName } from './sharedNodes.js';
import { serializeDataNode } from './dataNodes.js';
import { objectGroup } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { objectGroup as sourceObjectGroup } from 'three/src/nodes/core/UniformGroupNode.js';

type DefaultNodeSerializerOptions = {
  overrides?: Record<string, NodeExport | ((node: unknown) => NodeExport | null)>;
};

const cleanArgs = (raw: Record<string, unknown>): Record<string, JsonValue> | undefined => {
  const args: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      Array.isArray(value) ||
      typeof value === 'object'
    ) {
      args[key] = value as JsonValue;
    }
  }
  return Object.keys(args).length > 0 ? args : undefined;
};

const assignLink = (
  links: Record<string, unknown>,
  property: string,
  index: number | string | undefined,
  node: unknown
) => {
  const linkTarget = { node };
  if (index === undefined) {
    links[property] = linkTarget;
    return;
  }

  let container = links[property];
  if (!container) {
    container = Number.isInteger(index) ? [] : {};
    links[property] = container;
  }

  if (Array.isArray(container)) {
    (container as unknown[])[index as number] = linkTarget;
  } else {
    (container as Record<string, unknown>)[String(index)] = linkTarget;
  }
};

export const createDefaultNodeSerializer = (options: DefaultNodeSerializerOptions = {}) => {
  const overrides = options.overrides ?? {};

  return (node: unknown): NodeExport | null => {
    const sharedName = getSharedTSLNodeName(node);
    if (sharedName) {
      const override = overrides[sharedName];
      if (typeof override === 'function') {
        const result = override(node);
        if (result) return result;
      } else if (override) {
        return override;
      }
      return { op: sharedName };
    }

    if (!node || typeof node !== 'object') return null;

    const nodeType =
      (node as { type?: string }).type ??
      (node as { constructor?: { type?: string } }).constructor?.type ??
      (node as { constructor?: { name?: string } }).constructor?.name;

    if (!nodeType) return null;

    const override = overrides[nodeType];
    if (typeof override === 'function') {
      const result = override(node);
      if (result) return result;
    } else if (override) {
      return override;
    }

    // Shared exports above retain their Three.js-owned update behavior. Ordinary
    // instances with app callbacks cannot be represented by data-only glTF.
    for (const [property, value] of Object.entries(node)) {
      if (typeof value === 'function' ||
          (['updateType', 'updateBeforeType', 'updateAfterType'].includes(property) && value !== 'none')) {
        throw new Error(`Unsupported dynamic property "${property}"; supply explicit adapters`);
      }
    }

    const dataNode = serializeDataNode(node);
    if (dataNode) return dataNode;

    if (['ConstNode', 'UniformNode', 'AttributeNode', 'MathNode', 'OperatorNode'].includes(nodeType) && !Object.prototype.hasOwnProperty.call(node.constructor, 'type')) {
      throw new Error(`Unsupported subclass of ${nodeType}; supply explicit adapters`);
    }
    if (['ConstNode', 'UniformNode', 'AttributeNode'].includes(nodeType)) {
      for (const child of (node as Node).getSerializeChildren()) {
        if (nodeType !== 'UniformNode' || child.property !== 'groupNode' || ![objectGroup, sourceObjectGroup].includes(child.childNode as typeof objectGroup)) {
          throw new Error(`Unsupported ${nodeType} link "${child.property}"; supply explicit adapters`);
        }
      }
    }

    if (nodeType === 'UniformNode' && ![objectGroup, sourceObjectGroup].includes((node as { groupNode?: unknown }).groupNode as typeof objectGroup)) {
      throw new Error('Unsupported UniformNode group; supply explicit adapters');
    }

    if (nodeType === 'ConstNode' || nodeType === 'UniformNode') {
      const serializeData: Record<string, unknown> = {
        meta: { nodes: {}, textures: {}, images: {} }
      };
      (node as { serialize?: (data: Record<string, unknown>) => void }).serialize?.(serializeData);
      if (!['float', 'bool', 'color', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4'].includes(serializeData.valueType as string)) {
        throw new Error(`Unsupported ${nodeType} value type; supply explicit adapters`);
      }
      const args = cleanArgs({
        value: serializeData.value,
        valueType: serializeData.valueType,
        nodeType: serializeData.nodeType,
        precision: serializeData.precision
      });
      return { op: nodeType, args };
    }

    if (nodeType === 'AttributeNode') {
      const serializeData: Record<string, unknown> = {
        meta: { nodes: {}, textures: {}, images: {} }
      };
      (node as { serialize?: (data: Record<string, unknown>) => void }).serialize?.(serializeData);
      const args = cleanArgs({
        attributeName: serializeData._attributeName ?? serializeData.attributeName,
        nodeType: serializeData.nodeType
      });
      return { op: nodeType, args };
    }

    if (nodeType === 'MathNode' || nodeType === 'OperatorNode') {
      const serializeData: Record<string, unknown> = {
        meta: { nodes: {}, textures: {}, images: {} }
      };
      (node as { serialize?: (data: Record<string, unknown>) => void }).serialize?.(serializeData);
      const args = cleanArgs({
        method: serializeData.method,
        op: serializeData.op
      });
      const links: Record<string, unknown> = {};
      const children = (node as {
        getSerializeChildren?: () => Iterable<{ property: string; index?: number; childNode: unknown }>;
      }).getSerializeChildren?.();
      if (children) {
        for (const child of children) {
          assignLink(links, child.property, child.index, child.childNode);
        }
      }
      // getSerializeChildren() omits self references. Include direct node
      // inputs too so the graph writer detects cycles instead of dropping them.
      for (const [property, value] of Object.entries(node)) {
        if (value && typeof value === 'object' && (value as { isNode?: boolean }).isNode) {
          links[property] = { node: value };
        }
      }
      return { op: nodeType, args, links: Object.keys(links).length > 0 ? links : undefined };
    }

    throw new Error(`Unsupported node type "${nodeType}"; supply a serializer and resolver override`);
  };
};

import type { JsonValue } from './types.js';
import type { NodeExport } from './types.js';
import { getSharedTSLNodeName } from './sharedNodes.js';

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

    if (nodeType === 'ConstNode' || nodeType === 'UniformNode') {
      const serializeData: Record<string, unknown> = {
        meta: { nodes: {}, textures: {}, images: {} }
      };
      (node as { serialize?: (data: Record<string, unknown>) => void }).serialize?.(serializeData);
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
      const links: Record<string, { node: unknown }> = {};
      const children = (node as {
        getSerializeChildren?: () => Iterable<{ property: string; index?: number; childNode: unknown }>;
      }).getSerializeChildren?.();
      if (children) {
        for (const child of children) {
          if (child.index !== undefined) continue;
          links[child.property] = { node: child.childNode };
        }
      }
      return { op: nodeType, args, links: Object.keys(links).length > 0 ? links : undefined };
    }

    const serializeData: Record<string, unknown> = {
      meta: { nodes: {}, textures: {}, images: {} }
    };
    if (typeof (node as { serialize?: (data: Record<string, unknown>) => void }).serialize === 'function') {
      (node as { serialize: (data: Record<string, unknown>) => void }).serialize(serializeData);
    }

    const args = cleanArgs(
      Object.fromEntries(
        Object.entries(serializeData).filter(([key]) => key !== 'meta' && key !== 'inputNodes')
      )
    );

    const links: Record<string, { node: unknown }> = {};
    const children = (node as { getSerializeChildren?: () => Iterable<{ property: string; index?: number; childNode: unknown }> })
      .getSerializeChildren?.();
    if (children) {
      for (const child of children) {
        if (child.index !== undefined) continue;
        links[child.property] = { node: child.childNode };
      }
    }

    return {
      op: nodeType,
      args,
      links: Object.keys(links).length > 0 ? links : undefined
    };
  };
};

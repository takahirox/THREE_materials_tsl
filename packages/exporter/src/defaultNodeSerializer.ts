import { serializeUserDataNode } from './userDataNodes.js';
import { serializeBufferNode } from './bufferNodes.js';
import { serializeUniformArrayNode, isUniformArrayNodeOp } from './uniformArrayNodes.js';
import { serializeGeometryNode, isGeometryNodeOp } from './geometryNodes.js';
import type { JsonValue } from './types.js';
import type { NodeExport } from './types.js';
import { getSharedTSLNodeName } from './sharedNodes.js';
import { serializeReferenceNode, isReferenceNodeOp } from './referenceNodes.js';
import { serializeShadingNode } from './shadingNodes.js';
import { serializeDataNode } from './dataNodes.js';
import { serializeTextureNode, isTextureNodeOp } from './textureNodes.js';
import { validateNodeLinks } from './nodeLinks.js';
import { validateUniformGroup, validateUniformNode } from './uniformGroups.js';
import type { Node } from 'three/webgpu';

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
      if (['objectGroup', 'renderGroup', 'frameGroup'].includes(sharedName)) validateUniformGroup(node);
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

    const userDataNode = serializeUserDataNode(node);
    if (userDataNode) return userDataNode;

    // Shared exports above retain their Three.js-owned update behavior. Ordinary
    // instances with app callbacks cannot be represented by data-only glTF.
    for (const [property, value] of Object.entries(node)) {
      if (typeof value === 'function' ||
          (['updateType', 'updateBeforeType', 'updateAfterType'].includes(property) && value !== 'none' &&
            !(property === 'updateType' && (isTextureNodeOp(nodeType) || isReferenceNodeOp(nodeType) || isGeometryNodeOp(nodeType) || isUniformArrayNodeOp(nodeType))))) {
        throw new Error(`Unsupported dynamic property "${property}"; supply explicit adapters`);
      }
    }

    const bufferNode = serializeBufferNode(node);
    if (bufferNode) return bufferNode;
    const uniformArrayNode = serializeUniformArrayNode(node);
    if (uniformArrayNode) return uniformArrayNode;
    const geometryNode = serializeGeometryNode(node);
    if (geometryNode) return geometryNode;
    const referenceNode = serializeReferenceNode(node);
    if (referenceNode) return referenceNode;
    const textureNode = serializeTextureNode(node);
    if (textureNode) return textureNode;
    const shadingNode = serializeShadingNode(node);
    if (shadingNode) return shadingNode;
    const dataNode = serializeDataNode(node);
    if (dataNode) return dataNode;

    if (['ConstNode', 'UniformNode', 'AttributeNode', 'MathNode', 'OperatorNode'].includes(nodeType) && !Object.prototype.hasOwnProperty.call(node.constructor, 'type')) {
      throw new Error(`Unsupported subclass of ${nodeType}; supply explicit adapters`);
    }
    if (['ConstNode', 'UniformNode', 'AttributeNode', 'MathNode', 'OperatorNode'].includes(nodeType)) {
      const inputs = nodeType === 'UniformNode' ? ['groupNode'] :
        nodeType === 'MathNode' ? ['aNode', 'bNode', 'cNode'] :
        nodeType === 'OperatorNode' ? ['aNode', 'bNode'] : [];
      validateNodeLinks(node as Node, inputs);
    }

    const uniformGroup = nodeType === 'UniformNode' ? validateUniformNode(node as Node) : undefined;

    if (nodeType === 'ConstNode' || nodeType === 'UniformNode') {
      // Native serialization discovers the group child. Preseed its UUID so
      // graph traversal, identity and cycles remain owned by the graph writer.
      const children = [...(node as Node).getSerializeChildren()];
      const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
      const serializeData: Record<string, unknown> = {
        meta: { nodes, textures: {}, images: {} }
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
      const links: Record<string, unknown> = {};
      if (uniformGroup && uniformGroup !== 'objectGroup') {
        for (const { property, index, childNode } of children) assignLink(links, property, index, childNode);
      }
      return { op: nodeType, args, ...(Object.keys(links).length ? { links } : {}) };
    }

    if (nodeType === 'AttributeNode') {
      const serializeData: Record<string, unknown> = {
        meta: { nodes: {}, textures: {}, images: {} }
      };
      (node as { serialize?: (data: Record<string, unknown>) => void }).serialize?.(serializeData);
      const attributeName = serializeData._attributeName ?? serializeData.attributeName;
      // Native AttributeNode.serialize() omits the explicit constructor type.
      // Keep null for geometry inference and preserve explicit scalar/vector types.
      const attributeType = (node as Node).nodeType ?? null;
      if (typeof attributeName !== 'string' || attributeName.length === 0 ||
          (attributeType !== null && (typeof attributeType !== 'string' || !/^(?:float|int|uint|bool|color|[biu]?vec[234]|mat[234])$/.test(attributeType)))) {
        throw new Error('Invalid or unsupported AttributeNode name or type; supply explicit adapters');
      }
      const args = cleanArgs({
        attributeName,
        nodeType: attributeType
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

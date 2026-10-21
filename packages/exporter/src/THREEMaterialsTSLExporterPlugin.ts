import { isPositionReferenceNode, validatePositionMesh, validatePositionTransport, type PositionNodeDefinition, type PositionMeshDefinition } from './positionReferenceNodes.js';
import { validateBufferAttributeMesh, validateBufferAttributeTransport, validateBufferAttributeAliases } from './bufferAttributeNodes.js';
import { userDataProperty, validateUserDataMesh, validateUserDataTransport, type UserDataNodeDefinition, type UserDataMeshDefinition } from './userDataNodes.js';
import { validateGeometryMaterial } from './geometryNodes.js';
import { validateReferenceMaterial, validateReferenceGeometry } from './referenceNodes.js';
import { REVISION } from 'three';

import type { BufferAttribute, Material, Mesh, Object3D, Texture } from 'three';
import type { GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { LinkDefinition, LinkValue, NodeDefinition, NodeExport } from './types.js';
import { validateTextureFallback } from './textureNodes.js';

type LinkTarget =
  | LinkDefinition
  | { node: unknown }
  | { texture: Texture }
  | { accessor: BufferAttribute }
  | LinkTarget[]
  | { [key: string]: LinkTarget }
  | unknown;

export type THREEMaterialsTSLExporterPluginOptions = {
  nodeSerializer: (node: unknown) => NodeExport | null;
  entrypoints?: string[];
  includeThreeRevision?: boolean;
  threeRevision?: string;
};

type NodeMaterialLike = Material & {
  isNodeMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
  isMeshBasicMaterial?: boolean;
};

export class THREEMaterialsTSLExporterPlugin {
  public readonly name = 'THREE_materials_tsl';

  private readonly writer: GLTFWriter;
  private readonly options: THREEMaterialsTSLExporterPluginOptions;
  private readonly resourceReferences: { table: 'textures' | 'accessors'; index: number }[] = [];
  private readonly accessorIndices = new Map<BufferAttribute, number>();
  private readonly materialNodes = new WeakMap<Material, Set<object>>();
  private readonly bufferAttributeNodes = new WeakMap<Material, Set<object>>();
  private readonly positionNodes = new WeakMap<Material, Set<object>>();
  private readonly userDataNodes = new WeakMap<Material, Set<object>>();

  constructor(writer: GLTFWriter, options: THREEMaterialsTSLExporterPluginOptions) {
    this.writer = writer;
    this.options = options;
  }

  beforeParse(input: Object3D | Object3D[]) {
    // Object extras are serialized before writeMaterialAsync. Preflight native
    // UserDataNode inputs before JSON.stringify can invoke any extras accessors.
    // Buffer attributes need preflight too: native export skips positionless
    // geometry, and native child discovery can read unknown attached getters.
    const checked = new WeakMap<Material, Set<object>>();
    const visit = (object: Object3D) => {
      const mesh = object as Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) {
        if (!this.isNodeMaterial(material)) continue;
        if (!checked.has(material)) {
          const nodes = new Set<object>();
          const seen = new Set<object>();
          const walk = (value: unknown) => {
            if (!this.isNodeLike(value) || seen.has(value)) return;
            seen.add(value);
            const node = value as import('three/webgpu').Node;
            if (node.type === 'BufferAttributeNode') {
              const data = this.options.nodeSerializer(node);
              if (data?.op === 'BufferAttributeNode') nodes.add(node);
              return;
            }
            if (node.type === 'ReferenceNode') {
              const data = this.options.nodeSerializer(node);
              if (data?.op === 'ReferenceNode' && isPositionReferenceNode(node)) nodes.add(node);
              return; // Never traverse the cached Mesh or Vector3 uniform.
            }
            if (node.type === 'UserDataNode') {
              const data = this.options.nodeSerializer(node);
              if (data?.op === 'UserDataNode' && userDataProperty(node) !== undefined) nodes.add(node);
              return; // The internal uniform/reference are native runtime caches.
            }
            if (node.type === 'RendererReferenceNode') {
              this.options.nodeSerializer(node);
              return; // Do not traverse the cached active renderer or its resources.
            }
            for (const { childNode } of (node.getSerializeChildren?.() ?? [])) walk(childNode);
          };
          for (const node of Object.values(this.collectEntrypoints(material) ?? {})) walk(node);
          checked.set(material, nodes);
        }
        for (const node of checked.get(material)!) {
          validatePositionMesh(node, object);
          validateUserDataMesh(node, object);
          validateBufferAttributeMesh(node, object);
        }
      }
      for (const child of object.children) {
        if (child.visible || (this.writer as GLTFWriter & { options: { onlyVisible?: boolean } }).options.onlyVisible === false) visit(child);
      }
    };
    for (const object of Array.isArray(input) ? input : [input]) visit(object);
  }

  writeMesh(mesh: Mesh) {
    const materials = Array.isArray(mesh.material) ?
      mesh.geometry.groups.map((group) => (mesh.material as Material[])[group.materialIndex ?? 0]) : [mesh.material];
    for (const material of materials) {
      for (const node of this.materialNodes.get(material) ?? []) {
        validateReferenceGeometry(node, material, mesh.geometry.hasAttribute('tangent'));
      }
      for (const node of this.bufferAttributeNodes.get(material) ?? []) validateBufferAttributeMesh(node, mesh);
    }
  }

  afterParse() {
    // References may point to resources emitted by later meshes or animations.
    // GLTFWriter exposes json at runtime; @types/three's declarations omit it.
    const { json, nodeMap, cache } = this.writer as GLTFWriter & {
      json: { textures?: unknown[]; accessors?: unknown[]; nodes?: (UserDataNodeDefinition & PositionNodeDefinition)[]; meshes?: (UserDataMeshDefinition & PositionMeshDefinition)[] };
      nodeMap?: Map<Object3D, number>;
      cache: { meshes: Map<string, number>; materials: Map<string, number> };
    };
    // writeMesh is cached by geometry/material, whereas nodeMap includes every
    // exported object, including meshes sharing the exact same geometry.
    for (const [object, index] of nodeMap ?? []) {
      const mesh = object as Mesh;
      for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
        for (const node of this.bufferAttributeNodes.get(material) ?? []) {
          const nodeDef = json.nodes?.[index];
          validateBufferAttributeTransport(node, object, nodeDef?.mesh === undefined ? undefined : json.meshes?.[nodeDef.mesh]);
        }
        for (const node of this.positionNodes.get(material) ?? []) {
          const nodeDef = json.nodes?.[index];
          // Match r186's native geometry/material and tangent-sensitive cache keys.
          const materialKey = (material as import('three').MeshStandardMaterial).normalMap ?
            `${material.uuid}:${mesh.geometry.hasAttribute('tangent')}` : material.uuid;
          validatePositionTransport(node, object, nodeDef, nodeDef?.mesh === undefined ? undefined : json.meshes?.[nodeDef.mesh],
            cache.meshes.get(`${mesh.geometry.uuid}:${material.uuid}`), cache.materials.get(materialKey));
        }
        for (const node of this.userDataNodes.get(material) ?? []) {
          const nodeDef = json.nodes?.[index];
          validateUserDataTransport(node, object, nodeDef, nodeDef?.mesh === undefined ? undefined : json.meshes?.[nodeDef.mesh]);
        }
      }
    }
    for (const { table, index } of this.resourceReferences) {
      if (!json[table]?.[index]) throw new Error(`Invalid resource reference: ${table}[${index}] was not exported`);
    }
  }

  async writeMaterialAsync(material: Material, materialDef: Record<string, unknown>) {
    if (!this.isNodeMaterial(material)) return;

    if (typeof material.type !== 'string' || !material.type.trim() || material.type === 'NodeMaterial') {
      throw new Error('NodeMaterial must have a non-empty concrete material type');
    }
    // GLTFExporter handles ordinary PBR values and its material extensions using
    // the standard/basic/physical flags exposed by these NodeMaterial families.
    if (material.isMeshStandardMaterial !== true && material.isMeshBasicMaterial !== true) {
      throw new Error(`Unsupported ordinary material fallback for "${material.type}"`);
    }

    const entrypoints = this.collectEntrypoints(material);
    if (!entrypoints || Object.keys(entrypoints).length === 0) return;

    if (typeof this.options.nodeSerializer !== 'function') throw new Error('nodeSerializer is required');

    const serialized = await this.serializeGraph(entrypoints, material);
    if (Object.values(serialized.nodes).some((node) => node.op === 'TextureNode')) validateTextureFallback(material);

    const extension = {
      version: '2.0',
      materialType: material.type,
      entrypoints: serialized.entrypoints,
      nodes: serialized.nodes
    } as Record<string, unknown>;

    const revision = this.options.threeRevision ?? (this.options.includeThreeRevision ? `r${REVISION}` : undefined);
    if (revision) {
      extension.three = { revision };
    }

    materialDef.extensions = materialDef.extensions || {};
    (materialDef.extensions as Record<string, unknown>)[this.name] = extension;
    this.writer.extensionsUsed[this.name] = true;
  }

  private collectEntrypoints(material: NodeMaterialLike): Record<string, unknown> | null {
    const entrypoints: Record<string, unknown> = {};
    const materialRecord = material as unknown as Record<string, unknown>;
    const names = this.options.entrypoints ?? Object.keys(materialRecord);

    for (const name of names) {
      const value = materialRecord[name];
      if (!value) continue;
      if (!this.isNodeLike(value)) continue;
      if (!name.endsWith('Node') || ['__proto__', 'prototype', 'constructor'].includes(name)) {
        if (this.options.entrypoints) throw new Error(`Unsupported entrypoint "${name}"`);
        continue;
      }
      entrypoints[name] = value;
    }

    return Object.keys(entrypoints).length > 0 ? entrypoints : null;
  }

  private isNodeLike(value: unknown): value is { isNode?: boolean } {
    return Boolean(value && typeof value === 'object' && (value as { isNode?: boolean }).isNode === true);
  }

  private isNodeMaterial(value: unknown): value is NodeMaterialLike {
    return Boolean(
      value && typeof value === 'object' && (value as { isNodeMaterial?: boolean }).isNodeMaterial === true
    );
  }

  private isLinkDefinition(value: LinkTarget): value is LinkDefinition {
    if (!value || typeof value !== 'object') return false;
    const link = value as LinkDefinition;
    return link.$ref !== undefined || link.$refTex !== undefined || link.$refAccessor !== undefined;
  }

  private async serializeGraph(entrypoints: Record<string, unknown>, material: Material) {
    const nodes: Record<string, NodeDefinition> = {};
    const nodeIds = new Map<unknown, string>();
    let nextId = 0;
    const visiting = new Set<unknown>();

    const serializeNode = async (node: unknown): Promise<string> => {
      if (visiting.has(node)) throw new Error('Cannot export a cyclic node graph');
      const cached = nodeIds.get(node);
      if (cached) return cached;

      const nodeId = `n${nextId++}`;
      nodeIds.set(node, nodeId);
      visiting.add(node);

      const exportData = this.options.nodeSerializer(node);
      if (!exportData || typeof exportData.op !== 'string' || !exportData.op.trim()) {
        throw new Error('Node serializer returned no op');
      }

      if (exportData.op === 'BufferAttributeNode') {
        validateBufferAttributeAliases(node as object, this.accessorIndices.keys());
        if (!this.bufferAttributeNodes.has(material)) this.bufferAttributeNodes.set(material, new Set());
        this.bufferAttributeNodes.get(material)!.add(node as object);
      }
      if (exportData.op === 'ReferenceNode' && isPositionReferenceNode(node as object)) {
        if (!this.positionNodes.has(material)) this.positionNodes.set(material, new Set());
        this.positionNodes.get(material)!.add(node as object);
      }
      if (exportData.op === 'UserDataNode' && userDataProperty(node as object) !== undefined) {
        if (!this.userDataNodes.has(material)) this.userDataNodes.set(material, new Set());
        this.userDataNodes.get(material)!.add(node as object);
      }
      validateReferenceMaterial(node as object, material);
      validateGeometryMaterial(node as object, material);
      if (!this.materialNodes.has(material)) this.materialNodes.set(material, new Set());
      this.materialNodes.get(material)!.add(node as object);
      const nodeDef: NodeDefinition = { op: exportData.op };
      if (exportData.args !== undefined) {
        // Reject executable/non-JSON arguments rather than allowing JSON.stringify
        // to silently erase them. Circular values also fail serialization.
        JSON.stringify(exportData.args, (_key, value) => {
          if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' ||
              value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
            throw new Error('Node arguments must be JSON literals');
          }
          return value;
        });
        nodeDef.args = exportData.args;
      }

      if (exportData.links) {
        const linksOut: Record<string, LinkValue> = {};
        for (const [slotName, linkTarget] of Object.entries(exportData.links)) {
          const linkDef = await this.resolveLinkTargetValue(linkTarget, serializeNode);
          linksOut[slotName] = linkDef;
        }
        if (Object.keys(linksOut).length > 0) nodeDef.links = linksOut;
      }

      nodes[nodeId] = nodeDef;
      visiting.delete(node);
      return nodeId;
    };

    const entrypointIds: Record<string, string> = {};
    for (const [slotName, node] of Object.entries(entrypoints)) {
      entrypointIds[slotName] = await serializeNode(node);
    }

    // Also validate explicit reference definitions supplied by custom adapters.
    // These bypass serializeNode(), so they need their own missing/cycle checks.
    const checked = new Set<string>();
    const checking = new Set<string>();
    const checkNode = (id: string): void => {
      if (checking.has(id)) throw new Error('Cannot export a cyclic node graph');
      if (checked.has(id)) return;
      if (!Object.prototype.hasOwnProperty.call(nodes, id)) throw new Error(`Missing node reference "${id}"`);
      checking.add(id);
      for (const value of Object.values(nodes[id].links ?? {})) checkLink(value);
      checking.delete(id);
      checked.add(id);
    };
    const checkLink = (value: LinkValue): void => {
      if (Array.isArray(value)) { value.forEach(checkLink); return; }
      const keys = Object.keys(value);
      const refs = keys.filter((key) => ['$ref', '$refTex', '$refAccessor'].includes(key));
      if (refs.length) {
        if (refs.length !== 1 || keys.length !== 1) throw new Error('Invalid link reference');
        const link = value as LinkDefinition;
        if (refs[0] === '$ref') {
          if (typeof link.$ref !== 'string') throw new Error('Invalid node reference');
          checkNode(link.$ref);
        } else {
          const index = refs[0] === '$refTex' ? link.$refTex : link.$refAccessor;
          if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new Error('Invalid resource reference');
          this.resourceReferences.push({ table: refs[0] === '$refTex' ? 'textures' : 'accessors', index });
        }
      } else {
        Object.values(value).forEach(checkLink);
      }
    };
    for (const id of Object.keys(nodes)) checkNode(id);

    return {
      entrypoints: entrypointIds,
      nodes
    };
  }

  private async resolveLinkTargetValue(
    target: LinkTarget,
    serializeNode: (node: unknown) => Promise<string>
  ): Promise<LinkValue> {
    if (this.isLinkDefinition(target)) return target;

    if (this.isNodeLike(target)) {
      return { $ref: await serializeNode(target) };
    }

    if (target && typeof target === 'object') {
      if (Array.isArray(target)) {
        const resolved: LinkValue[] = [];
        for (let i = 0; i < target.length; i += 1) {
          if (!(i in target)) throw new Error('Sparse link arrays are unsupported');
          const entry = await this.resolveLinkTargetValue(target[i], serializeNode);
          resolved[i] = entry;
        }
        return resolved;
      }

      const objectTarget = target as { node?: unknown; texture?: Texture; accessor?: BufferAttribute };
      if (objectTarget.node) {
        return { $ref: await serializeNode(objectTarget.node) };
      }
      if (objectTarget.texture) {
        const textureIndex = await this.writer.processTextureAsync(objectTarget.texture);
        return { $refTex: textureIndex };
      }
      if (objectTarget.accessor) {
        const accessorWriter = this.writer as GLTFWriter & {
          processAccessor?: (accessor: BufferAttribute) => number | null;
        };
        if (typeof accessorWriter.processAccessor !== 'function') throw new Error('Could not export accessor link');
        const cached = this.accessorIndices.get(objectTarget.accessor);
        if (cached !== undefined) return { $refAccessor: cached };
        const accessorIndex = accessorWriter.processAccessor(objectTarget.accessor);
        if (accessorIndex === undefined || accessorIndex === null) throw new Error('Could not export accessor link');
        this.accessorIndices.set(objectTarget.accessor, accessorIndex);
        return { $refAccessor: accessorIndex };
      }

      const resolved: Record<string, LinkValue> = {};
      for (const [key, value] of Object.entries(target as Record<string, LinkTarget>)) {
        const entry = await this.resolveLinkTargetValue(value, serializeNode);
        resolved[key] = entry;
      }
      return resolved;
    }

    throw new Error('Unsupported link target');
  }
}

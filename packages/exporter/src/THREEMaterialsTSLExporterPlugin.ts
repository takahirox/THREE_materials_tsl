import { REVISION } from 'three';

import type { BufferAttribute, Material, Texture } from 'three';
import type { GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type LinkDefinition = {
  $ref?: string;
  $refTex?: number;
  $refAccessor?: number;
};

type LinkTarget =
  | LinkDefinition
  | { node: unknown }
  | { texture: Texture }
  | { accessor: BufferAttribute }
  | unknown;

type NodeDefinition = {
  op: string;
  args?: JsonValue;
  links?: Record<string, LinkDefinition>;
};

type NodeExport = {
  op: string;
  args?: JsonValue;
  links?: Record<string, LinkTarget>;
};

export type THREEMaterialsTSLExporterPluginOptions = {
  nodeSerializer: (node: unknown) => NodeExport | null;
  entrypoints?: string[];
  version?: string;
  includeThreeRevision?: boolean;
  threeRevision?: string;
};

type NodeMaterialLike = Material & {
  isNodeMaterial?: boolean;
  isMeshStandardNodeMaterial?: boolean;
  metalness?: number;
  roughness?: number;
  emissiveIntensity?: number;
};

export class THREEMaterialsTSLExporterPlugin {
  public readonly name = 'THREE_materials_tsl';
  private readonly emissiveStrengthExtension = 'KHR_materials_emissive_strength';

  private readonly writer: GLTFWriter;
  private readonly options: THREEMaterialsTSLExporterPluginOptions;

  constructor(writer: GLTFWriter, options: THREEMaterialsTSLExporterPluginOptions) {
    this.writer = writer;
    this.options = options;
  }

  async writeMaterialAsync(material: Material, materialDef: Record<string, unknown>) {
    if (!this.isNodeMaterial(material)) return;

    this.writePBRParams(material, materialDef);

    const entrypoints = this.collectEntrypoints(material);
    if (!entrypoints || Object.keys(entrypoints).length === 0) return;

    if (!this.options.nodeSerializer) return;

    const serialized = await this.serializeGraph(entrypoints);
    if (!serialized) return;

    const extension = {
      version: this.options.version ?? '1.0',
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

  private writePBRParams(material: NodeMaterialLike, materialDef: Record<string, unknown>) {
    if (!this.isMeshStandardNodeMaterial(material)) return;

    const pbr = (materialDef.pbrMetallicRoughness ?? {}) as Record<string, unknown>;
    if (pbr.metallicFactor === undefined && typeof material.metalness === 'number') {
      pbr.metallicFactor = material.metalness;
    }
    if (pbr.roughnessFactor === undefined && typeof material.roughness === 'number') {
      pbr.roughnessFactor = material.roughness;
    }
    materialDef.pbrMetallicRoughness = pbr;

    const emissiveIntensity = material.emissiveIntensity;
    if (typeof emissiveIntensity === 'number' && emissiveIntensity !== 1) {
      materialDef.extensions = materialDef.extensions || {};
      (materialDef.extensions as Record<string, unknown>)[this.emissiveStrengthExtension] = {
        emissiveStrength: emissiveIntensity
      };
      this.writer.extensionsUsed[this.emissiveStrengthExtension] = true;
    }
  }

  private collectEntrypoints(material: NodeMaterialLike): Record<string, unknown> | null {
    const entrypoints: Record<string, unknown> = {};
    const materialRecord = material as unknown as Record<string, unknown>;
    const names = this.options.entrypoints ?? Object.keys(materialRecord);

    for (const name of names) {
      const value = materialRecord[name];
      if (!value) continue;
      if (!this.isNodeLike(value)) continue;
      if (!this.options.entrypoints && !name.endsWith('Node')) continue;
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

  private isMeshStandardNodeMaterial(value: NodeMaterialLike): boolean {
    return Boolean(value.isMeshStandardNodeMaterial === true);
  }

  private isLinkDefinition(value: LinkTarget): value is LinkDefinition {
    if (!value || typeof value !== 'object') return false;
    const link = value as LinkDefinition;
    return link.$ref !== undefined || link.$refTex !== undefined || link.$refAccessor !== undefined;
  }

  private async serializeGraph(entrypoints: Record<string, unknown>) {
    const nodes: Record<string, NodeDefinition> = {};
    const nodeIds = new Map<unknown, string>();
    let nextId = 0;

    const serializeNode = async (node: unknown): Promise<string> => {
      const cached = nodeIds.get(node);
      if (cached) return cached;

      const nodeId = `n${nextId++}`;
      nodeIds.set(node, nodeId);

      const exportData = this.options.nodeSerializer(node);
      if (!exportData || !exportData.op) {
        throw new Error('Node serializer returned no op');
      }

      const nodeDef: NodeDefinition = { op: exportData.op };
      if (exportData.args !== undefined) nodeDef.args = exportData.args;

      if (exportData.links) {
        const linksOut: Record<string, LinkDefinition> = {};
        for (const [slotName, linkTarget] of Object.entries(exportData.links)) {
          const linkDef = await this.resolveLinkTarget(linkTarget, serializeNode);
          if (linkDef) linksOut[slotName] = linkDef;
        }
        if (Object.keys(linksOut).length > 0) nodeDef.links = linksOut;
      }

      nodes[nodeId] = nodeDef;
      return nodeId;
    };

    const entrypointIds: Record<string, string> = {};
    for (const [slotName, node] of Object.entries(entrypoints)) {
      entrypointIds[slotName] = await serializeNode(node);
    }

    return {
      entrypoints: entrypointIds,
      nodes
    };
  }

  private async resolveLinkTarget(
    target: LinkTarget,
    serializeNode: (node: unknown) => Promise<string>
  ): Promise<LinkDefinition | null> {
    if (this.isLinkDefinition(target)) return target;

    if (this.isNodeLike(target)) {
      return { $ref: await serializeNode(target) };
    }

    if (target && typeof target === 'object') {
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
        const accessorIndex = accessorWriter.processAccessor?.(objectTarget.accessor);
        if (accessorIndex === undefined || accessorIndex === null) return null;
        return { $refAccessor: accessorIndex };
      }
    }

    return null;
  }
}

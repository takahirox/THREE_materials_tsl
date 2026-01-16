import { Color, LinearSRGBColorSpace } from 'three';
import { NodeMaterial } from 'three/webgpu';

import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type NodeResolver = (op: string, args?: JsonValue) => unknown;

type NodeRegistryLike = {
  get?: (op: string) => unknown;
  [key: string]: unknown;
};

type LinkDefinition = {
  $ref?: string;
  $refTex?: number;
  $refAccessor?: number;
};

type NodeDefinition = {
  op: string;
  args?: JsonValue;
  links?: Record<string, LinkDefinition>;
};

type ThreeMetadata = {
  revision?: string;
};

type ExtensionDefinition = {
  version: string;
  entrypoints: Record<string, string>;
  nodes: Record<string, NodeDefinition>;
  three?: ThreeMetadata;
  compat?: Record<string, JsonValue>;
};

type GltfMaterialDef = {
  extensions?: Record<string, unknown>;
  pbrMetallicRoughness?: {
    roughnessFactor?: number;
    metallicFactor?: number;
  };
  emissiveFactor?: number[];
};

export type THREEMaterialsTSLLoaderPluginOptions = {
  nodeResolver?: NodeResolver;
  nodeRegistry?: NodeRegistryLike;
  supportedVersions?: string[];
  materialType?: typeof NodeMaterial;
  onError?: (error: unknown) => void;
  onApplied?: (material: NodeMaterial, extension: ExtensionDefinition) => void;
};

export class THREEMaterialsTSLLoaderPlugin {
  public readonly name = 'THREE_materials_tsl';

  private readonly parser: GLTFParser;
  private readonly options: THREEMaterialsTSLLoaderPluginOptions;
  private readonly materialExtensions = new Map<number, ExtensionDefinition>();
  private readonly supportedVersions: string[];

  constructor(parser: GLTFParser, options: THREEMaterialsTSLLoaderPluginOptions = {}) {
    this.parser = parser;
    this.options = options;
    this.supportedVersions = options.supportedVersions ?? ['1.0'];
  }

  getMaterialType(materialIndex: number) {
    const ext = this.getMaterialExtension(materialIndex);
    if (!ext) return null;
    if (!this.isVersionSupported(ext.version)) return null;
    return this.options.materialType ?? NodeMaterial;
  }

  extendMaterialParams(materialIndex: number) {
    const ext = this.getMaterialExtension(materialIndex);
    if (!ext) return;
    this.materialExtensions.set(materialIndex, ext);
  }

  async afterRoot(result?: unknown) {
    if (this.materialExtensions.size === 0) return;

    const materials = await this.parser.getDependencies('material');
    const applied = new Set<unknown>();

    const applyExtensionToMaterial = async (
      material: unknown,
      extension: ExtensionDefinition,
      materialIndex: number
    ) => {
      if (applied.has(material)) return;
      if (!this.isVersionSupported(extension.version)) return;
      if (!this.isNodeMaterial(material)) return;
      this.applyPBRParams(materialIndex, material as NodeMaterial);
      await this.applyExtension(material, extension);
      applied.add(material);
    };

    const materialPromises = Array.from(this.materialExtensions.entries()).map(
      async ([materialIndex, extension]) => {
        const material = materials[materialIndex];
        if (!material) return;
        await applyExtensionToMaterial(material, extension, materialIndex);
      }
    );

    await Promise.all(materialPromises);

    const associations = (this.parser as { associations?: Map<unknown, { materials?: number }> }).associations;
    if (!associations) return;

    const scenes: unknown[] = [];
    if (result && typeof result === 'object') {
      const root = result as { scenes?: unknown[]; scene?: unknown };
      if (Array.isArray(root.scenes)) {
        scenes.push(...root.scenes);
      } else if (root.scene) {
        scenes.push(root.scene);
      }
    }

    const extraPromises: Promise<void>[] = [];
    for (const scene of scenes) {
      if (!scene || typeof scene !== 'object' || !('traverse' in scene)) continue;
      (scene as { traverse: (cb: (obj: unknown) => void) => void }).traverse((object) => {
        const material = (object as { material?: unknown }).material;
        if (!material) return;

        const applyForMaterial = (mat: unknown) => {
          const association = associations.get(mat);
          const materialIndex = association?.materials;
          if (materialIndex === undefined) return;
          const extension = this.materialExtensions.get(materialIndex);
          if (!extension) return;
          extraPromises.push(applyExtensionToMaterial(mat, extension, materialIndex));
        };

        if (Array.isArray(material)) {
          material.forEach(applyForMaterial);
        } else {
          applyForMaterial(material);
        }
      });
    }

    if (extraPromises.length > 0) {
      await Promise.all(extraPromises);
    }
  }

  private getMaterialExtension(materialIndex: number): ExtensionDefinition | null {
    const materialDef = this.parser.json.materials?.[materialIndex] as GltfMaterialDef | undefined;
    if (!materialDef?.extensions) return null;
    const ext = materialDef.extensions[this.name] as ExtensionDefinition | undefined;
    if (!ext) return null;
    return ext;
  }

  private isVersionSupported(version: string): boolean {
    return this.supportedVersions.includes(version);
  }

  private isNodeMaterial(value: unknown): value is NodeMaterial {
    return Boolean(
      value && typeof value === 'object' && (value as { isNodeMaterial?: boolean }).isNodeMaterial === true
    );
  }

  private applyPBRParams(materialIndex: number, material: NodeMaterial) {
    const materialDef = this.parser.json.materials?.[materialIndex] as GltfMaterialDef | undefined;
    if (!materialDef) return;

    const pbr = materialDef.pbrMetallicRoughness;
    if (pbr) {
      const roughness = (pbr.roughnessFactor as number | undefined) ?? undefined;
      const metalness = (pbr.metallicFactor as number | undefined) ?? undefined;
      if (typeof roughness === 'number') (material as unknown as { roughness?: number }).roughness = roughness;
      if (typeof metalness === 'number') (material as unknown as { metalness?: number }).metalness = metalness;
    }

    if (Array.isArray(materialDef.emissiveFactor)) {
      const emissive = (material as unknown as { emissive?: Color }).emissive;
      if (emissive) {
        const [r, g, b] = materialDef.emissiveFactor as number[];
        emissive.setRGB(r, g, b, LinearSRGBColorSpace);
      }
    }

    const emissiveStrength = materialDef.extensions?.KHR_materials_emissive_strength as
      | { emissiveStrength?: number }
      | undefined;
    if (emissiveStrength && typeof emissiveStrength.emissiveStrength === 'number') {
      (material as unknown as { emissiveIntensity?: number }).emissiveIntensity = emissiveStrength.emissiveStrength;
    }
  }

  private resolveNodeFactory(op: string, args?: JsonValue): unknown {
    if (this.options.nodeResolver) {
      return this.options.nodeResolver(op, args);
    }

    const registry = this.options.nodeRegistry;
    if (!registry) return null;
    if (typeof registry.get === 'function') return registry.get(op);
    return registry[op];
  }

  private async applyExtension(material: NodeMaterial, extension: ExtensionDefinition) {
    const { entrypoints, nodes } = extension;

    if (!entrypoints || Object.keys(entrypoints).length === 0) {
      throw new Error('Missing entrypoints');
    }

    for (const nodeId of Object.values(entrypoints)) {
      if (!nodes[nodeId]) {
        throw new Error(`Entrypoint nodeId "${nodeId}" is missing`);
      }
    }

    const resolving = new Set<string>();
    const resolved = new Map<string, unknown>();

    const resolveNode = async (nodeId: string): Promise<unknown> => {
      if (resolved.has(nodeId)) return resolved.get(nodeId);

      if (resolving.has(nodeId)) {
        throw new Error(`Cycle detected at nodeId "${nodeId}"`);
      }

      const nodeDef = nodes[nodeId];
      if (!nodeDef) {
        throw new Error(`Missing nodeId "${nodeId}"`);
      }

      resolving.add(nodeId);

      const node = await this.createNode(nodeDef);
      if (nodeDef.links) {
        await this.applyLinks(node, nodeDef.links, resolveNode);
      }

      resolving.delete(nodeId);
      resolved.set(nodeId, node);
      return node;
    };

    try {
      const entrypointPromises = Object.entries(entrypoints).map(
        async ([slotName, nodeId]) => {
          const node = await resolveNode(nodeId);
          (material as unknown as Record<string, unknown>)[slotName] = node;
        }
      );
      await Promise.all(entrypointPromises);
      material.needsUpdate = true;
      if (this.options.onApplied) {
        this.options.onApplied(material, extension);
      }
    } catch (error) {
      if (this.options.onError) {
        this.options.onError(error);
      }
      // Ignore extension on failure, per spec.
    }
  }

  private async createNode(nodeDef: NodeDefinition): Promise<unknown> {
    const factory = this.resolveNodeFactory(nodeDef.op, nodeDef.args);
    if (!factory) {
      throw new Error(`Unknown op "${nodeDef.op}"`);
    }

    if (typeof factory === 'function') {
      const args = this.normalizeArgs(nodeDef.args);
      try {
        return new (factory as new (...factoryArgs: unknown[]) => unknown)(...args);
      } catch {
        return (factory as (...factoryArgs: unknown[]) => unknown)(...args);
      }
    }

    return factory;
  }

  private normalizeArgs(args: JsonValue | undefined): unknown[] {
    if (args === undefined) return [];
    if (Array.isArray(args)) return args;
    return [args];
  }

  private async applyLinks(
    node: unknown,
    links: Record<string, LinkDefinition>,
    resolveNode: (nodeId: string) => Promise<unknown>
  ) {
    const linkEntries = Object.entries(links);

    for (const [slotName, linkDef] of linkEntries) {
      const value = await this.resolveLink(linkDef, resolveNode);
      (node as Record<string, unknown>)[slotName] = value;
    }
  }

  private async resolveLink(
    linkDef: LinkDefinition,
    resolveNode: (nodeId: string) => Promise<unknown>
  ): Promise<unknown> {
    if (linkDef.$ref !== undefined) {
      return resolveNode(linkDef.$ref);
    }

    if (linkDef.$refTex !== undefined) {
      const textures = this.parser.json.textures ?? [];
      if (linkDef.$refTex < 0 || linkDef.$refTex >= textures.length) {
        throw new Error(`Texture index out of range: ${linkDef.$refTex}`);
      }
      return this.parser.getDependency('texture', linkDef.$refTex);
    }

    if (linkDef.$refAccessor !== undefined) {
      const accessors = this.parser.json.accessors ?? [];
      if (linkDef.$refAccessor < 0 || linkDef.$refAccessor >= accessors.length) {
        throw new Error(`Accessor index out of range: ${linkDef.$refAccessor}`);
      }
      return this.parser.getDependency('accessor', linkDef.$refAccessor);
    }

    return null;
  }
}

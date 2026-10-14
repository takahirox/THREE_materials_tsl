import * as TSL from 'three/tsl';
import { Material, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, NodeMaterial } from 'three/webgpu';
import type { GLTF, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type NodeResolver = (op: string, args?: JsonValue) => unknown;
export type MaterialTypes = Record<string, new () => NodeMaterial>;
export type ExtensionDefinition = {
  version: '2.0';
  materialType: string;
  entrypoints: Record<string, string>;
  nodes: Record<string, { op: string; args?: JsonValue; links?: Record<string, unknown> }>;
  three?: { revision?: string };
  compat?: Record<string, JsonValue>;
};
export type THREEMaterialsTSLLoaderPluginOptions = {
  nodeResolver: NodeResolver;
  materialTypes?: MaterialTypes;
  onError?: (error: unknown) => void;
  onApplied?: (material: NodeMaterial, extension: ExtensionDefinition) => void;
};

const builtInTypes: MaterialTypes = { MeshBasicNodeMaterial, MeshStandardNodeMaterial, MeshPhysicalNodeMaterial };
const sharedNodes = new Set<unknown>(Object.values(TSL).filter((value) => value && typeof value === 'object' && 'isNode' in value));
const hasOwn = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key);
const isNode = (value: unknown): value is { isNode: true } => record(value) && value.isNode === true;

export class THREEMaterialsTSLLoaderPlugin {
  public readonly name = 'THREE_materials_tsl';

  constructor(private readonly parser: GLTFParser, private readonly options: THREEMaterialsTSLLoaderPluginOptions) {}

  // Let GLTFLoader and all its other extensions finish ordinary materials and
  // primitive-specific clones first. Prepare replacements privately, then publish
  // all replacements for a material only after its entire graph succeeds.
  async afterRoot(result: GLTF) {
    if (!this.parser.json.materials?.some((material: { extensions?: Record<string, unknown> }) =>
      material.extensions && hasOwn(material.extensions, this.name))) return;
    const originals: Material[] = await this.parser.getDependencies('material');
    const replacements = new Map<Material, NodeMaterial>();
    const groups = new Map<number, Set<Material>>();
    originals.forEach((material, index) => groups.set(index, new Set([material])));
    for (const scene of result.scenes) {
      scene.traverse((object) => {
        const material = (object as unknown as { material?: Material | Material[] }).material;
        for (const item of Array.isArray(material) ? material : material ? [material] : []) {
          const index = this.parser.associations.get(item)?.materials;
          if (index !== undefined) groups.get(index)?.add(item);
        }
      });
    }

    for (const [index, materials] of groups) {
      const raw = this.parser.json.materials?.[index]?.extensions?.[this.name];
      if (raw === undefined) continue;
      try {
        const extension = this.validate(raw);
        const types = { ...builtInTypes, ...this.options.materialTypes };
        const Type = hasOwn(types, extension.materialType) ? types[extension.materialType] : undefined;
        if (typeof Type !== 'function') throw new Error(`Unknown materialType "${extension.materialType}"`);
        const candidates = new Map<Material, NodeMaterial>();
        for (const source of materials) {
          const target = new Type();
          if (!target?.isNodeMaterial || target.type !== extension.materialType) {
            throw new Error(`Unusable materialType "${extension.materialType}"`);
          }
          this.copyOrdinaryMaterial(source, target);
          candidates.set(source, target);
        }
        const slots = await this.resolveGraph(extension);
        for (const target of candidates.values()) {
          for (const [slot, node] of Object.entries(slots)) {
            if (!safeKey(slot) || !slot.endsWith('Node') || !(slot in target)) {
              throw new Error(`Unsupported entrypoint "${slot}"`);
            }
            (target as unknown as Record<string, unknown>)[slot] = node;
          }
          target.needsUpdate = true;
          this.options.onApplied?.(target, extension);
        }
        for (const [source, target] of candidates) replacements.set(source, target);
      } catch (error) {
        this.options.onError?.(error);
      }
    }

    for (const [source, target] of replacements) {
      const association = this.parser.associations.get(source);
      if (association) this.parser.associations.set(target, association);
    }
    // GLTFParser's runtime dependency cache is not declared by @types/three.
    const cache = (this.parser as GLTFParser & { cache: { add(key: string, value: unknown): void } }).cache;
    originals.forEach((source, index) => {
      const target = replacements.get(source);
      if (target) cache.add(`material:${index}`, Promise.resolve(target));
    });
    // getDependencies() also caches the complete array.
    cache.add('material', Promise.resolve(originals.map((source) => replacements.get(source) ?? source)));
    for (const scene of result.scenes) {
      scene.traverse((object) => {
        const mesh = object as unknown as { material?: Material | Material[] };
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((source) => replacements.get(source) ?? source);
        else if (mesh.material) mesh.material = replacements.get(mesh.material) ?? mesh.material;
      });
    }
  }

  private copyOrdinaryMaterial(source: Material, target: NodeMaterial) {
    // Use Three.js copy routines for colors/vectors/textures and extension values;
    // NodeMaterial.copy() itself copies graph slots, not all ordinary PBR values.
    const flags = target as unknown as Record<string, unknown>;
    if (source instanceof MeshPhysicalMaterial && flags.isMeshPhysicalNodeMaterial) {
      MeshPhysicalMaterial.prototype.copy.call(target as unknown as MeshPhysicalMaterial, source);
    } else if (source instanceof MeshStandardMaterial && flags.isMeshStandardNodeMaterial) {
      if (source instanceof MeshPhysicalMaterial) throw new Error('materialType cannot preserve physical material properties');
      MeshStandardMaterial.prototype.copy.call(target as unknown as MeshStandardMaterial, source);
    } else if (source instanceof MeshBasicMaterial && flags.isMeshBasicNodeMaterial) {
      MeshBasicMaterial.prototype.copy.call(target as unknown as MeshBasicMaterial, source);
    } else {
      throw new Error('Unsupported ordinary material / NodeMaterial pairing');
    }
  }

  private validate(raw: unknown): ExtensionDefinition {
    if (!record(raw) || raw.version !== '2.0') throw new Error('Unsupported extension version');
    if (typeof raw.materialType !== 'string' || !raw.materialType.trim()) throw new Error('Invalid materialType');
    if (!record(raw.entrypoints) || !Object.keys(raw.entrypoints).length || !record(raw.nodes)) throw new Error('Missing entrypoints or nodes');
    for (const [id, node] of Object.entries(raw.nodes)) {
      if (!safeKey(id) || !record(node) || typeof node.op !== 'string' || !node.op.trim()) throw new Error(`Invalid node "${id}"`);
      if (node.args !== undefined) this.validateJson(node.args);
      if (node.links !== undefined && !record(node.links)) throw new Error('Invalid links');
    }
    for (const id of Object.values(raw.entrypoints)) {
      if (typeof id !== 'string' || !hasOwn(raw.nodes, id)) throw new Error('Missing entrypoint node');
    }
    return raw as ExtensionDefinition;
  }

  private validateJson(value: unknown): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) { value.forEach((item) => this.validateJson(item)); return; }
    if (record(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (!safeKey(key)) throw new Error('Invalid argument property');
        this.validateJson(item);
      }
      return;
    }
    throw new Error('Arguments must be JSON literals');
  }

  private async resolveGraph(extension: ExtensionDefinition) {
    const resolved = new Map<string, unknown>();
    const resolving = new Set<string>();
    const resolveNode = async (id: string): Promise<unknown> => {
      if (resolved.has(id)) return resolved.get(id);
      if (resolving.has(id)) throw new Error(`Cycle detected at "${id}"`);
      if (!hasOwn(extension.nodes, id)) throw new Error(`Missing node "${id}"`);
      const def = extension.nodes[id];
      resolving.add(id);
      const factory = this.options.nodeResolver(def.op, def.args);
      let node: unknown = factory;
      if (typeof factory === 'function') {
        const args = def.args === undefined ? [] : Array.isArray(def.args) ? def.args : [def.args];
        // Classes and arrow factories are both supported, without retrying a
        // failed constructor and hiding its reconstruction error.
        node = factory.prototype ? new (factory as new (...args: unknown[]) => unknown)(...args) : factory(...args);
      }
      if (!isNode(node)) throw new Error(`Unknown or unusable op "${def.op}"`);
      if (def.links) {
        // Shared TSL singleton operations must never be mutated by file data.
        if (sharedNodes.has(node) && Object.keys(def.links).length) throw new Error('Shared TSL operations cannot have links');
        for (const [slot, value] of Object.entries(def.links)) {
          if (!safeKey(slot)) throw new Error('Invalid link property');
          (node as unknown as Record<string, unknown>)[slot] = await resolveLink(value);
        }
      }
      resolving.delete(id);
      resolved.set(id, node);
      return node;
    };
    const resolveLink = async (value: unknown): Promise<unknown> => {
      if (Array.isArray(value)) {
        const result = [];
        for (const item of value) result.push(await resolveLink(item));
        return result;
      }
      if (!record(value)) throw new Error('Invalid link value');
      const refs = ['$ref', '$refTex', '$refAccessor'].filter((key) => hasOwn(value, key));
      if (refs.length) {
        if (refs.length !== 1 || Object.keys(value).length !== 1) throw new Error('Invalid reference');
        const key = refs[0];
        const ref = value[key];
        if (key === '$ref') {
          if (typeof ref !== 'string') throw new Error('Invalid node reference');
          return resolveNode(ref);
        }
        const kind = key === '$refTex' ? 'texture' : 'accessor';
        const list = this.parser.json[kind === 'texture' ? 'textures' : 'accessors'] ?? [];
        if (typeof ref !== 'number' || !Number.isInteger(ref) || ref < 0 || ref >= list.length) throw new Error(`Invalid ${kind} index`);
        const dependency = await this.parser.getDependency(kind, ref);
        if (!dependency) throw new Error(`Missing ${kind}`);
        return dependency;
      }
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (!safeKey(key)) throw new Error('Invalid link property');
        result[key] = await resolveLink(item);
      }
      return result;
    };
    // Sequential DFS distinguishes shared DAG inputs from true cycles. Validate
    // every definition, including nodes not reachable from an entrypoint.
    for (const id of Object.keys(extension.nodes)) await resolveNode(id);
    const slots: Record<string, unknown> = {};
    for (const [slot, id] of Object.entries(extension.entrypoints)) {
      if (!safeKey(slot)) throw new Error('Invalid entrypoint');
      slots[slot] = resolved.get(id);
    }
    return slots;
  }
}

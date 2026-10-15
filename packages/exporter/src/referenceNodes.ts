import { Color, Vector2, TangentSpaceNormalMap, RGFormat, RED_GREEN_RGTC2_Format, RG11_EAC_Format } from 'three';
import { UniformNode } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { objectGroup } from 'three/tsl';
import { objectGroup as sourceObjectGroup } from 'three/src/nodes/core/UniformGroupNode.js';
import { validateTextureFallback } from './textureNodes.js';
import { validateNodeLinks } from './nodeLinks.js';
import type { JsonValue, NodeExport } from './types.js';

// Keep this data-only contract paired between the loader and exporter.
const materialProperties: Record<string, string> = {
  color: 'color', opacity: 'float', alphaTest: 'float',
  roughness: 'float', metalness: 'float', emissive: 'color', emissiveIntensity: 'float',
  normalScale: 'vec2', aoMapIntensity: 'float',
  clearcoat: 'float', clearcoatRoughness: 'float', clearcoatNormalScale: 'vec2',
  sheen: 'float', sheenColor: 'color', sheenRoughness: 'float',
  anisotropy: 'float', anisotropyRotation: 'float',
  iridescence: 'float', iridescenceIOR: 'float', ior: 'float',
  transmission: 'float', thickness: 'float', attenuationDistance: 'float',
  attenuationColor: 'color', dispersion: 'float', specularIntensity: 'float', specularColor: 'color'
};
const materialScopes: Record<string, string[]> = {
  color: ['color'], opacity: ['opacity'], alphaTest: ['alphaTest'],
  roughness: ['roughness'], metalness: ['metalness'], emissive: ['emissive', 'emissiveIntensity'],
  normal: [], ao: ['aoMapIntensity'], clearcoat: ['clearcoat'], clearcoatRoughness: ['clearcoatRoughness'],
  clearcoatNormal: ['clearcoatNormalScale'], sheen: ['sheen', 'sheenColor'], sheenRoughness: ['sheenRoughness'],
  anisotropy: ['anisotropy', 'anisotropyRotation'], iridescence: ['iridescence'], iridescenceIOR: ['iridescenceIOR'],
  iridescenceThickness: ['iridescenceThicknessRange'], ior: ['ior'], transmission: ['transmission'],
  thickness: ['thickness'], attenuationDistance: ['attenuationDistance'], attenuationColor: ['attenuationColor'],
  dispersion: ['dispersion'], specularIntensity: ['specularIntensity'], specularColor: ['specularColor']
};
const modelScopes = ['position', 'viewPosition', 'direction', 'scale', 'worldMatrix', 'radius'];
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const check = (valid: unknown) => { if (!valid) throw new Error('Invalid or unsupported material/model reference; supply explicit adapters'); };
export const isReferenceNodeOp = (op: string) => ['MaterialNode', 'ModelNode', 'MaterialReferenceNode', 'Object3DNode'].includes(op);
const defaults = new WeakSet<object>();

function referenceProperties(node: Record<string, unknown>, material: Record<string, unknown>): string[] {
  if (node.type === 'MaterialReferenceNode') return [node.property as string];
  if (node.type !== 'MaterialNode') return [];
  if (node.scope === 'normal') return material.normalMap ? ['normalScale'] : [];
  if (node.scope === 'clearcoatNormal') return material.clearcoatNormalMap ? ['clearcoatNormalScale'] : [];
  return materialScopes[node.scope as string];
}

// Native r186 glTF transport omits disabled extension state and normalizes some
// values. A live reference must start with the authored value, not just its type.
// Do not snapshot these values into node arguments to work around that loss.
function validatePropertyTransport(property: string, target: Record<string, unknown>) {
  const v = target[property];
  if (property === 'alphaTest') check(v === 0 || (!target.transparent && (v as number) > 0));
  if (property === 'aoMapIntensity' && !target.aoMap) check(v === 1);
  if (property === 'clearcoatRoughness' && target.clearcoat === 0) check(v === 0);
  if (property === 'sheen') check(v === 0 || v === 1);
  if (property === 'sheenColor' && target.sheen === 0) check((v as Color).equals(new Color(0, 0, 0)));
  if (property === 'sheenRoughness' && target.sheen === 0) check(v === 1);
  if (property === 'anisotropyRotation' && target.anisotropy === 0) check(v === 0);
  if (property === 'iridescenceIOR' && target.iridescence === 0) check(v === 1.3);
  if (property === 'iridescenceThicknessRange' && target.iridescence === 0) {
    check((v as number[])[0] === 100 && (v as number[])[1] === 400);
  }
  if (property === 'thickness' && target.transmission === 0) check(v === 0);
  if (property === 'attenuationDistance') {
    check(v !== 0); // GLTFLoader interprets zero as Infinity.
    if (target.transmission === 0) check(v === Infinity);
  }
  if (property === 'attenuationColor' && target.transmission === 0) check((v as Color).equals(new Color(1, 1, 1)));
  if (property === 'emissive') {
    const c = v as Color;
    check(Math.max(c.r, c.g, c.b) > 0 || (c.r === 0 && c.g === 0 && c.b === 0));
  }
}

// GLTFLoader flips both normal-scale Y components on primitives without
// tangents, even without a normal map. Check every exported mesh, since shared
// materials may be used with different tangent layouts.
export function validateReferenceGeometry(value: object, material: object, hasTangent: boolean) {
  if (!defaults.has(value)) return;
  const target = material as Record<string, unknown>;
  for (const property of referenceProperties(value as Record<string, unknown>, target)) {
    if (property !== 'normalScale' && property !== 'clearcoatNormalScale') continue;
    const scale = target[property] as Vector2;
    const transportedX = property === 'normalScale' ? (target.normalMap ? Math.abs(scale.x) : 1) :
      target.clearcoat !== 0 && target.clearcoatNormalMap ? scale.x : 1;
    check(scale.x === transportedX && scale.y === (hasTangent ? transportedX : -transportedX));
  }
}

function validateArgs(op: string, args: Record<string, unknown>) {
  const fields = op === 'MaterialReferenceNode' ? ['property', 'uniformType'] : ['scope'];
  check(Object.keys(args).every((key) => [...fields, 'nodeType', 'name', 'global', 'parents'].includes(key)));
  check(args.nodeType === null);
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
  if (op === 'MaterialNode') check(typeof args.scope === 'string' && own(materialScopes, args.scope));
  else if (op === 'ModelNode') check(modelScopes.includes(args.scope as string));
  else if (op === 'MaterialReferenceNode') {
    check(typeof args.property === 'string' && own(materialProperties, args.property));
    check(args.uniformType === materialProperties[args.property as string]);
  } else check(false); // Object3DNode has no portable default object binding.
}

// Called only for default-created/serialized nodes. Overrides own their binding
// contracts. Validate every clone privately, before publishing any graph slots.
export function validateReferenceMaterial(value: object, material: object) {
  if (!defaults.has(value)) return;
  if ((value as { type?: string }).type === 'MaterialNode') validateTextureFallback(material as import('three').Material);
  const node = value as Record<string, unknown>;
  const target = material as Record<string, unknown>;
  if (node.type === 'MaterialNode') {
    // These native setup branches depend on ordinary state glTF does not
    // reconstruct. Never turn a bump/packed/object-space normal into a different
    // normal lookup, or silently drop the separate alpha-map reference.
    if (node.scope === 'opacity') check(!target.alphaMap);
    const gatedMaps: Record<string, [string, string]> = {
      clearcoat: ['clearcoat', 'clearcoatMap'], clearcoatRoughness: ['clearcoat', 'clearcoatRoughnessMap'],
      clearcoatNormal: ['clearcoat', 'clearcoatNormalMap'], sheen: ['sheen', 'sheenColorMap'],
      sheenRoughness: ['sheen', 'sheenRoughnessMap'], anisotropy: ['anisotropy', 'anisotropyMap'],
      iridescence: ['iridescence', 'iridescenceMap'], iridescenceThickness: ['iridescence', 'iridescenceThicknessMap'],
      transmission: ['transmission', 'transmissionMap'], thickness: ['transmission', 'thicknessMap']
    };
    const gate = gatedMaps[node.scope as string];
    if (gate && target[gate[0]] === 0) check(!target[gate[1]]);
    if (node.scope === 'anisotropy' && target.anisotropyMap) {
      // Native r186 GLTFExporter omits this texture's texCoord, so import
      // always selects UV set 0 even when another set exists on the mesh.
      check((target.anisotropyMap as { channel: number }).channel === 0);
    }
    if (node.scope === 'normal') {
      check(target.normalMap || !target.bumpMap);
      if (target.normalMap) {
        const map = target.normalMap as { format: number };
        check(target.normalMapType === TangentSpaceNormalMap);
        check(![RGFormat, RED_GREEN_RGTC2_Format, RG11_EAC_Format].some((format) => format === map.format));
      }
    }
  }
  const properties = referenceProperties(node, target);
  for (const property of properties) {
    const v = target[property];
    const type = materialProperties[property];
    if (property === 'iridescenceThicknessRange') {
      check(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)));
    } else if (type === 'float') {
      // Infinity is Three.js's ordinary default attenuation distance.
      check(typeof v === 'number' && (Number.isFinite(v) || (property === 'attenuationDistance' && v === Infinity)));
    } else if (type === 'color') check(v instanceof Color && [v.r, v.g, v.b].every(Number.isFinite));
    else if (type === 'vec2') check(v instanceof Vector2 && [v.x, v.y].every(Number.isFinite));
    validatePropertyTransport(property, target);
  }
}

export function serializeReferenceNode(value: object): NodeExport | null {
  const node = value as Node & Record<string, unknown>;
  if (!isReferenceNodeOp(node.type)) return null;
  check(own(node.constructor, 'type'));
  const fields = node.type === 'MaterialReferenceNode' ? ['property', 'uniformType'] : ['scope'];
  const args: Record<string, JsonValue> = {};
  for (const key of [...fields, 'nodeType', 'name', 'global', 'parents']) args[key] = node[key] as JsonValue;
  validateArgs(node.type, args);
  check(node.updateType === (node.type === 'MaterialNode' ? 'none' : 'object'));
  const internal = node.type === 'ModelNode' ? 'uniformNode' : node.type === 'MaterialReferenceNode' ? 'node' : null;
  validateNodeLinks(node, internal ? [internal] : []);
  if (node.type === 'MaterialReferenceNode') {
    check(node.material === null && node.object === null && node.count === null && node.group === null);
    check(Array.isArray(node.properties) && node.properties.length === 1 && node.properties[0] === node.property);
  }
  // Internal uniforms and resolved objects are Three.js-owned runtime caches,
  // not graph inputs or snapshots. Reject customized uniform behavior.
  const uniform = internal ? node[internal] as Node & Record<string, unknown> : null;
  if (uniform != null) {
    check(uniform instanceof UniformNode && uniform.type === 'UniformNode' && own(uniform.constructor, 'type'));
    validateNodeLinks(uniform, ['groupNode']);
    check([objectGroup, sourceObjectGroup].includes(uniform.groupNode as typeof objectGroup));
    check(uniform.updateType === 'none' && uniform.updateBeforeType === 'none' && uniform.updateAfterType === 'none');
    check(!Object.values(uniform).some((v) => typeof v === 'function'));
    check(uniform.precision === null);
    check(uniform.name === (node.type === 'MaterialReferenceNode' ? node.name ?? '' : '') && !uniform.global && !uniform.parents);
    check(uniform.nodeType === null || uniform.nodeType === (node.type === 'MaterialReferenceNode' ? node.uniformType :
      node.scope === 'worldMatrix' ? 'mat4' : node.scope === 'radius' ? 'float' : 'vec3'));
  } else check(node.type !== 'ModelNode');
  // Object3DNode.serialize() owns ModelNode's scope; MaterialNode and
  // MaterialReferenceNode omit their constructor fields upstream.
  const children = [...node.getSerializeChildren()];
  const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  const data: Record<string, unknown> = { meta: { nodes, textures: {}, images: {} } };
  node.serialize(data as never);
  if (node.type === 'ModelNode') args.scope = data.scope as JsonValue;
  defaults.add(node);
  return { op: node.type, args };
}

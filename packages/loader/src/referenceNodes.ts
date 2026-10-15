import { Color, Vector2, TangentSpaceNormalMap, RGFormat, RED_GREEN_RGTC2_Format, RG11_EAC_Format } from 'three';
import { MaterialNode, ModelNode, MaterialReferenceNode } from 'three/webgpu';
import type { JsonValue } from './THREEMaterialsTSLLoaderPlugin.js';

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
  const node = value as Record<string, unknown>;
  const target = material as Record<string, unknown>;
  if (node.type === 'MaterialNode') {
    // These native setup branches depend on ordinary state glTF does not
    // reconstruct. Never turn a bump/packed/object-space normal into a different
    // normal lookup, or silently drop the separate alpha-map reference.
    if (node.scope === 'opacity') check(!target.alphaMap);
    if (node.scope === 'normal') {
      check(target.normalMap || !target.bumpMap);
      if (target.normalMap) {
        const map = target.normalMap as { format: number };
        check(target.normalMapType === TangentSpaceNormalMap);
        check(![RGFormat, RED_GREEN_RGTC2_Format, RG11_EAC_Format].some((format) => format === map.format));
      }
    }
  }
  const properties = node.type === 'MaterialNode' ? materialScopes[node.scope as string] :
    node.type === 'MaterialReferenceNode' ? [node.property as string] : [];
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
  }
}

export function resolveReferenceNode(op: string, raw: JsonValue | undefined, links?: Record<string, unknown>) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  check(!links || Object.keys(links).length === 0);
  const args = raw as Record<string, unknown>;
  validateArgs(op, args);
  let node;
  if (op === 'MaterialNode') node = new MaterialNode(args.scope as never);
  else if (op === 'ModelNode') {
    node = new ModelNode(args.scope as never);
    node.deserialize({ scope: args.scope } as never);
  } else if (op === 'MaterialReferenceNode') node = new MaterialReferenceNode(args.property as string, args.uniformType as string);
  else return null;
  node.name = args.name as string;
  node.global = args.global as boolean;
  node.parents = args.parents as boolean;
  defaults.add(node);
  return node;
}

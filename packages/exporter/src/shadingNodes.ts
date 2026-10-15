import { NodeBuilder } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { JsonValue, NodeExport } from './types.js';
import { validateNodeLinks } from './nodeLinks.js';
import {
  TangentSpaceNormalMap, ObjectSpaceNormalMap, NoNormalPacking, NormalRGPacking, NormalGAPacking,
  NoToneMapping, LinearToneMapping, ReinhardToneMapping, CineonToneMapping,
  ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping,
  NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace
} from 'three';

// Paired with the other package's shadingNodes.ts. These are constructor data,
// not shader implementations or a registry of arbitrary executable operations.
const adapters: Record<string, { fields: string[]; required: string[]; optional?: string[] }> = {
  NormalMapNode: { fields: ['normalMapType', 'unpackNormalMode'], required: ['node'], optional: ['scaleNode'] },
  BumpMapNode: { fields: [], required: ['textureNode'], optional: ['scaleNode'] },
  VertexColorNode: { fields: ['index'], required: [] },
  ColorSpaceNode: { fields: ['source', 'target'], required: ['colorNode'] },
  ToneMappingNode: { fields: ['toneMapping'], required: ['exposureNode'], optional: ['colorNode'] },
  RenderOutputNode: { fields: ['toneMapping', 'outputColorSpace'], required: [], optional: ['colorNode'] },
  BitcastNode: { fields: ['conversionType', 'inputType'], required: ['valueNode'] },
  BitcountNode: { fields: ['method'], required: ['aNode'] },
  PackFloatNode: { fields: ['encoding', 'layout'], required: ['vectorNode'] },
  UnpackFloatNode: { fields: ['encoding', 'layout'], required: ['uintNode'] },
  Packed4x8IntegerNode: { fields: ['method'], required: ['aNode'], optional: ['bNode'] }
};
const check = (valid: unknown) => { if (!valid) throw new Error('Invalid or unsupported shading node arguments or links'); };
const colorSpaces: string[] = [NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace];
const toneMappings: number[] = [NoToneMapping, LinearToneMapping, ReinhardToneMapping, CineonToneMapping,
  ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping];
const numericType = (value: unknown) => typeof value === 'string' && /^(?:float|int|uint|[iu]?vec[234])$/.test(value);
const scalarType = (value: unknown) => ['float', 'int', 'uint'].includes(value as string);

function validateArgs(op: string, args: Record<string, unknown>, links: Record<string, unknown>) {
  const adapter = adapters[op];
  check(Object.keys(args).every((key) => [...adapter.fields, 'nodeType', 'name', 'global', 'parents'].includes(key)));
  check(args.name === null || args.name === '' || (typeof args.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args.name)));
  check(typeof args.global === 'boolean' && typeof args.parents === 'boolean');
  const fixedType = ['NormalMapNode', 'BumpMapNode', 'ToneMappingNode'].includes(op) ? 'vec3' :
    ['VertexColorNode', 'ColorSpaceNode', 'RenderOutputNode'].includes(op) ? 'vec4' : null;
  check(args.nodeType === fixedType);
  switch (op) {
    case 'NormalMapNode':
      check([TangentSpaceNormalMap, ObjectSpaceNormalMap].includes(args.normalMapType as never));
      check([NoNormalPacking, NormalRGPacking, NormalGAPacking].includes(args.unpackNormalMode as never));
      check(args.normalMapType !== ObjectSpaceNormalMap || args.unpackNormalMode === NoNormalPacking); break;
    case 'VertexColorNode':
      // Native GLTFExporter/Loader preserve color/COLOR_0. color1 is renamed
      // _COLOR1/_color1, so higher indices need a paired geometry adapter.
      check(args.index === 0 || args.index === undefined); break;
    case 'ColorSpaceNode':
      for (const key of ['source', 'target']) check([...colorSpaces, 'WorkingColorSpace', 'OutputColorSpace', null, undefined].includes(args[key] as never)); break;
    case 'ToneMappingNode': check(toneMappings.includes(args.toneMapping as number)); break;
    case 'RenderOutputNode':
      check(args.toneMapping == null || toneMappings.includes(args.toneMapping as number));
      check(args.outputColorSpace == null || colorSpaces.includes(args.outputColorSpace as string)); break;
    case 'BitcastNode':
      check(numericType(args.conversionType));
      check(args.inputType === null || (scalarType(args.inputType) && scalarType(args.conversionType))); break;
    case 'BitcountNode': check(['countLeadingZeros', 'countTrailingZeros', 'countOneBits'].includes(args.method as string)); break;
    case 'PackFloatNode':
    case 'UnpackFloatNode':
      check(['snorm', 'unorm', 'float16'].includes(args.encoding as string));
      check(['2x16', '4x8'].includes(args.layout as string));
      check(args.encoding !== 'float16' || args.layout === '2x16'); break;
    case 'Packed4x8IntegerNode':
      check(['dot4I8Packed', 'dot4U8Packed', 'pack4xI8', 'pack4xU8', 'pack4xI8Clamp', 'pack4xU8Clamp', 'unpack4xI8', 'unpack4xU8'].includes(args.method as string));
      check(args.method === 'dot4I8Packed' || args.method === 'dot4U8Packed' ? links.bNode !== undefined : links.bNode === undefined); break;
  }
}

export function serializeShadingNode(value: object): NodeExport | null {
  const node = value as Node & Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(adapters, node.type)) return null;
  check(Object.prototype.hasOwnProperty.call(node.constructor, 'type'));
  const adapter = adapters[node.type];
  const inputs = [...adapter.required, ...(adapter.optional ?? [])];
  validateNodeLinks(node, inputs);
  const children = [...node.getSerializeChildren()];
  const nodes = Object.fromEntries(children.map(({ childNode }) => [childNode.uuid, { uuid: childNode.uuid }]));
  const data: Record<string, unknown> = { meta: { nodes, textures: {}, images: {} } };
  node.serialize(data as never);
  const args: Record<string, JsonValue> = {};
  for (const key of [...adapter.fields, 'nodeType', 'name', 'global', 'parents']) {
    // Undefined is meaningful for RenderOutputNode: unlike null, it does not
    // inherit context. Encode it by omitting the field, never normalize to null.
    const field = key === 'toneMapping' ? node._toneMapping : data[key] ?? node[key];
    if (field !== undefined) args[key] = field as JsonValue;
  }
  // ColorSpaceNode treats null/undefined/empty equally as a no-op; preserve
  // undefined by omission and validate it as such below.
  const links: Record<string, unknown> = {};
  for (const key of inputs) {
    const child = node[key] as Node | null;
    // Scale and packed-binary inputs use a strict null sentinel upstream.
    // Only color inputs use a falsy/context fallback that also accepts undefined.
    if ((child === null || (child === undefined && key === 'colorNode')) && !adapter.required.includes(key)) continue;
    check(child && child.isNode === true);
    links[key] = { node: child };
  }
  validateArgs(node.type, args, links);
  validateShadingInputs(node);
  return { op: node.type, args, links };
}

// Three.js owns type inference. Supply no renderer or GPU resources; inputs
// requiring unavailable context must use an explicit paired adapter.
function validateShadingInputs(value: object) {
  const node = value as import('three/webgpu').Node & {
    valueNode: import('three/webgpu').Node; aNode: import('three/webgpu').Node;
    vectorNode: import('three/webgpu').Node; uintNode: import('three/webgpu').Node;
    inputType: string | null; conversionType: string; layout: string;
  };
  if (!['BitcastNode', 'BitcountNode', 'PackFloatNode', 'UnpackFloatNode'].includes(node.type)) return;
  // The JS base is concrete; its declarations mark shader hooks abstract.
  const TypeBuilder = NodeBuilder as unknown as new () => NodeBuilder & { getTypeLength(type: string): number };
  const builder = new TypeBuilder();
  if (node.type === 'BitcastNode') {
    const source = node.valueNode.getNodeType(builder);
    check(numericType(source));
    // r186 GLSL has no float-to-float bitcast intrinsic.
    const floating = (type: string) => /^(?:float|vec[234])$/.test(type);
    check(!(floating(node.inputType ?? source) && floating(node.conversionType)));
    if (node.inputType === null) check(builder.getTypeLength(source) === builder.getTypeLength(node.conversionType));
  } else if (node.type === 'BitcountNode') {
    check(/^(?:int|uint|[iu]vec[234])$/.test(node.aNode.getNodeType(builder)));
  } else if (node.type === 'PackFloatNode') {
    check(node.vectorNode.getNodeType(builder) === (node.layout === '4x8' ? 'vec4' : 'vec2'));
  } else check(node.uintNode.getNodeType(builder) === 'uint');
}

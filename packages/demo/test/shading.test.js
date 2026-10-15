import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createCanvas, CanvasElement, Image, ImageData, loadImage } from '@napi-rs/canvas';
import { BoxGeometry, Mesh, Scene, Texture, SRGBColorSpace, LinearSRGBColorSpace,
  Float32BufferAttribute, ColorManagement, PerspectiveCamera, TangentSpaceNormalMap, ObjectSpaceNormalMap,
  NoNormalPacking, NormalRGPacking, NormalGAPacking, NoToneMapping, LinearToneMapping,
  ReinhardToneMapping, CineonToneMapping, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, CustomToneMapping } from 'three';
import { GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
import { MeshPhysicalNodeMaterial, ConstNode } from 'three/webgpu';
import { NormalMapNode, BumpMapNode, VertexColorNode, ColorSpaceNode, ToneMappingNode, RenderOutputNode,
  BitcastNode, BitcountNode, PackFloatNode, UnpackFloatNode, Packed4x8IntegerNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@loader';
import { THREEMaterialsTSLExporterPlugin, createDefaultNodeSerializer } from '@exporter';

const extensionName = 'THREE_materials_tsl';
beforeAll(() => {
  // CPU canvas/PNG codec behind browser API shims. The real writer embeds the
  // image; the real parser fetches/decodes it through ImageBitmapLoader.
  vi.stubGlobal('HTMLCanvasElement', CanvasElement);
  vi.stubGlobal('OffscreenCanvas', class extends CanvasElement {
    convertToBlob({ type }) { return Promise.resolve(new Blob([this.toBuffer(type)], { type })); }
  });
  vi.stubGlobal('ImageBitmap', Image);
  vi.stubGlobal('ImageData', ImageData);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async (blob) => loadImage(Buffer.from(await blob.arrayBuffer())));
  vi.stubGlobal('FileReader', class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.(); }); }
    readAsDataURL(blob) { blob.arrayBuffer().then((value) => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
  });
  vi.stubGlobal('ProgressEvent', class { constructor(type, values) { this.type = type; Object.assign(this, values); } });
});
afterAll(() => vi.unstubAllGlobals());

function texture() {
  const canvas = createCanvas(2, 2);
  // Native canvas exposes a non-browser data() method. Hide it so Three.js
  // uses its ordinary canvas image path rather than its DataTexture path.
  Object.defineProperty(canvas, 'data', { value: undefined });
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
  ]), 2, 2), 0, 0);
  const value = new Texture(canvas);
  value.name = 'four pixels';
  return value;
}
function pixels(image) {
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return [...canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data];
}
function sceneWith(...materials) {
  const scene = new Scene();
  for (const material of materials) {
    const geometry = new BoxGeometry();
    geometry.setAttribute('uv1', geometry.attributes.uv.clone());
    geometry.setAttribute('color', new Float32BufferAttribute(Array(geometry.attributes.position.count).fill([0.2, 0.4, 0.6]).flat(), 3));
    scene.add(new Mesh(geometry, material));
  }
  return scene;
}
async function exportScene(scene, binary = false) {
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: createDefaultNodeSerializer() }));
  return exporter.parseAsync(scene, { binary });
}
async function load(json, enabled = true, errors = []) {
  const loader = new GLTFLoader();
  if (enabled) loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
    nodeResolver: createDefaultNodeResolver(), onError: (error) => errors.push(error)
  }));
  return loader.parseAsync(json instanceof ArrayBuffer ? json : JSON.stringify(json), '');
}
function materialsOf(gltf) {
  const result = [];
  gltf.scene.traverse((object) => { if (object.isMesh) result.push(object.material); });
  return result;
}
const materialOf = (gltf) => materialsOf(gltf)[0];
function geometryOf(gltf) {
  let geometry; gltf.scene.traverse((o) => { if (o.isMesh && !geometry) geometry = o.geometry; });
  return geometry;
}

const toneMappings = [NoToneMapping, LinearToneMapping, ReinhardToneMapping, CineonToneMapping,
  ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping];
const fixtures = [];
for (const space of [TangentSpaceNormalMap, ObjectSpaceNormalMap]) {
  for (const mode of space === TangentSpaceNormalMap ? [NoNormalPacking, NormalRGPacking, NormalGAPacking] : [NoNormalPacking]) {
    for (const scale of [false, true]) fixtures.push([`normal ${space}/${mode}/scale=${scale}`, () => {
      const node = TSL.normalMap(TSL.texture(texture()), scale ? TSL.vec2(0.5, 0.7) : null);
      node.normalMapType = space; node.unpackNormalMode = mode; return node;
    }]);
  }
}
for (const scale of [false, true]) fixtures.push([`bump scale=${scale}`, () => TSL.bumpMap(TSL.texture(texture()), scale ? TSL.time : null)]);
fixtures.push(['vertex color', () => TSL.vertexColor()], ['vertex omitted index', () => new VertexColorNode()]);
for (const source of ['', SRGBColorSpace, LinearSRGBColorSpace, 'WorkingColorSpace', 'OutputColorSpace', null, undefined]) {
  for (const target of ['', SRGBColorSpace, LinearSRGBColorSpace, 'WorkingColorSpace', 'OutputColorSpace', null, undefined]) {
    fixtures.push([`color ${source}->${target}`, () => new ColorSpaceNode(TSL.materialColor, source, target)]);
  }
}
for (const mapping of toneMappings) {
  fixtures.push([`tone ${mapping} default exposure/context color`, () => new ToneMappingNode(mapping)]);
  fixtures.push([`tone ${mapping} explicit inputs`, () => new ToneMappingNode(mapping, TSL.time, TSL.vec4(0.8, 0.4, 0.2, 0.5))]);
  fixtures.push([`output ${mapping}`, () => TSL.renderOutput(TSL.vec4(0.8, 0.4, 0.2, 0.5), mapping, SRGBColorSpace)]);
}
for (const mapping of [null, undefined, NoToneMapping]) {
  for (const output of [null, undefined, '', SRGBColorSpace, LinearSRGBColorSpace]) {
    fixtures.push([`context output ${mapping}/${output}`, () => new RenderOutputNode(null, mapping, output)]);
  }
}
for (const type of ['float', 'int', 'uint', 'vec2', 'ivec2', 'uvec2', 'vec3', 'ivec3', 'uvec3', 'vec4', 'ivec4', 'uvec4']) {
  const n = /[234]$/.test(type) ? Number(type.slice(-1)) : 1;
  const target = n === 1 ? 'uint' : `uvec${n}`;
  fixtures.push([`bitcast ${type}`, () => new BitcastNode(TSL[type](1), target)]);
}
for (const [input, output] of [['float', 'int'], ['float', 'uint'], ['int', 'float'], ['uint', 'float']]) {
  fixtures.push([`bitcast alias ${input}/${output}`, () => new BitcastNode(TSL.vec3(1), output, input)]);
}
for (const method of ['countOneBits', 'countLeadingZeros', 'countTrailingZeros']) {
  for (const type of ['int', 'uint', 'ivec2', 'uvec3', 'ivec4']) {
    fixtures.push([`${method} ${type}`, () => TSL[method](TSL[type](5))]);
  }
}
for (const encoding of ['snorm', 'unorm', 'float16']) {
  for (const layout of encoding === 'float16' ? ['2x16'] : ['2x16', '4x8']) {
    fixtures.push([`pack/unpack ${encoding}/${layout}`, () => {
      const pack = new PackFloatNode(encoding, layout === '4x8' ? TSL.vec4(0.2) : TSL.vec2(0.4));
      pack.layout = layout;
      const unpack = new UnpackFloatNode(encoding, pack); unpack.layout = layout; return unpack;
    }]);
  }
}
for (const method of ['dot4I8Packed', 'dot4U8Packed', 'pack4xI8', 'pack4xU8', 'pack4xI8Clamp', 'pack4xU8Clamp', 'unpack4xI8', 'unpack4xU8']) {
  fixtures.push([method, () => TSL[method](method.startsWith('pack') ?
    (method.includes('I8') ? TSL.ivec4(-1, 2, -3, 4) : TSL.uvec4(1, 2, 3, 4)) : TSL.uint(123), ...(method.startsWith('dot') ? [TSL.uint(456)] : []))]);
}

function shaderFlow(node, geometry, gpu = false, context = {}, materialOptions = {}) {
  const renderer = {
    backend: { isWebGPUBackend: gpu }, debug: { diagnostics: { keywords: false } },
    library: new StandardNodeLibrary(), outputColorSpace: SRGBColorSpace,
    toneMappingExposure: 1.2
  };
  const Builder = gpu ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(new Mesh(geometry, Object.assign(new MeshPhysicalNodeMaterial(), materialOptions)), renderer);
  Object.assign(builder.context, { color: TSL.vec4(0.8, 0.4, 0.2, 0.5), toneMapping: ReinhardToneMapping, outputColorSpace: SRGBColorSpace }, context);
  builder.camera = new PerspectiveCamera();
  builder.context.setupPositionView = () => builder.material.setupPositionView(builder);
  builder.context.setupNormal = () => TSL.subBuild(builder.material.setupNormal(builder), 'NORMAL', 'vec3');
  builder.setShaderStage('fragment');
  const flow = builder.flowStagesNode(node, 'vec4');
  return { result: flow.result, code: flow.code, vertex: builder.flowCode.vertex,
    functions: (builder.codes.fragment ?? []).map(({ code }) => code) };
}

it.each(fixtures)('round-trips twice and preserves Three.js shader flow: %s', async (_, create) => {
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = create(); source.emissiveNode = source.colorNode;
  const scene = sceneWith(source); const geometry = scene.children[0].geometry;
  const expected = shaderFlow(source.colorNode, geometry);
  expect(expected.result).toBeTruthy();
  let json = await exportScene(scene);
  const graph = json.materials[0].extensions[extensionName];
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    const material = materialOf(gltf);
    expect(material.isNodeMaterial).toBe(true);
    expect(material.colorNode).toBe(material.emissiveNode);
    expect(shaderFlow(material.colorNode, geometryOf(gltf))).toEqual(expected);
    json = await exportScene(gltf.scene);
    expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});

it('retains shared texture inputs, optional scales, exposure and dynamic references', async () => {
  const source = new MeshPhysicalNodeMaterial(); const tex = TSL.texture(texture());
  source.normalNode = TSL.normalMap(tex, TSL.vec2(0.5));
  source.clearcoatNormalNode = TSL.bumpMap(tex, TSL.time);
  source.colorNode = new ToneMappingNode(ACESFilmicToneMapping, undefined, TSL.materialColor);
  let json = await exportScene(sceneWith(source));
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    const m = materialOf(gltf);
    expect(m.normalNode.node).toBe(m.clearcoatNormalNode.textureNode);
    expect(m.clearcoatNormalNode.scaleNode).toBe(TSL.time);
    expect(m.colorNode.exposureNode).toBe(TSL.toneMappingExposure);
    expect(m.colorNode.colorNode).toBe(TSL.materialColor);
    const renderer = { toneMappingExposure: 1.5 };
    m.colorNode.exposureNode.updateReference({ renderer });
    m.colorNode.exposureNode.update({ renderer });
    expect(m.colorNode.exposureNode.node.value).toBe(1.5);
    json = await exportScene(gltf.scene);
  }
});

const invalidExports = [
  ['normal space', () => Object.assign(TSL.normalMap(TSL.vec3(0.5)), { normalMapType: 99 })],
  ['normal unpack', () => Object.assign(TSL.normalMap(TSL.vec3(0.5)), { unpackNormalMode: 'bad' })],
  ['object-space unpack', () => Object.assign(TSL.normalMap(TSL.vec3(0.5)), { normalMapType: ObjectSpaceNormalMap, unpackNormalMode: NormalRGPacking })],
  ['undefined normal scale', () => Object.assign(TSL.normalMap(TSL.vec3(0.5)), { scaleNode: undefined })],
  ['undefined bump scale', () => Object.assign(TSL.bumpMap(TSL.float(1)), { scaleNode: undefined })],
  ['undefined packed input', () => Object.assign(new Packed4x8IntegerNode('pack4xI8', TSL.ivec4(1)), { bNode: undefined })],
  ['bump scale', () => new BumpMapNode(TSL.float(1), 2)],
  ...[-1, 1, 0.5].map((index) => [`vertex index ${index}`, () => new VertexColorNode(index)]),
  ['color space', () => new ColorSpaceNode(TSL.vec4(1), 'custom-space', SRGBColorSpace)],
  ['custom tone mapping', () => new ToneMappingNode(CustomToneMapping)],
  ['custom output tone mapping', () => TSL.renderOutput(TSL.vec4(1), CustomToneMapping, SRGBColorSpace)],
  ['custom output color space', () => TSL.renderOutput(TSL.vec4(1), NoToneMapping, 'custom-space')],
  ['bitcast target', () => new BitcastNode(TSL.float(1), 'bool')],
  ['bitcast alias', () => new BitcastNode(TSL.float(1), 'uint', 'vec2')],
  ['bitcast width', () => new BitcastNode(TSL.vec2(1), 'uint')],
  ['bitcast float identity', () => new BitcastNode(TSL.float(1), 'float')],
  ['bitcast source', () => new BitcastNode(TSL.bool(true), 'uint')],
  ['bitcount method', () => new BitcountNode('bad', TSL.uint(1))],
  ['bitcount type', () => TSL.countOneBits(TSL.float(1))],
  ['pack encoding', () => new PackFloatNode('bad', TSL.vec2(1))],
  ['pack layout', () => Object.assign(new PackFloatNode('snorm', TSL.vec2(1)), { layout: '2x32' })],
  ['pack unsupported half4x8', () => Object.assign(new PackFloatNode('float16', TSL.vec4(1)), { layout: '4x8' })],
  ['pack width', () => new PackFloatNode('snorm', TSL.vec3(1))],
  ['unpack input', () => new UnpackFloatNode('snorm', TSL.float(1))],
  ['integer method', () => new Packed4x8IntegerNode('bad', TSL.uint(1))],
  ['integer missing binary input', () => new Packed4x8IntegerNode('dot4I8Packed', TSL.uint(1))],
  ['integer extra unary input', () => new Packed4x8IntegerNode('unpack4xI8', TSL.uint(1), TSL.uint(2))],
  ['extra links', () => Object.assign(TSL.normalMap(TSL.vec3(0.5)), { extra: { child: TSL.time } })],
  ['callbacks', () => TSL.normalMap(TSL.vec3(0.5)).onUpdate(() => {})],
  ['subclass', () => { class Custom extends NormalMapNode {} return new Custom(TSL.vec3(0.5)); }]
];
it.each(invalidExports)('rejects export with %s', async (_, create) => {
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = create();
  await expect(exportScene(sceneWith(source))).rejects.toThrow(/Unsupported|Invalid|unsupported/);
});

const invalidImports = [
  ['normal space', () => TSL.normalMap(TSL.vec3(1)), (n) => { n.args.normalMapType = 99; }],
  ['normal unpack', () => TSL.normalMap(TSL.vec3(1)), (n) => { n.args.unpackNormalMode = 'bad'; }],
  ['object-space unpack', () => TSL.normalMap(TSL.vec3(1)), (n) => { n.args.normalMapType = ObjectSpaceNormalMap; n.args.unpackNormalMode = NormalGAPacking; }],
  ['bump link', () => TSL.bumpMap(TSL.texture(texture())), (n) => { n.links.scaleNode = { $refTex: 0 }; }],
  ['vertex index', () => TSL.vertexColor(), (n) => { n.args.index = 1; }],
  ['color space', () => TSL.workingToColorSpace(TSL.vec4(1), SRGBColorSpace), (n) => { n.args.source = 'custom'; }],
  ['custom tone mapping', () => new ToneMappingNode(LinearToneMapping), (n) => { n.args.toneMapping = CustomToneMapping; }],
  ['custom output', () => TSL.renderOutput(TSL.vec4(1)), (n) => { n.args.outputColorSpace = 'custom'; }],
  ['output tone mapping', () => TSL.renderOutput(TSL.vec4(1)), (n) => { n.args.toneMapping = 99; }],
  ['bitcast target', () => new BitcastNode(TSL.float(1), 'uint'), (n) => { n.args.conversionType = 'mat3'; }],
  ['bitcast width', () => new BitcastNode(TSL.float(1), 'uint'), (n) => { n.args.conversionType = 'uvec2'; }],
  ['bitcast alias', () => new BitcastNode(TSL.float(1), 'uint'), (n) => { n.args.inputType = 'vec2'; }],
  ['bitcount method', () => TSL.countOneBits(TSL.uint(1)), (n) => { n.args.method = 'eval'; }],
  ['bitcount type', () => TSL.countOneBits(TSL.uint(1)), (n, e) => { e.nodes.invalid = { op: 'ConstNode', args: { value: 1, valueType: 'float', nodeType: 'float' } }; n.links.aNode = { $ref: 'invalid' }; }],
  ['pack encoding', () => new PackFloatNode('snorm', TSL.vec2(1)), (n) => { n.args.encoding = 'bad'; }],
  ['pack width', () => new PackFloatNode('snorm', TSL.vec2(1)), (n) => { n.args.layout = '4x8'; }],
  ['unpack layout', () => new UnpackFloatNode('unorm', TSL.uint(1)), (n) => { n.args.layout = '4x16'; }],
  ['unpack input', () => new UnpackFloatNode('unorm', TSL.uint(1)), (n, e) => { e.nodes.invalid = { op: 'ConstNode', args: { value: 1, valueType: 'float', nodeType: 'float' } }; n.links.uintNode = { $ref: 'invalid' }; }],
  ['integer method', () => TSL.pack4xI8(TSL.ivec4(1)), (n) => { n.args.method = 'eval'; }],
  ['integer arity', () => TSL.dot4I8Packed(TSL.uint(1), TSL.uint(2)), (n) => { delete n.links.bNode; }],
  ['unknown field', () => TSL.vertexColor(), (n) => { n.args.custom = 1; }],
  ['invalid type', () => TSL.vertexColor(), (n) => { n.args.nodeType = 'vec3'; }],
  ['missing required link', () => TSL.normalMap(TSL.vec3(1)), (n) => { delete n.links.node; }],
  ['dangling link', () => TSL.normalMap(TSL.vec3(1)), (n) => { n.links.node.$ref = 'absent'; }],
  ['cycle', () => TSL.normalMap(TSL.vec3(1)), (n) => { n.links.node.$ref = 'n0'; }],
  ['resource link', () => TSL.normalMap(TSL.vec3(1)), (n) => { n.links.node = { $refTex: 0 }; }],
  ['extra link', () => TSL.vertexColor(), (n) => { n.links = { unrecognized: { $ref: 'n0' } }; }]
];
it.each(invalidImports)('atomically retains ordinary fallback with %s', async (_, create, mutate) => {
  const source = new MeshPhysicalNodeMaterial(); source.color.setRGB(0.3, 0.5, 0.7);
  source.clearcoat = 0.6; source.map = texture(); source.map.flipY = false;
  source.colorNode = create(); source.roughnessNode = TSL.float(0.25);
  const json = await exportScene(sceneWith(source));
  const extension = json.materials[0].extensions[extensionName];
  let root = extension.nodes[extension.entrypoints.colorNode];
  while (root.op === 'VarNode') root = extension.nodes[root.links.node.$ref];
  mutate(root, extension);
  const errors = []; const failed = materialOf(await load(json, true, errors));
  const ordinary = materialOf(await load(json, false));
  expect(errors).toHaveLength(1);
  expect(failed.isNodeMaterial).toBeUndefined();
  expect(failed.type).toBe(ordinary.type);
  expect(failed.color).toEqual(ordinary.color);
  expect(failed.clearcoat).toBe(ordinary.clearcoat);
  expect(failed.roughness).toBe(ordinary.roughness);
  expect(failed.colorNode).toBeUndefined(); expect(failed.roughnessNode).toBeUndefined();
  expect(pixels(failed.map.image)).toEqual(pixels(ordinary.map.image));
  expect(failed.map.matrix).toEqual(ordinary.map.matrix);
});

it.each(fixtures.filter(([name]) => /bitcast|count|pack|dot4/.test(name)))('preserves WGSL generation: %s', async (_, create) => {
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = create();
  const scene = sceneWith(source);
  const expected = shaderFlow(source.colorNode, scene.children[0].geometry, true);
  let json = await exportScene(scene);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    expect(shaderFlow(materialOf(gltf).colorNode, geometryOf(gltf), true)).toEqual(expected);
    json = await exportScene(gltf.scene);
  }
});

it.each(['dot4I8Packed', 'dot4U8Packed', 'pack4xI8', 'pack4xU8', 'pack4xI8Clamp', 'pack4xU8Clamp', 'unpack4xI8', 'unpack4xU8'])('lets Three.js select native packed WGSL for %s', async (method) => {
  const previous = globalThis.navigator;
  vi.stubGlobal('navigator', { gpu: { wgslLanguageFeatures: new Set(['packed_4x8_integer_dot_product']) } });
  try {
    const create = fixtures.find(([name]) => name === method)[1];
    const source = new MeshPhysicalNodeMaterial(); source.colorNode = create();
    const scene = sceneWith(source);
    const expected = shaderFlow(source.colorNode, scene.children[0].geometry, true);
    expect(expected.result + expected.code).toContain(method + '(');
    let json = await exportScene(scene);
    for (let round = 0; round < 2; round++) {
      const gltf = await load(json);
      expect(shaderFlow(materialOf(gltf).colorNode, geometryOf(gltf), true)).toEqual(expected);
      json = await exportScene(gltf.scene);
    }
  } finally { vi.stubGlobal('navigator', previous); }
});

it('preserves context lookup, color-management disabling and output defaults without changing renderer configuration', async () => {
  const source = new MeshPhysicalNodeMaterial();
  source.colorNode = new ColorSpaceNode(TSL.vec4(0.5), 'WorkingColorSpace', 'OutputColorSpace');
  source.outputNode = TSL.renderOutput(null); // null explicitly inherits builder context
  const json = await exportScene(sceneWith(source));
  const gltf = await load(json); const m = materialOf(gltf); const geometry = geometryOf(gltf);
  expect(m.colorNode.resolveColorSpace({ context: { outputColorSpace: LinearSRGBColorSpace }, renderer: { outputColorSpace: SRGBColorSpace } }, m.colorNode.target)).toBe(LinearSRGBColorSpace);
  expect(m.outputNode.getToneMapping()).toBeNull(); expect(m.outputNode.outputColorSpace).toBeNull();
  for (const enabled of [false, true]) {
    const previous = ColorManagement.enabled;
    try {
      ColorManagement.enabled = enabled;
      for (const context of [{ toneMapping: NoToneMapping, outputColorSpace: LinearSRGBColorSpace }, { toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }]) {
        expect(shaderFlow(m.colorNode, geometry, false, context)).toEqual(shaderFlow(source.colorNode, geometry, false, context));
        expect(shaderFlow(m.outputNode, geometry, false, context)).toEqual(shaderFlow(source.outputNode, geometry, false, context));
      }
    } finally { ColorManagement.enabled = previous; }
  }
});

it('keeps Three.js vertex-color white fallback when the geometry has no color attribute', async () => {
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.vertexColor();
  const scene = sceneWith(source); scene.children[0].geometry.deleteAttribute('color');
  const expected = shaderFlow(source.colorNode, scene.children[0].geometry);
  expect(expected.result).toContain('vec4( 1.0, 1.0, 1.0, 1.0 )');
  const gltf = await load(await exportScene(scene));
  expect(shaderFlow(materialOf(gltf).colorNode, geometryOf(gltf))).toEqual(expected);
});

it('preserves base node state and shared inputs across shading classes', async () => {
  const source = new MeshPhysicalNodeMaterial();
  source.colorNode = Object.assign(new ColorSpaceNode(TSL.materialColor, SRGBColorSpace, LinearSRGBColorSpace), { name: 'converted', global: true, parents: true });
  source.emissiveNode = new ToneMappingNode(ReinhardToneMapping, TSL.time, source.colorNode);
  let json = await exportScene(sceneWith(source));
  for (let round = 0; round < 2; round++) {
    const gltf = await load(json); const m = materialOf(gltf);
    expect(m.colorNode.name).toBe('converted'); expect(m.colorNode.global).toBe(true); expect(m.colorNode.parents).toBe(true);
    expect(m.emissiveNode.colorNode).toBe(m.colorNode);
    expect(m.emissiveNode.exposureNode).toBe(TSL.time);
    json = await exportScene(gltf.scene);
  }
});

it('documents native higher-index geometry naming before rejecting its unsupported vertex lookup', async () => {
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.vertexColor(1);
  const scene = sceneWith(source); scene.children[0].geometry.setAttribute('color1', scene.children[0].geometry.attributes.color.clone());
  await expect(exportScene(scene)).rejects.toThrow(/unsupported/);
  const json = await new GLTFExporter().parseAsync(scene);
  expect(json.meshes[0].primitives[0].attributes._COLOR1).toBeDefined();
  const ordinary = await load(json, false);
  expect(geometryOf(ordinary).attributes._color1).toBeDefined();
  expect(geometryOf(ordinary).attributes.color1).toBeUndefined();
});

it.each(['tangents', 'flat normals', 'wireframe bump'])('preserves Three.js surface setup for %s', async (mode) => {
  const source = new MeshPhysicalNodeMaterial();
  source.normalNode = mode === 'wireframe bump' ? TSL.bumpMap(TSL.texture(texture()), TSL.float(0.5)) : TSL.normalMap(TSL.texture(texture()), TSL.vec2(0.6));
  const scene = sceneWith(source);
  if (mode === 'tangents') scene.children[0].geometry.computeTangents();
  const options = { flatShading: mode === 'flat normals', wireframe: mode === 'wireframe bump' };
  const expected = shaderFlow(source.normalNode, scene.children[0].geometry, false, {}, options);
  let json = await exportScene(scene);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    expect(shaderFlow(materialOf(gltf).normalNode, geometryOf(gltf), false, {}, options)).toEqual(expected);
    json = await exportScene(gltf.scene);
  }
});

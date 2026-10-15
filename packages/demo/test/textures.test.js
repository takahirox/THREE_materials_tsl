import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createCanvas, CanvasElement, Image, ImageData, loadImage } from '@napi-rs/canvas';
import { BoxGeometry, Mesh, Scene, Texture, Matrix3, SRGBColorSpace, LinearSRGBColorSpace,
  RepeatWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter, NearestMipmapLinearFilter,
  NearestMipmapNearestFilter, LinearMipmapNearestFilter, LinearMipmapLinearFilter,
  CubeTexture, DataTexture, DepthTexture, WebGLRenderTarget, FloatType, RedFormat } from 'three';
import GLSLNodeBuilder from 'three/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js';
import { MeshPhysicalNodeMaterial, TextureNode, TextureSizeNode, MaxMipLevelNode, ConstNode } from 'three/webgpu';
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

it.each([false, true])('round-trips default texture() twice with real PNG pixels and shared resources (flipY=%s)', async (flipY) => {
  const image = texture(); image.flipY = flipY;
  const first = new MeshPhysicalNodeMaterial();
  first.colorNode = TSL.texture(image);
  first.emissiveNode = first.colorNode;
  first.roughnessNode = TSL.texture(image).r;
  const second = new MeshPhysicalNodeMaterial(); second.colorNode = TSL.texture(image);
  const originalPixels = pixels(image.image);
  const expectedPixels = flipY ? [...originalPixels.slice(8), ...originalPixels.slice(0, 8)] : originalPixels;
  let json = await exportScene(sceneWith(first, second));
  expect(json.textures).toHaveLength(1);
  expect(json.images[0].uri).toMatch(/^data:image\/png;base64,/);
  const graph = json.materials[0].extensions[extensionName];
  expect(graph.nodes.n0.links.value).toEqual({ $refTex: 0 });
  for (let round = 0; round < 2; round++) {
    const errors = [];
    const gltf = await load(json, true, errors);
    expect(errors).toEqual([]);
    const material = materialOf(gltf);
    expect(material.colorNode).toBe(material.emissiveNode);
    expect(material.colorNode.value).toBe(material.roughnessNode.node.value);
    expect(material.colorNode.value).toBe(materialsOf(gltf)[1].colorNode.value);
    expect(material.colorNode.uvNode).toBeNull();
    expect(material.colorNode.updateMatrix).toBe(true);
    expect(material.colorNode.value.flipY).toBe(false);
    expect(material.colorNode.value.name).toBe('four pixels');
    expect(pixels(material.colorNode.value.image)).toEqual(expectedPixels);
    json = await exportScene(gltf.scene);
    expect(json.textures).toHaveLength(1);
    expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});

it.each(['', SRGBColorSpace, LinearSRGBColorSpace])('preserves sampling metadata, UV channels, transforms and updates (%s)', async (colorSpace) => {
  const image = texture(); image.flipY = false;
  Object.assign(image, { channel: 1, colorSpace, rotation: 0.4, anisotropy: 4,
    wrapS: RepeatWrapping, wrapT: MirroredRepeatWrapping, magFilter: NearestFilter,
    minFilter: NearestMipmapLinearFilter, generateMipmaps: false });
  image.offset.set(0.2, 0.3); image.repeat.set(2, 3); image.center.set(0.5, 0.4);
  image.updateMatrix();
  const source = new MeshPhysicalNodeMaterial();
  source.colorNode = TSL.texture(image);
  source.emissiveNode = new TextureNode(image, TSL.uv(0)); // explicit UV disables matrix by default
  const expectedMatrix = image.matrix.clone();
  let json = await exportScene(sceneWith(source));
  for (let round = 0; round < 2; round++) {
    const errors = [];
    const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    const { colorNode: node, emissiveNode: explicit } = materialOf(gltf);
    const restored = node.value;
    for (const key of ['channel', 'colorSpace', 'rotation', 'anisotropy', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'generateMipmaps', 'matrixAutoUpdate']) expect(restored[key], key).toBe(image[key]);
    for (const key of ['offset', 'repeat', 'center']) expect(restored[key].toArray(), key).toEqual(image[key].toArray());
    expect(restored.matrix).toEqual(expectedMatrix);
    expect(node.getDefaultUV().getAttributeName()).toBe('uv1');
    expect(explicit.uvNode.getAttributeName()).toBe('uv');
    expect(explicit.updateMatrix).toBe(false);
    expect(explicit.value).toBe(restored);
    // Three.js owns matrix computation and the update path, including replacing
    // the matrix object after graph reconstruction.
    node.getTransformedUV(TSL.uv());
    const matrix = restored.matrix = new Matrix3();
    restored.offset.x += 0.1;
    node.update();
    expect(node._matrixUniform.value).toBe(matrix);
    const expected = image.clone(); expected.offset.x += 0.1; expected.updateMatrix();
    expect(matrix).toEqual(expected.matrix);
    restored.offset.copy(image.offset); restored.updateMatrix();
    json = await exportScene(gltf.scene); // also tests shader-created cache fields
  }
});

it('retains fixed matrices and explicit UV matrix opt-in, level/bias/offset/fetch and query links', async () => {
  const image = texture(); image.flipY = false; image.matrixAutoUpdate = false;
  image.matrix.set(1, 0.2, 0.3, 0.4, 2, 0.5, 0, 0, 1);
  const base = TSL.texture(image, TSL.uv(1)); base.setUpdateMatrix(true);
  const source = new MeshPhysicalNodeMaterial();
  source.colorNode = base.level(1); source.colorNode.setUpdateMatrix(true);
  source.emissiveNode = base.bias(0.5);
  source.roughnessNode = base.load(TSL.ivec2(1, 0)).r;
  source.metalnessNode = base.offset(TSL.ivec2(1, 1)).r;
  source.opacityNode = new TextureSizeNode(base, new ConstNode(1, 'int'));
  source.aoNode = new MaxMipLevelNode(base);
  let json = await exportScene(sceneWith(source));
  const original = json.materials[0].extensions[extensionName];
  for (let round = 0; round < 2; round++) {
    const errors = [];
    const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    const m = materialOf(gltf);
    const root = m.colorNode.referenceNode;
    expect(root).toBe(m.emissiveNode.referenceNode);
    expect(root).toBe(m.roughnessNode.node.referenceNode);
    expect(root).toBe(m.metalnessNode.node.referenceNode);
    const resource = root.value;
    root.value = resource.clone();
    expect(m.colorNode.value).toBe(root.value);
    expect(m.emissiveNode.value).toBe(root.value);
    root.value = resource;
    expect(m.colorNode.levelNode.value).toBe(1);
    expect(m.emissiveNode.biasNode.value).toBe(0.5);
    expect(m.roughnessNode.node.sampler).toBe(false);
    expect(m.metalnessNode.node.offsetNode.type).toBe(source.metalnessNode.node.offsetNode.type);
    expect(m.colorNode.updateMatrix).toBe(true);
    expect(root.value.matrix).toEqual(image.matrix);
    root.getTransformedUV(TSL.uv()); root.update();
    expect(root.value.matrix).toEqual(image.matrix);
    expect(m.opacityNode.textureNode).toBe(root);
    expect(m.opacityNode.levelNode.value).toBe(1);
    expect(m.aoNode.textureNode).toBe(root);
    m.aoNode.update(); expect(m.aoNode.value).toBe(1);
    json = await exportScene(gltf.scene);
    expect(json.materials[0].extensions[extensionName]).toEqual(original);
  }
});

it('keeps core/KHR texture-info transforms separate from TSL state and preserves ordinary fallback', async () => {
  const image = texture(); image.flipY = false; image.channel = 1;
  image.colorSpace = SRGBColorSpace; image.offset.set(0.2, 0.3); image.repeat.set(2, 2); image.rotation = 0.4;
  image.updateMatrix();
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.texture(image);
  source.map = image; source.sheen = 1; source.sheenColorMap = image;
  source.clearcoat = 0.6; source.clearcoatMap = image;
  let json = await exportScene(sceneWith(source));
  const info = json.materials[0].pbrMetallicRoughness.baseColorTexture;
  expect(info.texCoord).toBe(1);
  expect(info.extensions.KHR_texture_transform).toEqual({ offset: [0.2, 0.3], scale: [2, 2], rotation: 0.4 });
  for (let round = 0; round < 2; round++) {
    const ordinary = materialOf(await load(json, false));
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    const m = materialOf(gltf);
    for (const key of ['map', 'sheenColorMap', 'clearcoatMap']) {
      expect(m[key].offset.toArray()).toEqual(ordinary[key].offset.toArray());
      expect(m[key].matrix).toEqual(ordinary[key].matrix);
      expect(m[key].channel).toBe(1);
      expect(pixels(m[key].image)).toEqual(pixels(image.image));
    }
    expect(m.colorNode.value).not.toBe(m.map);
    expect(m.colorNode.value.matrix).toEqual(image.matrix);
    expect(m.colorNode.value.colorSpace).toBe(SRGBColorSpace);
    expect(m.isMeshPhysicalNodeMaterial).toBe(true);
    expect(ordinary.isNodeMaterial).toBeUndefined();
    json = await exportScene(gltf.scene);
  }
});

it.each([
  ['missing resource', (e) => { delete e.nodes.n0.links.value; }],
  ['negative texture index', (e) => { e.nodes.n0.links.value.$refTex = -1; }],
  ['out of bounds texture index', (e) => { e.nodes.n0.links.value.$refTex = 100; }],
  ['wrong link kind', (e) => { e.nodes.n0.links.value = { $ref: 'n0' }; }],
  ['invalid channel', (e) => { e.nodes.n0.args.texture.channel = 4; }],
  ['unknown sampling field', (e) => { e.nodes.n0.args.gather = true; }],
  ['invalid matrix', (e) => { e.nodes.n0.args.texture.matrix = [1, 2]; }],
  ['reference cycle', (e) => { delete e.nodes.n0.args.texture; e.nodes.n0.links = { referenceNode: { $ref: 'n0' } }; }],
  ['unknown texture state', (e) => { e.nodes.n0.args.texture.depth = 1; }],
  ['invalid query target', (e) => { e.nodes.bad = { op: 'TextureSizeNode', args: { name: null, global: false, parents: false, precision: null }, links: { textureNode: { $ref: 'literal' } } }; e.nodes.literal = { op: 'ConstNode', args: { value: 1, valueType: 'float' } }; }],
  ['invalid reference target', (e) => { e.nodes.bad = { ...e.nodes.n0, args: { ...e.nodes.n0.args, texture: undefined }, links: { referenceNode: { $ref: 'literal' } } }; e.nodes.literal = { op: 'ConstNode', args: { value: 1, valueType: 'float' } }; }]
])('keeps the entire ordinary textured material on %s', async (_, mutate) => {
  const image = texture(); image.flipY = false; image.offset.set(0.2, 0.3);
  const source = new MeshPhysicalNodeMaterial(); source.map = image; source.clearcoat = 0.7;
  source.colorNode = TSL.texture(image); source.roughnessNode = TSL.float(0.3);
  const json = await exportScene(sceneWith(source));
  mutate(json.materials[0].extensions[extensionName]);
  const errors = []; const failed = materialOf(await load(json, true, errors));
  const ordinary = materialOf(await load(json, false));
  expect(errors).toHaveLength(1);
  expect(failed.type).toBe(ordinary.type);
  expect(failed.colorNode).toBeUndefined(); expect(failed.roughnessNode).toBeUndefined();
  expect(failed.clearcoat).toBe(ordinary.clearcoat);
  expect(failed.map.matrix).toEqual(ordinary.map.matrix);
  expect(pixels(failed.map.image)).toEqual(pixels(ordinary.map.image));
});

it('rejects unsupported sampling modes, resources, callbacks and subclasses explicitly', async () => {
  class CustomTexture extends Texture {}
  class CustomTextureNode extends TextureNode {}
  const modes = [
    (n) => { n.compareNode = TSL.float(0.5); }, (n) => { n.depthNode = TSL.int(0); },
    (n) => { n.gradNode = [TSL.vec2(1), TSL.vec2(1)]; }, (n) => { n.gatherNode = TSL.int(0); },
    (n) => { n._samplerComparison = true; }, (n) => { n.referenceNode = TSL.reference('map', 'texture', {}); },
    (n) => { n.value.type = FloatType; }, (n) => { n.value.format = RedFormat; },
    (n) => { n.value.mipmaps = [{}]; }, (n) => { n.value.premultiplyAlpha = true; },
    (n) => { n.value.userData.external = {}; }, (n) => { n.value.onUpdate = () => {}; },
    (n) => { n.value.toJSON = () => ({}); },
    (n) => { n.groupNode = TSL.frameGroup; }, (n) => { n.onUpdate(() => {}); },
    (n) => { n.value = new CubeTexture(); }, (n) => { n.value = new DataTexture(); },
    (n) => { n.value = new DepthTexture(); }, (n) => { n.value = new WebGLRenderTarget().texture; },
    (n) => { n.value = new CustomTexture(texture().image); },
    (n) => { n.extra = TSL.float(1); }
  ];
  for (const change of modes) {
    const source = new MeshPhysicalNodeMaterial(); source.colorNode = new TextureNode(texture());
    change(source.colorNode);
    await expect(exportScene(sceneWith(source))).rejects.toThrow(/Unsupported|Invalid|invalid/);
  }
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = new CustomTextureNode(texture());
  await expect(exportScene(sceneWith(source))).rejects.toThrow(/Unsupported/);
  source.colorNode = new TextureNode(texture()); source.colorNode.referenceNode = source.colorNode;
  await expect(exportScene(sceneWith(source))).rejects.toThrow(/cyclic/);
});

it('restores TSL color-space intent without changing a shared ordinary color map', async () => {
  const image = texture(); image.flipY = false; image.colorSpace = '';
  const source = new MeshPhysicalNodeMaterial(); source.map = image; source.colorNode = TSL.texture(image);
  const errors = []; const m = materialOf(await load(await exportScene(sceneWith(source)), true, errors));
  expect(errors).toEqual([]);
  expect(m.map.colorSpace).toBe(SRGBColorSpace);
  expect(m.colorNode.value.colorSpace).toBe('');
  expect(m.map).not.toBe(m.colorNode.value);
});

it.each([NearestFilter, LinearFilter, NearestMipmapNearestFilter, NearestMipmapLinearFilter,
  LinearMipmapNearestFilter, LinearMipmapLinearFilter])('preserves glTF minification filter %s and explicit mip-generation intent', async (minFilter) => {
  const image = texture(); image.flipY = false; image.minFilter = minFilter;
  // Deliberately differs from GLTFLoader's inferred value for the two non-mip
  // filters. The TSL copy must restore the authored flag in either case.
  image.generateMipmaps = [NearestFilter, LinearFilter].includes(minFilter);
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.texture(image);
  let json = await exportScene(sceneWith(source));
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    expect(materialOf(gltf).colorNode.value.minFilter).toBe(minFilter);
    expect(materialOf(gltf).colorNode.value.generateMipmaps).toBe(image.generateMipmaps);
    json = await exportScene(gltf.scene);
  }
});

it.each([0, 1, 2, 3])('retains default UV channel %s', async (channel) => {
  const image = texture(); image.channel = channel;
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.texture(image);
  const node = materialOf(await load(await exportScene(sceneWith(source)))).colorNode;
  expect(node.getDefaultUV().getAttributeName()).toBe(channel === 0 ? 'uv' : `uv${channel}`);
});

it.each(['nonuniform rotated scale', 'center', 'custom matrix'])('rejects ordinary fallback transform loss for %s', async (kind) => {
  const image = texture(); image.flipY = false;
  if (kind === 'nonuniform rotated scale') { image.repeat.set(2, 3); image.rotation = 0.4; }
  if (kind === 'center') { image.center.set(0.5, 0.5); image.rotation = 0.4; }
  if (kind === 'custom matrix') { image.matrixAutoUpdate = false; image.matrix.set(1, 0.2, 0, 0, 1, 0, 0, 0, 1); }
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.texture(image); source.map = image;
  await expect(exportScene(sceneWith(source))).rejects.toThrow(/Unsupported ordinary texture transform/);
  // The same transform is fully supported on a TSL-only texture.
  source.map = null;
  expect(materialOf(await load(await exportScene(sceneWith(source)))).colorNode.value.center.toArray()).toEqual(image.center.toArray());
});

it('round-trips embedded PNG image bufferViews through binary glTF', async () => {
  const image = texture(); image.flipY = false;
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = TSL.texture(image);
  let binary = await exportScene(sceneWith(source), true);
  expect(binary).toBeInstanceOf(ArrayBuffer);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(binary, true, errors); expect(errors).toEqual([]);
    expect(pixels(materialOf(gltf).colorNode.value.image)).toEqual(pixels(image.image));
    binary = await exportScene(gltf.scene, true);
  }
});

function shaderFlow(node, output = 'vec4') {
  const builder = new GLSLNodeBuilder(new Mesh(new BoxGeometry(), new MeshPhysicalNodeMaterial()), {
    backend: { isWebGPUBackend: false }, debug: { diagnostics: { keywords: false } }
  });
  builder.setShaderStage('fragment');
  const flow = builder.flowStagesNode(node, output);
  return { result: flow.result, code: flow.code, vertex: builder.flowCode.vertex };
}
it.each(['default', 'level', 'bias', 'offset', 'load', 'size', 'maxMip'])('retains Three.js shader generation for %s', async (mode) => {
  const image = texture(); image.flipY = false;
  const base = TSL.texture(image);
  const nodes = { default: base, level: base.level(1), bias: base.bias(0.5),
    offset: base.offset(TSL.ivec2(1, 0)), load: base.load(TSL.ivec2(0, 1)),
    size: TSL.textureSize(base, TSL.int(1)), maxMip: TSL.maxMipLevel(base) };
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = nodes[mode];
  const output = mode === 'size' ? 'uvec2' : mode === 'maxMip' ? 'float' : 'vec4';
  const expected = shaderFlow(source.colorNode, output);
  expect(expected.result).toBeTruthy();
  let json = await exportScene(sceneWith(source));
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, true, errors); expect(errors).toEqual([]);
    expect(shaderFlow(materialOf(gltf).colorNode, output)).toEqual(expected);
    json = await exportScene(gltf.scene); // serializes nodes after setup caches/updates
  }
});

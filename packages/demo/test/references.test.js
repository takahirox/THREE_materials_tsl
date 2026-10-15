import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, PerspectiveCamera, Color, Vector2, Vector3, Float32BufferAttribute,
  Texture, SRGBColorSpace, ObjectSpaceNormalMap, RGFormat, RepeatWrapping,
  MirroredRepeatWrapping, NearestFilter } from 'three';
import { createCanvas, CanvasElement, Image, ImageData, loadImage } from '@napi-rs/canvas';
import { MaterialNode, ModelNode, Object3DNode, MaterialReferenceNode, MeshPhysicalNodeMaterial,
  MeshBasicNodeMaterial, MeshStandardNodeMaterial, NodeFrame, GLSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@loader';
import { THREEMaterialsTSLExporterPlugin, createDefaultNodeSerializer } from '@exporter';

const extensionName = 'THREE_materials_tsl';
beforeAll(() => {
  vi.stubGlobal('HTMLCanvasElement', CanvasElement);
  vi.stubGlobal('OffscreenCanvas', class extends CanvasElement {
    convertToBlob({ type }) { return Promise.resolve(new Blob([this.toBuffer(type)], { type })); }
  });
  vi.stubGlobal('ImageBitmap', Image); vi.stubGlobal('ImageData', ImageData);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async (blob) => loadImage(Buffer.from(await blob.arrayBuffer())));
  vi.stubGlobal('FileReader', class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.(); }); }
    readAsDataURL(blob) { blob.arrayBuffer().then((value) => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
  });
  vi.stubGlobal('ProgressEvent', class { constructor(type, values) { this.type = type; Object.assign(this, values); } });
});
afterAll(() => vi.unstubAllGlobals());
function sceneWith(...materials) {
  const scene = new Scene();
  for (const material of materials) scene.add(new Mesh(new BoxGeometry(), material));
  return scene;
}
function meshes(scene) { const values = []; scene.traverse((o) => { if (o.isMesh) values.push(o); }); return values; }
async function exportScene(scene, binary = false) {
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: createDefaultNodeSerializer() }));
  return exporter.parseAsync(scene, { binary });
}
async function load(json, errors = [], enabled = true) {
  const loader = new GLTFLoader();
  if (enabled) loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
    nodeResolver: createDefaultNodeResolver(), onError: (e) => errors.push(e)
  }));
  return loader.parseAsync(json instanceof ArrayBuffer ? json : JSON.stringify(json), '');
}
function configured() {
  const m = new MeshPhysicalNodeMaterial();
  m.color.setRGB(0.2, 0.4, 0.6); m.roughness = 0.6; m.metalness = 0.3;
  m.emissive.setRGB(0.2, 0.3, 0.1); m.emissiveIntensity = 2; m.clearcoat = 0.4;
  m.clearcoatRoughness = 0.2; m.sheen = 1; m.sheenColor.setRGB(0.2, 0.3, 0.4);
  m.sheenRoughness = 0.7; m.anisotropy = 0.3; m.anisotropyRotation = 0.2;
  m.iridescence = 0.6; m.iridescenceIOR = 1.4; m.iridescenceThicknessRange = [150, 350];
  m.transmission = 0.2; m.thickness = 0.3; m.attenuationDistance = 2; m.ior = 1.6;
  m.attenuationColor.setRGB(0.8, 0.7, 0.6); m.dispersion = 0.1;
  m.specularIntensity = 0.7; m.specularColor.setRGB(0.9, 0.8, 0.7);
  m.normalScale.set(1, -1); m.clearcoatNormalScale.set(1, -1);
  return m;
}
function shader(node, mesh) {
  const renderer = { backend: { isWebGPUBackend: false }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
  const builder = new GLSLNodeBuilder(mesh, renderer);
  builder.camera = new PerspectiveCamera();
  builder.context.setupNormal = () => TSL.subBuild(mesh.material.setupNormal(builder), 'NORMAL', 'vec3');
  builder.context.setupPositionView = () => mesh.material.setupPositionView(builder);
  builder.setShaderStage('fragment');
  const flow = builder.flowStagesNode(node, node.scope === 'worldMatrix' ? 'mat4' : 'vec4');
  return { builder, code: { result: flow.result, code: flow.code, vertex: builder.flowCode.vertex } };
}
const scopes = ['color', 'opacity', 'alphaTest', 'roughness', 'metalness', 'emissive', 'normal', 'ao',
  'clearcoat', 'clearcoatRoughness', 'clearcoatNormal', 'sheen', 'sheenRoughness', 'anisotropy',
  'iridescence', 'iridescenceIOR', 'iridescenceThickness', 'ior', 'transmission', 'thickness',
  'attenuationDistance', 'attenuationColor', 'dispersion', 'specularIntensity', 'specularColor'];
const properties = {
  color: 'color', opacity: 'float', alphaTest: 'float', roughness: 'float', metalness: 'float',
  emissive: 'color', emissiveIntensity: 'float', normalScale: 'vec2', aoMapIntensity: 'float',
  clearcoat: 'float', clearcoatRoughness: 'float', clearcoatNormalScale: 'vec2', sheen: 'float',
  sheenColor: 'color', sheenRoughness: 'float', anisotropy: 'float', anisotropyRotation: 'float',
  iridescence: 'float', iridescenceIOR: 'float', ior: 'float', transmission: 'float', thickness: 'float',
  attenuationDistance: 'float', attenuationColor: 'color', dispersion: 'float', specularIntensity: 'float', specularColor: 'color'
};
const scopeProperties = Object.fromEntries(scopes.map((scope) => [scope,
  ({ emissive: ['emissive', 'emissiveIntensity'], normal: [], ao: ['aoMapIntensity'],
    clearcoatNormal: [], sheen: ['sheen', 'sheenColor'], anisotropy: ['anisotropy', 'anisotropyRotation'],
    iridescenceThickness: ['iridescenceThicknessRange'] })[scope] ?? [scope]
]));
function snapshot(value) { return value?.toArray ? value.toArray() : Array.isArray(value) ? [...value] : value; }
function updateReference(node, material) {
  expect(node.updateReference({ material })).toBe(material);
  const frame = new NodeFrame(); frame.material = material; frame.updateNode(node);
  return node.node.value;
}

const lossyStates = [
  ['clearcoatRoughness', 'clearcoatRoughness', (m) => { m.clearcoat = 0; m.clearcoatRoughness = 0.7; }],
  ['alphaTest', 'alphaTest', (m) => { m.transparent = true; m.alphaTest = 0.4; }],
  ['normalScale', null, (m) => { m.normalScale.set(2, 3); }],
  ['clearcoatNormalScale', null, (m) => { m.clearcoatNormalScale.set(2, 3); }],
  ['sheen', 'sheen', (m) => { m.sheen = 0.5; }],
  ['alphaTest', 'alphaTest', (m) => { m.alphaTest = -0.2; }],
  ['emissive', 'emissive', (m) => { m.emissive.setRGB(-0.1, -0.2, -0.3); }],
  ['aoMapIntensity', 'ao', (m) => { m.aoMapIntensity = 0.3; }],
  ['sheenColor', 'sheen', (m) => { m.sheen = 0; }],
  ['sheenRoughness', 'sheenRoughness', (m) => { m.sheen = 0; }],
  ['anisotropyRotation', 'anisotropy', (m) => { m.anisotropy = 0; }],
  ['iridescenceIOR', 'iridescenceIOR', (m) => { m.iridescence = 0; }],
  ['thickness', 'thickness', (m) => { m.transmission = 0; }],
  ['attenuationDistance', 'attenuationDistance', (m) => { m.transmission = 0; }],
  ['attenuationColor', 'attenuationColor', (m) => { m.transmission = 0; }],
  ['attenuationDistance', 'attenuationDistance', (m) => { m.attenuationDistance = 0; }]
];
it.each(lossyStates)('rejects live %s state that ordinary glTF transport would change (%s)', async (property, scope, configure) => {
  const source = configured(); configure(source);
  // Establish the actual native transport loss, then require both applicable
  // reference classes to fail export rather than publishing an altered graph.
  const ordinary = meshes((await load(await exportScene(sceneWith(source)), [], false)).scene)[0].material;
  expect(snapshot(ordinary[property])).not.toEqual(snapshot(source[property]));
  const nodes = [new MaterialReferenceNode(property, properties[property])];
  if (scope) nodes.push(new MaterialNode(scope));
  for (const node of nodes) {
    source.colorNode = node;
    await expect(exportScene(sceneWith(source))).rejects.toThrow(/unsupported.*reference/);
  }
});

it('rejects disabled iridescence range state used by MaterialNode', async () => {
  const source = configured(); source.iridescence = 0;
  source.colorNode = new MaterialNode('iridescenceThickness');
  await expect(exportScene(sceneWith(source))).rejects.toThrow(/reference/);
});

function metalRoughScene(shared = false) {
  const source = configured();
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  source.metalnessMap = new Texture(canvas);
  source.roughnessMap = shared ? source.metalnessMap : new Texture(canvas);
  const scene = sceneWith(source); const geometry = scene.children[0].geometry;
  geometry.setAttribute('uv1', new Float32BufferAttribute(
    Array.from(geometry.attributes.uv.array, (v) => v * 0.5 + 0.25), 2));
  return { source, scene };
}

it.each([
  ['channel', (t) => { t.channel = 1; }],
  ['offset', (t) => { t.offset.set(0.25, 0); }],
  ['repeat', (t) => { t.repeat.set(2, 3); }],
  ['rotation', (t) => { t.rotation = 0.5; }],
  ['wrapS', (t) => { t.wrapS = RepeatWrapping; }],
  ['wrapT', (t) => { t.wrapT = MirroredRepeatWrapping; }],
  ['magFilter', (t) => { t.magFilter = NearestFilter; }],
  ['minFilter', (t) => { t.minFilter = NearestFilter; }],
  ['channel', (t) => { t.channel = 1; t.offset.set(0.25, 0); }]
])('rejects roughness MaterialNode when native map packing changes %s', async (property, configure) => {
  const { source, scene } = metalRoughScene(); configure(source.roughnessMap);
  // Establish the native loss independently of the TSL graph: both maps use
  // metalnessMap's sampling after packing, despite separate authored settings.
  const ordinary = meshes((await load(await exportScene(scene), [], false)).scene)[0];
  expect(snapshot(ordinary.material.roughnessMap[property])).toEqual(snapshot(source.metalnessMap[property]));
  expect(snapshot(ordinary.material.roughnessMap[property])).not.toEqual(snapshot(source.roughnessMap[property]));
  expect(ordinary.geometry.attributes.uv1.array).toEqual(scene.children[0].geometry.attributes.uv1.array);
  source.roughnessNode = new MaterialNode('roughness');
  await expect(exportScene(scene)).rejects.toThrow(/roughnessMap.*metalnessMap.*sampling/);
});

it.each([false, true])('preserves matching metal/rough sampling through two round trips (shared texture: %s)', async (shared) => {
  const { source, scene } = metalRoughScene(shared);
  for (const texture of [source.metalnessMap, source.roughnessMap]) {
    texture.channel = 1; texture.offset.set(0.25, 0.125); texture.repeat.set(2, 2); texture.rotation = 0.5;
    texture.wrapS = RepeatWrapping; texture.wrapT = MirroredRepeatWrapping;
    texture.magFilter = NearestFilter; texture.minFilter = NearestFilter;
  }
  source.roughnessNode = new MaterialNode('roughness'); source.metalnessNode = new MaterialNode('metalness');
  let current = scene;
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(await exportScene(current), errors);
    expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0]; const material = mesh.material;
    expect(material.isNodeMaterial).toBe(true);
    for (const scope of ['roughness', 'metalness']) {
      expect(material[`${scope}Node`]).toBeInstanceOf(MaterialNode);
      expect(material[`${scope}Node`].scope).toBe(scope);
      for (const property of ['channel', 'offset', 'repeat', 'rotation', 'wrapS', 'wrapT', 'magFilter', 'minFilter']) {
        expect(snapshot(material[`${scope}Map`][property])).toEqual(snapshot(source[`${scope}Map`][property]));
      }
    }
    expect(mesh.geometry.attributes.uv1.array).toEqual(scene.children[0].geometry.attributes.uv1.array);
    current = gltf.scene;
  }
});

it.each([0, 1])('preserves or rejects the anisotropy map UV channel %s without retargeting', async (channel) => {
  const source = configured();
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  source.anisotropyMap = new Texture(canvas); source.anisotropyMap.channel = channel;
  const scene = sceneWith(source); const geometry = scene.children[0].geometry;
  geometry.setAttribute('uv1', new Float32BufferAttribute(
    Array.from(geometry.attributes.uv.array, (v) => v * 0.5 + 0.25), 2));
  expect(geometry.attributes.uv1.array).not.toEqual(geometry.attributes.uv.array);
  if (channel !== 0) {
    // Native r186 export omits texCoord for this extension's texture, even
    // though the geometry carries a distinct second UV set.
    const ordinary = meshes((await load(await exportScene(scene), [], false)).scene)[0];
    expect(ordinary.geometry.attributes.uv1.array).toEqual(geometry.attributes.uv1.array);
    expect(ordinary.material.anisotropyMap.channel).toBe(0);
    source.colorNode = new MaterialNode('anisotropy');
    await expect(exportScene(scene)).rejects.toThrow(/reference/);
    return;
  }
  source.colorNode = new MaterialNode('anisotropy');
  let current = scene;
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(await exportScene(current), errors);
    expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0];
    expect(mesh.material.isNodeMaterial).toBe(true);
    expect(mesh.material.colorNode.scope).toBe('anisotropy');
    expect(mesh.material.anisotropyMap.channel).toBe(channel);
    expect(mesh.geometry.attributes.uv.array).toEqual(geometry.attributes.uv.array);
    expect(mesh.geometry.attributes.uv1.array).toEqual(geometry.attributes.uv1.array);
    current = gltf.scene;
  }
});

it.each([
  ['clearcoat', 'clearcoatMap'], ['clearcoatRoughness', 'clearcoatRoughnessMap'],
  ['clearcoatNormal', 'clearcoatNormalMap'], ['sheen', 'sheenColorMap'],
  ['sheenRoughness', 'sheenRoughnessMap'], ['anisotropy', 'anisotropyMap'],
  ['iridescence', 'iridescenceMap'], ['iridescenceThickness', 'iridescenceThicknessMap'],
  ['transmission', 'transmissionMap'], ['thickness', 'thicknessMap']
])('rejects omitted %s texture dependencies even when scalar defaults survive', async (scope, map) => {
  const source = new MeshPhysicalNodeMaterial(); source.colorNode = new MaterialNode(scope);
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  source[map] = new Texture(canvas);
  await expect(exportScene(sceneWith(source))).rejects.toThrow(/reference/);
});

it('preserves default values of disabled extensions through both round trips', async () => {
  const source = new MeshPhysicalNodeMaterial();
  const bindings = ['clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'anisotropyRotation',
    'iridescenceIOR', 'thickness', 'attenuationDistance', 'attenuationColor', 'aoMapIntensity'];
  const refs = bindings.map((property) => new MaterialReferenceNode(property, properties[property]));
  source.colorNode = refs.reduce((graph, ref) => graph ? TSL.add(graph, ref) : ref, null);
  source.roughnessNode = new MaterialNode('iridescenceThickness');
  let scene = sceneWith(source);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(await exportScene(scene), errors); expect(errors).toEqual([]);
    const m = meshes(gltf.scene)[0].material;
    expect(m.isNodeMaterial).toBe(true);
    for (const property of bindings) expect(snapshot(m[property])).toEqual(snapshot(source[property]));
    expect(m.iridescenceThicknessRange).toEqual(source.iridescenceThicknessRange);
    scene = gltf.scene;
  }
});

it('validates normal-scale bindings in material arrays', async () => {
  const source = configured(); source.colorNode = new MaterialReferenceNode('normalScale', 'vec2');
  source.normalScale.set(2, 3);
  const scene = sceneWith([configured(), source]); const geometry = scene.children[0].geometry;
  geometry.clearGroups(); geometry.addGroup(0, geometry.index.count, 1);
  await expect(exportScene(scene)).rejects.toThrow(/reference/);
});

it.each(['normalScale', 'clearcoatNormalScale'])('checks %s magnitudes and signs for every shared-material tangent layout', async (property) => {
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  const source = configured(); source[property === 'normalScale' ? 'normalMap' : 'clearcoatNormalMap'] = new Texture(canvas);
  const scope = property === 'normalScale' ? 'normal' : 'clearcoatNormal';
  for (const node of [new MaterialReferenceNode(property, 'vec2'), new MaterialNode(scope)]) {
    source.colorNode = node;
    for (const hasTangent of [false, true]) {
      const scene = sceneWith(source);
      if (hasTangent) scene.children[0].geometry.computeTangents();
      source[property].set(2, 3);
      await expect(exportScene(scene)).rejects.toThrow(/reference/);
      source[property].set(2, hasTangent ? 2 : -2);
      let json = await exportScene(scene);
      for (let round = 0; round < 2; round++) {
        const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
        const mesh = meshes(gltf.scene)[0]; const m = mesh.material;
        const ref = node.isMaterialReferenceNode ? m.colorNode : m.colorNode.setup(shader(m.colorNode, mesh).builder).scaleNode;
        expect(snapshot(updateReference(ref, m))).toEqual(source[property].toArray());
        json = await exportScene(gltf.scene);
      }
    }
    // A shared binding must pass for both meshes, not only whichever material
    // cache entry GLTFExporter happened to create first.
    source[property].set(2, -2);
    const shared = sceneWith(source, source); shared.children[1].geometry.computeTangents();
    await expect(exportScene(shared)).rejects.toThrow(/reference/);
  }
});

it.each([MeshBasicNodeMaterial, MeshStandardNodeMaterial].map((Material) => [Material.type, Material]))('preserves clearcoatNormal without a map across two round trips: %s', async (_, Material) => {
  const source = new Material();
  source.colorNode = new MaterialNode('clearcoatNormal');
  expect(source.clearcoatNormalMap).toBeUndefined();
  expect(source.clearcoatNormalScale).toBeUndefined();
  const scene = sceneWith(source); const expected = shader(source.colorNode, scene.children[0]).code;
  let json = await exportScene(scene); const graph = json.materials[0].extensions[extensionName];
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors);
    expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0]; const material = mesh.material;
    expect(material).toBeInstanceOf(Material);
    expect(material.colorNode).toBeInstanceOf(MaterialNode);
    expect(material.colorNode.scope).toBe('clearcoatNormal');
    expect(material.clearcoatNormalMap).toBeUndefined();
    expect(material.clearcoatNormalScale).toBeUndefined();
    expect(material.colorNode.setup(shader(material.colorNode, mesh).builder)).toBe(TSL.normalView);
    expect(shader(material.colorNode, mesh).code).toEqual(expected);
    json = await exportScene(gltf.scene);
    expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});

it.each(scopes)('preserves MaterialNode scope, sharing and GLSL across two round trips: %s', async (scope) => {
  const source = configured(); source.colorNode = new MaterialNode(scope); source.emissiveNode = source.colorNode;
  const dependencies = scopeProperties[scope];
  const values = dependencies.map((property) => snapshot(source[property]));
  const scene = sceneWith(source); const expected = shader(source.colorNode, scene.children[0]).code;
  let json = await exportScene(scene); const graph = json.materials[0].extensions[extensionName];
  expect(graph.nodes[graph.entrypoints.colorNode].args.scope).toBe(scope);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0]; const m = mesh.material;
    expect(m.isNodeMaterial).toBe(true); expect(m.colorNode).toBe(m.emissiveNode);
    expect(m.colorNode).toBeInstanceOf(MaterialNode); expect(m.colorNode.scope).toBe(scope);
    expect(dependencies.map((property) => snapshot(m[property]))).toEqual(values);
    expect(shader(m.colorNode, mesh).code).toEqual(expected);
    // Exercise the actual material-reference uniforms produced by Three.js setup.
    const setup = m.colorNode.setup(shader(m.colorNode, mesh).builder);
    if (setup.isMaterialReferenceNode) {
      const property = setup.property;
      const old = m[property];
      m[property] = old?.isColor ? new Color(0.1, 0.2, 0.3) : typeof old === 'number' ? old + 0.1 : old;
      expect(updateReference(setup, m)).toBe(m[property]); m[property] = old;
    }
    json = await exportScene(gltf.scene); expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});
it.each(Object.entries(properties))('keeps typed MaterialReferenceNode live across two round trips: %s/%s', async (property, type) => {
  const source = configured(); source.colorNode = new MaterialReferenceNode(property, type);
  const value = snapshot(updateReference(source.colorNode, source));
  source.emissiveNode = source.colorNode;
  const scene = sceneWith(source); const expected = shader(source.colorNode, scene.children[0]).code;
  let json = await exportScene(scene); const graph = json.materials[0].extensions[extensionName];
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0]; const m = mesh.material; const node = m.colorNode;
    expect(node).toBeInstanceOf(MaterialReferenceNode); expect(node).toBe(m.emissiveNode);
    expect(node.property).toBe(property); expect(node.uniformType).toBe(type);
    expect(node.material).toBeNull(); expect(node.object).toBeNull();
    expect(snapshot(updateReference(node, m))).toEqual(value);
    expect(shader(node, mesh).code).toEqual(expected);
    const old = m[property];
    m[property] = type === 'color' ? new Color(0.1, 0.2, 0.3) : type === 'vec2' ? new Vector2(0.4, 0.6) : 0.75;
    expect(updateReference(node, m)).toBe(m[property]);
    const other = configured(); expect(updateReference(node, other)).toBe(other[property]);
    m[property] = old;
    json = await exportScene(gltf.scene); expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});
it.each(['position', 'viewPosition', 'direction', 'scale', 'worldMatrix', 'radius'])('keeps ModelNode %s bound to the current mesh and live transforms', async (scope) => {
  const source = configured(); source.colorNode = new ModelNode(scope); source.emissiveNode = source.colorNode;
  const scene = sceneWith(source, source); const expected = shader(source.colorNode, scene.children[0]).code;
  let json = await exportScene(scene); const graph = json.materials[0].extensions[extensionName];
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const [a, b] = meshes(gltf.scene); expect(a.material).toBe(b.material);
    const node = a.material.colorNode; expect(node).toBe(a.material.emissiveNode); expect(node).toBeInstanceOf(ModelNode);
    expect(shader(node, a).code).toEqual(expected);
    const camera = new PerspectiveCamera(); camera.position.set(3, 4, 5); camera.updateMatrixWorld();
    for (const object of [a, b, a]) {
      object.parent.position.addScalar(0.25); object.parent.updateMatrixWorld(true);
      object.position.addScalar(2); object.scale.multiplyScalar(1.5); object.rotation.y += 0.4; object.updateMatrixWorld();
      const native = new ModelNode(scope); native.update({ object, camera });
      const frame = new NodeFrame(); frame.object = object; frame.camera = camera; frame.updateNode(node);
      expect(node.object3d).toBe(object);
      expect(node.uniformNode.value).toEqual(native.uniformNode.value);
      if (scope === 'position') expect(node.uniformNode.value).toEqual(new Vector3().setFromMatrixPosition(object.matrixWorld));
      if (scope === 'worldMatrix') expect(node.uniformNode.value).toBe(object.matrixWorld);
      if (scope === 'radius') expect(node.uniformNode.value).toBeGreaterThan(1);
    }
    json = await exportScene(gltf.scene); expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});

it('rebinds shared material references to GLTFLoader clones and preserves clone normal-scale updates', async () => {
  const source = configured(); source.colorNode = new MaterialReferenceNode('normalScale', 'vec2');
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  source.normalMap = new Texture(canvas); source.normalScale.set(0.7, -0.7);
  source.emissiveNode = source.colorNode; source.roughnessNode = new MaterialNode('roughness');
  source.positionNode = TSL.vec3(new ModelNode('position'));
  const scene = sceneWith(source, source, source);
  const geometry = scene.children[2].geometry; geometry.deleteAttribute('normal');
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(0.5), 3));
  let json = await exportScene(scene);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const [a, b, c] = meshes(gltf.scene); expect(a.material).toBe(b.material); expect(c.material).not.toBe(a.material);
    expect(c.material.flatShading).toBe(true); expect(c.material.vertexColors).toBe(true);
    const node = a.material.colorNode;
    // Each source glTF material has one graph, shared by its primitive clones.
    if (round === 0) expect(c.material.colorNode).toBe(node);
    expect(a.material.normalScale.toArray()).toEqual([0.7, -0.7]);
    const originalA = a.material.normalScale.clone(), originalC = c.material.normalScale.clone();
    a.material.normalScale.set(0.2, 0.3); c.material.normalScale.set(0.8, -0.8);
    for (const object of [a, c, b]) expect(updateReference(node, object.material)).toBe(object.material.normalScale);
    const roughness = c.material.roughnessNode.getFloat('roughness');
    c.material.roughness = 0.9; a.material.roughness = 0.2;
    for (const object of [a, c, b]) expect(updateReference(roughness, object.material)).toBe(object.material.roughness);
    a.material.normalScale.copy(originalA); c.material.normalScale.copy(originalC);
    json = await exportScene(gltf.scene);
  }
});

it.each(['invalid', '2', null])('atomically retains ordinary materials and clones for malformed normal scale %s', async (scale) => {
  const source = configured(); source.colorNode = new MaterialNode('normal');
  source.emissiveNode = source.colorNode; source.roughnessNode = new MaterialNode('roughness');
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  source.normalMap = new Texture(canvas);
  const scene = sceneWith(source, source, source);
  const geometry = scene.children[2].geometry; geometry.deleteAttribute('normal');
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(0.5), 3));
  const json = await exportScene(scene); json.materials[0].normalTexture.scale = scale;
  const ordinary = await load(json, [], false);
  const errors = [], applied = vi.fn(); const loader = new GLTFLoader();
  loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
    nodeResolver: createDefaultNodeResolver(), onError: (e) => errors.push(e), onApplied: applied
  }));
  const gltf = await loader.parseAsync(JSON.stringify(json), '');
  expect(errors).toHaveLength(1); expect(applied).not.toHaveBeenCalled();
  const actual = meshes(gltf.scene), expected = meshes(ordinary.scene);
  expect(actual[0].material).toBe(actual[1].material);
  expect(actual[2].material).not.toBe(actual[0].material);
  for (let i = 0; i < actual.length; i++) {
    const m = actual[i].material, fallback = expected[i].material;
    expect(m.isNodeMaterial).not.toBe(true);
    for (const slot of ['colorNode', 'emissiveNode', 'roughnessNode']) expect(m[slot]).toBeUndefined();
    for (const property of ['color', 'roughness', 'normalScale', 'transmission', 'sheenColor', 'flatShading', 'vertexColors']) {
      expect(snapshot(m[property])).toEqual(snapshot(fallback[property]));
    }
    expect(m.normalMap.isTexture).toBe(true);
  }
  expect((await gltf.parser.getDependency('material', 0)).isNodeMaterial).not.toBe(true);
});

it('preserves base state, composed shared inputs, default Infinity and GLB encoding', async () => {
  const source = new MeshPhysicalNodeMaterial();
  const ref = Object.assign(new MaterialReferenceNode('attenuationDistance', 'float'), { name: 'distanceRef', global: true, parents: true });
  source.colorNode = ref; source.roughnessNode = TSL.add(ref, new MaterialNode('roughness'));
  source.emissiveNode = source.roughnessNode;
  let scene = sceneWith(source);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(await exportScene(scene, true), errors); expect(errors).toEqual([]);
    const m = meshes(gltf.scene)[0].material;
    expect(m.roughnessNode.node.aNode).toBe(m.colorNode); expect(m.emissiveNode).toBe(m.roughnessNode);
    expect(m.colorNode.name).toBe('distanceRef'); expect(m.colorNode.global).toBe(true); expect(m.colorNode.parents).toBe(true);
    expect(updateReference(m.colorNode, m)).toBe(Infinity); scene = gltf.scene;
  }
});

it('uses imported ordinary textures from MaterialNode setup and keeps current-material values live', async () => {
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  canvas.getContext('2d').fillRect(0, 0, 2, 2);
  const source = configured(); source.map = new Texture(canvas); source.map.colorSpace = SRGBColorSpace;
  source.colorNode = new MaterialNode('color');
  let json = await exportScene(sceneWith(source));
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0]; const m = mesh.material;
    const graph = m.colorNode.setup(shader(m.colorNode, mesh).builder).node;
    expect(graph.op).toBe('*'); expect(graph.bNode.property).toBe('map');
    expect(updateReference(graph.bNode, m)).toBe(m.map);
    m.color.setRGB(0.6, 0.4, 0.2); expect(updateReference(graph.aNode, m)).toBe(m.color);
    expect(shader(m.colorNode, mesh).code.result).toBeTruthy();
    json = await exportScene(gltf.scene);
  }
});

const invalidExports = [
  () => new MaterialNode('constructor'), () => new MaterialNode('size'), () => new MaterialNode('unknown'),
  () => new ModelNode('unknown'), () => new MaterialReferenceNode('roughness', 'vec3'),
  () => new MaterialReferenceNode('map', 'texture'), () => new MaterialReferenceNode('color.r', 'float'),
  () => new MaterialReferenceNode('__proto__', 'float'), () => new MaterialReferenceNode('userData.value', 'float'),
  () => new MaterialReferenceNode('color', 'color', configured()),
  () => Object.assign(new MaterialReferenceNode('roughness', 'float'), { object: configured() }),
  () => Object.assign(new MaterialReferenceNode('roughness', 'float'), { count: 2 }),
  () => Object.assign(new MaterialReferenceNode('roughness', 'float'), { properties: ['metalness'] }),
  () => new MaterialReferenceNode('roughness', 'float').setGroup(TSL.frameGroup),
  () => new MaterialReferenceNode('roughness', 'float').onUpdate(() => 0),
  () => Object.assign(new ModelNode('position'), { updateType: 'frame' }),
  () => Object.assign(new ModelNode('position'), { updateBeforeType: 'object' }),
  () => Object.assign(new MaterialNode('color'), { updateType: 'object' }),
  () => Object.assign(new ModelNode('position'), { extra: TSL.time }),
  () => Object.assign(new ModelNode('position'), { uniformNode: TSL.uniform(1).onUpdate(() => 2) }),
  () => { class CustomModel extends ModelNode {} return new CustomModel('position'); },
  ...['position', 'viewPosition', 'direction', 'scale', 'worldMatrix', 'radius'].flatMap((scope) => [
    () => new Object3DNode(scope), () => new Object3DNode(scope, new Mesh(new BoxGeometry()))
  ])
];
it.each(invalidExports.map((create, i) => [i, create]))('rejects unrepresentable reference variant %s on export', async (_, create) => {
  const m = configured(); m.colorNode = create();
  await expect(exportScene(sceneWith(m))).rejects.toThrow(/Unsupported|unsupported|Invalid/);
});

const invalidGraphs = [
  (e, n) => { n.args.scope = 'unknown'; }, (e, n) => { n.args.scope = '__proto__'; },
  (e, n) => { delete n.args.scope; }, (e, n) => { n.args.nodeType = 'vec3'; },
  (e, n) => { n.args.material = {}; }, (e, n) => { n.args.name = 'code()'; },
  (e, n) => { n.args.global = 1; },
  (e, n) => { n.links = { scope: { $ref: e.entrypoints.roughnessNode } }; },
  (e, n) => { n.op = 'ModelNode'; n.args.scope = 'bad'; },
  (e, n) => { n.op = 'Object3DNode'; n.args.scope = 'position'; },
  (e, n) => { n.op = 'Object3DNode'; n.args.scope = 'position'; n.args.object3d = null; },
  ...[['roughness', 'vec3'], ['constructor', 'float'], ['map', 'texture'], ['userData.foo', 'float'], ['color.r', 'float']].map(([property, uniformType]) =>
    (e, n) => { n.op = 'MaterialReferenceNode'; delete n.args.scope; Object.assign(n.args, { property, uniformType }); }),
  (e) => { e.nodes[e.entrypoints.roughnessNode].links.aNode = { $ref: 'missing' }; },
  (e) => { e.nodes.unreachable = { op: 'Object3DNode', args: { scope: 'position' } }; },
  (e, n) => { n.op = 'materialColor'; n.links = { scope: { $ref: e.entrypoints.roughnessNode } }; },
  (e, n) => { n.op = 'MaterialReferenceNode'; delete n.args.scope; Object.assign(n.args, { property: 'roughness', uniformType: 'float', count: 2 }); }
];
it.each(invalidGraphs.map((mutate, i) => [i, mutate]))('retains full ordinary physical fallback for malformed graph %s', async (_, mutate) => {
  const m = configured(); m.colorNode = new MaterialNode('color'); m.roughnessNode = TSL.add(0.2, 0.3);
  const json = await exportScene(sceneWith(m)); const e = json.materials[0].extensions[extensionName];
  mutate(e, e.nodes[e.entrypoints.colorNode]);
  const ordinary = meshes((await load(json, [], false)).scene)[0].material;
  const errors = []; const actual = meshes((await load(json, errors)).scene)[0].material;
  expect(errors).toHaveLength(1); expect(actual.isNodeMaterial).not.toBe(true);
  for (const property of ['color', 'roughness', 'metalness', 'clearcoat', 'transmission', 'sheenColor', 'specularColor']) expect(actual[property]).toEqual(ordinary[property]);
  expect(actual.colorNode).toBeUndefined(); expect(actual.roughnessNode).toBeUndefined();
  expect(TSL.materialColor.scope).toBe('color');
});

it('rejects failed property bindings on export and atomically retains all primitive clones on import', async () => {
  for (const node of [new MaterialNode('roughness'), new MaterialReferenceNode('roughness', 'float')]) {
    const m = new MeshBasicNodeMaterial(); m.colorNode = node;
    await expect(exportScene(sceneWith(m))).rejects.toThrow(/reference/);
  }
  const m = new MeshBasicNodeMaterial(); m.colorNode = new MaterialNode('color');
  const scene = sceneWith(m, m); scene.children[1].geometry.deleteAttribute('normal');
  const json = await exportScene(scene); const e = json.materials[0].extensions[extensionName];
  e.nodes[e.entrypoints.colorNode].args.scope = 'roughness';
  const errors = []; const gltf = await load(json, errors); expect(errors).toHaveLength(1);
  for (const mesh of meshes(gltf.scene)) expect(mesh.material.isNodeMaterial).not.toBe(true);
  expect((await gltf.parser.getDependency('material', 0)).isNodeMaterial).not.toBe(true);
});


it.each([
  ['MaterialNode', () => new MaterialNode('color')],
  ['ModelNode', () => new ModelNode('position')],
  ['MaterialReferenceNode', () => new MaterialReferenceNode('color', 'color')]
])('preserves base fields and rejects attached private graphs on %s', async (_, create) => {
  const source = configured(); source.colorNode = Object.assign(create(), { name: 'liveReference', global: true, parents: true });
  let scene = sceneWith(source);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(await exportScene(scene), errors); expect(errors).toEqual([]);
    const m = meshes(gltf.scene)[0].material;
    expect(m.colorNode.name).toBe('liveReference'); expect(m.colorNode.global).toBe(true); expect(m.colorNode.parents).toBe(true);
    scene = gltf.scene;
  }
  for (const attach of [
    (n) => n.before(TSL.time), (n) => Object.assign(n, { _custom: { nested: [TSL.time] } }),
    (n) => n.onUpdate(() => 1)
  ]) {
    source.colorNode = attach(create()); await expect(exportScene(sceneWith(source))).rejects.toThrow(/Unsupported|unsupported/);
  }
});

it.each(['color', 'roughness', 'normalScale'])('rejects wrongly typed current-material property %s', async (property) => {
  const source = configured(); source.colorNode = new MaterialReferenceNode(property, properties[property]);
  source[property] = 'invalid';
  await expect(exportScene(sceneWith(source))).rejects.toThrow();
});

it.each([
  ['bump-map normal', (m, texture) => { m.colorNode = new MaterialNode('normal'); m.bumpMap = texture; }],
  ['object-space normal', (m, texture) => { m.colorNode = new MaterialNode('normal'); m.normalMap = texture; m.normalMapType = ObjectSpaceNormalMap; }],
  ['packed normal', (m, texture) => { m.colorNode = new MaterialNode('normal'); m.normalMap = texture; texture.format = RGFormat; }],
  ['separate alpha reference', (m, texture) => { m.colorNode = new MaterialNode('opacity'); m.alphaMap = texture; }],
  ['unrepresentable map transform', (m, texture) => { m.colorNode = new MaterialNode('color'); m.map = texture; texture.center.set(0.5, 0.5); texture.rotation = 0.5; }]
])('rejects MaterialNode setup state outside native glTF transport: %s', async (_, configure) => {
  const canvas = createCanvas(2, 2); Object.defineProperty(canvas, 'data', { value: undefined });
  const m = configured(); configure(m, new Texture(canvas));
  await expect(exportScene(sceneWith(m))).rejects.toThrow(/unsupported|Unsupported/);
});

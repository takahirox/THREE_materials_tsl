import { describe, it, expect } from 'vitest';
import {
  BoxGeometry, BufferAttribute, Color, DoubleSide, Mesh, Scene, Texture,
  MeshPhysicalMaterial, MeshStandardMaterial, Vector2, Vector3, Vector4, Matrix3, Matrix4
} from 'three';
import { ConstNode, MeshBasicNodeMaterial, MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { materialColor, time } from 'three/tsl';
import UniformNode from 'three/src/nodes/core/UniformNode.js';
import NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import OperatorNode from 'three/src/nodes/math/OperatorNode.js';
import MathNode from 'three/src/nodes/math/MathNode.js';
import AttributeNode from 'three/src/nodes/core/AttributeNode.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@loader';
import { THREEMaterialsTSLExporterPlugin, createDefaultNodeSerializer } from '@exporter';

// The real GLTF exporter/loader only need these browser APIs for embedded buffers.
// No renderer, GPU, or approximation of Three.js node reconstruction is used.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((value) => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};
globalThis.ProgressEvent ??= class { constructor(type, values) { this.type = type; Object.assign(this, values); } };

const extensionName = 'THREE_materials_tsl';
function graph() {
  return {
    version: '2.0', materialType: 'MeshPhysicalNodeMaterial',
    entrypoints: { colorNode: 'color', roughnessNode: 'factor' },
    nodes: { color: { op: 'materialColor' }, factor: { op: 'ConstNode', args: { value: 0.3, valueType: 'float', nodeType: 'float' } } }
  };
}
function sceneWith(...materials) {
  const scene = new Scene();
  for (const material of materials) scene.add(new Mesh(new BoxGeometry(), material));
  return scene;
}
async function exportScene(scene, options = {}) {
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: createDefaultNodeSerializer(), ...options }));
  return exporter.parseAsync(scene, { binary: false });
}
async function load(json, options = {}, enabled = true) {
  const loader = new GLTFLoader();
  if (enabled) loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, { nodeResolver: createDefaultNodeResolver(), ...options }));
  return loader.parseAsync(JSON.stringify(json), '');
}
function meshes(scene) {
  const result = [];
  scene.traverse((object) => { if (object.isMesh) result.push(object); });
  return result;
}
function configure(material) {
  material.name = 'ordinary values';
  material.color.setRGB(0.2, 0.4, 0.6);
  material.metalness = 0.67;
  material.roughness = 0.23;
  material.emissive.setRGB(0.1, 0.2, 0.3);
  material.emissiveIntensity = 2.4;
  material.opacity = 0.72;
  material.transparent = true;
  material.side = DoubleSide;
  if (material.isMeshPhysicalMaterial) {
    material.clearcoat = 0.8;
    material.clearcoatRoughness = 0.18;
    material.transmission = 0.6;
    material.thickness = 0.42;
    material.attenuationDistance = 3;
    material.attenuationColor.setRGB(0.3, 0.6, 0.8);
    material.ior = 1.7;
    material.specularIntensity = 0.7;
    material.specularColor.setRGB(0.7, 0.8, 0.9);
    material.sheen = 1;
    material.sheenColor.setRGB(0.2, 0.3, 0.4);
    material.sheenRoughness = 0.4;
    material.iridescence = 0.5;
    material.iridescenceIOR = 1.4;
    material.iridescenceThicknessRange = [120, 360];
    material.anisotropy = 0.3;
    material.anisotropyRotation = 0.7;
    material.dispersion = 0.2;
  }
  return material;
}
const standardProperties = ['name', 'metalness', 'roughness', 'emissiveIntensity', 'opacity', 'transparent', 'side'];
const physicalProperties = ['clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'attenuationDistance', 'ior', 'specularIntensity', 'sheenRoughness', 'iridescence', 'iridescenceIOR', 'anisotropy', 'anisotropyRotation', 'dispersion'];
function expectOrdinary(actual, source) {
  for (const key of standardProperties) expect(actual[key], key).toEqual(source[key]);
  for (const key of ['color', 'emissive']) expect(actual[key].toArray(), key).toEqual(source[key].toArray());
  if (source.isMeshPhysicalMaterial) {
    for (const key of physicalProperties) expect(actual[key], key).toBeCloseTo(source[key]);
    for (const key of ['attenuationColor', 'specularColor', 'sheenColor']) expect(actual[key].toArray(), key).toEqual(source[key].toArray());
    expect(actual.iridescenceThicknessRange).toEqual(source.iridescenceThicknessRange);
  }
}
function expectDynamicColor(material) {
  expect(material.colorNode).toBe(materialColor);
  // Exercise Three.js's actual material reference update, including a replacement
  // Color object and a different material, as happens on shared graph instances.
  const reference = material.colorNode.setup({ context: { material } });
  reference.updateReference({ material });
  reference.updateValue();
  expect(reference.node.value).toBe(material.color);
  material.color = new Color(0.9, 0.3, 0.1);
  reference.updateReference({ material });
  reference.updateValue();
  expect(reference.node.value.toArray()).toEqual([0.9, 0.3, 0.1]);
}

it('exports and twice imports each material type with ordinary core/KHR values and dynamic references', async () => {
  const standard = configure(new MeshStandardNodeMaterial());
  const physical = configure(new MeshPhysicalNodeMaterial());
  for (const material of [standard, physical]) {
    material.colorNode = materialColor;
    const shared = new UniformNode(0.25, 'float');
    material.roughnessNode = new OperatorNode('*', shared, shared);
    material.emissiveNode = new MathNode(MathNode.SIN, time);
    material.positionNode = new AttributeNode('position', 'vec3');
  }
  const json = await exportScene(sceneWith(standard, physical), { includeThreeRevision: true });
  expect(json.materials.map((m) => m.extensions[extensionName].materialType)).toEqual(['MeshStandardNodeMaterial', 'MeshPhysicalNodeMaterial']);
  for (const material of json.materials) {
    expect(material.extensions[extensionName].version).toBe('2.0');
    expect(material.extensions[extensionName].three.revision).toMatch(/^r\d+$/);
  }
  expect(json.materials[1].extensions.KHR_materials_clearcoat.clearcoatFactor).toBe(0.8);
  expect(json.materials[1].extensions.KHR_materials_transmission.transmissionFactor).toBe(0.6);
  const ordinary = await load(json, {}, false);
  const imported = await load(json);
  for (const [index, source] of [standard, physical].entries()) {
    const material = imported.scene.children[index].material;
    expect(material.type).toBe(source.type);
    expectOrdinary(material, source);
    expectOrdinary(ordinary.scene.children[index].material, source);
    expect(ordinary.scene.children[index].material.isNodeMaterial).toBeUndefined();
    expect(material.roughnessNode.aNode).toBe(material.roughnessNode.bNode);
    expect(material.roughnessNode.aNode.value).toBe(0.25);
    expect(material.emissiveNode.aNode).toBe(time);
    expect(material.positionNode.getAttributeName()).toBe('position');
    expectDynamicColor(material);
  }
  const json2 = await exportScene(imported.scene);
  for (let i = 0; i < 2; i++) {
    const first = { ...json.materials[i].extensions[extensionName] };
    delete first.three;
    expect(json2.materials[i].extensions[extensionName]).toEqual(first);
  }
  const imported2 = await load(json2);
  for (let i = 0; i < 2; i++) {
    expectOrdinary(meshes(imported2.scene)[i].material, imported.scene.children[i].material);
    expectDynamicColor(meshes(imported2.scene)[i].material);
  }
});

it('handles shared materials, material arrays, multiple scenes and primitive-specific clones', async () => {
  const material = configure(new MeshPhysicalNodeMaterial());
  material.colorNode = materialColor;
  const scene = sceneWith(material, material, material);
  // First two use the same clone; the third requires a distinct vertex-color / flat clone.
  const geometry = scene.children[2].geometry;
  geometry.deleteAttribute('normal');
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(0.5), 3));
  const json = await exportScene(scene);
  const extraNodes = json.nodes.map((node) => ({ ...node }));
  json.scenes.push({ nodes: extraNodes.map((_, i) => json.nodes.length + i) });
  json.nodes.push(...extraNodes);
  const gltf = await load(json);
  const [a, b, c] = gltf.scene.children;
  expect(a.material).toBe(b.material);
  expect(c.material).not.toBe(a.material);
  expect(c.material.vertexColors).toBe(true);
  expect(c.material.flatShading).toBe(true);
  for (const currentScene of gltf.scenes) for (const mesh of currentScene.children) {
    expectOrdinary(mesh.material, material);
  }
  const sharedMaterials = new Set(gltf.scenes.flatMap((scene) => meshes(scene).map((mesh) => mesh.material)));
  for (const material of sharedMaterials) expectDynamicColor(material);
  const cached = await gltf.parser.getDependency('material', 0);
  expect(cached.type).toBe('MeshPhysicalNodeMaterial');
  expect((await gltf.parser.getDependencies('material'))[0]).toBe(cached);
  expect(gltf.parser.associations.get(a.material).materials).toBe(0);
  expect(gltf.parser.associations.get(c.material).materials).toBe(0);

  const arrayJson = await exportScene(new Mesh(new BoxGeometry(), [material, material, material, material, material, material]));
  const arrayGltf = await load(arrayJson);
  arrayGltf.scene.traverse((object) => {
    if (object.isMesh) expect(object.material.type).toBe('MeshPhysicalNodeMaterial');
  });
});

const failures = {
  'missing version': (e) => { delete e.version; },
  'old encoding': (e) => { e.version = '1.0'; delete e.materialType; },
  'old encoding with a type': (e) => { e.version = '1.0'; },
  'unsupported version': (e) => { e.version = '3.0'; },
  'missing materialType': (e) => { delete e.materialType; },
  'empty materialType': (e) => { e.materialType = ''; },
  'whitespace materialType': (e) => { e.materialType = ' '; },
  'invalid materialType': (e) => { e.materialType = 3; },
  'unknown materialType': (e) => { e.materialType = 'MissingNodeMaterial'; },
  'prototype materialType': (e) => { e.materialType = 'toString'; },
  'incompatible type': (e) => { e.materialType = 'MeshStandardNodeMaterial'; },
  'missing entrypoints': (e) => { delete e.entrypoints; },
  'empty entrypoints': (e) => { e.entrypoints = {}; },
  'invalid entrypoints': (e) => { e.entrypoints = []; },
  'missing nodes': (e) => { delete e.nodes; },
  'invalid nodes': (e) => { e.nodes = []; },
  'missing entrypoint reference': (e) => { e.entrypoints.roughnessNode = 'missing'; },
  'unknown op after a valid entrypoint': (e) => { e.nodes.factor.op = 'UnknownNode'; },
  'unknown unreachable op': (e) => { e.nodes.unreachable = { op: 'UnknownNode' }; },
  'invalid scalar literal': (e) => { e.nodes.factor.args.value = 'not a number'; },
  'invalid vector literal': (e) => { e.nodes.factor.args = { value: [1, 2], valueType: 'vec3' }; },
  'invalid op': (e) => { e.nodes.factor.op = 3; },
  'invalid node': (e) => { e.nodes.factor = null; },
  'broken link': (e) => { e.nodes.factor.links = { aNode: { $ref: 'missing' } }; },
  'cycle': (e) => { e.nodes.factor.links = { aNode: { $ref: 'factor' } }; },
  'indirect cycle': (e) => { e.nodes.other = { op: 'UniformNode', args: { value: 1, valueType: 'float' }, links: { aNode: { $ref: 'factor' } } }; e.nodes.factor.links = { aNode: { $ref: 'other' } }; },
  'invalid links': (e) => { e.nodes.factor.links = []; },
  'invalid link value': (e) => { e.nodes.factor.links = { aNode: 3 }; },
  'out of range texture': (e) => { e.nodes.factor.links = { value: { $refTex: 0 } }; },
  'out of range accessor': (e) => { e.nodes.factor.links = { value: { $refAccessor: 100 } }; },
  'fractional accessor': (e) => { e.nodes.factor.links = { value: { $refAccessor: 0.5 } }; },
  'ambiguous reference': (e) => { e.nodes.factor.links = { value: { $ref: 'color', $refAccessor: 0 } }; },
  'unsupported entrypoint': (e) => { e.entrypoints.color = 'color'; },
  'shared instance mutation': (e) => { e.nodes.color.links = { scope: { $ref: 'factor' } }; }
};

describe('whole-material fallback', () => {
  for (const [name, corrupt] of Object.entries(failures)) it(name, async () => {
    const source = configure(new MeshPhysicalMaterial());
    const json = await exportScene(sceneWith(source, source));
    const extension = graph();
    corrupt(extension);
    json.materials[0].extensions[extensionName] = extension;
    json.extensionsUsed.push(extensionName);
    const errors = [];
    let originals;
    const loader = new GLTFLoader();
    // Observe exact objects before TSL application, not only equivalent values.
    loader.register((parser) => ({ name: 'observe', async afterRoot(result) {
      originals = [result.scene.children[0].material, await parser.getDependency('material', 0)];
    } }));
    loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, { nodeResolver: createDefaultNodeResolver(), onError: (error) => errors.push(error) }));
    const result = await loader.parseAsync(JSON.stringify(json), '');
    const material = result.scene.children[0].material;
    expect(errors).toHaveLength(1);
    expect(material).toBe(originals[0]);
    expect(await result.parser.getDependency('material', 0)).toBe(originals[1]);
    expect(material).toBe(result.scene.children[1].material);
    expect(material.type).toBe('MeshPhysicalMaterial');
    expectOrdinary(material, source);
    expect(material.colorNode).toBeUndefined();
    expect(material.roughnessNode).toBeUndefined();
    expect(materialColor.scope).toBe('color');
  });
});

it('isolates failure to the affected material and supports custom material mappings', async () => {
  class CustomMaterial extends MeshPhysicalNodeMaterial { static get type() { return 'CustomMaterial'; } }
  const source = configure(new MeshPhysicalMaterial());
  const json = await exportScene(sceneWith(source, configure(new MeshStandardMaterial())));
  json.materials[0].extensions[extensionName] = { ...graph(), materialType: 'CustomMaterial' };
  json.materials[1].extensions[extensionName] = { ...graph(), materialType: 'Missing' };
  json.extensionsUsed.push(extensionName);
  const result = await load(json, { materialTypes: { CustomMaterial } });
  expect(result.scene.children[0].material).toBeInstanceOf(CustomMaterial);
  expectOrdinary(result.scene.children[0].material, source);
  expect(result.scene.children[1].material.type).toBe('MeshStandardMaterial');
  for (const Bad of [MeshPhysicalMaterial, class extends MeshPhysicalNodeMaterial { constructor() { throw new Error('bad type'); } }]) {
    const fallback = await load(json, { materialTypes: { CustomMaterial: Bad } });
    expect(fallback.scene.children[0].material.type).toBe('MeshPhysicalMaterial');
  }
});

it('ignores revision metadata, preserves MASK/unlit fallback, and does not require metadata', async () => {
  const material = new MeshBasicNodeMaterial({ color: 0x123456, alphaTest: 0.37 });
  material.colorNode = materialColor;
  const json = await exportScene(sceneWith(material));
  const ext = json.materials[0].extensions[extensionName];
  expect(ext.three).toBeUndefined();
  ext.three = { revision: 'r1' };
  const loaded = await load(json);
  expect(loaded.scene.children[0].material.type).toBe('MeshBasicNodeMaterial');
  expect(loaded.scene.children[0].material.alphaTest).toBe(0.37);
  const fallback = await load(json, {}, false);
  expect(fallback.scene.children[0].material.type).toBe('MeshBasicMaterial');
  expect(fallback.scene.children[0].material.color).toEqual(material.color);
});

it('reconstructs serialized literal values with Three.js semantics', async () => {
  for (const value of [0.4, true, new Color(0.1, 0.2, 0.3), new Vector2(1, 2), new Vector3(1, 2, 3), new Vector4(1, 2, 3, 4), new Matrix3(), new Matrix4()]) {
    for (const Type of [ConstNode, UniformNode]) {
      const material = new MeshStandardNodeMaterial();
      material.colorNode = new Type(value);
      const result = await load(await exportScene(sceneWith(material)));
      const actual = result.scene.children[0].material.colorNode.value;
      expect(actual?.toArray ? actual.toArray() : actual).toEqual(value?.toArray ? value.toArray() : value);
    }
  }
});

describe.each(['ConstNode', 'UniformNode'])('%s without nodeType', (op) => {
  it.each([
    ['float', 0.4], ['bool', true], ['color', [1, 0, 0]],
    ['vec2', [1, 2]], ['vec3', [1, 2, 3]], ['vec4', [1, 2, 3, 4]],
    ['mat2', [1, 0, 0, 1]], ['mat3', new Matrix3().toArray()], ['mat4', new Matrix4().toArray()]
  ])('loads and generates an inferred %s literal', async (valueType, value) => {
    const json = await exportScene(sceneWith(new MeshStandardMaterial()));
    json.materials[0].extensions ??= {};
    json.materials[0].extensions[extensionName] = {
      version: '2.0', materialType: 'MeshStandardNodeMaterial',
      entrypoints: { colorNode: 'literal' },
      nodes: { literal: { op, args: { value, valueType, precision: 'high' } } }
    };
    json.extensionsUsed ??= [];
    json.extensionsUsed.push(extensionName);
    const errors = [];
    const result = await load(json, { onError: (error) => errors.push(error) });
    const material = meshes(result.scene)[0].material;
    expect(errors).toEqual([]);
    expect(material.type).toBe('MeshStandardNodeMaterial');
    const node = material.colorNode;
    expect(node.type).toBe(op);
    expect(node.value?.toArray ? node.value.toArray() : node.value?.elements ?? node.value).toEqual(value);
    expect(node.precision).toBe('high');
    // r186 reads renderer diagnostics when registering uniform declarations.
    // Supply only that setting; literal generation still uses the real NodeBuilder.
    const builder = new NodeBuilder(null, { debug: { diagnostics: { keywords: false } } }, null);
    builder.setShaderStage('fragment');
    expect(node.getNodeType(builder)).toBe(valueType);
    const snippet = node.generate(builder, valueType);
    if (op === 'ConstNode') {
      expect(snippet).toBe(builder.generateConst(valueType, node.value));
    } else {
      expect(snippet).toMatch(/^node(?:Uniform|Var)\d+$/);
      // Three.js stores boolean uniforms as uint and casts them on access.
      expect(builder.uniforms.fragment[0].type).toBe(valueType === 'bool' ? 'uint' : valueType);
      expect(builder.uniforms.fragment[0].value).toBe(node.value);
    }
  });
});

it.each([['!', true, 'bool'], ['~', 5, 'int']])('round-trips unary OperatorNode %s without a second input', async (op, value, nodeType) => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = new OperatorNode(op, new ConstNode(value, nodeType));
  const errors = [];
  let json = await exportScene(sceneWith(material));
  const originalGraph = json.materials[0].extensions[extensionName];
  expect(Object.keys(originalGraph.nodes.n0.links)).toEqual(['aNode']);
  for (let round = 0; round < 2; round++) {
    const imported = await load(json, { onError: (error) => errors.push(error) });
    const actual = meshes(imported.scene)[0].material;
    expect(errors).toEqual([]);
    expect(actual.type).toBe('MeshStandardNodeMaterial');
    expect(actual.colorNode.op).toBe(op);
    expect(actual.colorNode.aNode.value).toBe(value);
    expect(actual.colorNode.aNode.nodeType).toBe(nodeType);
    expect(actual.colorNode.bNode).toBeUndefined();
    json = await exportScene(imported.scene);
    expect(json.materials[0].extensions[extensionName]).toEqual(originalGraph);
  }
});

it.each([
  ['$refTex', 0], ['$refTex', 99], ['$refAccessor', 4], ['$refAccessor', 99]
])('rejects dangling explicit resource reference %s:%i', async (key, index) => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = new ConstNode(0);
  const nodeSerializer = () => ({ op: 'CustomNode', links: { nested: [{ resource: { [key]: index } }] } });
  await expect(exportScene(sceneWith(material), { nodeSerializer })).rejects.toThrow(/resource reference/);
});

it('validates explicit accessor references after later meshes have emitted their resources', async () => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = new ConstNode(0);
  const scene = sceneWith(material, new MeshStandardMaterial());
  const nodeSerializer = () => ({ op: 'AccessorNode', links: { data: { $refAccessor: 4 } } });
  const json = await exportScene(scene, { nodeSerializer });
  expect(json.accessors.length).toBe(8);
  const nodeResolver = createDefaultNodeResolver({ overrides: { AccessorNode: () => new ConstNode(0) } });
  const errors = [];
  const imported = await load(json, { nodeResolver, onError: (error) => errors.push(error) });
  expect(errors).toEqual([]);
  expect(meshes(imported.scene)[0].material.colorNode.data.array).toEqual(scene.children[1].geometry.attributes.position.array);
});

it('rejects invalid export types, unsupported nodes, cycles and unrepresentable links', async () => {
  for (const type of ['', ' ', null, 42, 'NodeMaterial']) {
    const material = new MeshStandardNodeMaterial();
    Object.defineProperty(material, 'type', { value: type });
    material.colorNode = materialColor;
    await expect(exportScene(sceneWith(material))).rejects.toThrow(/material type/);
  }
  const material = new MeshStandardNodeMaterial();
  material.colorNode = new OperatorNode('*', new ConstNode(1), new ConstNode(2));
  material.colorNode.aNode = material.colorNode;
  await expect(exportScene(sceneWith(material))).rejects.toThrow(/cyclic/);
  material.colorNode = { isNode: true, type: 'UnsupportedNode' };
  await expect(exportScene(sceneWith(material))).rejects.toThrow(/Unsupported node/);
  material.colorNode = new ConstNode(1);
  await expect(exportScene(sceneWith(material), { nodeSerializer: () => ({ op: 'CustomNode', links: { invalid: 3 } }) })).rejects.toThrow(/link target/);
  for (const reference of [{ $ref: 'missing' }, { $ref: 'n0' }, { $refTex: -1 }, { $refAccessor: 0.5 }, { $ref: 'n0', $refTex: 0 }]) {
    await expect(exportScene(sceneWith(material), { nodeSerializer: () => ({ op: 'CustomNode', links: { input: reference } }) })).rejects.toThrow(/reference|cyclic/);
  }
  material.colorNode = new UniformNode(new Texture());
  await expect(exportScene(sceneWith(material))).rejects.toThrow(/value type/);
});

it('preserves nested node/texture/accessor links using explicit custom adapters', async () => {
  const texture = new Texture();
  const accessor = new BufferAttribute(new Float32Array([1, 2, 3]), 3);
  const writer = { json: { textures: [{}], accessors: [{}] }, extensionsUsed: {}, processTextureAsync: async (value) => { expect(value).toBe(texture); return 0; }, processAccessor: (value) => { expect(value).toBe(accessor); return 0; } };
  const shared = new ConstNode(0.7, 'float');
  const material = new MeshStandardNodeMaterial();
  material.colorNode = new ConstNode(0);
  const basicSerializer = createDefaultNodeSerializer();
  const plugin = new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: (node) => node === material.colorNode ? {
    op: 'CustomNode', links: { inputs: [{ node: shared }, { tint: { node: shared }, map: { texture }, data: { accessor }, explicitMap: { $refTex: 0 }, explicitData: { $refAccessor: 0 } }] }
  } : basicSerializer(node) });
  const def = {};
  await plugin.writeMaterialAsync(material, def);
  plugin.afterParse();
  const source = new MeshStandardMaterial({ color: 0x123456 });
  const mesh = new Mesh(new BoxGeometry(), source);
  const scene = new Scene(); scene.add(mesh);
  const cache = new Map();
  const parser = { json: { materials: [def], textures: [{}], accessors: [{}] }, associations: new Map([[source, { materials: 0 }]]), cache: { add: (key, value) => cache.set(key, value) }, getDependencies: async () => [source], getDependency: async (type) => type === 'texture' ? texture : accessor };
  const resolver = createDefaultNodeResolver({ overrides: { CustomNode: () => new ConstNode(0) } });
  await new THREEMaterialsTSLLoaderPlugin(parser, { nodeResolver: resolver }).afterRoot({ scenes: [scene] });
  const inputs = mesh.material.colorNode.inputs;
  expect(inputs[0]).toBe(inputs[1].tint);
  expect(inputs[0].value).toBe(0.7);
  expect(inputs[1].map).toBe(texture);
  expect(inputs[1].data).toBe(accessor);
  expect(inputs[1].explicitMap).toBe(texture);
  expect(inputs[1].explicitData).toBe(accessor);
  expect(source.colorNode).toBeUndefined();
  delete writer.processAccessor;
  await expect(plugin.writeMaterialAsync(material, {})).rejects.toThrow(/accessor link/);
});

it('keeps ordinary texture bindings, texture transforms and clone normal scales on success and fallback', async () => {
  const json = await exportScene(sceneWith(configure(new MeshPhysicalMaterial())));
  json.textures = [{}];
  const def = json.materials[0];
  def.pbrMetallicRoughness.baseColorTexture = { index: 0, extensions: { KHR_texture_transform: { offset: [0.2, 0.3], scale: [2, 3] } } };
  def.normalTexture = { index: 0, scale: 0.7 };
  def.extensions.KHR_materials_clearcoat.clearcoatNormalTexture = { index: 0, scale: 0.4 };
  def.extensions[extensionName] = graph();
  json.extensionsUsed.push(extensionName, 'KHR_texture_transform');
  for (const valid of [true, false]) {
    const loader = new GLTFLoader();
    const texture = new Texture();
    texture.flipY = false;
    loader.register(() => ({ name: 'test_texture_source', loadTexture: async () => texture }));
    loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, { nodeResolver: createDefaultNodeResolver() }));
    if (!valid) def.extensions[extensionName].nodes.factor.op = 'UnknownNode';
    const result = await loader.parseAsync(JSON.stringify(json), '');
    const material = result.scene.children[0].material;
    expect(Boolean(material.isNodeMaterial)).toBe(valid);
    expect(material.map.offset.toArray()).toEqual([0.2, 0.3]);
    expect(material.map.repeat.toArray()).toEqual([2, 3]);
    expect(material.normalMap).toBe(texture);
    expect(material.clearcoatNormalMap).toBe(texture);
    expect(material.normalScale.toArray()).toEqual([0.7, -0.7]);
    expect(material.clearcoatNormalScale.toArray()).toEqual([0.4, -0.4]);
  }
});

it('round-trips custom accessor links through real glTF buffers and dependency resolution', async () => {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = new ConstNode(0);
  material.colorNode.data = new BufferAttribute(new Float32Array([0.2, 0.4, 0.6, 0.8]), 2);
  const nodeSerializer = (node) => ({ op: 'AccessorNode', links: { data: { accessor: node.data } } });
  const nodeResolver = createDefaultNodeResolver({ overrides: { AccessorNode: () => new ConstNode(0) } });
  const json = await exportScene(sceneWith(material), { nodeSerializer });
  const imported = await load(json, { nodeResolver });
  const data = imported.scene.children[0].material.colorNode.data;
  expect(data.itemSize).toBe(2);
  expect(data.array).toEqual(material.colorNode.data.array);
  const json2 = await exportScene(imported.scene, { nodeSerializer });
  const imported2 = await load(json2, { nodeResolver });
  expect(meshes(imported2.scene)[0].material.colorNode.data.array).toEqual(data.array);
});

it('falls back after a resolver or dependency throws without retaining successful earlier entrypoints', async () => {
  const json = await exportScene(sceneWith(configure(new MeshPhysicalMaterial())));
  json.materials[0].extensions[extensionName] = graph();
  json.extensionsUsed.push(extensionName);
  const errors = [];
  const resolver = createDefaultNodeResolver({ overrides: { ConstNode: () => { throw new Error('constructor failed'); } } });
  const failed = await load(json, { nodeResolver: resolver, onError: (error) => errors.push(error) });
  expect(errors[0].message).toBe('constructor failed');
  expect(failed.scene.children[0].material.type).toBe('MeshPhysicalMaterial');
  expect(failed.scene.children[0].material.colorNode).toBeUndefined();

  json.textures = [{}];
  json.materials[0].extensions[extensionName].nodes.factor.links = { value: { $refTex: 0 } };
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'failed_texture', loadTexture: async () => { throw new Error('texture failed'); } }));
  loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, { nodeResolver: createDefaultNodeResolver(), onError: (error) => errors.push(error) }));
  const result = await loader.parseAsync(JSON.stringify(json), '');
  expect(errors[1].message).toBe('texture failed');
  expect(result.scene.children[0].material.type).toBe('MeshPhysicalMaterial');
  expect(result.scene.children[0].material.colorNode).toBeUndefined();
});

it('exports ordinary values for a NodeMaterial with no graph and leaves input materials untouched', async () => {
  const source = configure(new MeshPhysicalNodeMaterial());
  const color = source.color;
  const json = await exportScene(sceneWith(source));
  expect(json.materials[0].extensions[extensionName]).toBeUndefined();
  const ordinary = await load(json, {}, false);
  expectOrdinary(ordinary.scene.children[0].material, source);
  expect(source.color).toBe(color);
  expect(source.type).toBe('MeshPhysicalNodeMaterial');
  expect(source.colorNode).toBeNull();
});

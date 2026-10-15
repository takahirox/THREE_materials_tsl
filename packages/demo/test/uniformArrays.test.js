import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Float32BufferAttribute, Mesh, Scene, Color, Vector2, Vector3, Vector4, Matrix3, DoubleSide } from 'three';
import { MeshPhysicalNodeMaterial, UniformArrayNode, BufferNode, BufferAttributeNode, ArrayNode, ConstNode,
  NodeFrame, NodeBuilder, GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary, UniformGroupNode,
  UniformNode, AttributeNode, MathNode, OperatorNode, VarNode, ConvertNode, SubBuildNode } from 'three/webgpu';
import SourceUniformArrayNode from 'three/src/nodes/accessors/UniformArrayNode.js';
import SourceUniformNode from 'three/src/nodes/core/UniformNode.js';
import * as TSL from 'three/tsl';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@loader';
import { THREEMaterialsTSLExporterPlugin, createDefaultNodeSerializer } from '@exporter';
const extensionName = 'THREE_materials_tsl';
beforeAll(() => {
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
function meshes(scene) { const result = []; scene.traverse((o) => { if (o.isMesh) result.push(o); }); return result; }
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

function shader(node, gpu = false, stage = 'fragment', geometry = new BoxGeometry()) {
  const material = new MeshPhysicalNodeMaterial();
  const renderer = { backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
  const Builder = gpu ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(new Mesh(geometry, material), renderer);
  builder.setShaderStage(stage);
  const flow = builder.flowStagesNode(node, node.getNodeType(builder));
  // Normalize native ID-based buffer identifiers only; compare all layout/code.
  const normalize = (s) => s.replace(/NodeBuffer_\d+/g, 'NodeBuffer_ID').replace(/buffer\d+/g, 'bufferID');
  return { result: normalize(flow.result), code: normalize(flow.code),
    vertex: normalize(builder.flowCode.vertex), uniforms: normalize(builder.getUniforms(stage)) };
}
const values = [
  ['float', () => [0, -1.25, 3.4028234663852886e38]],
  ['int', () => [-2147483648, 0, 2147483647]],
  ['uint', () => [0, 1, 4294967295]],
  ['color', () => [new Color(0, 0.25, 1), new Color(2, -0.5, 0)]],
  ['vec2', () => [new Vector2(0, -2), new Vector2(0.5, 4)]],
  ['vec3', () => [new Vector3(0, -2, 3), new Vector3(0.5, 4, 0)]],
  ['vec4', () => [new Vector4(0, -2, 3, 0.5), new Vector4(0.5, 4, 0, 0)]]
];
const fixtures = values.flatMap(([type, create]) => [false, ...(type === 'int' || type === 'uint' ? [] : [true])]
  .map((inferred) => [type, inferred, create]));
it.each(fixtures)('round-trips %s (inferred=%s) twice with native packing, shader flow and per-render updates', async (type, inferred, create) => {
  const array = create();
  const parent = TSL.uniformArray(array, inferred ? undefined : type);
  Object.assign(parent, { global: true, parents: true, precision: 'high' });
  const element = parent.element(0), other = parent.element(TSL.instanceIndex);
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0.3, clearcoat: 0.4 });
  m.color.setRGB(0.2, 0.4, 0.6); m.colorNode = element; m.emissiveNode = element;
  m.roughnessNode = other; m.metalnessNode = element.indexNode;
  let scene = sceneWith(m, m);
  // Export unbuilt, then build and export again. Both must encode only data.
  let json = await exportScene(scene);
  const expectedGraph = json.materials[0].extensions[extensionName];
  const unbuiltArgs = expectedGraph.nodes[expectedGraph.nodes[expectedGraph.entrypoints.colorNode].links.node.$ref].args;
  expect(Object.keys(unbuiltArgs).sort()).toEqual(['array', 'elementType', 'global', 'name', 'nodeType', 'parents', 'precision']);
  const expectedShaders = [false, true].flatMap((gpu) => ['fragment', 'vertex'].map((stage) => shader(element, gpu, stage)));
  expect((await exportScene(scene)).materials[0].extensions[extensionName]).toEqual(expectedGraph);
  const padded = type === 'int' ? 'ivec4' : type === 'uint' ? 'uvec4' : 'vec4';
  const BufferType = type === 'int' ? Int32Array : type === 'uint' ? Uint32Array : Float32Array;
  expect(parent.value).toBeInstanceOf(BufferType); expect(parent.paddedType).toBe(padded);
  const expectedBuffer = Array.from(parent.value);
  const components = array.flatMap((v) => {
    const data = typeof v === 'number' ? [v] : v.toArray();
    return [...data, ...Array(4 - data.length).fill(0)];
  });
  expect(expectedBuffer).toEqual(Array.from(new BufferType(components)));
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const [actual, shared] = meshes(gltf.scene).map((o) => o.material);
    expect(actual).toBe(shared); expect(actual.type).toBe('MeshPhysicalNodeMaterial');
    expect(actual.color.toArray()).toEqual(m.color.toArray()); expect(actual.clearcoat).toBeCloseTo(0.4);
    const a = actual.colorNode, p = a.node;
    expect(a.type).toBe('UniformArrayElementNode'); expect(a).toBe(actual.emissiveNode);
    expect(a).not.toBe(actual.roughnessNode); expect(p).toBe(actual.roughnessNode.node);
    expect(a.indexNode).toBe(actual.metalnessNode); expect(actual.roughnessNode.indexNode).toBe(TSL.instanceIndex);
    expect(p).toBeInstanceOf(UniformArrayNode); expect(p).not.toBe(parent);
    expect(p.array).toEqual(array); expect(p.array).not.toBe(array); expect(p.elementType).toBe(type);
    if (typeof array[0] === 'object') { expect(p.array[0]).toBeInstanceOf(array[0].constructor); expect(p.array[0]).not.toBe(array[0]); }
    expect(p.value).toBeNull(); expect(p.bufferCount).toBe(0); expect(p.updateType).toBe('render');
    expect(p.groupNode).toBe(TSL.objectGroup); expect(p.precision).toBe('high');
    expect([false, true].flatMap((gpu) => ['fragment', 'vertex'].map((stage) => shader(a, gpu, stage)))).toEqual(expectedShaders);
    expect(p.value).toBeInstanceOf(BufferType); expect(p.bufferType).toBe(padded); expect(p.bufferCount).toBe(array.length);
    expect(Array.from(p.value)).toEqual(expectedBuffer);
    const frame = new NodeFrame(); frame.renderId = 1; frame.updateNode(p);
    const saved = typeof p.array[0] === 'number' ? p.array[0] : p.array[0].clone();
    if (typeof p.array[0] === 'number') p.array[0] = 2;
    else if (type === 'color') p.array[0].r = 2;
    else p.array[0].x = 2;
    // Same render is cached; next render uploads the mutated source values.
    frame.updateNode(p); expect(Array.from(p.value)).toEqual(expectedBuffer);
    frame.renderId++; frame.updateNode(p); expect(p.value[0]).toBe(2);
    p.array[0] = saved; frame.renderId++; frame.updateNode(p);
    expect(Array.from(p.value)).toEqual(expectedBuffer);
    expect(parent.array).toBe(array); // snapshot never rebinds the application array
    scene = gltf.scene; json = await exportScene(scene);
    expect(json.materials[0].extensions[extensionName]).toEqual(expectedGraph);
  }
});

it('retains native instance-index shader linkage in the vertex stage through GLB', async () => {
  const m = new MeshPhysicalNodeMaterial();
  m.colorNode = TSL.uniformArray([new Color(1, 0, 0), new Color(0, 1, 0)], 'color').element(TSL.instanceIndex);
  const errors = []; const actual = meshes((await load(await exportScene(sceneWith(m), true), errors)).scene)[0].material.colorNode;
  expect(errors).toEqual([]); expect(actual.indexNode).toBe(TSL.instanceIndex);
  for (const gpu of [false, true]) expect(shader(actual, gpu, 'vertex')).toEqual(shader(m.colorNode, gpu, 'vertex'));
});

it('supports a single element, upper length bound, direct native/source instances and dynamic scalar indices', async () => {
  for (const parent of [new UniformArrayNode([1]), new SourceUniformArrayNode([1]), TSL.uniformArray(Array(4096).fill(1), 'uint')]) {
    const m = new MeshPhysicalNodeMaterial(); m.colorNode = parent.element(parent.array.length - 1);
    const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material.colorNode;
    expect(actual.node.array).toEqual(parent.array);
  }
  const p = TSL.uniformArray([1, 2]); const m = new MeshPhysicalNodeMaterial();
  m.colorNode = p.element(TSL.add(TSL.uniform(0), 1));
  const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material.colorNode;
  expect(actual.indexNode.type).toBe('VarNode'); expect(actual.indexNode.node.type).toBe('OperatorNode');
});

it.each([null, 'float', 'int', 'uint'])('round-trips a populated shared attribute index of type %s twice with native shader linkage', async (type) => {
  const m = new MeshPhysicalNodeMaterial();
  m.roughnessNode = TSL.attribute('_customindex', type);
  m.colorNode = TSL.uniformArray([1, 2]).element(m.roughnessNode);
  let scene = sceneWith(m);
  const geometry = meshes(scene)[0].geometry;
  const values = Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i % 2);
  geometry.setAttribute('_customindex', new Float32BufferAttribute(values, 1));
  const shaders = (node, geometry) => [false, true].flatMap((gpu) => ['fragment', 'vertex'].map((stage) => shader(node, gpu, stage, geometry)));
  const expected = shaders(m.colorNode, geometry);
  for (const gpu of [false, true]) expect(shader(m.colorNode, gpu, 'vertex', geometry).result).toContain('_customindex');
  for (let round = 0; round < 2; round++) {
    const json = await exportScene(scene);
    expect(json.meshes[0].primitives[0].attributes._CUSTOMINDEX).toBeTypeOf('number');
    const errors = []; const gltf = await load(json, errors);
    expect(errors).toEqual([]);
    const mesh = meshes(gltf.scene)[0], actual = mesh.material;
    expect(Array.from(mesh.geometry.getAttribute('_customindex').array)).toEqual(values);
    expect(actual.colorNode.indexNode).toBe(actual.roughnessNode);
    expect(actual.roughnessNode.getAttributeName()).toBe('_customindex');
    expect(actual.roughnessNode.nodeType).toBe(type);
    expect(shaders(actual.colorNode, mesh.geometry)).toEqual(expected);
    scene = gltf.scene;
  }
});

it.each([null, 'float', 'int', 'uint', 'vec2'])('preserves attribute index type %s and shader flow through two round trips', async (type) => {
  const m = new MeshPhysicalNodeMaterial();
  m.roughnessNode = TSL.attribute('uv', type);
  m.colorNode = TSL.uniformArray([0.2, 0.8]).element(TSL.length(m.roughnessNode));
  const shaders = (node) => [false, true].flatMap((gpu) => ['fragment', 'vertex'].map((stage) => shader(node, gpu, stage)));
  const expected = shaders(m.colorNode);
  if (type === 'float') {
    const inferred = TSL.uniformArray([0.2, 0.8]).element(TSL.length(TSL.attribute('uv')));
    expect(expected).not.toEqual(shaders(inferred));
  }
  let scene = sceneWith(m);
  for (let round = 0; round < 2; round++) {
    const json = await exportScene(scene);
    const graph = json.materials[0].extensions[extensionName];
    expect(graph.nodes[graph.entrypoints.roughnessNode].args).toEqual({ attributeName: 'uv', nodeType: type });
    const errors = []; const gltf = await load(json, errors);
    expect(errors).toEqual([]);
    const actual = meshes(gltf.scene)[0].material;
    expect(actual.roughnessNode.nodeType).toBe(type);
    expect(actual.colorNode.indexNode.type).toBe('VarNode');
    expect(actual.colorNode.indexNode.node.aNode).toBe(actual.roughnessNode);
    expect(shaders(actual.colorNode)).toEqual(expected);
    scene = gltf.scene;
  }
});

it.each([123, {}, [], true, null, '', undefined])('rejects malformed attribute index name %j on export', async (name) => {
  for (const index of [TSL.attribute(name, 'uint'), TSL.length(TSL.attribute(name, 'float'))]) {
    const m = new MeshPhysicalNodeMaterial();
    m.colorNode = TSL.uniformArray([0.2, 0.8]).element(index);
    await expect(exportScene(sceneWith(m))).rejects.toThrow();
  }
});

const indexForms = [
  ['direct', (node) => node],
  ['VarNode', (node) => new VarNode(node)],
  ['ConvertNode', (node) => new ConvertNode(node, 'uint')],
  ['SubBuild', (node) => new SubBuildNode(node, 'arrayIndex')],
  ['OperatorNode', (node) => new OperatorNode('+', node, new ConstNode(0))]
];
it.each([...indexForms, ['MathNode', (node) => TSL.length(node)]])('rejects attribute indices renamed by native glTF through %s', async (_, wrap) => {
  for (const name of ['customIndex', 'customindex', '_customIndex', 'color_0', 'texcoord_0', 'morphIndex']) {
    const m = new MeshPhysicalNodeMaterial();
    m.colorNode = TSL.uniformArray([0.2, 0.8]).element(wrap(TSL.attribute(name, 'float')));
    const scene = sceneWith(m), geometry = meshes(scene)[0].geometry;
    geometry.setAttribute(name, new Float32BufferAttribute(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i % 2), 1));
    for (const gpu of [false, true]) expect(JSON.stringify(shader(m.colorNode, gpu, 'vertex', geometry))).toContain(name);
    await expect(exportScene(scene)).rejects.toThrow(/attribute.*index.*name/i);
  }
});
it.each(indexForms)('preserves valid scalar uniform indices through %s twice', async (_, wrap) => {
  for (const Ctor of [UniformNode, SourceUniformNode]) for (const type of [null, 'float', 'int', 'uint']) {
    const m = new MeshPhysicalNodeMaterial();
    m.roughnessNode = new Ctor(1, type);
    m.colorNode = TSL.uniformArray([0.2, 0.8]).element(wrap(m.roughnessNode));
    let scene = sceneWith(m);
    for (let round = 0; round < 2; round++) {
      const errors = []; const gltf = await load(await exportScene(scene), errors);
      expect(errors).toEqual([]);
      const actual = meshes(gltf.scene)[0].material;
      expect(actual.roughnessNode.value).toBe(1);
      expect(actual.roughnessNode.nodeType).toBe(type);
      const index = actual.colorNode.indexNode;
      expect(index === actual.roughnessNode || index.node === actual.roughnessNode || index.aNode === actual.roughnessNode).toBe(true);
      scene = gltf.scene;
    }
  }
});

const invalidScalarInputs = [
  [new Vector2(0, 1), 'vec2', 'uint'],
  [new Color(0, 1, 0), 'color', 'float'],
  [true, 'bool', 'int'],
  [0.5, 'float', 'int'],
  [-1, 'float', 'uint'],
  [2147483648, 'float', 'int'],
  [4294967296, 'float', 'uint']
];
it.each(indexForms)('rejects incompatible scalar input values through %s on export', async (_, wrap) => {
  for (const Ctor of [ConstNode, UniformNode]) for (const [value, , type] of invalidScalarInputs) {
    const m = new MeshPhysicalNodeMaterial();
    m.colorNode = TSL.uniformArray([0.2, 0.8]).element(wrap(new Ctor(value, type)));
    await expect(exportScene(sceneWith(m))).rejects.toThrow();
  }
});

const nativeIndexClasses = [
  [UniformNode, [0, 'uint']], [SourceUniformNode, [0, 'uint']], [ConstNode, [0, 'uint']],
  [AttributeNode, ['customIndex', 'uint']],
  [MathNode, ['abs', new ConstNode(0)]],
  [OperatorNode, ['+', new ConstNode(0), new ConstNode(0)]],
  [VarNode, [new ConstNode(0)]], [ConvertNode, [new ConstNode(0), 'uint']],
  [SubBuildNode, [new ConstNode(0), 'arrayIndex']]
];
it.each(indexForms)('rejects built-in index subclasses with forged operation IDs through %s', async (_, wrap) => {
  for (const [Base, args] of nativeIndexClasses) {
    class CustomIndex extends Base {
      static get type() { return Base.type; }
      generate() { return '1u'; }
    }
    const m = new MeshPhysicalNodeMaterial();
    m.colorNode = TSL.uniformArray([0.2, 0.8]).element(wrap(new CustomIndex(...args)));
    await expect(exportScene(sceneWith(m))).rejects.toThrow();
  }
});

const invalidExports = [
  ...[[], Array(4097).fill(1), [NaN], [Infinity], [1e40], [-0], [true], [null], [1, new Vector2()], new Float32Array([1])].map((v) => () => TSL.uniformArray(v, 'float')),
  ...[['int', [1.5]], ['int', [-2147483649]], ['int', [2147483648]], ['uint', [-1]], ['uint', [4294967296]],
    ['color', [new Vector3()]], ['vec3', [new Color()]], ['vec2', [[1, 2]]], ['vec4', [new Vector3()]],
    ['vec3', [new Vector3(1, NaN, 2)]], ['mat3', [new Matrix3()]], ['bool', [true]], ['ivec2', [new Vector2()]], ['unknown', [1]]]
    .map(([t, a]) => () => TSL.uniformArray(a, t)),
  ...[-1, 0.5, 2, NaN, Infinity].map((index) => () => TSL.uniformArray([1, 2]).element(index)),
  () => TSL.uniformArray([1]).element(TSL.vec2(0)),
  () => TSL.uniformArray([1]).element(TSL.bool(true)),
  () => { const n = TSL.uniformArray([1]).element(0); n.node = new ArrayNode('float', 1); return n; },
  () => { const n = TSL.uniformArray([1]).element(0); n.indexNode = null; return n; },
  () => { class Custom extends UniformArrayNode { static get type() { return 'UniformArrayNode'; } } return new Custom([1]); },
  () => { const n = TSL.uniformArray([1]).element(0); return new (class extends n.constructor { static get type() { return 'UniformArrayElementNode'; } })(n.node, n.indexNode); },
  () => { class CustomVector extends Vector2 {} return TSL.uniformArray([new CustomVector()]); },
  () => Object.assign(TSL.uniformArray([1]), { groupNode: new UniformGroupNode('custom') }),
  () => TSL.uniformArray([1]).setGroup(TSL.renderGroup),
  () => TSL.uniformArray([1]).onRenderUpdate(() => 1),
  () => TSL.uniformArray([1]).onReference(() => ({})),
  () => Object.assign(TSL.uniformArray([1]), { updateBuffer() {} }),
  () => Object.assign(TSL.uniformArray([1]), { updateType: 'frame' }),
  () => Object.assign(TSL.uniformArray([1]), { updateBeforeType: 'render' }),
  () => Object.assign(TSL.uniformArray([1]), { extra: 1 }),
  () => TSL.uniformArray([1]).setName('customBuffer'),
  () => TSL.uniformArray(Object.assign([1], { callback() {} })),
  () => TSL.uniformArray(Object.assign([1], { 4294967295: 2 })),
  () => TSL.uniformArray([Object.assign(new Vector2(), { callback() {} })]),
  () => TSL.uniformArray([Object.assign(new Color(), { isColor: false })], 'color'),
  () => TSL.uniformArray([Object.defineProperty(new Vector2(), 'x', { get: () => 1 })]),
  () => Object.defineProperty(TSL.uniformArray([1]), 'update', { value() {} }),
  () => { const n = TSL.uniformArray([1]).element(0); n.extra = TSL.time; return n; },
  () => { const n = TSL.uniformArray([1]).element(0); n.updateType = 'render'; return n; },
  () => Object.assign(TSL.uniformArray([1]), { _extra: { nested: [TSL.time] } }),
  () => TSL.uniformArray([1]).before(TSL.time),
  () => Object.assign(TSL.uniformArray([1]), { paddedType: 'vec2' }),
  () => Object.assign(TSL.uniformArray([1]), { bufferCount: 1 }),
  () => { const n = TSL.uniformArray([1]); n.addUpdateRange(0, 1); return n; },
  () => new BufferNode(new Float32Array([1]), 'float', 1),
  () => new BufferAttributeNode(new Float32Array([1]), 'float'),
  () => { const n = TSL.uniformArray([1]).element(0); n.indexNode = n; return n; }
];
it.each(invalidExports.map((create, i) => [i, create]))('rejects unsupported export %s', async (_, create) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = create();
  await expect(exportScene(sceneWith(m))).rejects.toThrow();
});

const invalidImports = [
  ...['ConstNode', 'UniformNode'].flatMap((op) => indexForms.flatMap(([form]) =>
    invalidScalarInputs.map(([value, valueType, nodeType]) => (e, p, n) => {
      e.nodes.badIndex = { op, args: { value: value.toArray ? value.toArray() : value, valueType, nodeType, precision: null } };
      let ref = 'badIndex';
      if (form !== 'direct') {
        const args = { nodeType: null, name: null, global: false, parents: false };
        let links = { node: { $ref: ref } };
        if (form === 'VarNode') Object.assign(args, { global: true, readOnly: false, intent: false });
        if (form === 'ConvertNode') args.convertTo = 'uint';
        if (form === 'SubBuild') args.name = 'arrayIndex';
        if (form === 'OperatorNode') {
          e.nodes.zero = { op: 'ConstNode', args: { value: 0, valueType: 'float', nodeType: null, precision: null } };
          links = { aNode: { $ref: ref }, bNode: { $ref: 'zero' } };
        }
        e.nodes.wrappedIndex = { op: form, args: form === 'OperatorNode' ? { op: '+' } : args, links };
        ref = 'wrappedIndex';
      }
      n.links.indexNode = { $ref: ref };
    }))),
  (e, p) => { p.args.array = []; }, (e, p) => { p.args.array = Array(4097).fill(1); },
  (e, p) => { p.args.array = [null]; }, (e, p) => { p.args.array = [[1]]; },
  (e, p) => { p.args.array = [1e40]; }, (e, p) => { p.args.array = [true]; },
  (e, p) => { delete p.args.array; }, (e, p) => { p.args.elementType = 'unknown'; },
  (e, p) => { p.args.elementType = '__proto__'; }, (e, p) => { p.args.elementType = 'uint'; p.args.array = [-1]; },
  (e, p) => { p.args.elementType = 'int'; p.args.array = [0.5]; },
  (e, p) => { p.args.elementType = 'vec2'; p.args.array = [[1, 2, 3]]; },
  (e, p) => { p.args.precision = 'unknown'; }, (e, p) => { p.args.nodeType = 'vec4'; },
  (e, p) => { p.args.name = 'shader()'; }, (e, p) => { p.args.name = 'customBuffer'; }, (e, p) => { p.args.global = 1; },
  (e, p) => { p.args.value = [1, 0, 0, 0]; }, (e, p) => { p.args.updateType = 'none'; },
  (e, p) => { p.links = { groupNode: { $ref: 'objectGroup' } }; },
  (e, p, n) => { n.links.node = { $ref: 'missing' }; },
  (e, p, n) => { n.links.indexNode = { $ref: 'missing' }; },
  (e, p, n) => { n.links.indexNode = { $refTex: 0 }; },
  (e, p, n) => { n.links.indexNode = { $refAccessor: 0 }; },
  (e, p, n) => { n.links.indexNode = [{ $ref: e.entrypoints.roughnessNode }]; },
  (e, p, n) => { n.links.indexNode = { $ref: e.entrypoints.roughnessNode, extra: 1 }; },
  (e, p, n) => { n.links.indexNode = { $ref: e.entrypoints.colorNode }; },
  (e, p, n) => { n.links.node = { $ref: e.entrypoints.roughnessNode }; },
  (e, p, n) => { n.links.indexNode = { $ref: e.entrypoints.metalnessNode }; },
  (e, p, n) => { delete n.links.indexNode; }, (e, p, n) => { n.links.extra = n.links.node; },
  (e, p, n) => { n.args.elementType = 'float'; },
  ...['extra', 'nodeType', 'precision', 'links'].map((mode) => (e, p, n) => {
    const index = { op: 'ConstNode', args: { value: 0, valueType: 'float', nodeType: null } };
    if (mode === 'links') index.links = { extra: { $ref: e.entrypoints.roughnessNode } };
    else index.args[mode] = 'unknown';
    e.nodes.badIndex = index; n.links.indexNode = { $ref: 'badIndex' };
  }),
  ...[-1, 0.5, 2].map((value) => (e, p, n) => {
    e.nodes.badIndex = { op: 'ConstNode', args: { value, valueType: 'float', nodeType: null } };
    n.links.indexNode = { $ref: 'badIndex' };
  }),
  ...[
    ...[123, {}, [], true, null, '', undefined].map((attributeName) => ({ attributeName, nodeType: 'uint' })),
    ...[123, {}, [], false, '', 'unknown'].map((nodeType) => ({ attributeName: 'customIndex', nodeType }))
  ].map((args) => (e, p, n) => {
    e.nodes.badIndex = { op: 'AttributeNode', args };
    n.links.indexNode = { $ref: 'badIndex' };
  }),
  (e) => { e.nodes.unreachable = { op: 'UniformArrayNode', args: {} }; },
  (e) => { e.nodes.unreachable = { op: 'UniformArrayElementNode', args: { nodeType: null, name: '', global: false, parents: false }, links: { node: { $ref: 'missing' }, indexNode: { $ref: 'missing' } } }; },
  (e, p) => { p.op = 'BufferNode'; },
  (e, p, n) => { n.op = 'unknown'; },
  (e, p, n) => { n.links.indexNode = { $ref: 'instanceIndexWithState' }; e.nodes.instanceIndexWithState = { op: 'instanceIndex', args: { nodeType: 'float' } }; }
];
it.each(invalidImports.map((mutate, i) => [i, mutate]))('retains the entire ordinary material atomically for malformed import %s', async (_, mutate) => {
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0.3, clearcoat: 0.4,
    transmission: 0.2, thickness: 0.5, ior: 1.6, transparent: true, opacity: 0.7, side: DoubleSide });
  m.color.setRGB(0.2, 0.4, 0.6); m.emissive.setRGB(0.1, 0.2, 0.3); m.userData = { purpose: 'fallback' };
  m.colorNode = TSL.uniformArray([1, 2]).element(0); m.roughnessNode = TSL.add(0.2, 0.3); m.metalnessNode = TSL.vec2(0.2);
  const json = await exportScene(sceneWith(m)); const e = json.materials[0].extensions[extensionName];
  const n = e.nodes[e.entrypoints.colorNode]; mutate(e, e.nodes[n.links.node.$ref], n);
  const ordinary = meshes((await load(json, [], false)).scene)[0].material;
  const errors = []; const gltf = await load(json, errors); const actual = meshes(gltf.scene)[0].material;
  expect(errors).toHaveLength(1); expect(actual.isNodeMaterial).not.toBe(true);
  expect((await gltf.parser.getDependency('material', 0)).isNodeMaterial).not.toBe(true);
  for (const key of Object.keys(ordinary)) {
    if (['id', 'uuid', 'userData'].includes(key)) continue;
    expect(actual[key], key).toEqual(ordinary[key]);
  }
  const { gltfExtensions, ...extras } = ordinary.userData; expect(actual.userData).toEqual(extras);
  expect(actual.colorNode).toBeUndefined(); expect(actual.roughnessNode).toBeUndefined();
  expect(TSL.instanceIndex.nodeType).toBe('uint');
});

it('exports the current source snapshot even when a built upload buffer is stale', async () => {
  const array = [new Vector3(1, 2, 3)], parent = TSL.uniformArray(array);
  parent.setup(new NodeBuilder());
  array[0].x = 4;
  expect(parent.value[0]).toBe(1);
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = parent.element(0);
  const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material.colorNode.node;
  expect(actual.array[0].toArray()).toEqual([4, 2, 3]);
  array[0].x = 5;
  expect(actual.array[0].x).toBe(4);
  actual.setup(new NodeBuilder());
  actual.array[0].y = 7; actual.updateBuffer();
  expect(Array.from(actual.value)).toEqual([4, 7, 3, 0]);
});

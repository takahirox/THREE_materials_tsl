import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, DoubleSide, Float32BufferAttribute, Vector4 } from 'three';
import { MeshPhysicalNodeMaterial, BufferNode, UniformArrayNode, BufferAttributeNode, StorageBufferNode,
  ArrayElementNode, ConstNode, UniformNode, UniformGroupNode, VarNode, ConvertNode, SubBuildNode, SplitNode,
  OperatorNode, NodeBuilder, GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
import SourceBufferNode from 'three/src/nodes/accessors/BufferNode.js';
import SourceArrayElementNode from 'three/src/nodes/utils/ArrayElementNode.js';
import WebGLBackend from 'three/src/renderers/webgl-fallback/WebGLBackend.js';
import WebGPUBindingUtils from 'three/src/renderers/webgpu/utils/WebGPUBindingUtils.js';
import NodeBuilderState from 'three/src/renderers/common/nodes/NodeBuilderState.js';
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
// Distinct column values expose matrix transposition and count/stride mistakes.
const dataFor = (type, count) => new Float32Array(Array.from({ length: count * (type === 'vec4' ? 4 : 16) }, (_, i) => (i % 31 - 15) / 8));
const bufferFor = (type = 'vec4', count = 2) => TSL.buffer(dataFor(type, count), type, count);
const expression = (element, type) => type === 'mat4' ? TSL.mul(element, TSL.vec4(TSL.positionLocal, 1)).xyz : element.xyz;
const variants = ['vec4', 'mat4'].flatMap((type) => [false, true].flatMap((binary) =>
  [1, 3, type === 'vec4' ? 4096 : 1024].map((count) => [type, binary, count])));
it.each(variants)('round-trips %s twice (GLB=%s, count=%s) with native ordering, expressions and shared links', async (type, binary, count) => {
  const parent = bufferFor(type, count), index = TSL.uniform(count - 1, 'uint');
  const element = parent.element(index), last = parent.element(count - 1);
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0.3, clearcoat: 0.4 });
  m.color.setRGB(0.2, 0.4, 0.6);
  m.positionNode = expression(element, type); m.colorNode = m.positionNode; m.emissiveNode = m.colorNode;
  m.roughnessNode = index; m.normalNode = expression(last, type);
  let scene = sceneWith(m, m);
  const expected = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(m.positionNode, gpu, stage)));
  for (const s of expected) {
    expect(s.uniforms).toContain(type === 'mat4' ? 'mat4' : 'vec4');
    expect(s.uniforms).toContain(String(count));
    expect(s.result + s.code).toContain('[');
    if (type === 'mat4') expect(s.result + s.code).toContain('*');
  }
  const saved = Array.from(parent.value);
  for (let round = 0; round < 2; round++) {
    const json = await exportScene(scene);
    const graph = json.materials[0].extensions[extensionName];
    const buffers = Object.values(graph.nodes).filter((n) => n.op === 'BufferNode');
    expect(buffers).toHaveLength(1);
    expect(buffers[0]).toEqual({ op: 'BufferNode', args: { value: saved, bufferType: type, bufferCount: count } });
    const errors = [], gltf = await load(binary ? await exportScene(scene, true) : json, errors);
    expect(errors).toEqual([]);
    const [actual, shared] = meshes(gltf.scene).map((o) => o.material);
    expect(actual).toBe(shared); expect(actual.type).toBe('MeshPhysicalNodeMaterial');
    expect(actual.colorNode).toBe(actual.positionNode); expect(actual.colorNode).toBe(actual.emissiveNode);
    expect(actual.color.toArray()).toEqual(m.color.toArray()); expect(actual.clearcoat).toBeCloseTo(0.4);
    const found = [];
    actual.positionNode.traverse((n) => { if (n.isArrayElementNode) found.push(n); });
    expect(found).toHaveLength(1);
    const a = found[0], p = a.node;
    expect(a).toBeInstanceOf(ArrayElementNode); expect(a.type).toBe('ArrayElementNode');
    expect(a.indexNode).toBe(actual.roughnessNode);
    expect(p).toBeInstanceOf(BufferNode); expect(p).not.toBeInstanceOf(UniformArrayNode);
    expect(p.value).toBeInstanceOf(Float32Array); expect(p.value).not.toBe(parent.value);
    expect(Array.from(p.value)).toEqual(saved); expect(p.bufferType).toBe(type); expect(p.nodeType).toBe(type); expect(p.bufferCount).toBe(count);
    expect(p.groupNode).toBe(TSL.objectGroup); expect(p.updateType).toBe('none'); expect(p.updateRanges).toEqual([]);
    const others = []; actual.normalNode.traverse((n) => { if (n.isArrayElementNode) others.push(n); });
    expect(others[0].node).toBe(p);
    expect([false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(actual.positionNode, gpu, stage)))).toEqual(expected);
    scene = gltf.scene;
  }
});

it.each(['vec4', 'mat4'])('accepts exact source instances, Float32 subviews and built snapshots for %s', async (type) => {
  const values = dataFor(type, 2), larger = new Float32Array(values.length + 8); larger.set(values, 4);
  for (const Ctor of [BufferNode, SourceBufferNode]) {
    const parent = new Ctor(larger.subarray(4, 4 + values.length), type, 2);
    const Element = Ctor === BufferNode ? ArrayElementNode : SourceArrayElementNode;
    const m = new MeshPhysicalNodeMaterial(); m.colorNode = new Element(parent, new ConstNode(1, 'uint'));
    const scene = sceneWith(m);
    const before = (await exportScene(scene)).materials[0].extensions[extensionName];
    for (const gpu of [false, true]) shader(m.colorNode, gpu);
    expect((await exportScene(scene)).materials[0].extensions[extensionName]).toEqual(before);
    parent.value[0] = 7; // Current source snapshot, including updates after build.
    const json = await exportScene(scene); parent.value[0] = 9;
    const actual = meshes((await load(json)).scene)[0].material.colorNode;
    expect(actual.node.value[0]).toBe(7); expect(actual.node.value.byteOffset).toBe(0);
    expect(actual.node.value).toHaveLength(values.length);
  }
});

it.each(['vec4', 'mat4'])('preserves native instance/vertex index linkage for %s', async (type) => {
  for (const index of [TSL.instanceIndex, TSL.vertexIndex, new TSL.instanceIndex.constructor('instance'), new TSL.vertexIndex.constructor('vertex')]) {
    const m = new MeshPhysicalNodeMaterial(); m.positionNode = expression(bufferFor(type).element(index), type);
    const expected = [false, true].map((gpu) => shader(m.positionNode, gpu, 'vertex'));
    let scene = sceneWith(m);
    for (let round = 0; round < 2; round++) {
      const errors = [], gltf = await load(await exportScene(scene, true), errors); expect(errors).toEqual([]);
      const actual = meshes(gltf.scene)[0].material.positionNode;
      expect([false, true].map((gpu) => shader(actual, gpu, 'vertex'))).toEqual(expected);
      scene = gltf.scene;
    }
  }
});

it.each([false, true].flatMap((gpu) => ['vec4', 'mat4'].map((type) => [gpu, type])))('native buffer bindings follow mutable/replaced values and retain object ownership (WGSL=%s, %s)', async (gpu, type) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = bufferFor(type).element(1);
  const other = new MeshPhysicalNodeMaterial(); other.colorNode = m.colorNode;
  const gltf = await load(await exportScene(sceneWith(m, other)));
  const materials = meshes(gltf.scene).map((o) => o.material);
  const renderer = { backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(), debug: { diagnostics: { keywords: false } } };
  const all = [];
  for (const actual of [m, ...materials]) {
    const builder = new (gpu ? WGSLNodeBuilder : GLSLNodeBuilder)(new Mesh(new BoxGeometry(), actual), renderer);
    builder.setShaderStage('vertex'); builder.flowStagesNode(actual.colorNode, type); builder.sortBindingGroups();
    const bindings = builder.getBindings(), binding = bindings.flatMap((g) => g.bindings).find((b) => b.isNodeUniformBuffer);
    const p = actual.colorNode.node;
    expect(binding.nodeUniform).toBe(p); expect(binding.groupNode).toBe(TSL.objectGroup);
    expect(binding.buffer).toBe(p.value); expect(binding.byteLength).toBe(type === 'mat4' ? 128 : 32); expect(binding.update()).toBe(true);
    const upload = vi.fn(), gpuBuffer = {};
    const uploadValue = () => {
      if (gpu) WebGPUBindingUtils.prototype.updateBinding.call({ backend: {
        get: () => ({ buffer: gpuBuffer }), device: { queue: { writeBuffer: upload } }
      } }, binding);
      else WebGLBackend.prototype.updateBinding.call({ get: () => ({ bufferGPU: gpuBuffer }),
        gl: { UNIFORM_BUFFER: 35345, DYNAMIC_DRAW: 35048, bindBuffer() {}, bufferData: upload }
      }, binding);
      expect(upload.mock.calls.at(-1)[gpu ? 2 : 1]).toBe(p.value);
    };
    uploadValue();
    p.value[5] = 42; expect(binding.buffer[5]).toBe(42); uploadValue();
    p.value = dataFor(type, 2); expect(binding.buffer).toBe(p.value); expect(binding.buffer[5]).not.toBe(42); uploadValue();
    const state = new NodeBuilderState('', '', '', [], bindings, [], [], [], null, false);
    const clones = state.createBindings();
    expect(clones[0]).not.toBe(bindings[0]); expect(clones[0].bindings[0]).not.toBe(bindings[0].bindings[0]);
    expect(clones[0].bindings[0].nodeUniform).toBe(p);
    all.push(binding);
  }
  expect(all[1]).not.toBe(all[2]); expect(all[1].nodeUniform).not.toBe(all[2].nodeUniform);
});

const indexForms = [
  ['direct', (n) => n], ['var', (n) => new VarNode(n)], ['convert', (n) => new ConvertNode(n, 'uint')],
  ['subbuild', (n) => new SubBuildNode(n, 'bufferIndex')], ['operator', (n) => new OperatorNode('+', n, new ConstNode(0))]
];
it.each(indexForms)('retains shared scalar indices through %s', async (_, wrap) => {
  for (const type of ['vec4', 'mat4']) {
    const m = new MeshPhysicalNodeMaterial(); m.roughnessNode = TSL.uniform(1, 'uint');
    m.colorNode = bufferFor(type).element(wrap(m.roughnessNode));
    let scene = sceneWith(m);
    for (let round = 0; round < 2; round++) {
      const errors = [], gltf = await load(await exportScene(scene), errors); expect(errors).toEqual([]);
      const actual = meshes(gltf.scene)[0].material;
      const index = actual.colorNode.indexNode;
      expect(index === actual.roughnessNode || index.node === actual.roughnessNode || index.aNode === actual.roughnessNode).toBe(true);
      for (const gpu of [false, true]) expect(shader(actual.colorNode, gpu)).toEqual(shader(m.colorNode, gpu));
      scene = gltf.scene;
    }
  }
});
it('retains canonical populated geometry indices through two round trips', async () => {
  const m = new MeshPhysicalNodeMaterial(); m.roughnessNode = TSL.attribute('_bufferindex', 'uint');
  m.colorNode = bufferFor().element(m.roughnessNode); let scene = sceneWith(m);
  const geometry = meshes(scene)[0].geometry;
  const indices = Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i % 2);
  geometry.setAttribute('_bufferindex', new Float32BufferAttribute(indices, 1));
  const expected = [false, true].map((gpu) => shader(m.colorNode, gpu, 'vertex', geometry));
  for (let round = 0; round < 2; round++) {
    const gltf = await load(await exportScene(scene)), mesh = meshes(gltf.scene)[0];
    expect(mesh.material.colorNode.indexNode).toBe(mesh.material.roughnessNode);
    expect(Array.from(mesh.geometry.getAttribute('_bufferindex').array)).toEqual(indices);
    expect([false, true].map((gpu) => shader(mesh.material.colorNode, gpu, 'vertex', mesh.geometry))).toEqual(expected);
    scene = gltf.scene;
  }
});
it('preserves draw-index linkage on the native GLSL vertex path', async () => {
  const m = new MeshPhysicalNodeMaterial(); m.positionNode = bufferFor().element(TSL.drawIndex);
  const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material.positionNode;
  expect(actual.indexNode).toBe(TSL.drawIndex);
  // r186 queries native draw support even during Node-side generation.
  const generate = (node) => {
    const renderer = { backend: { isWebGPUBackend: false, extensions: { has: () => true } }, library: new StandardNodeLibrary(),
      hasFeature: () => true, debug: { diagnostics: { keywords: false } } };
    const builder = new GLSLNodeBuilder(new Mesh(new BoxGeometry(), m), renderer); builder.setShaderStage('vertex');
    const flow = builder.flowStagesNode(node, 'vec4');
    return { result: flow.result.replace(/buffer\d+/g, 'bufferID'), code: flow.code };
  };
  expect(generate(actual)).toEqual(generate(m.positionNode));
});

const invalidParents = [
  ...['vec4', 'mat4'].map((type) => () => bufferFor(type, type === 'vec4' ? 4097 : 1025)),
  ...['float', 'int', 'uint', 'vec2', 'vec3', 'mat3', 'bool', 'uvec4', 'unknown', null, undefined, '__proto__']
    .map((type) => () => new BufferNode(new Float32Array(4), type, 1)),
  ...[0, -1, 0.5, NaN, Infinity, '2', 4097].map((count) => () => new BufferNode(new Float32Array(8), 'vec4', count)),
  ...['vec4', 'mat4'].flatMap((type) => [0, 1, 5, 15, 17, 16385].map((length) => () => new BufferNode(new Float32Array(length), type, 1))),
  ...[[], [1, 2, 3, 4], [[1, 2, 3, 4]], [new Vector4()], new ArrayBuffer(16), new DataView(new ArrayBuffer(16)),
    new Float64Array(4), new Int32Array(4), new Uint32Array(4), new Uint8Array(4)]
    .map((value) => () => new BufferNode(value, 'vec4', 1)),
  ...[NaN, Infinity, -Infinity, -0].map((value) => () => { const n = bufferFor(); n.value[0] = value; return n; }),
  () => { const n = bufferFor(); n.nodeType = 'mat4'; return n; },
  () => { const n = bufferFor(); n.precision = 'high'; return n; },
  () => { const n = bufferFor(); n.global = true; return n; },
  () => { const n = bufferFor(); n.parents = true; return n; },
  () => { const n = bufferFor(); n.name = 'appLabel'; return n; },
  () => { const n = bufferFor(); n.groupNode = TSL.renderGroup; return n; },
  () => { const n = bufferFor(); n.groupNode = TSL.frameGroup; return n; },
  () => { const n = bufferFor(); n.groupNode = new UniformGroupNode('object'); return n; },
  () => { const n = bufferFor(); n.groupNode = { ...TSL.objectGroup }; return n; },
  () => bufferFor().onRenderUpdate(() => 1), () => bufferFor().onReference(() => ({})),
  () => Object.assign(bufferFor(), { updateType: 'frame' }),
  () => Object.assign(bufferFor(), { updateBeforeType: 'object' }),
  () => Object.assign(bufferFor(), { updateAfterType: 'render' }),
  () => Object.assign(bufferFor(), { extra: 1 }),
  () => Object.assign(bufferFor(), { _extra: { node: TSL.time } }),
  () => Object.defineProperty(bufferFor(), 'update', { value() {} }),
  () => { const n = bufferFor(); n.addUpdateRange(0, 1); return n; },
  () => { const n = bufferFor(); n.updateRanges.extra = 1; return n; },
  () => Object.assign(bufferFor(), { updateRanges: Array(1) }),
  () => Object.assign(bufferFor(), { updateRanges: null }),
  () => { const n = bufferFor(); n.value.extra = 1; return n; },
  () => { const n = bufferFor(); n.value[Symbol('extra')] = 1; return n; },
  () => { const n = bufferFor(); n[Symbol('extra')] = 1; return n; },
  () => { class Custom extends BufferNode { static get type() { return 'BufferNode'; } } return new Custom(new Float32Array(4), 'vec4', 1); },
  () => { class Custom extends Float32Array {} return new BufferNode(new Custom(4), 'vec4', 1); },
  () => bufferFor().before(TSL.time),
  () => new BufferAttributeNode(new Float32Array(4), 'vec4'),
  () => new StorageBufferNode(new Float32Array(4), 'vec4', 1),
  () => new BufferNode(new Float32Array(new SharedArrayBuffer(16)), 'vec4', 1)
];
it.each(invalidParents.map((create, i) => [i, create]))('rejects unsupported buffer export %s', async (_, create) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = create();
  await expect(exportScene(sceneWith(m))).rejects.toThrow();
});
const invalidElements = [
  ...[-1, 0.5, 2, NaN, Infinity, -0].flatMap((index) => indexForms.slice(0, 4).map(([, wrap]) => () => bufferFor().element(wrap(new ConstNode(index))))),
  () => bufferFor().element(TSL.vec2(0)), () => bufferFor().element(TSL.bool(true)),
  () => bufferFor().element(new UniformNode(new Vector4(), 'float')),
  () => bufferFor().element(TSL.length(new ConstNode(true, 'float'))),
  () => bufferFor().element(TSL.attribute('customIndex', 'uint')),
  () => bufferFor().element(TSL.length(TSL.attribute('customIndex', 'vec2'))),
  () => { const n = bufferFor().element(0); n.node = new ConstNode(0); return n; },
  () => { const n = bufferFor().element(0); n.indexNode = null; return n; },
  () => { const n = bufferFor().element(0); n.indexNode = n; return n; },
  () => { const n = bufferFor().element(0); n.extra = TSL.time; return n; },
  () => { const n = bufferFor().element(0); n._extra = { node: TSL.time }; return n; },
  () => { const n = bufferFor().element(0); n.nodeType = 'float'; return n; },
  () => { const n = bufferFor().element(0); n.extra = 1; return n; },
  () => { const n = bufferFor().element(0); n.onRenderUpdate(() => 1); return n; },
  () => { class Custom extends ArrayElementNode { static get type() { return 'ArrayElementNode'; } } return new Custom(bufferFor(), new ConstNode(0)); },
  () => { class Custom extends ConstNode { static get type() { return 'ConstNode'; } } return bufferFor().element(new Custom(0)); }
];
it.each(invalidElements.map((create, i) => [i, create]))('rejects invalid buffer element export %s', async (_, create) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = create(); await expect(exportScene(sceneWith(m))).rejects.toThrow();
});
const invalidImports = [
  ...['vec3', 'mat3', '__proto__', null, 123].map((v) => (e, p) => { p.args.bufferType = v; }),
  ...[0, -1, 0.5, 4097, '2', null].map((v) => (e, p) => { p.args.bufferCount = v; }),
  ...[[], [0], [null, 0, 0, 0, 0, 0, 0, 0], [true, 0, 0, 0, 0, 0, 0, 0], [1e40, 0, 0, 0, 0, 0, 0, 0], [0.1, 0, 0, 0, 0, 0, 0, 0], [-1e-50, 0, 0, 0, 0, 0, 0, 0], [[0, 0, 0, 0], [0, 0, 0, 0]], {}, 'buffer']
    .map((v) => (e, p) => { p.args.value = v; }),
  ...['value', 'bufferType', 'bufferCount'].map((key) => (e, p) => { delete p.args[key]; }),
  ...['nodeType', 'precision', 'global', 'parents', 'name', 'updateType', 'updateRanges', 'groupNode', 'extra', 'code']
    .map((key) => (e, p) => { p.args[key] = key === 'updateRanges' ? [{ start: 0, count: 1 }] : 'unknown'; }),
  (e, p) => { p.args = null; }, (e, p) => { p.args = []; },
  (e, p) => { p.links = { groupNode: { $ref: e.entrypoints.roughnessNode } }; },
  (e, p) => { p.links = { value: { $refAccessor: 0 } }; },
  ...['node', 'indexNode'].flatMap((key) => [
    (e, p, n) => { delete n.links[key]; },
    (e, p, n) => { n.links[key] = { $ref: 'missing' }; },
    (e, p, n) => { n.links[key] = { $ref: e.entrypoints.colorNode }; },
    (e, p, n) => { n.links[key] = [{ $ref: e.entrypoints.roughnessNode }]; },
    (e, p, n) => { n.links[key] = { $refTex: 0 }; },
    (e, p, n) => { n.links[key] = { $refAccessor: 0 }; },
    (e, p, n) => { n.links[key] = { $ref: e.entrypoints.roughnessNode, extra: 1 }; }
  ]),
  (e, p, n) => { n.links.extra = n.links.node; },
  (e, p, n) => { n.args.extra = 1; }, (e, p, n) => { n.args.nodeType = 'float'; },
  (e, p, n) => { n.links.node = { $ref: e.entrypoints.roughnessNode }; },
  (e, p, n) => { n.links.indexNode = n.links.node; },
  ...[-1, 0.5, 2].flatMap((index) => ['direct', 'var', 'convert', 'subbuild'].map((mode) => (e, p, n) => {
    e.nodes.badIndex = { op: 'ConstNode', args: { value: index, valueType: 'float', nodeType: null } };
    let ref = 'badIndex';
    if (mode !== 'direct') {
      e.nodes.wrapped = { op: { var: 'VarNode', convert: 'ConvertNode', subbuild: 'SubBuild' }[mode],
        args: { nodeType: null, name: mode === 'subbuild' ? 'bufferIndex' : null, global: false, parents: false,
          ...(mode === 'var' ? { readOnly: false, intent: false } : mode === 'convert' ? { convertTo: 'uint' } : {}) }, links: { node: { $ref: ref } } };
      ref = 'wrapped';
    }
    n.links.indexNode = { $ref: ref };
  })),
  (e, p, n) => { e.nodes.bad = { op: 'ConstNode', args: { value: [0, 0], valueType: 'vec2', nodeType: null } }; n.links.indexNode = { $ref: 'bad' }; },
  (e, p, n) => { e.nodes.bad = { op: 'UniformNode', args: { value: [0, 0, 0, 0], valueType: 'vec4', nodeType: 'float' } }; n.links.indexNode = { $ref: 'bad' }; },
  (e) => { e.nodes.unreachable = { op: 'BufferNode', args: {} }; },
  (e, p, n) => { e.nodes.unreachable = structuredClone(n); e.nodes.unreachable.links.indexNode = n.links.node; },
  (e, p, n) => { e.nodes.unreachable = structuredClone(n); e.nodes.unreachable.links.node = { $ref: 'missing' }; },
  (e, p) => { e.nodes.unreachable = structuredClone(p); e.nodes.unreachable.args.bufferCount = 0; },
  (e, p, n) => { e.nodes.unreachable = structuredClone(n); e.nodes.unreachable.links.node = { $ref: 'unreachable' }; }
];
it.each(invalidImports.map((mutate, i) => [i, mutate]))('retains full ordinary material atomically for malformed buffer import %s', async (_, mutate) => {
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0.3, clearcoat: 0.4, transmission: 0.2,
    thickness: 0.5, ior: 1.6, transparent: true, opacity: 0.7, side: DoubleSide });
  m.color.setRGB(0.2, 0.4, 0.6); m.emissive.setRGB(0.1, 0.2, 0.3); m.userData = { purpose: 'buffer fallback' };
  m.colorNode = bufferFor().element(0); m.emissiveNode = m.colorNode; m.roughnessNode = TSL.uniform(0.5);
  const json = await exportScene(sceneWith(m, m)), e = json.materials[0].extensions[extensionName];
  const n = e.nodes[e.entrypoints.colorNode]; mutate(e, e.nodes[n.links.node.$ref], n);
  const ordinary = meshes((await load(json, [], false)).scene)[0].material;
  const errors = [], gltf = await load(json, errors), [actual, shared] = meshes(gltf.scene).map((o) => o.material);
  expect(errors).toHaveLength(1); expect(actual).toBe(shared); expect(actual.isNodeMaterial).not.toBe(true);
  expect((await gltf.parser.getDependency('material', 0)).isNodeMaterial).not.toBe(true);
  for (const key of Object.keys(ordinary)) {
    if (['id', 'uuid', 'userData'].includes(key)) continue;
    expect(actual[key], key).toEqual(ordinary[key]);
  }
  const { gltfExtensions, ...extras } = ordinary.userData; expect(actual.userData).toEqual(extras);
  expect(actual.colorNode).toBeUndefined(); expect(actual.emissiveNode).toBeUndefined(); expect(actual.roughnessNode).toBeUndefined();
});

it.each(['vec4', 'mat4'])('retains finite Float32 boundaries and rejects pending partial uploads for %s', async (type) => {
  const p = bufferFor(type, 1);
  p.value.set([Math.fround(3.4028234663852886e38), -Math.fround(3.4028234663852886e38), Math.fround(1.401298464324817e-45), 0]);
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = p.element(0);
  let scene = sceneWith(m);
  for (let round = 0; round < 2; round++) {
    const errors = [], gltf = await load(await exportScene(scene, true), errors); expect(errors).toEqual([]);
    const actual = meshes(gltf.scene)[0].material.colorNode.node;
    expect(Array.from(actual.value)).toEqual(Array.from(p.value));
    actual.addUpdateRange(0, 4);
    await expect(exportScene(gltf.scene)).rejects.toThrow();
    actual.clearUpdateRanges();
    scene = gltf.scene;
  }
});

it.each(['vec4', 'mat4'])('retains nested native component/column access for %s', async (type) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = bufferFor(type, 1).element(0).element(3);
  const expected = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(m.colorNode, gpu, stage)));
  let scene = sceneWith(m);
  for (let round = 0; round < 2; round++) {
    const errors = [], gltf = await load(await exportScene(scene), errors); expect(errors).toEqual([]);
    const actual = meshes(gltf.scene)[0].material.colorNode;
    expect(actual.node.node).toBeInstanceOf(BufferNode);
    expect([false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(actual, gpu, stage)))).toEqual(expected);
    scene = gltf.scene;
  }
});
it('keeps ordinary ArrayElementNode access to existing UniformArrayNode buffers', async () => {
  const m = new MeshPhysicalNodeMaterial();
  m.colorNode = new ArrayElementNode(TSL.uniformArray([1, 2, 3, 4, 5]), new ConstNode(4, 'uint'));
  const errors = [], gltf = await load(await exportScene(sceneWith(m)), errors); expect(errors).toEqual([]);
  const actual = meshes(gltf.scene)[0].material.colorNode;
  expect(actual.node).toBeInstanceOf(UniformArrayNode);
  for (const gpu of [false, true]) expect(shader(actual, gpu)).toEqual(shader(m.colorNode, gpu));
});

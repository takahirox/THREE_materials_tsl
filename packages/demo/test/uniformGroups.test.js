import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, MeshStandardMaterial, DoubleSide } from 'three';
import { MeshPhysicalNodeMaterial, UniformNode, UniformGroupNode, NodeFrame,
  GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
import SourceUniformNode from 'three/src/nodes/core/UniformNode.js';
import SourceUniformGroupNode, { objectGroup as sourceObjectGroup, renderGroup as sourceRenderGroup,
  frameGroup as sourceFrameGroup } from 'three/src/nodes/core/UniformGroupNode.js';
import NodeManager from 'three/src/renderers/common/nodes/NodeManager.js';
import NodeBuilderState from 'three/src/renderers/common/nodes/NodeBuilderState.js';
import * as TSL from 'three/tsl';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@loader';
import { THREEMaterialsTSLExporterPlugin, createDefaultNodeSerializer } from '@exporter';

const extensionName = 'THREE_materials_tsl';
const groups = ['objectGroup', 'renderGroup', 'frameGroup'];
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
function shader(node, gpu = false, stage = 'fragment', renderer) {
  const material = new MeshPhysicalNodeMaterial();
  renderer ??= { backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
  const Builder = gpu ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(new Mesh(new BoxGeometry(), material), renderer);
  builder.setShaderStage(stage);
  const flow = builder.flowStagesNode(node, node.getNodeType(builder));
  builder.sortBindingGroups();
  builder.buildUpdateNodes();
  return { builder, code: { result: flow.result, code: flow.code, uniforms: builder.getUniforms(stage) } };
}

const fixtures = groups.flatMap((group) => [false, true].flatMap((binary) =>
  [UniformNode, SourceUniformNode].map((Ctor) => [group, binary, Ctor === UniformNode ? 'bundle' : 'source', Ctor])));
it.each(fixtures)('round-trips %s twice (GLB=%s, %s) with sharing, ordinary materials and native shaders', async (op, binary, _, Ctor) => {
  const m = new MeshPhysicalNodeMaterial({ clearcoat: 0.4, roughness: 0.6 });
  m.colorNode = new Ctor(0.25).setGroup(TSL[op]);
  m.emissiveNode = m.colorNode;
  m.roughnessNode = new Ctor(0.75).setGroup(TSL[op]);
  m.positionNode = TSL.vec3(m.colorNode, m.colorNode, m.colorNode);
  m.opacityNode = TSL.time;
  const other = new MeshPhysicalNodeMaterial(); other.colorNode = m.colorNode;
  const ordinary = new MeshStandardMaterial({ roughness: 0.2 });
  let scene = sceneWith(m, m, other, ordinary);
  const expected = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(m.positionNode, gpu, stage).code));
  for (let round = 0; round < 2; round++) {
    const json = await exportScene(scene);
    const graph = json.materials[0].extensions[extensionName];
    const a = graph.nodes[graph.entrypoints.colorNode], b = graph.nodes[graph.entrypoints.roughnessNode];
    expect(a.args).toEqual({ value: 0.25, valueType: 'float', nodeType: null, precision: null });
    if (op === 'objectGroup') {
      expect(a.links).toBeUndefined(); expect(b.links).toBeUndefined();
      expect(Object.values(graph.nodes).filter((n) => groups.includes(n.op))).toHaveLength(0);
    } else {
      expect(a.links).toEqual(b.links);
      expect(graph.nodes[a.links.groupNode.$ref]).toEqual({ op });
      expect(Object.values(graph.nodes).filter((n) => n.op === op)).toHaveLength(1);
    }
    const errors = []; const gltf = await load(binary ? await exportScene(scene, true) : json, errors);
    expect(errors).toEqual([]);
    const [actual, shared, independent, plain] = meshes(gltf.scene).map((o) => o.material);
    expect(actual).toBe(shared); expect(actual).not.toBe(independent);
    expect(actual.colorNode).toBe(actual.emissiveNode);
    expect(actual.colorNode).not.toBe(actual.roughnessNode);
    expect(actual.colorNode.groupNode).toBe(TSL[op]); expect(actual.roughnessNode.groupNode).toBe(TSL[op]);
    expect(independent.colorNode.groupNode).toBe(TSL[op]);
    expect(actual.opacityNode).toBe(TSL.time);
    expect(actual.colorNode.updateType).toBe('none');
    expect(actual.clearcoat).toBeCloseTo(0.4); expect(actual.roughness).toBeCloseTo(0.6);
    expect(plain.isNodeMaterial).not.toBe(true); expect(plain.roughness).toBeCloseTo(0.2);
    expect(actual.positionNode.node.nodes).toEqual([actual.colorNode, actual.colorNode, actual.colorNode]);
    expect([false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(actual.positionNode, gpu, stage).code))).toEqual(expected);
    scene = gltf.scene;
  }
});

it('keeps native source defaults and explicit objectGroup imports compatible with omission', async () => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = new SourceUniformNode(0.5);
  expect(m.colorNode.groupNode).toBe(sourceObjectGroup);
  const json = await exportScene(sceneWith(m)), e = json.materials[0].extensions[extensionName];
  const n = e.nodes[e.entrypoints.colorNode]; expect(n.links).toBeUndefined();
  e.nodes.explicitDefault = { op: 'objectGroup' }; n.links = { groupNode: { $ref: 'explicitDefault' } };
  const errors = [], gltf = await load(json, errors); expect(errors).toEqual([]);
  expect(meshes(gltf.scene)[0].material.colorNode.groupNode).toBe(TSL.objectGroup);
  const next = (await exportScene(gltf.scene)).materials[0].extensions[extensionName];
  expect(next.nodes[next.entrypoints.colorNode].links).toBeUndefined();
});

it.each([false, true])('preserves native group ordering, binding reuse/ownership and scheduling (WGSL=%s)', async (gpu) => {
  const m = new MeshPhysicalNodeMaterial();
  // Deliberately encounter object before the two order=0 groups.
  m.colorNode = TSL.uniform(1).setGroup(TSL.objectGroup);
  m.roughnessNode = TSL.uniform(2).setGroup(TSL.renderGroup);
  m.metalnessNode = TSL.uniform(3).setGroup(TSL.frameGroup);
  const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material;
  const nodes = [actual.colorNode, actual.roughnessNode, actual.metalnessNode];
  const expression = TSL.vec3(...nodes);
  const renderer = { backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
  const { builder, code } = shader(expression, gpu, 'fragment', renderer);
  const bindings = builder.getBindings();
  expect(bindings.map((b) => b.name)).toEqual(['render', 'frame', 'object']);
  expect(bindings.map((b) => b.bindings[0].groupNode.order)).toEqual([0, 0, 1]);
  expect(code.uniforms).toContain(gpu ? 'var<uniform> render' : 'render {');
  expect(code.uniforms).toContain(gpu ? 'var<uniform> frame' : 'frame {');
  expect(code.uniforms).toContain(gpu ? 'var<uniform> object' : 'object {');
  for (const group of groups.map((op) => TSL[op])) expect(builder.updateNodes).toContain(group);
  const another = shader(expression, gpu, 'fragment', renderer).builder.getBindings();
  for (const b of bindings) {
    const reused = another.find((x) => x.name === b.name);
    if (b.name === 'object') expect(reused).not.toBe(b);
    else expect(reused).toBe(b);
  }
  const state = new NodeBuilderState('', '', '', [], bindings, [], [], [], null, false);
  const clones = state.createBindings();
  expect(clones[0]).toBe(bindings[0]); expect(clones[1]).toBe(bindings[1]);
  expect(clones[2]).not.toBe(bindings[2]);
  expect(clones[2].bindings[0].groupNode).toBe(TSL.objectGroup);

  const frame = new NodeFrame(), manager = new NodeManager({}, {});
  frame.frameId = 1; frame.renderId = 1;
  const versions = nodes.map((n) => n.groupNode.version);
  const update = () => { for (const n of nodes) frame.updateNode(n.groupNode); };
  update(); expect(nodes.map((n, i) => n.groupNode.version - versions[i])).toEqual([1, 1, 1]);
  for (const binding of bindings) expect(manager.updateGroup(binding.bindings[0])).toBe(true);
  update(); expect(nodes.map((n, i) => n.groupNode.version - versions[i])).toEqual([2, 1, 1]);
  expect(bindings.map((b) => manager.updateGroup(b.bindings[0]))).toEqual([false, false, true]);
  frame.renderId++; update();
  expect(nodes.map((n, i) => n.groupNode.version - versions[i])).toEqual([3, 2, 1]);
  expect(bindings.map((b) => manager.updateGroup(b.bindings[0]))).toEqual([true, false, true]);
  frame.frameId++; frame.renderId++; update();
  expect(nodes.map((n, i) => n.groupNode.version - versions[i])).toEqual([4, 3, 2]);
  expect(bindings.map((b) => manager.updateGroup(b.bindings[0]))).toEqual([true, true, true]);
  // Bindings read live imported uniform values through native upload buffers.
  for (const n of nodes) {
    const binding = bindings.find((b) => b.name === n.groupNode.name).bindings[0];
    binding.update(); const offset = binding.uniforms[0].offset;
    expect(binding.buffer[offset]).toBe(n.value);
    n.value += 10; binding.update(); expect(binding.buffer[offset]).toBe(n.value);
  }
  // Runtime group version changes never become serialized arguments.
  const e = (await exportScene(sceneWith(actual))).materials[0].extensions[extensionName];
  for (const op of ['renderGroup', 'frameGroup']) expect(Object.values(e.nodes).find((n) => n.op === op)).toEqual({ op });
});

const independentGroups = [
  ...[UniformGroupNode, SourceUniformGroupNode].flatMap((Ctor) => [
    new Ctor('custom'), new Ctor('custom', false, 1, 'object'),
    new Ctor('custom', true, 0, 'frame'), new Ctor('custom', true, 0, 'render'),
    new Ctor('object', false, 1, 'object'), new Ctor('render', true, 0, 'render'),
    new Ctor('frame', true, 0, 'frame'), new Ctor('custom', false, -1, null)
  ]),
  TSL.uniformGroup('custom'), TSL.sharedUniformGroup('custom'), sourceRenderGroup, sourceFrameGroup,
  { isNode: true, isUniformGroup: true, type: 'UniformGroupNode', name: 'render' },
  new (class extends UniformGroupNode { static get type() { return 'UniformGroupNode'; } })('custom'),
  new (class extends UniformGroupNode { static get type() { return 'renderGroup'; } })('render'),
  TSL.float(1), null, undefined
];
it.each(independentGroups.map((g, i) => [i, g]))('rejects unsupported or forged groups on export %s', async (_, group) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = TSL.uniform(1).setGroup(group);
  await expect(exportScene(sceneWith(m))).rejects.toThrow();
});

const invalidUniforms = [
  (n) => { n.extra = 1; }, (n) => { n.global = true; }, (n) => { n.parents = true; },
  (n) => n.setName('custom'), (n) => n.onFrameUpdate(() => 1),
  (n) => { n.updateType = 'render'; }, (n) => { n.updateBeforeType = 'object'; },
  (n) => { n.updateAfterType = 'frame'; }, (n) => { n.extra = TSL.time; },
  (n) => { n._extra = { nested: [TSL.time] }; }, (n) => n.before(TSL.time),
  (n) => { n.groupNode = n; }, (n) => { delete n.groupNode; },
  (n) => Object.defineProperty(n, 'update', { value() {} }),
  (n) => { n[Symbol('extra')] = 1; }
];
it.each(invalidUniforms.map((mutate, i) => [i, mutate]))('rejects unrepresented UniformNode state %s', async (_, mutate) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = TSL.uniform(1).setGroup(TSL.renderGroup); mutate(m.colorNode);
  await expect(exportScene(sceneWith(m))).rejects.toThrow();
});
it('rejects UniformNode subclasses even with a forged built-in operation ID', async () => {
  for (const Base of [UniformNode, SourceUniformNode]) {
    class Forged extends Base { static get type() { return 'UniformNode'; } }
    const m = new MeshPhysicalNodeMaterial(); m.colorNode = new Forged(1).setGroup(TSL.frameGroup);
    await expect(exportScene(sceneWith(m))).rejects.toThrow();
  }
});
it.each(groups)('rejects altered singleton configuration and callbacks for %s, including default omission', async (op) => {
  const group = TSL[op], m = new MeshPhysicalNodeMaterial(); m.colorNode = TSL.uniform(1).setGroup(group);
  for (const [key, value] of [['name', 'changed'], ['shared', !group.shared], ['order', 2], ['updateType', 'none'],
    ['updateBeforeType', 'frame'], ['updateAfterType', 'render'], ['extra', 1], ['update', () => {}], ['extraLink', TSL.time]]) {
    const descriptor = Object.getOwnPropertyDescriptor(group, key);
    try {
      group[key] = value;
      await expect(exportScene(sceneWith(m))).rejects.toThrow();
      expect(() => createDefaultNodeSerializer()(group)).toThrow();
    } finally {
      if (descriptor) Object.defineProperty(group, key, descriptor); else delete group[key];
    }
  }
});

const invalidImports = [
  ...[null, {}, [], 'group', 0, { $refTex: 0 }, { $refAccessor: 0 }, { $ref: 0 }, { $ref: '' },
    { $ref: 'missing' }, [{ $ref: 'group' }], { nested: { $ref: 'group' } }, { $ref: 'group', extra: 1 }]
    .map((value) => (e, n) => { n.links.groupNode = value; }),
  (e, n) => { n.links.groupNode = { $ref: e.entrypoints.colorNode }; },
  (e, n) => { n.links.groupNode = { $ref: e.entrypoints.roughnessNode }; },
  (e, n) => { n.links = { aNode: n.links.groupNode }; },
  (e, n) => { n.links.extra = n.links.groupNode; },
  (e, n) => { n.args.groupNode = 'renderGroup'; },
  ...['updateType', 'updateBeforeType', 'updateAfterType', 'version', 'shared', 'order', 'unknown']
    .map((field) => (e, n) => { n.args[field] = field === 'order' || field === 'version' ? 0 : 'frame'; }),
  ...['groupNode', 'updateType', 'unknown'].map((field) => (e, n) => { n[field] = 'frame'; }),
  ...groups.flatMap((op) => [
    ...[null, {}, [], { name: 'custom' }, { shared: true }, { order: 0 }, { updateType: 'frame' }, { version: 10 }, { unknown: 1 }]
      .map((args) => (e, n, g) => { g.op = op; g.args = args; }),
    (e, n, g) => { g.op = op; g.links = { extra: { $ref: e.entrypoints.roughnessNode } }; },
    (e, n, g) => { g.op = op; g.unknown = 1; }
  ]),
  (e, n, g) => { g.op = 'UniformGroupNode'; g.args = { name: 'custom', shared: false, order: 1, updateType: 'object' }; },
  (e, n, g) => { g.op = 'unknownGroup'; },
  (e, n, g) => { g.links = { extra: { $ref: e.entrypoints.colorNode } }; },
  (e) => { e.nodes.unreachable = { op: 'frameGroup', args: { version: 2 } }; },
  (e) => { e.nodes.unreachable = { op: 'UniformNode', args: { value: 1, valueType: 'float' }, links: { groupNode: { $ref: 'missing' } } }; },
  (e) => { e.nodes.unreachable = { op: 'UniformNode', args: { value: 1, valueType: 'float' }, links: { groupNode: { $ref: 'unreachable' } } }; },
  (e) => { e.nodes.unreachable = { op: 'renderGroup', links: { extra: { $ref: 'missing' } } }; }
];
it.each(invalidImports.map((mutate, i) => [i, mutate]))('retains the complete ordinary material for malformed group import %s', async (_, mutate) => {
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0.3, clearcoat: 0.4, transmission: 0.2,
    thickness: 0.5, ior: 1.6, transparent: true, opacity: 0.7, side: DoubleSide });
  m.color.setRGB(0.2, 0.4, 0.6); m.emissive.setRGB(0.1, 0.2, 0.3); m.userData = { purpose: 'fallback' };
  m.colorNode = TSL.uniform(0.5).setGroup(TSL.renderGroup); m.emissiveNode = m.colorNode;
  m.roughnessNode = TSL.float(0.25); m.positionNode = TSL.vec3(m.colorNode);
  const json = await exportScene(sceneWith(m, m)); const e = json.materials[0].extensions[extensionName];
  const n = e.nodes[e.entrypoints.colorNode]; mutate(e, n, e.nodes[n.links.groupNode.$ref]);
  const ordinary = meshes((await load(json, [], false)).scene)[0].material;
  const versions = groups.map((op) => TSL[op].version);
  const errors = [], gltf = await load(json, errors), [actual, shared] = meshes(gltf.scene).map((o) => o.material);
  expect(errors).toHaveLength(1); expect(actual.isNodeMaterial).not.toBe(true); expect(shared).toBe(actual);
  // GLTFLoader can create mesh-specific ordinary clones (for example missing tangents).
  expect((await gltf.parser.getDependency('material', 0)).isNodeMaterial).not.toBe(true);
  for (const key of Object.keys(ordinary)) {
    if (['id', 'uuid', 'userData'].includes(key)) continue;
    expect(actual[key], key).toEqual(ordinary[key]);
  }
  const { gltfExtensions, ...extras } = ordinary.userData; expect(actual.userData).toEqual(extras);
  for (const slot of Object.keys(e.entrypoints)) expect(actual[slot]).toBeUndefined();
  expect(groups.map((op) => TSL[op].version)).toEqual(versions);
});

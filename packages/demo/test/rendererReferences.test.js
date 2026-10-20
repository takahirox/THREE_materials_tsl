import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, Float32BufferAttribute, Vector3, MeshStandardMaterial } from 'three';
import { RendererReferenceNode, UniformNode, UniformGroupNode, MeshPhysicalNodeMaterial, NodeFrame,
  GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
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
function meshes(scene) { const result = []; scene.traverse((o) => { if (o.isMesh) result.push(o); }); return result; }
async function exportScene(scene, binary = false, options = {}) {
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: createDefaultNodeSerializer(), ...options }));
  return exporter.parseAsync(scene, { binary });
}
async function load(json, errors = [], enabled = true, prepare) {
  const loader = new GLTFLoader();
  if (prepare) loader.register(prepare);
  if (enabled) loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
    nodeResolver: createDefaultNodeResolver(), onError: (e) => errors.push(e)
  }));
  // Mark TSL as recognized in the ordinary control too, so its payload is not
  // added as unknown-extension userData solely because the adapter is disabled.
  else loader.register(() => ({ name: extensionName }));
  return loader.parseAsync(json instanceof ArrayBuffer || typeof json === 'string' ? json : JSON.stringify(json), '');
}

const args = { property: 'toneMappingExposure', uniformType: 'float' };
function fixture(clones = false) {
  const material = new MeshPhysicalNodeMaterial({ clearcoat: 0.4, roughness: 0.6,
    metalness: 0.3, transmission: 0.2, thickness: 0.3, ior: 1.6, transparent: true, opacity: 0.7 });
  material.color.setRGB(0.2, 0.4, 0.6);
  material.colorNode = TSL.rendererReference('toneMappingExposure', 'float');
  material.emissiveNode = material.colorNode;
  material.roughnessNode = new RendererReferenceNode('toneMappingExposure', 'float');
  material.positionNode = TSL.vec3(material.colorNode, material.colorNode, material.roughnessNode);
  material.opacityNode = TSL.toneMappingExposure;
  const scene = new Scene(), geometry = new BoxGeometry();
  scene.add(new Mesh(geometry, material));
  const second = clones ? geometry.clone() : geometry;
  if (clones) {
    second.deleteAttribute('normal');
    second.setAttribute('color', new Float32BufferAttribute(Array(second.attributes.position.count * 3).fill(1), 3));
  }
  scene.add(new Mesh(second, material));
  scene.add(new Mesh(geometry, new MeshStandardMaterial({ roughness: 0.25 })));
  return { scene, material };
}
function renderer(gpu = false, exposure = 2) {
  return { toneMappingExposure: exposure, backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
}
function update(node, active, frame = new NodeFrame()) {
  frame.renderer = active;
  frame.updateNode(node); // Calls the real updateReference and object-frequency update.
  expect(node.reference).toBe(active);
  expect(node.node.value).toBe(active.toneMappingExposure);
  expect(node.node.groupNode).toBe(TSL.renderGroup);
  return frame;
}
function shader(node, mesh, gpu, stage, active = renderer(gpu)) {
  const builder = new (gpu ? WGSLNodeBuilder : GLSLNodeBuilder)(mesh, active);
  builder.setShaderStage(stage);
  const flow = builder.flowStagesNode(node, 'vec3'); // Native setup/analyze/generate.
  builder.sortBindingGroups(); builder.buildUpdateNodes();
  return { builder, code: { result: flow.result, code: flow.code, uniforms: builder.getUniforms(stage) } };
}

it.each([false, true].flatMap((binary) => [false, true].map((built) => [binary, built])))(
  'round-trips distinct current-renderer instances twice with sharing and live values (GLB=%s, built=%s)', async (binary, built) => {
    const { scene, material } = fixture();
    const source = material.colorNode;
    const expected = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) =>
      shader(material.positionNode, scene.children[0], gpu, stage).code));
    if (!built) {
      // Use fresh, truly unbuilt instances for the first export.
      const fresh = fixture(); scene.children[0].material = scene.children[1].material = fresh.material;
    }
    let current = scene;
    for (let round = 0; round < 3; round++) {
      const [a, b, plain] = meshes(current), m = a.material, node = m.colorNode;
      expect(m).toBe(b.material);
      expect(node).toBeInstanceOf(RendererReferenceNode);
      expect(node).toBe(m.emissiveNode);
      expect(node).not.toBe(m.roughnessNode); expect(node).not.toBe(TSL.toneMappingExposure);
      expect(m.roughnessNode).not.toBe(TSL.toneMappingExposure);
      expect(m.positionNode.node.nodes).toEqual([node, node, m.roughnessNode]);
      expect(m.opacityNode).toBe(TSL.toneMappingExposure);
      expect(node.renderer).toBeNull(); expect(node.object).toBeNull();
      expect(node.group).toBe(TSL.renderGroup); expect(node.updateType).toBe('object');
      if (round > 0) {
        expect(node).not.toBe(source); expect(node.node).toBeNull(); expect(node.reference).toBeNull();
      }
      if (round === 0 && !built) expect(node.node).toBeNull();
      for (const key of ['clearcoat', 'transmission', 'thickness', 'ior', 'roughness', 'metalness', 'opacity']) expect(m[key]).toBeCloseTo(material[key]);
      expect(m.transparent).toBe(true); expect(m.color.toArray()).toEqual(material.color.toArray());
      expect(plain.material.isNodeMaterial).not.toBe(true); expect(plain.material.roughness).toBeCloseTo(0.25);
      // Export the first unbuilt graph before any reference or shader update.
      const unbuilt = round === 0 && !built ? await exportScene(current, binary) : null;
      const active = renderer(false, 3 + round), other = renderer(false, 7 + round);
      const frame = update(node, active);
      active.toneMappingExposure += 0.5;
      update(node, active, frame); // Same frame/render IDs: OBJECT must still update.
      update(node, other, frame); // No producer renderer retained.
      update(m.roughnessNode, active, frame);
      expect(node.node).not.toBe(m.roughnessNode.node);
      expect([false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) =>
        shader(m.positionNode, a, gpu, stage).code))).toEqual(expected);
      if (round === 2) break;
      const json = await exportScene(current), e = json.materials[0].extensions[extensionName];
      expect(e.version).toBe('2.0'); expect(e.materialType).toBe('MeshPhysicalNodeMaterial');
      expect(e.nodes[e.entrypoints.colorNode]).toEqual({ op: 'RendererReferenceNode', args });
      expect(e.nodes[e.entrypoints.roughnessNode]).toEqual({ op: 'RendererReferenceNode', args });
      expect(e.entrypoints.colorNode).toBe(e.entrypoints.emissiveNode);
      expect(e.nodes[e.entrypoints.opacityNode]).toEqual({ op: 'toneMappingExposure' });
      expect(Object.values(e.nodes).filter((n) => n.op === 'RendererReferenceNode')).toHaveLength(2);
      expect(Object.values(e.nodes).some((n) => ['UniformNode', 'renderGroup'].includes(n.op))).toBe(false);
      expect(json.materials[0].extensions.KHR_materials_clearcoat).toBeDefined();
      const errors = [];
      current = (await load(unbuilt ?? (binary ? await exportScene(current, true) : json), errors)).scene;
      expect(errors).toEqual([]);
    }
  }
);

it.each([false, true])('preserves native GLSL/WGSL uniform bindings, group behavior and live packed values (WGSL=%s)', async (gpu) => {
  const { scene } = fixture();
  const imported = (await load(await exportScene(scene))).scene, mesh = meshes(imported)[0], m = mesh.material;
  const active = renderer(gpu, 1.5), { builder, code } = shader(m.positionNode, mesh, gpu, 'fragment', active);
  const a = m.colorNode, b = m.roughnessNode;
  expect(a.reference).toBe(active); expect(b.reference).toBe(active);
  expect(a.node.value).toBe(1.5); expect(a.node.nodeType).toBe('float');
  expect(a.node.updateType).toBe('none'); expect(a.node.updateBeforeType).toBe('none'); expect(a.node.updateAfterType).toBe('none');
  expect(builder.updateNodes).toContain(a); expect(builder.updateNodes).toContain(b); expect(builder.updateNodes).toContain(TSL.renderGroup);
  expect(builder.updateBeforeNodes).toEqual([]); expect(builder.updateAfterNodes).toEqual([]);
  expect(code.uniforms).toContain(gpu ? 'var<uniform> render' : 'render {');
  const binding = builder.getBindings().find((g) => g.name === 'render').bindings[0];
  expect(binding.groupNode).toBe(TSL.renderGroup); expect(binding.groupNode.order).toBe(0); expect(binding.groupNode.shared).toBe(true);
  expect(binding.uniforms).toHaveLength(2); // Repeated a input shares its native uniform.
  binding.update();
  for (const u of binding.uniforms) expect(binding.buffer[u.offset]).toBe(1.5);
  const frame = new NodeFrame(), version = TSL.renderGroup.version;
  frame.renderId = 1; frame.frameId = 1;
  update(a, active, frame); update(b, active, frame); frame.updateNode(TSL.renderGroup);
  frame.updateNode(TSL.renderGroup); expect(TSL.renderGroup.version).toBe(version + 1);
  frame.renderId++; active.toneMappingExposure = 4.25;
  for (const n of builder.updateNodes) frame.updateNode(n);
  expect(TSL.renderGroup.version).toBe(version + 2);
  binding.update(); for (const u of binding.uniforms) expect(binding.buffer[u.offset]).toBe(4.25);
});

it('never reads or serializes the cached renderer, even with getters, callbacks and graph resources', async () => {
  const { scene, material } = fixture(), active = renderer();
  update(material.colorNode, active);
  const callback = vi.fn(() => { throw new Error('cached renderer must be opaque'); });
  Object.defineProperty(active, 'toneMappingExposure', { get: callback, enumerable: true });
  active.toJSON = callback; active.resource = TSL.time;
  const json = await exportScene(scene);
  expect(callback).not.toHaveBeenCalled();
  expect(material.colorNode.reference).toBe(active);
  expect(Object.values(json.materials[0].extensions[extensionName].nodes)).not.toContainEqual({ op: 'time' });
});

it('accepts the native type-only lazy cache and honors selected entrypoints', async () => {
  const { scene, material } = fixture();
  material.colorNode.setNodeType('float');
  expect(material.colorNode.node.value).toBeNull();
  const json = await exportScene(scene), errors = [];
  const node = meshes((await load(json, errors)).scene)[0].material.colorNode;
  expect(errors).toEqual([]); expect(node.node).toBeNull();
  update(node, renderer(false, 3.75));
  material.colorNode.renderer = renderer(); // Unselected graph is outside export scope.
  const selected = await exportScene(scene, false, { entrypoints: ['opacityNode'] });
  expect(Object.values(selected.materials[0].extensions[extensionName].nodes)).toEqual([{ op: 'toneMappingExposure' }]);
});

it('validates the exact shared render group configuration without transporting runtime versions', async () => {
  const { scene } = fixture(), group = TSL.renderGroup;
  for (const [key, value] of [['updateType', 'object'], ['update', () => {}], ['order', 1], ['shared', false], ['extra', TSL.time]]) {
    const descriptor = Object.getOwnPropertyDescriptor(group, key);
    try {
      group[key] = value;
      await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
    } finally {
      if (descriptor) Object.defineProperty(group, key, descriptor); else delete group[key];
    }
  }
});

const badNodes = [
  ['explicit renderer', () => new RendererReferenceNode('toneMappingExposure', 'float', renderer())],
  ...['exposure', 'toneMappingExposure.x', '__proto__', 'constructor'].map((p) => [p, () => new RendererReferenceNode(p, 'float')]),
  ...['int', 'uint', 'vec2', 'color', 'texture'].map((t) => [t, () => new RendererReferenceNode('toneMappingExposure', t)]),
  ...['updateType', 'updateBeforeType', 'updateAfterType'].map((k) => [k, (n) => { n[k] = 'render'; }]),
  ...['name', 'nodeType', 'global', 'parents', 'count', 'object', 'renderer', 'unknown', '_unknown'].map((k) => [k, (n) => { n[k] = k === 'object' || k === 'renderer' ? renderer() : 1; }]),
  ['extra child', (n) => { n.extra = TSL.time; }],
  ['nested private child', (n) => { n._extra = { node: TSL.time }; }],
  ['before attachment', (n) => n.before(TSL.float(1))],
  ['callback', (n) => n.onObjectUpdate(() => 1)],
  ['method callback', (n) => { n.updateReference = () => renderer(); }],
  ['hidden method', (n) => Object.defineProperty(n, 'update', { value() {} })],
  ['symbol', (n) => { n[Symbol('extra')] = 1; }],
  ['wrong properties', (n) => { n.properties = ['other']; }],
  ['extra properties', (n) => { n.properties.extra = 1; }],
  ['missing field', (n) => { delete n.renderer; }],
  ['null group', (n) => n.setGroup(null)],
  ['object group', (n) => n.setGroup(TSL.objectGroup)],
  ['frame group', (n) => n.setGroup(TSL.frameGroup)],
  ['independent group', (n) => n.setGroup(new UniformGroupNode('render', true, 0, 'render'))],
  ['subclass', () => new (class extends RendererReferenceNode {})('toneMappingExposure', 'float')],
  ['forged subclass', () => new (class extends RendererReferenceNode { static get type() { return 'RendererReferenceNode'; } })('toneMappingExposure', 'float')]
];
it.each(badNodes)('rejects unsupported source state: %s', async (_, mutate) => {
  const { scene, material } = fixture(), node = material.colorNode, replacement = mutate(node);
  material.colorNode = replacement?.isNode ? replacement : node;
  await expect(exportScene(scene)).rejects.toThrow(/Unsupported|unsupported/);
});

it.each(['precision', 'type', 'group', 'value', 'name', 'global', 'parents', 'callback', 'schedule', 'extra', 'child', 'subclass'])(
  'rejects customized lazy uniform state: %s', async (mode) => {
    const { scene, material } = fixture(); update(material.colorNode, renderer()); const n = material.colorNode.node;
    if (mode === 'precision') n.precision = 'high';
    if (mode === 'type') n.nodeType = 'vec2';
    if (mode === 'group') n.setGroup(TSL.objectGroup);
    if (mode === 'value') n.value = new Vector3();
    if (mode === 'name') n.setName('custom');
    if (mode === 'global') n.global = true;
    if (mode === 'parents') n.parents = true;
    if (mode === 'callback') n.onObjectUpdate(() => 1);
    if (mode === 'schedule') n.updateBeforeType = 'frame';
    if (mode === 'extra') n.extra = 1;
    if (mode === 'child') n._extra = TSL.time;
    if (mode === 'subclass') material.colorNode.node = new (class extends UniformNode {}) (1, 'float').setGroup(TSL.renderGroup);
    await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
  }
);
it.each(['node', 'selector'])('rejects accessors before invoking them: %s', async (mode) => {
  const { scene, material } = fixture(), callback = vi.fn();
  Object.defineProperty(mode === 'node' ? material.colorNode : material.colorNode.properties, mode === 'node' ? 'unknown' : '0', { get: callback });
  await expect(exportScene(scene)).rejects.toThrow(/Unsupported/); expect(callback).not.toHaveBeenCalled();
});

const badGraphs = [
  ['wrong property', (n) => { n.args.property = 'other'; }],
  ['nested property', (n) => { n.args.property = 'toneMappingExposure.x'; }],
  ['wrong type', (n) => { n.args.uniformType = 'vec3'; }],
  ...['renderer', 'object', 'value', 'reference', 'count', 'group', 'name', 'global', 'parents', 'nodeType', 'updateType', 'callback'].map((k) => [k, (n) => { n.args[k] = null; }]),
  ['missing type', (n) => { delete n.args.uniformType; }],
  ['missing args', (n) => { delete n.args; }],
  ['array args', (n) => { n.args = ['toneMappingExposure', 'float']; }],
  ['unknown node field', (n) => { n.value = 1; }],
  ['extra link', (n, e) => { n.links = { node: { $ref: e.entrypoints.opacityNode } }; }],
  ['dangling link', (n) => { n.links = { node: { $ref: 'missing' } }; }],
  ['cycle', (n, e) => { n.links = { node: { $ref: e.entrypoints.colorNode } }; }],
  ['link array', (n) => { n.links = []; }],
  ['shared args', (_, e) => { e.nodes[e.entrypoints.opacityNode].args = args; }],
  ['shared link', (_, e) => { e.nodes[e.entrypoints.opacityNode].links = { node: { $ref: e.entrypoints.colorNode } }; }],
  ['invalid unreachable', (n, e) => { e.nodes.unreachable = { ...n, args: { ...args, value: 1 } }; }],
  ['unreachable dangling', (_, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'missing' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['unreachable cycle', (_, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'unreachable' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['late invalid slot', (_, e) => { e.entrypoints.unknownNode = e.entrypoints.colorNode; }]
];
async function fallback(json) {
  const ordinary = await load(json, [], false), errors = [], applied = vi.fn();
  let parser, originals;
  const loader = new GLTFLoader();
  loader.register((p) => ({ name: 'capture-original-materials', async beforeRoot() {
    originals = await p.getDependencies('material');
  } }));
  loader.register((p) => { parser = p; return new THREEMaterialsTSLLoaderPlugin(p, {
    nodeResolver: createDefaultNodeResolver(), onError: (e) => errors.push(e), onApplied: applied
  }); });
  const result = await loader.parseAsync(JSON.stringify(json), '');
  expect(errors).toHaveLength(1); expect(applied).not.toHaveBeenCalled();
  const actual = meshes(result.scene), controls = meshes(ordinary.scene);
  for (const [i, mesh] of actual.entries()) {
    expect(mesh.material.isNodeMaterial).not.toBe(true);
    const { uuid: _a, ...a } = mesh.material.toJSON(), { uuid: _b, ...b } = controls[i].material.toJSON();
    expect(a).toEqual(b);
    for (const slot of ['colorNode', 'roughnessNode', 'emissiveNode', 'positionNode', 'opacityNode']) expect(mesh.material[slot]).toBeUndefined();
  }
  expect(actual[0].material).not.toBe(actual[1].material);
  expect(actual[1].material.flatShading).toBe(true); expect(actual[1].material.vertexColors).toBe(true);
  const cached = await parser.getDependency('material', 0);
  expect(cached).toBe(originals[0]); expect(cached.isNodeMaterial).not.toBe(true);
  expect(await parser.getDependencies('material')).toEqual(originals);
}
it.each(badGraphs)('retains whole ordinary material, extensions, clones and cache atomically: %s', async (_, mutate) => {
  const json = await exportScene(fixture(true).scene), e = json.materials[0].extensions[extensionName];
  mutate(e.nodes[e.entrypoints.colorNode], e);
  await fallback(json);
});

it.each([false, true])('keeps primitive clones and within-material node identity across two rounds (GLB=%s)', async (binary) => {
  let { scene } = fixture(true);
  for (let round = 0; round < 2; round++) {
    const errors = []; scene = (await load(await exportScene(scene, binary), errors)).scene;
    expect(errors).toEqual([]); const [a, b] = meshes(scene);
    expect(a.material).not.toBe(b.material); expect(b.material.flatShading).toBe(true); expect(b.material.vertexColors).toBe(true);
    if (round === 0) expect(a.material.colorNode).toBe(b.material.colorNode);
    for (const mesh of [a, b]) {
      expect(mesh.material.colorNode).toBe(mesh.material.emissiveNode);
      expect(mesh.material.opacityNode).toBe(TSL.toneMappingExposure);
      update(mesh.material.colorNode, renderer(false, 5 + round));
    }
  }
});

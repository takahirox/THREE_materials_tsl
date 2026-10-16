import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, Float32BufferAttribute, Color, Vector3, Texture, InstancedMesh, SkinnedMesh } from 'three';
import { UserDataNode, ReferenceNode, UniformGroupNode, MeshPhysicalNodeMaterial, NodeFrame,
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
function fixture(values = [0.5, 0.75], cached = true) {
  const material = new MeshPhysicalNodeMaterial({ clearcoat: 0.4, roughness: 0.6,
    metalness: 0.3, transmission: 0.2, thickness: 0.3, ior: 1.6 });
  material.color.setRGB(0.2, 0.4, 0.6);
  material.colorNode = TSL.userData('tint', 'float');
  material.emissiveNode = material.colorNode;
  material.positionNode = TSL.vec3(material.colorNode, material.colorNode, material.colorNode);
  material.opacityNode = TSL.time;
  const geometry = new BoxGeometry();
  const scene = new Scene();
  for (const tint of values) {
    const mesh = new Mesh(cached ? geometry : new BoxGeometry(), material);
    mesh.userData.tint = tint;
    mesh.userData.annotation = { label: 'ordinary extras', values: [1, true, null] };
    scene.add(mesh);
  }
  return { scene, material, mesh: scene.children[0] };
}
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
function update(node, mesh, frame = new NodeFrame()) {
  frame.object = mesh;
  expect(node.updateReference(frame)).toBe(mesh.userData);
  frame.updateNode(node);
  expect(node.node.groupNode).toBe(TSL.objectGroup);
  return node.node.value;
}
function shader(node, mesh, gpu, stage) {
  const renderer = { backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
  const Builder = gpu ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(mesh, renderer);
  builder.setShaderStage(stage);
  const flow = builder.flowStagesNode(node, 'vec3');
  builder.sortBindingGroups(); builder.buildUpdateNodes();
  return { builder, code: { result: flow.result, code: flow.code, uniforms: builder.getUniforms(stage) } };
}

it.each([false, true].flatMap((binary) => [false, true].map((cached) => [binary, cached])))(
  'round-trips actual mesh extras twice with shared material, live updates and shaders (GLB=%s, cached geometry=%s)', async (binary, cached) => {
    const { scene, material } = fixture([0.5, 0.75], cached);
    const frame = new NodeFrame();
    const expected = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) =>
      shader(material.positionNode, scene.children[0], gpu, stage).code));
    let current = scene;
    for (let round = 0; round < 3; round++) {
      const [a, b] = meshes(current);
      const m = a.material, node = m.colorNode;
      expect(m).toBe(b.material);
      expect(node).toBeInstanceOf(UserDataNode);
      expect(node).toBe(m.emissiveNode);
      expect(m.positionNode.node.nodes).toEqual([node, node, node]);
      expect(m.opacityNode).toBe(TSL.time);
      expect(node.userData).toBeNull(); expect(node.object).toBeNull();
      expect(a.userData.tint).toBeCloseTo(0.5 + round * 0.125);
      expect(b.userData.tint).toBeCloseTo(0.75 + round * 0.125);
      for (const mesh of [a, b]) {
        expect(update(node, mesh, frame)).toBe(mesh.userData.tint);
        mesh.userData.tint += 0.125;
        expect(update(node, mesh, frame)).toBe(mesh.userData.tint);
      }
      // Swapping the dictionary must stay live too; no captured foreign object.
      a.userData = { ...a.userData };
      expect(update(node, a, frame)).toBe(a.userData.tint);
      expect(update(node, b, frame)).toBe(b.userData.tint);
      expect(a.userData.annotation).toEqual(scene.children[0].userData.annotation);
      expect(m.clearcoat).toBeCloseTo(0.4); expect(m.transmission).toBeCloseTo(0.2);
      expect(m.thickness).toBeCloseTo(0.3); expect(m.ior).toBeCloseTo(1.6);
      expect(m.roughness).toBeCloseTo(0.6); expect(m.metalness).toBeCloseTo(0.3);
      expect(m.color.toArray()).toEqual(material.color.toArray());
      const actual = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => {
        const { builder, code } = shader(m.positionNode, a, gpu, stage);
        expect(builder.updateNodes).toContain(node);
        return code;
      }));
      expect(actual).toEqual(expected);
      if (round === 2) break;
      const json = await exportScene(current);
      const graph = json.materials[0].extensions[extensionName];
      const encoded = graph.nodes[graph.entrypoints.colorNode];
      expect(encoded).toEqual({ op: 'UserDataNode', args: { property: 'tint', uniformType: 'float' } });
      expect(graph.entrypoints.colorNode).toBe(graph.entrypoints.emissiveNode);
      expect(Object.values(graph.nodes).filter((n) => n.op === 'UserDataNode')).toHaveLength(1);
      expect(json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.extras.tint)).toEqual([a.userData.tint, b.userData.tint]);
      if (cached) expect(json.meshes).toHaveLength(1);
      expect(json.materials[0].extensions.KHR_materials_clearcoat).toBeDefined();
      const errors = [];
      current = (await load(binary ? await exportScene(current, true) : json, errors)).scene;
      expect(errors).toEqual([]);
    }
  }
);

it('supports a lone mesh, independent nodes/selectors and selected entrypoints', async () => {
  const { scene, material, mesh } = fixture([0]);
  mesh.userData.gain = -2.5;
  material.roughnessNode = new UserDataNode('gain', 'float');
  const json = await exportScene(scene);
  const errors = [], result = await load(json, errors), actual = meshes(result.scene)[0];
  expect(errors).toEqual([]);
  expect(actual.material.roughnessNode).not.toBe(actual.material.colorNode);
  expect(update(actual.material.roughnessNode, actual)).toBe(-2.5);
  const selected = await exportScene(scene, false, { entrypoints: ['opacityNode'] });
  expect(Object.values(selected.materials[0].extensions[extensionName].nodes)).toEqual([{ op: 'time' }]);
});

const badNodes = [
  ['external dictionary', () => new UserDataNode('tint', 'float', { tint: 0.5 })],
  ['foreign object', (n) => { n.object = { tint: 0.5 }; }],
  ['nested selector', () => new UserDataNode('nested.tint', 'float')],
  ...['', 'a-b', 'tint[0]', '0tint', '__proto__', 'constructor', 'prototype', 'toString', 'toJSON', 'name', 'gltfExtensions'].map(
    (selector) => [`unsafe selector ${selector}`, () => new UserDataNode(selector, 'float')]),
  ...['int', 'uint', 'bool', 'color', 'vec2', 'texture'].map((type) => [type, () => new UserDataNode('tint', type)]),
  ['custom group', (n) => n.setGroup(new UniformGroupNode('custom'))],
  ['shared render group', (n) => n.setGroup(TSL.renderGroup)],
  ['callback', (n) => { n.onObjectUpdate(() => 1); }],
  ['update callback', (n) => { n.updateReference = () => ({ tint: 1 }); }],
  ['before schedule', (n) => { n.updateBeforeType = 'object'; }],
  ['schedule', (n) => { n.updateType = 'frame'; }],
  ['array count', (n) => { n.count = 1; }],
  ['properties extra state', (n) => { n.properties.extra = 1; }],
  ['properties mismatch', (n) => { n.properties = ['other']; }],
  ['nondefault base type', (n) => { n.nodeType = 'float'; }],
  ['nondefault name', (n) => n.setName('custom')],
  ['nondefault global', (n) => { n.global = true; }],
  ['nondefault parents', (n) => { n.parents = true; }],
  ['unknown scalar state', (n) => { n.extra = 1; }],
  ['unknown child', (n) => { n.extra = TSL.float(1); }],
  ['hidden child', (n) => { n._extra = TSL.float(1); }],
  ['before attachment', (n) => n.before(TSL.float(1))],
  ['subclass', () => new (class extends UserDataNode {})('tint', 'float')],
  ['general reference', () => new ReferenceNode('tint', 'float')]
];
it.each(badNodes)('rejects unsupported node state: %s', async (_, configure) => {
  const { scene, material } = fixture([0.5]);
  const n = new UserDataNode('tint', 'float'), replacement = configure(n);
  material.colorNode = replacement?.isNode ? replacement : n;
  await expect(exportScene(scene)).rejects.toThrow(/Unsupported|unsupported/);
});

const badValues = [undefined, null, '0.5', true, NaN, Infinity, -Infinity, -0,
  [0.5], new Float32Array([0.5]), { value: 0.5 }, new Color(), new Vector3(), new Texture(), () => 0.5];
it.each(badValues.map((v, i) => [i, v]))('rejects nonportable source value %s even on a cached second mesh', async (_, value) => {
  const { scene } = fixture();
  scene.children[1].userData.tint = value;
  await expect(exportScene(scene)).rejects.toThrow(/UserDataNode/);
});

it('rejects own/inherited accessors and serialization callbacks before running them', async () => {
  for (const mode of ['selected accessor', 'other accessor', 'toJSON', 'inherited', 'nonenumerable']) {
    const { scene, mesh } = fixture([0.5]);
    const callback = vi.fn(() => 0.5);
    if (mode === 'selected accessor') Object.defineProperty(mesh.userData, 'tint', { get: callback, enumerable: true });
    if (mode === 'other accessor') Object.defineProperty(mesh.userData, 'other', { get: callback, enumerable: true });
    if (mode === 'toJSON') mesh.userData.toJSON = callback;
    if (mode === 'inherited') mesh.userData = Object.create({ tint: 0.5 });
    if (mode === 'nonenumerable') Object.defineProperty(mesh.userData, 'tint', { value: 0.5, enumerable: false });
    await expect(exportScene(scene)).rejects.toThrow(/UserDataNode/);
    expect(callback).not.toHaveBeenCalled();
  }
});

it.each([
  ['material array', ({ mesh, material }) => { mesh.material = [material]; }],
  ['multiple primitives', ({ mesh, material }) => { mesh.material = [material, material]; }],
  ['wireframe', ({ material }) => { material.wireframe = true; }],
  ['pivot', ({ mesh }) => { mesh.pivot = new Vector3(1, 0, 0); }],
  ['morphs', ({ mesh }) => { mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position.clone()]; }],
  ['instancing', ({ scene, mesh, material }) => { scene.remove(mesh); scene.add(new InstancedMesh(mesh.geometry, material, 1)); }],
  ['skinning', ({ scene, mesh, material }) => { scene.remove(mesh); scene.add(new SkinnedMesh(mesh.geometry, material)); }]
])('rejects unproven source render layout: %s', async (_, configure) => {
  const data = fixture([0.5]); configure(data);
  await expect(exportScene(data.scene)).rejects.toThrow(/UserDataNode/);
});

async function expectFallback(json, prepare) {
  const ordinary = meshes((await load(json, [], false, prepare)).scene);
  const errors = [], result = await load(json, errors, true, prepare), actual = meshes(result.scene);
  expect(errors).toHaveLength(1);
  expect(actual).toHaveLength(ordinary.length);
  for (const [i, mesh] of actual.entries()) {
    const a = mesh.material, b = ordinary[i].material;
    expect(a.isNodeMaterial).not.toBe(true);
    expect(a.type).toBe(b.type);
    const { uuid: _a, ...actualJSON } = a.toJSON();
    const { uuid: _b, ...ordinaryJSON } = b.toJSON();
    expect(actualJSON).toEqual(ordinaryJSON);
    expect(a.color.toArray()).toEqual(b.color.toArray());
    for (const key of ['roughness', 'metalness', 'clearcoat', 'transmission', 'thickness', 'ior', 'transparent', 'opacity']) expect(a[key]).toEqual(b[key]);
    for (const slot of ['colorNode', 'emissiveNode', 'positionNode', 'opacityNode']) expect(a[slot]).toBeUndefined();
  }
  return { result, actual };
}
const badGraphs = [
  ['missing extras', (j) => { delete j.nodes[1].extras.tint; }],
  ['wrong extras type', (j) => { j.nodes[1].extras.tint = '0.5'; }],
  ['null extras', (j) => { j.nodes[0].extras = null; }],
  ['missing node extras despite mesh extras', (j) => { j.meshes[0].extras = { tint: 0.5 }; delete j.nodes[0].extras.tint; }],
  ['missing node extras despite primitive extras', (j) => { j.meshes[0].primitives[0].extras = { tint: 0.5 }; delete j.nodes[0].extras.tint; }],
  ['node unknown field', (_, n) => { n.unrecognized = 1; }],
  ['args unknown field', (_, n) => { n.args.userData = null; }],
  ['args foreign object', (_, n) => { n.args.object = { tint: 0.5 }; }],
  ['args custom schedule', (_, n) => { n.args.updateType = 'frame'; }],
  ['args missing field', (_, n) => { delete n.args.uniformType; }],
  ['args array', (_, n) => { n.args = ['tint', 'float']; }],
  ['args missing', (_, n) => { delete n.args; }],
  ['extra unsafe entrypoint', (_, n, e) => { e.entrypoints.constructor = e.entrypoints.colorNode; }],
  ['unknown binding', (_, n) => { n.args.property = 'missing'; }],
  ['nested selector', (_, n) => { n.args.property = 'a.tint'; }],
  ['unsafe selector', (_, n) => { n.args.property = '__proto__'; }],
  ['unsupported type', (_, n) => { n.args.uniformType = 'uint'; }],
  ['unknown link', (_, n, e) => { n.links = { node: { $ref: e.entrypoints.opacityNode } }; }],
  ['link array', (_, n) => { n.links = []; }],
  ['dangling link', (_, n) => { n.links = { node: { $ref: 'missing' } }; }],
  ['malformed link', (_, n) => { n.links = { node: { $ref: 'n1', extra: 1 } }; }],
  ['cycle', (_, n, e) => { n.links = { node: { $ref: e.entrypoints.colorNode } }; }],
  ['valid unreachable with missing selector', (_, n, e) => { e.nodes.unreachable = { op: 'UserDataNode', args: { property: 'absent', uniformType: 'float' } }; }],
  ['invalid unreachable', (_, n, e) => { e.nodes.unreachable = { ...n, args: { ...n.args, callback: 'no' } }; }],
  ['unreachable dangling reference', (_, n, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'missing' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['unreachable cycle', (_, n, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'unreachable' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['invalid late slot', (_, n, e) => { e.entrypoints.unknownNode = e.entrypoints.colorNode; }],
  ['multiple primitives', (j) => { j.meshes[0].primitives.push(structuredClone(j.meshes[0].primitives[0])); }],
  ['node camera attachment', (j) => { j.cameras = [{ type: 'perspective', perspective: { yfov: 0.7, znear: 0.1 } }]; j.nodes[0].camera = 0; }],
  ['uninstantiated node', (j) => { j.nodes.push({ mesh: 0, extras: { tint: 0.25 } }); }]
];
it.each(badGraphs)('retains the complete ordinary physical material atomically: %s', async (_, mutate) => {
  const json = await exportScene(fixture().scene);
  const e = json.materials[0].extensions[extensionName], n = e.nodes[e.entrypoints.colorNode];
  mutate(json, n, e);
  await expectFallback(json);
});

it('demonstrates multi-primitive Group extras do not belong to native rendering meshes', async () => {
  const json = await exportScene(fixture([0.5]).scene);
  json.meshes[0].primitives.push(structuredClone(json.meshes[0].primitives[0]));
  const { result, actual } = await expectFallback(json);
  expect(result.scene.children[0].isGroup).toBe(true);
  expect(result.scene.children[0].userData.tint).toBe(0.5);
  for (const mesh of actual) expect(mesh.userData.tint).toBeUndefined();
});

it.each(['mismatch', 'nonfinite', 'missing', 'accessor', 'dictionary accessor'])('validates actual imported extras after native loader hooks: %s', async (mode) => {
  const json = await exportScene(fixture().scene);
  await expectFallback(json, () => ({ name: 'mutate-extras', afterRoot(result) {
    const mesh = meshes(result.scene)[1];
    if (mode === 'mismatch') mesh.userData.tint = 0.125;
    if (mode === 'nonfinite') mesh.userData.tint = Infinity;
    if (mode === 'missing') delete mesh.userData.tint;
    if (mode === 'dictionary accessor') Object.defineProperty(mesh, 'userData', { get() { throw new Error('must not read dictionary accessor'); } });
    if (mode === 'accessor') Object.defineProperty(mesh.userData, 'tint', { get() { throw new Error('must not read accessor'); } });
  } }));
});

it('rechecks final native extras when serialization omits a dictionary', async () => {
  const { scene, mesh } = fixture([0.5]);
  // Native writer checks object.userData again after beforeParse; emulate an
  // intervening exporter plugin dropping extras to exercise the final check.
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: createDefaultNodeSerializer() }));
  exporter.register(() => ({ writeNode(object, nodeDef) { if (object === mesh) delete nodeDef.extras; } }));
  await expect(exporter.parseAsync(scene)).rejects.toThrow(/UserDataNode/);
});

it.each([false, true])('keeps native per-primitive material clones and per-object updates through repeated round trips (GLB=%s)', async (binary) => {
  const { scene } = fixture([0.25, 0.5], false);
  const geometry = scene.children[1].geometry;
  geometry.deleteAttribute('normal');
  geometry.setAttribute('color', new Float32BufferAttribute(Array(geometry.attributes.position.count * 3).fill(1), 3));
  let current = scene;
  for (let round = 0; round < 2; round++) {
    const errors = [], imported = await load(await exportScene(current, binary), errors);
    expect(errors).toEqual([]);
    const [a, b] = meshes(imported.scene);
    expect(a.material).not.toBe(b.material);
    expect(b.material.flatShading).toBe(true); expect(b.material.vertexColors).toBe(true);
    if (round === 0) expect(a.material.colorNode).toBe(b.material.colorNode);
    for (const mesh of [a, b]) {
      const node = mesh.material.colorNode;
      expect(node).toBe(mesh.material.emissiveNode);
      expect(update(node, mesh)).toBe(mesh.userData.tint);
      mesh.userData.tint += 0.125;
      expect(update(node, mesh)).toBe(mesh.userData.tint);
    }
    current = imported.scene;
  }
  const json = await exportScene(scene);
  delete json.nodes[1].extras.tint;
  const { actual } = await expectFallback(json);
  expect(actual[0].material).not.toBe(actual[1].material);
  expect(actual[1].material.flatShading).toBe(true); expect(actual[1].material.vertexColors).toBe(true);
});

it('checks every scene and retains ordinary material when another scene lacks a binding', async () => {
  const { scene, material } = fixture([0.25]);
  const other = new Scene(), mesh = new Mesh(new BoxGeometry(), material);
  mesh.userData.tint = 0.75; other.add(mesh);
  const json = await exportScene([scene, other]);
  const errors = [], result = await load(json, errors);
  expect(errors).toEqual([]); expect(result.scenes).toHaveLength(2);
  const a = meshes(result.scenes[0])[0], b = meshes(result.scenes[1])[0];
  expect(a.material).toBe(b.material);
  expect(update(a.material.colorNode, a)).toBe(0.25);
  expect(update(b.material.colorNode, b)).toBe(0.75);
  delete json.nodes[1].extras.tint;
  const failures = [], fallback = await load(json, failures);
  expect(failures).toHaveLength(1);
  for (const loaded of fallback.scenes) {
    const material = meshes(loaded)[0].material;
    expect(material.isNodeMaterial).not.toBe(true); expect(material.clearcoat).toBeCloseTo(0.4);
  }
});

it.each(['precision', 'group', 'name', 'callback', 'extra', 'child'])(
  'rejects customized native internal uniform state: %s', async (mode) => {
    const { scene, material, mesh } = fixture([0.5]);
    update(material.colorNode, mesh);
    const n = material.colorNode.node;
    if (mode === 'precision') n.precision = 'high';
    if (mode === 'group') n.setGroup(TSL.renderGroup);
    if (mode === 'name') n.setName('custom');
    if (mode === 'callback') n.onObjectUpdate(() => 1);
    if (mode === 'extra') n.unrecognized = 1;
    if (mode === 'child') n._extra = TSL.float(1);
    await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
  }
);

it.each(['node accessor', 'properties accessor', 'cached extras accessor'])(
  'rejects state accessors without invoking them: %s', async (mode) => {
    const { scene, material, mesh } = fixture([0.5]);
    const callback = vi.fn(() => 0.5);
    if (mode === 'node accessor') Object.defineProperty(material.colorNode, 'unknown', { get: callback });
    if (mode === 'properties accessor') Object.defineProperty(material.colorNode.properties, '0', { get: callback });
    if (mode === 'cached extras accessor') {
      update(material.colorNode, mesh);
      Object.defineProperty(mesh.userData, 'tint', { get: callback });
    }
    await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
    expect(callback).not.toHaveBeenCalled();
  }
);

it('validates finite raw extras as well as actual mesh values', async () => {
  const json = await exportScene(fixture().scene);
  await expectFallback(json, (parser) => ({ name: 'mutate-raw-extras', afterRoot() {
    parser.json.nodes[1].extras.tint = Infinity;
  } }));
});

it('rejects unsupported primitive layouts even when mesh extras happen to populate their children', async () => {
  const json = await exportScene(fixture([0.5]).scene);
  json.meshes[0].extras = { tint: 0.5 };
  json.meshes[0].primitives.push(structuredClone(json.meshes[0].primitives[0]));
  const { actual } = await expectFallback(json);
  expect(actual.map((mesh) => mesh.userData.tint)).toEqual([0.5, 0.5]);
});

it('does not validate non-exported hidden meshes or materials without selected user-data graphs', async () => {
  const { scene } = fixture();
  scene.children[1].visible = false; delete scene.children[1].userData.tint;
  const errors = [], result = await load(await exportScene(scene), errors);
  expect(errors).toEqual([]); expect(meshes(result.scene)).toHaveLength(1);
  const { material, scene: second } = fixture([undefined]);
  material.colorNode = null; material.emissiveNode = null; material.positionNode = null;
  const plain = await load(await exportScene(second), errors);
  expect(errors).toEqual([]); expect(meshes(plain.scene)[0].material.opacityNode).toBe(TSL.time);
});

it.each([null, true, '0.5', [], {}, undefined, NaN, Infinity].map((value, i) => [i, value]))(
  'retains the full ordinary material for malformed encoded extras %s', async (_, value) => {
    const json = await exportScene(fixture().scene);
    json.nodes[1].extras.tint = value;
    await expectFallback(json);
  }
);

it('rejects a JSON numeric negative zero that native re-export would normalize', async () => {
  const json = await exportScene(fixture().scene);
  await expectFallback(JSON.stringify(json).replace('"tint":0.5', '"tint":-0'));
});

it('rejects cloned scene roots without exact native node ownership', async () => {
  const json = await exportScene(fixture([0.5]).scene);
  json.scenes.push(structuredClone(json.scenes[0]));
  const errors = [], result = await load(json, errors);
  expect(errors).toHaveLength(1);
  for (const scene of result.scenes) {
    const mesh = meshes(scene)[0];
    expect(mesh.userData.tint).toBe(0.5);
    expect(mesh.material.isNodeMaterial).not.toBe(true);
    expect(mesh.material.clearcoat).toBeCloseTo(0.4);
  }
});

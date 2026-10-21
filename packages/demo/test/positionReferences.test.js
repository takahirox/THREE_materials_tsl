import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, Scene, Float32BufferAttribute, Vector3, Matrix4, InstancedMesh, SkinnedMesh, InstancedBufferGeometry } from 'three';
import { ReferenceNode, ModelNode, UniformNode, UniformGroupNode, MeshPhysicalNodeMaterial, NodeFrame,
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
function fixture(cached = true) {
  const material = new MeshPhysicalNodeMaterial({ clearcoat: 0.4, roughness: 0.6,
    metalness: 0.3, transmission: 0.2, thickness: 0.3, ior: 1.6 });
  material.color.setRGB(0.2, 0.4, 0.6);
  material.colorNode = TSL.reference('position', 'vec3');
  material.emissiveNode = material.colorNode;
  material.positionNode = material.colorNode.add(material.colorNode);
  material.opacityNode = TSL.time;
  const geometry = new BoxGeometry(), scene = new Scene(), parent = new Group();
  parent.position.set(10, -20, 30); parent.rotation.set(0.3, 0.4, 0.5); parent.scale.set(2, 3, 4);
  scene.add(parent);
  for (const position of [[1.25, -2.5, 3.75], [-4, 5, 6]]) {
    const mesh = new Mesh(cached ? geometry : geometry.clone(), material);
    mesh.position.fromArray(position); parent.add(mesh);
  }
  return { scene, parent, material, mesh: parent.children[0], other: parent.children[1] };
}
function meshes(scene) { const result = []; scene.traverse((o) => { if (o.isMesh) result.push(o); }); return result; }
async function exportScene(scene, options = {}, prepare) {
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, { nodeSerializer: createDefaultNodeSerializer() }));
  if (prepare) exporter.register(prepare);
  return exporter.parseAsync(scene, options);
}
async function load(json, errors = [], enabled = true, prepare, applied = vi.fn()) {
  const loader = new GLTFLoader();
  if (prepare) loader.register(prepare);
  if (enabled) loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
    nodeResolver: createDefaultNodeResolver(), onError: (e) => errors.push(e), onApplied: applied
  }));
  else loader.register(() => ({ name: extensionName }));
  return loader.parseAsync(json instanceof ArrayBuffer || typeof json === 'string' ? json : JSON.stringify(json), '');
}
function update(node, mesh, frame = new NodeFrame()) {
  frame.object = mesh;
  frame.updateNode(node);
  expect(node.reference).toBe(mesh);
  expect(node.getValueFromReference()).toBe(mesh.position);
  expect(node.node).toBeInstanceOf(UniformNode);
  expect(node.node.groupNode).toBe(TSL.objectGroup);
  expect(node.node.value).toBe(mesh.position);
  return node.node.value.toArray();
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

it.each([false, true].flatMap((binary) => [false, true].flatMap((trs) => [false, true].map((cached) => [binary, trs, cached]))))(
  'preserves rendered local positions, native live reads and shaders twice (GLB=%s, TRS=%s, cached=%s)', async (binary, trs, cached) => {
    const { scene, material } = fixture(cached);
    const frame = new NodeFrame();
    const expected = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) =>
      shader(material.positionNode, meshes(scene)[0], gpu, stage).code));
    let current = scene;
    for (let round = 0; round < 3; round++) {
      const [a, b] = meshes(current), m = a.material, node = m.colorNode;
      expect(a.material).toBe(b.material);
      expect(Object.getPrototypeOf(node)).toBe(ReferenceNode.prototype);
      expect(node).not.toBeInstanceOf(ModelNode);
      expect(node).toBe(m.emissiveNode);
      expect(m.positionNode.node.aNode).toBe(node); expect(m.positionNode.node.bNode).toBe(node);
      expect(m.opacityNode).toBe(TSL.time);
      expect(node.object).toBeNull(); expect(node.count).toBeNull(); expect(node.name).toBeNull();
      expect(node.group).toBeNull(); expect(node.property).toBe('position'); expect(node.uniformType).toBe('vec3');
      expect(a.position.toArray()).toEqual([1.25 + round * 0.125, -2.5, 3.75]);
      expect(b.position.toArray()).toEqual([-4 + round * 0.125, 5, 6]);
      current.updateMatrixWorld(true);
      expect(a.getWorldPosition(new Vector3()).toArray()).not.toEqual(a.position.toArray());
      for (const mesh of [a, b]) {
        expect(update(node, mesh, frame)).toEqual(mesh.position.toArray());
        mesh.position.x += 0.125;
        expect(update(node, mesh, frame)).toEqual(mesh.position.toArray());
      }
      expect(update(node, a, frame)).toEqual(a.position.toArray());
      expect(update(node, b, frame)).toEqual(b.position.toArray());
      expect(m.clearcoat).toBeCloseTo(0.4); expect(m.transmission).toBeCloseTo(0.2);
      expect(m.thickness).toBeCloseTo(0.3); expect(m.ior).toBeCloseTo(1.6);
      expect(m.roughness).toBeCloseTo(0.6); expect(m.metalness).toBeCloseTo(0.3);
      expect(m.color.toArray()).toEqual(material.color.toArray());
      const actual = [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => {
        const { builder, code } = shader(m.positionNode, a, gpu, stage);
        expect(builder.updateNodes).toContain(node);
        expect(builder.uniforms[stage].filter((u) => u.node === node.node)).toHaveLength(1);
        return code;
      }));
      expect(actual).toEqual(expected);
      if (round === 2) break;
      const json = await exportScene(current, { trs });
      const graph = json.materials[0].extensions[extensionName];
      expect(graph.nodes[graph.entrypoints.colorNode]).toEqual({ op: 'ReferenceNode', args: { property: 'position', uniformType: 'vec3' } });
      expect(graph.entrypoints.colorNode).toBe(graph.entrypoints.emissiveNode);
      expect(Object.values(graph.nodes).filter((n) => n.op === 'ReferenceNode')).toHaveLength(1);
      expect(json.nodes.filter((n) => n.mesh !== undefined).map((n) => trs ? n.translation : n.matrix.slice(12, 15))).toEqual([a.position.toArray(), b.position.toArray()]);
      if (cached) expect(json.meshes).toHaveLength(1);
      expect(json.materials[0].extensions.KHR_materials_clearcoat).toBeDefined();
      const errors = [], result = await load(binary ? await exportScene(current, { binary, trs }) : json, errors);
      expect(errors).toEqual([]);
      for (const mesh of meshes(result.scene)) {
        const association = result.parser.associations.get(mesh);
        expect(association.primitives).toBe(0);
        expect(await result.parser.getDependency('node', association.nodes)).toBe(mesh);
        expect(mesh.position.toArray()).toEqual(json.nodes[association.nodes][trs ? 'translation' : 'matrix'].slice(trs ? 0 : 12, trs ? 3 : 15));
      }
      current = result.scene;
    }
  }
);

it.each([false, true])('supports unbuilt and legitimately built native instances with opaque runtime object caches (built=%s)', async (built) => {
  const { scene, material, mesh } = fixture();
  material.roughnessNode = new ReferenceNode('position', 'vec3');
  if (built) {
    shader(material.colorNode, mesh, false, 'vertex');
    update(material.colorNode, mesh);
    // A last-rendered runtime object may have callbacks/cyclic state. Never traverse it.
    const cached = new Mesh();
    Object.defineProperty(cached, 'isNode', { enumerable: true, get() { throw new Error('runtime cache traversed'); } });
    material.colorNode.reference = cached;
  } else expect(material.colorNode.node).toBeNull();
  const json = await exportScene(scene), errors = [], result = await load(json, errors);
  expect(errors).toEqual([]);
  const node = meshes(result.scene)[0].material.colorNode;
  expect(node.node).toBeNull(); expect(node.reference).toBeNull();
  expect(node).not.toBe(meshes(result.scene)[0].material.roughnessNode);
});

it.each([false, true])('supports matching fixed translation matrices (TRS=%s)', async (trs) => {
  const { scene } = fixture();
  for (const mesh of meshes(scene)) { mesh.updateMatrix(); mesh.matrixAutoUpdate = false; }
  const errors = [], result = await load(await exportScene(scene, { trs }), errors);
  expect(errors).toEqual([]);
  expect(meshes(result.scene).map((m) => m.position.toArray())).toEqual(meshes(scene).map((m) => m.position.toArray()));
});

const badNodes = [
  ['foreign object', () => new ReferenceNode('position', 'vec3', new Mesh())],
  ...['', 'userData.position', 'position.x', 'scale', 'matrix', '__proto__'].map((p) => [`selector ${p}`, () => new ReferenceNode(p, 'vec3')]),
  ...['float', 'color', 'vec2', 'vec4', 'texture', 'cubeTexture', 'mat4'].map((t) => [`type ${t}`, () => new ReferenceNode('position', t)]),
  ['array count', (n) => { n.count = 3; }],
  ['group', (n) => { n.group = new UniformGroupNode('custom'); }],
  ['shared group', (n) => { n.group = TSL.objectGroup; }],
  ['name', (n) => n.setName('custom')],
  ['empty name', (n) => n.setName('')],
  ['global', (n) => { n.global = true; }],
  ['parents', (n) => { n.parents = true; }],
  ['nodeType', (n) => { n.nodeType = 'vec3'; }],
  ['callback', (n) => n.onObjectUpdate(() => new Vector3())],
  ['updateReference', (n) => { n.updateReference = () => new Mesh(); }],
  ['schedule', (n) => { n.updateType = 'frame'; }],
  ['before schedule', (n) => { n.updateBeforeType = 'object'; }],
  ['after schedule', (n) => { n.updateAfterType = 'object'; }],
  ['selector cache', (n) => { n.properties = ['scale']; }],
  ['extra selector state', (n) => { n.properties.extra = 1; }],
  ['unknown scalar', (n) => { n.extra = 1; }],
  ['extra child', (n) => { n.extra = TSL.vec3(1); }],
  ['hidden child', (n) => { n._extra = TSL.vec3(1); }],
  ['self child', (n) => { n._extra = n; }],
  ['before attachment', (n) => n.before(TSL.vec3(1))],
  ['subclass', () => new (class extends ReferenceNode {})('position', 'vec3')],
  ['symbol', (n) => { n[Symbol('extra')] = 1; }]
];
it.each(badNodes)('rejects unsupported node: %s', async (_, configure) => {
  const { scene, material } = fixture();
  const n = new ReferenceNode('position', 'vec3'), replacement = configure(n);
  material.colorNode = replacement?.isNode ? replacement : n;
  await expect(exportScene(scene)).rejects.toThrow(/Unsupported|unsupported/);
});
it.each(['precision', 'group', 'name', 'callback', 'scalar', 'child', 'type', 'value', 'subclass'])(
  'rejects customized internal uniform: %s', async (mode) => {
    const { scene, material, mesh } = fixture(); update(material.colorNode, mesh);
    const n = material.colorNode.node;
    if (mode === 'precision') n.precision = 'high';
    if (mode === 'group') n.setGroup(TSL.renderGroup);
    if (mode === 'name') n.setName('custom');
    if (mode === 'callback') n.onObjectUpdate(() => 1);
    if (mode === 'scalar') n.extra = 1;
    if (mode === 'child') n._extra = TSL.float(1);
    if (mode === 'type') n.nodeType = 'float';
    if (mode === 'value') n.value = [1, 2, 3];
    if (mode === 'subclass') Object.setPrototypeOf(n, (class extends UniformNode {}).prototype);
    await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
  }
);
it.each(['own field', 'properties', 'uniform', 'uniform vector'])(
  'rejects accessors without invoking callbacks: %s', async (mode) => {
    const { scene, material, mesh } = fixture(), callback = vi.fn(() => 1);
    if (mode === 'own field') Object.defineProperty(material.colorNode, 'extra', { get: callback });
    if (mode === 'properties') Object.defineProperty(material.colorNode.properties, '0', { get: callback });
    if (mode === 'uniform' || mode === 'uniform vector') {
      update(material.colorNode, mesh);
      Object.defineProperty(mode === 'uniform' ? material.colorNode.node : mesh.position, mode === 'uniform' ? 'value' : 'x', { get: callback });
    }
    await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
    expect(callback).not.toHaveBeenCalled();
  }
);

const badMeshes = [
  ['zero translation', ({ other }) => other.position.set(0, 0, 0)],
  ['negative zero', ({ other }) => { other.position.y = -0; }],
  ['nonfinite', ({ other }) => { other.position.y = Infinity; }],
  ['missing position', ({ other }) => other.geometry.deleteAttribute('position')],
  ['local rotation', ({ other }) => { other.rotation.x = 0.3; }],
  ['local scale', ({ other }) => { other.scale.x = 2; }],
  ['negative scale', ({ other }) => { other.scale.x = -1; }],
  ['fixed mismatched matrix', ({ other }) => { other.matrixAutoUpdate = false; }],
  ['fixed shear', ({ other }) => { other.updateMatrix(); other.matrixAutoUpdate = false; other.matrix.elements[4] = 0.5; }],
  ['pivot', ({ other }) => { other.pivot = new Vector3(1, 0, 0); }],
  ['pivot extras', ({ parent }) => { parent.userData.pivot = [1, 0, 0]; }],
  ['material array', ({ other, material }) => { other.material = [material]; }],
  ['multiple materials', ({ other, material }) => { other.material = [material, material]; }],
  ['wireframe', ({ material }) => { material.wireframe = true; }],
  ['morph', ({ other }) => { other.geometry.morphAttributes.position = [other.geometry.attributes.position.clone()]; }],
  ['skinned', ({ parent, other, material }) => { parent.remove(other); parent.add(new SkinnedMesh(other.geometry, material)); }],
  ['instanced', ({ parent, other, material }) => { parent.remove(other); parent.add(new InstancedMesh(other.geometry, material, 1)); }],
  ['instanced geometry', ({ other }) => { other.geometry = new InstancedBufferGeometry().copy(other.geometry); }],
  ['draw range', ({ other }) => { other.geometry.setDrawRange(3, 3); }]
];
it.each(badMeshes)('rejects unsafe source mesh including cached material uses: %s', async (_, configure) => {
  const data = fixture(); configure(data);
  await expect(exportScene(data.scene)).rejects.toThrow(/ReferenceNode/);
});

async function expectFallback(json, prepare) {
  const control = await load(json, [], false, prepare), ordinary = control.scenes.flatMap(meshes);
  const errors = [], applied = vi.fn(), result = await load(json, errors, true, prepare, applied), actual = result.scenes.flatMap(meshes);
  expect(errors).toHaveLength(1); expect(applied).not.toHaveBeenCalled();
  expect(actual).toHaveLength(ordinary.length);
  for (const [i, mesh] of actual.entries()) {
    const a = mesh.material, b = ordinary[i].material;
    expect(a.isNodeMaterial).not.toBe(true);
    const { uuid: _a, ...actualJSON } = a.toJSON(), { uuid: _b, ...ordinaryJSON } = b.toJSON();
    expect(actualJSON).toEqual(ordinaryJSON);
    for (const slot of ['colorNode', 'emissiveNode', 'positionNode', 'opacityNode']) expect(a[slot]).toBeUndefined();
  }
  const cache = await result.parser.getDependencies('material');
  for (const mesh of actual) {
    const index = result.parser.associations.get(mesh.material).materials;
    expect(await result.parser.getDependency('material', index)).toBe(cache[index]);
    expect(cache[index].isNodeMaterial).not.toBe(true);
  }
  return { result, actual };
}
const badGraphs = [
  ['missing transform', (j) => { delete j.nodes.find((n) => n.mesh !== undefined).matrix; }],
  ['matrix shear', (j) => { j.nodes.find((n) => n.mesh !== undefined).matrix[4] = 0.5; }],
  ['matrix scale', (j) => { j.nodes.find((n) => n.mesh !== undefined).matrix[0] = 2; }],
  ['projective matrix', (j) => { j.nodes.find((n) => n.mesh !== undefined).matrix[3] = 0.5; }],
  ['short matrix', (j) => { j.nodes.find((n) => n.mesh !== undefined).matrix.pop(); }],
  ['matrix plus TRS', (j) => { j.nodes.find((n) => n.mesh !== undefined).translation = [1, 2, 3]; }],
  ['nonfinite raw matrix', (j) => { j.nodes.find((n) => n.mesh !== undefined).matrix[12] = null; }],
  ['unknown field', (_, n) => { n.extra = 1; }],
  ['unknown arg', (_, n) => { n.args.object = null; }],
  ['missing arg', (_, n) => { delete n.args.uniformType; }],
  ['missing args', (_, n) => { delete n.args; }],
  ['array args', (_, n) => { n.args = ['position', 'vec3']; }],
  ['wrong selector', (_, n) => { n.args.property = 'scale'; }],
  ['nested selector', (_, n) => { n.args.property = 'position.x'; }],
  ['wrong type', (_, n) => { n.args.uniformType = 'float'; }],
  ['extra link', (_, n, e) => { n.links = { node: { $ref: e.entrypoints.opacityNode } }; }],
  ['broken link', (_, n) => { n.links = { node: { $ref: 'missing' } }; }],
  ['malformed ref', (_, n, e) => { n.links = { node: { $ref: e.entrypoints.opacityNode, extra: 1 } }; }],
  ['cycle', (_, n, e) => { n.links = { node: { $ref: e.entrypoints.colorNode } }; }],
  ['invalid unreachable', (_, n, e) => { e.nodes.unreachable = { ...n, args: { ...n.args, property: 'absent' } }; }],
  ['unreachable cycle', (_, n, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'unreachable' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['unreachable dangling ref', (_, n, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'absent' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['invalid late entrypoint', (_, n, e) => { e.entrypoints.unknownNode = e.entrypoints.colorNode; }],
  ['multiple primitives', (j) => { j.meshes[0].primitives.push(structuredClone(j.meshes[0].primitives[0])); }],
  ['uninstantiated node', (j) => { j.nodes.push({ mesh: 0, matrix: new Matrix4().makeTranslation(1, 2, 3).elements }); }],
  ['camera wrapper', (j) => { j.cameras = [{ type: 'perspective', perspective: { yfov: 0.7, znear: 0.1 } }]; j.nodes.find((n) => n.mesh !== undefined).camera = 0; }],
  ['pivot metadata', (j) => { j.nodes.find((n) => n.mesh !== undefined).extras = { pivot: [1, 2, 3] }; }]
];
it.each(badGraphs)('retains complete ordinary material, extensions and dependency caches: %s', async (_, mutate) => {
  const json = await exportScene(fixture().scene), e = json.materials[0].extensions[extensionName];
  mutate(json, e.nodes[e.entrypoints.colorNode], e);
  await expectFallback(json);
});

it.each(['missing', 'short', 'negative zero', 'nonfinite', 'zero', 'scale', 'rotation'])(
  'rejects malformed TRS on import: %s', async (mode) => {
    const json = await exportScene(fixture().scene, { trs: true });
    const def = json.nodes.find((n) => n.mesh !== undefined);
    if (mode === 'missing') delete def.translation;
    if (mode === 'short') def.translation.pop();
    if (mode === 'negative zero') return expectFallback(JSON.stringify(json).replace('1.25,-2.5,3.75', '-0,-2.5,3.75'));
    if (mode === 'nonfinite') def.translation[0] = null;
    if (mode === 'zero') def.translation = [0, 0, 0];
    if (mode === 'scale') def.scale = [2, 1, 1];
    if (mode === 'rotation') def.rotation = [0.1, 0, 0, 1];
    await expectFallback(json);
  }
);

it.each(['mismatch', 'nonfinite', 'accessor', 'wrapper', 'clone', 'association'])(
  'checks actual native render-object identity and position after loader hooks: %s', async (mode) => {
    const json = await exportScene(fixture().scene);
    await expectFallback(json, (parser) => ({ name: 'alter-native-owner', afterRoot(result) {
      const mesh = meshes(result.scene)[1];
      if (mode === 'mismatch') mesh.position.x += 1;
      if (mode === 'nonfinite') mesh.position.z = Infinity;
      if (mode === 'accessor') {
        mesh.matrixAutoUpdate = false; // Keep native post-hook world update from invoking the test accessor.
        Object.defineProperty(mesh.position, 'x', { get() { throw new Error('must not invoke position getter'); } });
      }
      if (mode === 'wrapper' || mode === 'clone') {
        const parent = mesh.parent; parent.remove(mesh);
        if (mode === 'wrapper') { const wrapper = new Group(); wrapper.add(mesh); parent.add(wrapper); parser.cache.add(`node:${parser.associations.get(mesh).nodes}`, Promise.resolve(wrapper)); }
        else { const copy = mesh.clone(); parent.add(copy); }
      }
      if (mode === 'association') parser.associations.set(mesh, { nodes: 100, meshes: 0, primitives: 0 });
    } }));
  }
);

it.each(['missing', 'mismatch', 'shear', 'nonfinite'])(
  'rechecks the actual exported node definitions: %s', async (mode) => {
    const { scene, mesh } = fixture();
    await expect(exportScene(scene, {}, () => ({ writeNode(object, def) {
      if (object !== mesh) return;
      if (mode === 'missing') delete def.matrix;
      if (mode === 'mismatch') def.matrix = new Matrix4().makeTranslation(100, 2, 3).elements;
      if (mode === 'shear') def.matrix[4] = 0.5;
      if (mode === 'nonfinite') def.matrix[12] = Infinity;
    } }))).rejects.toThrow(/ReferenceNode/);
  }
);

it.each([false, true])('preserves material clones, geometry ownership and live values twice (GLB=%s)', async (binary) => {
  const { scene, other } = fixture(false);
  other.geometry.deleteAttribute('normal');
  other.geometry.setAttribute('color', new Float32BufferAttribute(Array(other.geometry.attributes.position.count * 3).fill(1), 3));
  let current = scene;
  for (let round = 0; round < 2; round++) {
    const errors = [], result = await load(await exportScene(current, { binary }), errors);
    expect(errors).toEqual([]);
    const [a, b] = meshes(result.scene);
    expect(a.material).not.toBe(b.material);
    expect(b.material.flatShading).toBe(true); expect(b.material.vertexColors).toBe(true);
    if (round === 0) expect(a.material.colorNode).toBe(b.material.colorNode);
    for (const mesh of [a, b]) {
      expect(update(mesh.material.colorNode, mesh)).toEqual(mesh.position.toArray());
      mesh.position.x += 0.125;
      expect(update(mesh.material.colorNode, mesh)).toEqual(mesh.position.toArray());
    }
    current = result.scene;
  }
  const json = await exportScene(scene);
  delete json.nodes.find((n) => n.mesh === 1).matrix;
  const { actual } = await expectFallback(json);
  expect(actual[0].material).not.toBe(actual[1].material);
  expect(actual[1].material.flatShading).toBe(true); expect(actual[1].material.vertexColors).toBe(true);
});

it('checks distinct nodes in multiple scenes and rejects unproven reused scene roots', async () => {
  const { scene, material } = fixture();
  const second = new Scene(), mesh = new Mesh(new BoxGeometry(), material);
  mesh.position.set(7, 8, 9); second.add(mesh);
  const json = await exportScene([scene, second]), errors = [], result = await load(json, errors);
  expect(errors).toEqual([]); expect(result.scenes).toHaveLength(2);
  expect(update(meshes(result.scenes[1])[0].material.colorNode, meshes(result.scenes[1])[0])).toEqual([7, 8, 9]);
  // Native GLTFLoader scenes are Groups; wrap each in a Scene to preserve
  // scene partitioning on native re-export without changing render-Mesh locals.
  const exportScenes = result.scenes.map((group) => new Scene().add(group));
  const repeatedErrors = [], repeated = await load(await exportScene(exportScenes), repeatedErrors);
  expect(repeatedErrors).toEqual([]); expect(repeated.scenes).toHaveLength(2);
  expect(repeated.scenes.flatMap(meshes).map((m) => update(m.material.colorNode, m))).toEqual([[1.25, -2.5, 3.75], [-4, 5, 6], [7, 8, 9]]);
  const invalid = structuredClone(json);
  delete invalid.nodes.find((n) => n.matrix?.[12] === 7).matrix;
  await expectFallback(invalid);
  json.scenes.push(structuredClone(json.scenes[0]));
  await expectFallback(json);
});

it('ignores nonexported hidden meshes and graphs excluded by selected entrypoints', async () => {
  const { scene, other, material } = fixture();
  other.visible = false; other.position.x = Infinity;
  expect(meshes((await load(await exportScene(scene))).scene)).toHaveLength(1);
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, {
    nodeSerializer: createDefaultNodeSerializer(), entrypoints: ['opacityNode']
  }));
  material.colorNode.object = new Mesh();
  const graph = (await exporter.parseAsync(scene)).materials[0].extensions[extensionName];
  expect(Object.values(graph.nodes)).toEqual([{ op: 'time' }]);
});

it.each([false, true])('packs live native vec3 uniforms for each object before and after import (WGSL=%s)', async (gpu) => {
  let { scene } = fixture();
  for (let round = 0; round < 2; round++) {
    const [a, b] = meshes(scene), node = a.material.colorNode;
    const { builder, code } = shader(a.material.positionNode, a, gpu, 'vertex');
    expect(code.uniforms).toContain(gpu ? 'var<uniform> object' : 'object {');
    expect(builder.updateNodes).toContain(node);
    expect(builder.updateBeforeNodes).toEqual([]); expect(builder.updateAfterNodes).toEqual([]);
    const binding = builder.getBindings().find((g) => g.name === 'object').bindings[0];
    expect(binding.groupNode).toBe(TSL.objectGroup);
    expect(binding.groupNode.shared).toBe(false); expect(binding.groupNode.order).toBe(1);
    expect(binding.uniforms).toHaveLength(1);
    const frame = new NodeFrame();
    for (const mesh of [a, b, a]) {
      mesh.position.x += 0.125;
      update(node, mesh, frame);
      binding.update();
      const offset = binding.uniforms[0].offset;
      expect(Array.from(binding.buffer.slice(offset, offset + 3))).toEqual(mesh.position.toArray());
    }
    scene = (await load(await exportScene(scene))).scene;
  }
});

it.each(['scale', 'quaternion', 'missing geometry position', 'nontriangle geometry'])(
  'rejects incompatible actual imported mesh state: %s', async (mode) => {
    const json = await exportScene(fixture().scene);
    await expectFallback(json, () => ({ name: 'alter-native-transform', afterRoot(result) {
      const mesh = meshes(result.scene)[1];
      if (mode === 'scale') mesh.scale.y = Infinity;
      if (mode === 'quaternion') mesh.quaternion.x = NaN;
      if (mode === 'missing geometry position') mesh.geometry.deleteAttribute('position');
      if (mode === 'nontriangle geometry') mesh.geometry.index.count = 2;
    } }));
  }
);

it('checks invalid unreachable position definitions against object ownership too', async () => {
  const data = fixture(); data.material.colorNode = TSL.vec3(1); data.material.emissiveNode = null;
  data.material.positionNode = null;
  const json = await exportScene(data.scene);
  json.materials[0].extensions[extensionName].nodes.unreachable = { op: 'ReferenceNode', args: { property: 'position', uniformType: 'vec3' } };
  delete json.nodes.find((n) => n.mesh !== undefined).matrix;
  await expectFallback(json);
});

it('demonstrates native fixed-matrix loss and primitive/wrapper retargeting before rejecting them', async () => {
  const { scene, other } = fixture();
  other.matrixAutoUpdate = false; // Stale identity matrix disagrees with the live position.
  const native = new GLTFExporter();
  const ordinary = await load(await native.parseAsync(scene), [], false);
  expect(meshes(ordinary.scene)[1].position.toArray()).toEqual([0, 0, 0]);
  expect(other.position.toArray()).toEqual([-4, 5, 6]);
  await expect(exportScene(scene)).rejects.toThrow(/ReferenceNode/);

  const json = await exportScene(fixture().scene);
  json.meshes[0].primitives.push(structuredClone(json.meshes[0].primitives[0]));
  const { result, actual } = await expectFallback(json);
  const group = result.scene.children[0].children[0];
  expect(group.isGroup).toBe(true); expect(group.position.toArray()).toEqual([1.25, -2.5, 3.75]);
  for (const mesh of actual) expect(mesh.position.toArray()).toEqual([0, 0, 0]);
});

it('does not infer object ownership from matching names, positions, geometry or material', async () => {
  const { scene, mesh, other } = fixture();
  other.name = mesh.name = 'same-name'; other.position.copy(mesh.position);
  const json = await exportScene(scene);
  await expectFallback(json, () => ({ name: 'replace-with-identical-clone', afterRoot(result) {
    const mesh = meshes(result.scene)[1], parent = mesh.parent, clone = mesh.clone();
    parent.remove(mesh); parent.add(clone);
  } }));
});

it('preserves consumer override ownership after a previous default serialization', async () => {
  const { scene, material, mesh } = fixture();
  await exportScene(scene);
  material.colorNode.object = mesh;
  const exporter = new GLTFExporter();
  exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, {
    nodeSerializer: createDefaultNodeSerializer({ overrides: { ReferenceNode: () => ({ op: 'ConsumerPosition', args: { bindingId: 'hero' } }) } })
  }));
  const json = await exporter.parseAsync(scene);
  const graph = json.materials[0].extensions[extensionName];
  expect(graph.nodes[graph.entrypoints.colorNode]).toEqual({ op: 'ConsumerPosition', args: { bindingId: 'hero' } });
});

it('accepts a legitimate native type-only lazy uniform without transporting its cache', async () => {
  const { scene, material, mesh } = fixture(), node = material.colorNode;
  node.updateReference({ object: mesh }); node.setNodeType('vec3');
  expect(node.node.value).toBeNull();
  const errors = [], result = await load(await exportScene(scene), errors);
  expect(errors).toEqual([]);
  const imported = meshes(result.scene)[0];
  expect(imported.material.colorNode.node).toBeNull();
  expect(update(imported.material.colorNode, imported)).toEqual(imported.position.toArray());
});

it.each([false, true])('rejects altered implicit default group configuration (built=%s)', async (built) => {
  const { scene, material, mesh } = fixture();
  if (built) update(material.colorNode, mesh);
  const original = TSL.objectGroup.order;
  try {
    TSL.objectGroup.order = 100;
    await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
  } finally { TSL.objectGroup.order = original; }
});

it('never invokes runtime identity coercion or debug-cache callbacks during export', async () => {
  const { scene, material, mesh } = fixture(), callback = vi.fn(() => { throw new Error('runtime callback invoked'); });
  update(material.colorNode, mesh);
  material.colorNode.stackTrace = Object.defineProperty({}, 'trace', { get: callback, enumerable: true });
  await exportScene(scene);
  material.colorNode.node._uuid = { toString: callback };
  await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
  expect(callback).not.toHaveBeenCalled();
});

it.each(['operator', 'math'])('never recursively snapshots reference uniform values from a parent %s', async (kind) => {
  const { scene, material, mesh } = fixture(), node = material.colorNode;
  material.positionNode = kind === 'math' ? node.normalize() : node.add(node);
  update(node, mesh);
  const callback = vi.fn(() => { throw new Error('must not snapshot runtime vector'); });
  mesh.position.toArray = callback; // Native direct transform output would also call this in TRS mode.
  await exportScene(scene); // Matrix mode never needs Vector3.toArray().
  expect(callback).not.toHaveBeenCalled();
});

it.each(['mesh cache association', 'primitive material association'])(
  'rejects mismatched exported ownership despite matching transforms: %s', async (mode) => {
    const { scene, mesh, other } = fixture(false);
    other.position.copy(mesh.position);
    await expect(exportScene(scene, {}, () => ({
      writeNode(object, def) { if (mode === 'mesh cache association' && object === other) def.mesh = 0; },
      writeMesh(object, def) { if (mode === 'primitive material association' && object === mesh) delete def.primitives[0].material; }
    }))).rejects.toThrow(/ReferenceNode/);
  }
);

it('retains the exact native material and clone objects in caches on failed binding', async () => {
  const { scene, other } = fixture(false);
  other.geometry.deleteAttribute('normal');
  other.geometry.setAttribute('color', new Float32BufferAttribute(Array(other.geometry.attributes.position.count * 3).fill(1), 3));
  const json = await exportScene(scene);
  delete json.nodes.find((n) => n.mesh === 1).matrix;
  let originals, primitiveMaterials;
  const loader = new GLTFLoader(), errors = [], applied = vi.fn();
  loader.register((parser) => ({ name: 'capture-native-materials', async beforeRoot() {
    originals = await parser.getDependencies('material');
  }, afterRoot(result) { primitiveMaterials = meshes(result.scene).map((m) => m.material); } }));
  loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
    nodeResolver: createDefaultNodeResolver(), onError: (e) => errors.push(e), onApplied: applied
  }));
  const result = await loader.parseAsync(JSON.stringify(json), '');
  expect(errors).toHaveLength(1); expect(applied).not.toHaveBeenCalled();
  const cached = await result.parser.getDependencies('material');
  expect(cached).toEqual(originals);
  for (const [i, material] of originals.entries()) expect(await result.parser.getDependency('material', i)).toBe(material);
  for (const [i, mesh] of meshes(result.scene).entries()) expect(mesh.material).toBe(primitiveMaterials[i]);
  expect(primitiveMaterials[0]).not.toBe(primitiveMaterials[1]);
  expect(primitiveMaterials[1].flatShading).toBe(true); expect(primitiveMaterials[1].vertexColors).toBe(true);
});

it.each(['uniform isNode', 'uniform version', 'implicit group version'])(
  'rejects cache accessors before native discovery or shared validation: %s', async (mode) => {
    const { scene, material, mesh } = fixture(), callback = vi.fn(() => 1);
    update(material.colorNode, mesh);
    const object = mode === 'implicit group version' ? TSL.objectGroup : material.colorNode.node;
    const key = mode === 'uniform isNode' ? 'isNode' : 'version';
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    try {
      Object.defineProperty(object, key, { get: callback, configurable: true });
      await expect(exportScene(scene)).rejects.toThrow(/Unsupported/);
      expect(callback).not.toHaveBeenCalled();
    } finally { Object.defineProperty(object, key, descriptor); }
  }
);

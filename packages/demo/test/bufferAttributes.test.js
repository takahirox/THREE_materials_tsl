import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BufferAttribute, Float32BufferAttribute, BufferGeometry, BoxGeometry, Mesh, Scene, InstancedMesh,
  SkinnedMesh, InterleavedBuffer, InterleavedBufferAttribute, InstancedBufferAttribute, DynamicDrawUsage, IntType, Vector3 } from 'three';
import { BufferAttributeNode, MeshPhysicalNodeMaterial, GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
import SourceBufferAttributeNode from 'three/src/nodes/accessors/BufferAttributeNode.js';
import RenderObject from 'three/src/renderers/common/RenderObject.js';
import Attributes from 'three/src/renderers/common/Attributes.js';
import { AttributeType } from 'three/src/renderers/common/Constants.js';
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

const typeFor = (width) => ['float', 'vec2', 'vec3', 'vec4'][width - 1];
function fixture(width = 3, explicit = false, count = 3, cached = true) {
  const data = new Float32BufferAttribute(Array.from({ length: width * count }, (_, i) => (i % 19 - 9) / 8), width);
  const node = TSL.bufferAttribute(data, explicit ? typeFor(width) : null);
  const material = new MeshPhysicalNodeMaterial({ clearcoat: 0.4, roughness: 0.6, metalness: 0.3,
    transmission: 0.2, thickness: 0.3, ior: 1.6 });
  material.color.setRGB(0.2, 0.4, 0.6);
  material.colorNode = node; material.emissiveNode = node;
  material.positionNode = TSL.positionLocal.add(TSL.vec3(node).mul(0.01)); material.opacityNode = TSL.time;
  const geometry = new BufferGeometry();
  const positions = [];
  for (let i = 0; i < count; i++) positions.push(i === 1 ? 1 : 0, i >= 2 ? 1 + i / 4096 : 0, 0);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // An indexed triangle permits minimum/maximum vertex counts too.
  geometry.setIndex(count === 1 ? [0, 0, 0] : [0, 1, count - 1]);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material), new Mesh(cached ? geometry : geometry.clone(), material));
  return { scene, material, node, data, mesh: scene.children[0] };
}
function shader(node, geometry, gpu, stage) {
  const renderer = { backend: { isWebGPUBackend: gpu }, library: new StandardNodeLibrary(),
    debug: { diagnostics: { keywords: false } } };
  const builder = new (gpu ? WGSLNodeBuilder : GLSLNodeBuilder)(new Mesh(geometry, new MeshPhysicalNodeMaterial()), renderer);
  builder.setShaderStage(stage);
  // flowStagesNode restores the builder's previous vars. Keep its actual
  // per-flow variable table for the native WGSL varying declaration pass.
  let variables;
  const getVars = builder.getVars.bind(builder);
  builder.getVars = (...args) => { variables = builder.vars; return getVars(...args); };
  const flow = builder.flowStagesNode(node, node.getNodeType(builder));
  builder.vars = variables;
  // A standalone flow omits the surrounding material pipeline, which normally
  // establishes both stage tables before WGSL declares non-interpolated vars.
  builder.vars.vertex ??= []; builder.vars.fragment ??= [];
  const normalize = (v) => v.replace(/nodeAttribute\d+/g, 'nodeAttributeID').replace(/nodeVarying\d+/g, 'nodeVaryingID');
  const code = { result: normalize(flow.result), code: normalize(flow.code), vars: normalize(flow.vars), vertex: normalize(builder.flowCode.vertex),
    attributes: normalize(builder.getAttributes('vertex')), varyingVertex: normalize(builder.getVaryings('vertex')),
    varyingFragment: normalize(builder.getVaryings('fragment')) };
  return { builder, code };
}
const variants = [1, 2, 3, 4].flatMap((width) => [false, true].flatMap((explicit) =>
  [false, true].flatMap((binary) => [1, 3, 4096].map((count) => [width, explicit, binary, count]))));
it.each(variants)('round-trips width %s (explicit=%s GLB=%s count=%s) twice with native attributes, stages and sharing', async (width, explicit, binary, count) => {
  const source = fixture(width, explicit, count);
  let scene = source.scene;
  const values = Array.from(source.data.array);
  const flows = (node, geometry) => [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => {
    const { builder, code } = shader(node, geometry, gpu, stage);
    expect(builder.bufferAttributes).toHaveLength(1);
    expect(builder.bufferAttributes[0].node.attribute).toBe(node.value);
    expect(code.attributes).toContain(gpu ? '@location' : 'layout( location');
    if (stage === 'fragment') {
      expect(code.vertex).toContain('nodeAttribute');
      expect(code.varyingFragment).toContain('nodeVarying');
    }
    return code;
  }));
  const expected = flows(source.node, source.mesh.geometry);
  for (let round = 0; round < 2; round++) {
    const json = await exportScene(scene);
    const e = json.materials[0].extensions[extensionName], n = e.nodes[e.entrypoints.colorNode];
    expect(n.op).toBe('BufferAttributeNode');
    expect(n.args).toEqual({ bufferType: explicit ? typeFor(width) : null });
    expect(Object.keys(n.links)).toEqual(['value']);
    expect(e.entrypoints.emissiveNode).toBe(e.entrypoints.colorNode);
    const accessorIndex = n.links.value.$refAccessor, accessor = json.accessors[accessorIndex];
    expect(accessor).toMatchObject({ componentType: 5126, count, type: ['SCALAR', 'VEC2', 'VEC3', 'VEC4'][width - 1] });
    expect(accessor.normalized).toBeUndefined();
    expect(json.bufferViews[accessor.bufferView].target).toBeUndefined();
    expect(json.bufferViews[accessor.bufferView].byteStride).toBeUndefined();
    expect(json.meshes[0].primitives[0].attributes.POSITION).not.toBe(accessorIndex);
    const errors = [], loaded = await load(binary ? await exportScene(scene, true) : json, errors);
    expect(errors).toEqual([]);
    const [a, b] = meshes(loaded.scene), actual = a.material.colorNode;
    expect(a.material).toBe(b.material); expect(a.geometry).toBe(b.geometry);
    expect(actual).toBeInstanceOf(BufferAttributeNode); expect(actual.attribute).toBe(actual.value);
    expect(actual.value).not.toBe(source.data); expect(actual.value).toBeInstanceOf(BufferAttribute);
    expect(actual.value.itemSize).toBe(width); expect(actual.value.count).toBe(count);
    expect(Array.from(actual.value.array)).toEqual(values);
    expect(actual.nodeType).toBe(explicit ? typeFor(width) : null);
    expect(actual.bufferType).toBe(explicit ? typeFor(width) : null);
    expect(a.material.emissiveNode).toBe(actual);
    const children = []; a.material.positionNode.traverse((n) => children.push(n));
    expect(children).toContain(actual);
    expect(a.material.opacityNode).toBe(TSL.time);
    expect(a.material.color.toArray()).toEqual(source.material.color.toArray());
    for (const key of ['clearcoat', 'transmission', 'thickness', 'ior', 'metalness', 'roughness']) expect(a.material[key]).toBeCloseTo(source.material[key]);
    expect(flows(actual, a.geometry)).toEqual(expected);
    scene = loaded.scene;
  }
});

it.each([false, true])('native render-object binding and version-based updates use the resolved attribute (WGSL=%s)', async (gpu) => {
  const f = fixture();
  const loaded = await load(await exportScene(f.scene));
  for (const mesh of [f.mesh, ...meshes(loaded.scene)]) {
    const node = mesh.material.colorNode, { builder } = shader(node, mesh.geometry, gpu, 'fragment');
    const renderObject = { attributes: null, geometry: mesh.geometry, getNodeBuilderState: () => ({ nodeAttributes: builder.getAttributesArray() }) };
    const attributes = RenderObject.prototype.getAttributes.call(renderObject);
    expect(attributes).toEqual([node.attribute]);
    expect(renderObject.vertexBuffers).toEqual([node.value]);
    const create = vi.fn(), update = vi.fn();
    const manager = new Attributes({ createAttribute: create, updateAttribute: update }, { createAttribute() {} });
    manager.update(attributes[0], AttributeType.VERTEX);
    manager.update(attributes[0], AttributeType.VERTEX);
    expect(create).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledWith(node.value); expect(update).not.toHaveBeenCalled();
    node.value.array[0] = 0.875; node.value.needsUpdate = true;
    manager.update(attributes[0], AttributeType.VERTEX);
    expect(update).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledWith(node.value);
    expect(update.mock.calls[0][0].array[0]).toBe(0.875);
    expect(node.attribute).toBe(node.value);
  }
});

it('preserves one accessor and native hash sharing for distinct nodes using one attribute, with material-local graphs', async () => {
  const f = fixture();
  f.material.emissiveNode = TSL.bufferAttribute(f.data, 'vec3');
  const other = f.material.clone();
  f.scene.add(new Mesh(f.mesh.geometry, other));
  for (let round = 0; round < 2; round++) {
    const json = await exportScene(f.scene), nodes = Object.values(json.materials[0].extensions[extensionName].nodes).filter((n) => n.op === 'BufferAttributeNode');
    expect(nodes).toHaveLength(2); expect(nodes[0].links).toEqual(nodes[1].links);
    const errors = [], result = await load(json, errors); expect(errors).toEqual([]);
    const [a, , b] = meshes(result.scene);
    expect(a.material.colorNode).not.toBe(a.material.emissiveNode);
    expect(a.material.colorNode.value).toBe(a.material.emissiveNode.value);
    expect(a.material.colorNode).not.toBe(b.material.colorNode);
    const { builder } = shader(a.material.colorNode, a.geometry, false, 'vertex');
    expect(a.material.colorNode.getHash(builder)).toBe(a.material.emissiveNode.getHash(builder));
    f.scene = result.scene;
  }
});

it.each([BufferAttributeNode, SourceBufferAttributeNode])('accepts exact native class %s and binary Float32 subviews, including negative zero', async (Ctor) => {
  const f = fixture();
  const values = new Float32Array([99, -0, 1.401298464324817e-45, 3.4028234663852886e38, 1, 2, 3, 4, 5, 6, 99]);
  f.material.colorNode = new Ctor(new BufferAttribute(values.subarray(1, 10), 3));
  const errors = [], result = await load(await exportScene(f.scene, true), errors); expect(errors).toEqual([]);
  const n = meshes(result.scene)[0].material.colorNode;
  expect(Array.from(n.value.array)).toEqual(Array.from(values.subarray(1, 10)));
  expect(Object.is(n.value.array[0], -0)).toBe(true);
  expect(n.attribute).toBe(n.value);
});

const badNodes = [
  ['raw Float32 array', (n) => new BufferAttributeNode(n.value.array, 'vec3')],
  ['interleaved', () => new BufferAttributeNode(new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(9), 3), 3, 0))],
  ['interleaved buffer', () => new BufferAttributeNode(new InterleavedBuffer(new Float32Array(9), 3), 'vec3')],
  ['instanced attribute', () => new BufferAttributeNode(new InstancedBufferAttribute(new Float32Array(9), 3))],
  ['instancing', (n) => TSL.instancedBufferAttribute(n.value).setInstanced(true)],
  ['dynamic factory', (n) => TSL.dynamicBufferAttribute(n.value)],
  ['subclass', (n) => new (class extends BufferAttributeNode {})(n.value)],
  ['attribute subclass', () => new BufferAttributeNode(new (class extends BufferAttribute {})(new Float32Array(9), 3))],
  ...['bufferStride', 'bufferOffset'].map((key) => [key, (n) => { n[key] = 1; }]),
  ...['mat3', 'mat4', 'int', 'uint', 'bool', 'color', 'vec4', 'unknown'].map((type) => [type, (n) => new BufferAttributeNode(n.value, type)]),
  ['mismatched base type', (n) => { n.nodeType = 'vec4'; }],
  ['explicit with null bufferType', (n) => { n.nodeType = 'vec3'; n.bufferType = null; }],
  ['stale attribute', (n) => { n.attribute = n.value.clone(); }],
  ['absent attribute', (n) => { n.attribute = null; }],
  ...['name', 'precision', 'global', 'parents', 'updateType', 'updateBeforeType', 'updateAfterType', 'extra', '_extra'].map((key) =>
    [key, (n) => { n[key] = key.includes('extra') ? TSL.float(1) : 'custom'; }]),
  ['node callback', (n) => { n.update = () => {}; }],
  ['before attachment', (n) => { n.before(TSL.float(1)); }],
  ['symbol', (n) => { n[Symbol('state')] = 1; }],
  ...['name', 'usage', 'gpuType', 'normalized', 'extra'].map((key) => ["attribute " + key, (n) => { n.value[key] = key === 'usage' ? DynamicDrawUsage : key === 'gpuType' ? IntType : 'changed'; }]),
  ['attribute callback', (n) => { n.value.onUpload(() => {}); }],
  ['attribute event', (n) => { n.value.addEventListener('event', () => {}); }],
  ['pending ranges', (n) => { n.value.addUpdateRange(0, 1); }],
  ['sparse ranges', (n) => { n.value.updateRanges.length = 1; }],
  ['decorated ranges', (n) => { n.value.updateRanges.extra = 1; }],
  ['decorated typed array', (n) => { n.value.array.extra = 1; }],
  ...[Float64Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array].map((Type) =>
    [Type.name, () => new BufferAttributeNode(new BufferAttribute(new Type(9), 3))]),
  ['array subclass', () => new BufferAttributeNode(new BufferAttribute(new (class extends Float32Array {})(9), 3))],
  ['shared buffer', () => new BufferAttributeNode(new BufferAttribute(new Float32Array(new SharedArrayBuffer(36)), 3))],
  ...[0, 5, 9, 16, 1.5].map((width) => ['width ' + width, () => new BufferAttributeNode(new BufferAttribute(new Float32Array(18), width))]),
  ...[0, 4097].map((count) => ['count ' + count, () => new BufferAttributeNode(new Float32BufferAttribute(new Float32Array(count * 3), 3))]),
  ['fractional count', () => new BufferAttributeNode(new Float32BufferAttribute(new Float32Array(10), 3))],
  ...[NaN, Infinity, -Infinity].map((v) => ['nonfinite ' + v, (n) => { n.value.array[1] = v; }])
];
it.each(badNodes)('rejects unsupported source node/attribute: %s', async (_, configure) => {
  const f = fixture(), result = configure(f.node);
  f.material.colorNode = result?.isNode ? result : f.node;
  await expect(exportScene(f.scene)).rejects.toThrow(/unsupported|Unsupported/);
});
it.each(['node', 'attribute'])('rejects hidden state accessors without invoking them on %s', async (kind) => {
  const f = fixture(), getter = vi.fn();
  Object.defineProperty(kind === 'node' ? f.node : f.data, 'unknown', { get: getter });
  await expect(exportScene(f.scene)).rejects.toThrow(/BufferAttributeNode/);
  expect(getter).not.toHaveBeenCalled();
});

const badMeshes = [
  ['count mismatch', (f) => { f.scene.children[1].geometry = new BoxGeometry(); }],
  ['missing position', (f) => { f.mesh.geometry.deleteAttribute('position'); }],
  ['index outside attribute', (f) => { f.mesh.geometry.index.array[1] = 3; }],
  ['nontriangle index', (f) => { f.mesh.geometry.setIndex([0, 1]); }],
  ['draw range', (f) => { f.mesh.geometry.setDrawRange(0, 3); }],
  ['geometry alias', (f) => { f.mesh.geometry.setAttribute('color', f.data); }],
  ['geometry array alias', (f) => { f.mesh.geometry.setAttribute('color', new BufferAttribute(f.data.array, 3)); }],
  ['geometry backing-memory alias', (f) => { f.mesh.geometry.setAttribute('color', new BufferAttribute(new Float32Array(f.data.array.buffer), 3)); }],
  ['morphs', (f) => { f.mesh.geometry.morphAttributes.position = [f.mesh.geometry.attributes.position.clone()]; }],
  ['material array', (f) => { f.scene.children[1].material = [f.material]; }],
  ['wireframe', (f) => { f.material.wireframe = true; }],
  ['pivot on cached mesh', (f) => { f.scene.children[1].pivot = new Vector3(); }],
  ['mesh subclass on cached mesh', (f) => { f.scene.children[1] = new (class extends Mesh {})(f.mesh.geometry, f.material); }],
  ['instanced cached geometry', (f) => { f.scene.children[1] = new InstancedMesh(f.mesh.geometry, f.material, 1); }],
  ['skinned cached geometry', (f) => { f.scene.children[1] = new SkinnedMesh(f.mesh.geometry, f.material); }]
];
it.each(badMeshes)('rejects incompatible source geometry/object: %s', async (_, change) => {
  const f = fixture(); change(f);
  await expect(exportScene(f.scene)).rejects.toThrow();
});

async function expectFallback(json, prepare) {
  const ordinary = meshes((await load(json, [], false, prepare)).scene);
  const errors = [], actual = meshes((await load(json, errors, true, prepare)).scene);
  expect(errors).toHaveLength(1);
  expect(actual).toHaveLength(ordinary.length);
  for (const [i, mesh] of actual.entries()) {
    expect(mesh.material.isNodeMaterial).not.toBe(true);
    const { uuid: _a, ...a } = mesh.material.toJSON(), { uuid: _b, ...b } = ordinary[i].material.toJSON();
    expect(a).toEqual(b);
    for (const key of ['colorNode', 'emissiveNode', 'positionNode', 'opacityNode']) expect(mesh.material[key]).toBeUndefined();
  }
  return actual;
}
const badGraphs = [
  ['missing args', (_, n) => { delete n.args; }],
  ['array args', (_, n) => { n.args = []; }],
  ['unknown args', (_, n) => { n.args.bufferStride = 0; }],
  ['missing type', (_, n) => { delete n.args.bufferType; }],
  ['wrong type', (_, n) => { n.args.bufferType = 'vec4'; }],
  ['integer type', (_, n) => { n.args.bufferType = 'int'; }],
  ['missing links', (_, n) => { delete n.links; }],
  ['unknown links', (_, n) => { n.links.attribute = n.links.value; }],
  ['array link', (_, n) => { n.links.value = [n.links.value]; }],
  ['wrong ref kind', (_, n, e) => { n.links.value = { $ref: e.entrypoints.opacityNode }; }],
  ['cycle link', (_, n, e) => { n.links.value = { $ref: e.entrypoints.colorNode }; }],
  ['mixed ref', (_, n) => { n.links.value.$ref = 'n0'; }],
  ['decorated ref', (_, n) => { n.links.value.extra = 0; }],
  ...[-1, 99999, 0.5, null, '0'].map((ref) => ['bad ref ' + ref, (_, n) => { n.links.value.$refAccessor = ref; }]),
  ['missing accessor', (j, n) => { j.accessors[n.links.value.$refAccessor] = null; }],
  ['integer accessor', (_, n, e, a) => { a.componentType = 5125; }],
  ['normalized', (_, n, e, a) => { a.normalized = true; }],
  ['string normalized', (_, n, e, a) => { a.normalized = 'false'; }],
  ['matrix accessor', (_, n, e, a) => { a.type = 'MAT3'; }],
  ['empty accessor', (_, n, e, a) => { a.count = 0; }],
  ['oversized accessor', (_, n, e, a) => { a.count = 4097; }],
  ['fractional count', (_, n, e, a) => { a.count = 1.5; }],
  ['metadata count mismatch', (_, n, e, a) => { a.count = 2; }],
  ['metadata shape mismatch', (_, n, e, a) => { a.type = 'VEC2'; }],
  ['missing view', (_, n, e, a) => { delete a.bufferView; }],
  ['dangling view', (_, n, e, a) => { a.bufferView = 99999; }],
  ['sparse accessor', (_, n, e, a) => { a.sparse = {}; }],
  ['accessor extension', (_, n, e, a) => { a.extensions = {}; }],
  ['unaligned offset', (_, n, e, a) => { a.byteOffset = 1; }],
  ['overrun offset', (_, n, e, a) => { a.byteOffset = 4096; }],
  ['bad min', (_, n, e, a) => { a.min[0] = 9; }],
  ['bad max shape', (_, n, e, a) => { a.max = [1]; }],
  ['min wrong type', (_, n, e, a) => { a.min = 'min'; }],
  ['strided view', (_, n, e, a, v) => { v.byteStride = 12; }],
  ['index-target view', (_, n, e, a, v) => { v.target = 34963; }],
  ['view extension', (_, n, e, a, v) => { v.extensions = {}; }],
  ['view overrun', (_, n, e, a, v) => { v.byteLength = 999999; }],
  ['view unaligned', (_, n, e, a, v) => { v.byteOffset += 1; }],
  ['dangling buffer', (_, n, e, a, v) => { v.buffer = 99999; }],
  ['late bad slot', (_, n, e) => { e.entrypoints.unknownNode = e.entrypoints.colorNode; }],
  ['invalid unreachable', (_, n, e) => { e.nodes.unreachable = { ...n, args: { bufferType: 'mat4' } }; }],
  ['unreachable bad binding', (j, n, e) => { e.nodes.unreachable = structuredClone(n); e.nodes.unreachable.links.value.$refAccessor = j.meshes[0].primitives[0].attributes.POSITION; }],
  ['unreachable cycle', (_, n, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'unreachable' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['unreachable dangling ref', (_, n, e) => { e.nodes.unreachable = { op: 'OperatorNode', args: { op: '+' }, links: { aNode: { $ref: 'missing' }, bNode: { $ref: e.entrypoints.colorNode } } }; }],
  ['nontriangle primitive', (j) => { j.meshes[0].primitives[0].mode = 1; }],
  ['multiple primitives', (j) => { j.meshes[0].primitives.push(structuredClone(j.meshes[0].primitives[0])); }],
  ['geometry metadata mismatch', (j) => { j.accessors[j.meshes[0].primitives[0].attributes.POSITION].count = 2; }],
  ['nonfinite data', (j, n, e, a, v) => {
    const b = j.buffers[v.buffer], bytes = Buffer.from(b.uri.split(',')[1], 'base64');
    bytes.writeFloatLE(Infinity, (v.byteOffset ?? 0) + (a.byteOffset ?? 0));
    b.uri = 'data:application/octet-stream;base64,' + bytes.toString('base64');
  }],
  ['inaccessible accessor data', (j, n, e, a) => { a.bufferView = j.bufferViews.push({ buffer: j.buffers.push({ uri: 'data:application/octet-stream;base64,', byteLength: 36 }) - 1, byteOffset: 0, byteLength: 36 }) - 1; }]
];
it.each(badGraphs)('retains the entire ordinary physical material for invalid import: %s', async (_, mutate) => {
  const json = await exportScene(fixture().scene), e = json.materials[0].extensions[extensionName], n = e.nodes[e.entrypoints.colorNode];
  const a = json.accessors[n.links.value.$refAccessor], v = json.bufferViews[a.bufferView];
  mutate(json, n, e, a, v);
  await expectFallback(json);
});

it.each(['type', 'count', 'array', 'normalized', 'instanced', 'callback', 'child', 'ranges', 'geometry count', 'geometry index', 'stale value'])('validates native hydrated attributes and actual geometry after other loader hooks: %s', async (mode) => {
  const json = await exportScene(fixture().scene), e = json.materials[0].extensions[extensionName];
  const ref = e.nodes[e.entrypoints.colorNode].links.value.$refAccessor;
  await expectFallback(json, (parser) => ({ name: 'mutate-native', async afterRoot(result) {
    const a = await parser.getDependency('accessor', ref);
    if (mode === 'type') Object.setPrototypeOf(a, Float32BufferAttribute.prototype);
    if (mode === 'count') a.count = 2;
    if (mode === 'array') a.array = new Float64Array(a.array);
    if (mode === 'normalized') a.normalized = true;
    if (mode === 'instanced') a.isInstancedBufferAttribute = true;
    if (mode === 'callback') a.onUpload(() => {});
    if (mode === 'child') a.extra = TSL.float(1);
    if (mode === 'ranges') a.updateRanges.length = 1;
    if (mode === 'geometry count') meshes(result.scene)[1].geometry = new BoxGeometry();
    if (mode === 'geometry index') meshes(result.scene)[0].geometry.index.array[0] = 99;
    if (mode === 'stale value') { a.array = new Float32Array(9); }
  } }));
});

it.each([false, true])('keeps compatible geometry/material clones and atomically falls back for an incompatible second user (GLB=%s)', async (binary) => {
  const f = fixture(3, false, 3, false);
  const [first, second] = f.scene.children;
  first.geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  second.geometry.setAttribute('color', new Float32BufferAttribute(Array(9).fill(1), 3));
  let current = f.scene;
  for (let round = 0; round < 2; round++) {
    const errors = [], result = await load(await exportScene(current, binary), errors); expect(errors).toEqual([]);
    const [a, b] = meshes(result.scene);
    expect(a.material).not.toBe(b.material); expect(a.geometry).not.toBe(b.geometry);
    expect(a.material.isNodeMaterial).toBe(true); expect(b.material.isNodeMaterial).toBe(true);
    expect(b.material.flatShading).toBe(true); expect(b.material.vertexColors).toBe(true);
    expect(a.material.colorNode.attribute).toBe(a.material.colorNode.value);
    expect(b.material.colorNode.attribute).toBe(b.material.colorNode.value);
    if (round === 0) expect(a.material.colorNode).toBe(b.material.colorNode);
    current = result.scene;
  }
  const json = await exportScene(f.scene);
  json.accessors[json.meshes[1].primitives[0].attributes.POSITION].count = 2;
  const [a, b] = await expectFallback(json);
  expect(a.material).not.toBe(b.material); expect(b.material.vertexColors).toBe(true);
});

it('validates shared materials in all scenes, including cached geometry and an unused invalid primitive definition', async () => {
  const f = fixture(), second = new Scene();
  second.add(f.scene.children[1]);
  const json = await exportScene([f.scene, second]);
  const errors = [], result = await load(json, errors); expect(errors).toEqual([]);
  expect(result.scenes).toHaveLength(2);
  expect(meshes(result.scenes[0])[0].material).toBe(meshes(result.scenes[1])[0].material);
  const bad = structuredClone(json.meshes[0]);
  bad.primitives[0].attributes.POSITION = json.accessors.push({ ...json.accessors[bad.primitives[0].attributes.POSITION], count: 2 }) - 1;
  json.meshes.push(bad);
  const failures = [], fallback = await load(json, failures); expect(failures).toHaveLength(1);
  for (const scene of fallback.scenes) expect(meshes(scene)[0].material.isNodeMaterial).not.toBe(true);
});

it('supports native scene-root clones when every rendered mesh has compatible counts', async () => {
  const json = await exportScene(fixture().scene);
  json.scenes.push(structuredClone(json.scenes[0]));
  const errors = [], result = await load(json, errors); expect(errors).toEqual([]);
  expect(result.scenes).toHaveLength(2);
  for (const scene of result.scenes) {
    const node = meshes(scene)[0].material.colorNode;
    expect(node).toBeInstanceOf(BufferAttributeNode); expect(node.value).toBe(node.attribute);
  }
});

it('keeps the actual default behavior of r186 non-matrix native factories', async () => {
  const f = fixture();
  // r186's ordinary return branch omits setInstanced(instanced). The name of
  // the factory cannot establish instancing; validate the actual native state.
  const n = TSL.instancedBufferAttribute(f.data);
  expect(n.instanced).toBeUndefined();
  f.material.colorNode = n;
  const errors = [], result = await load(await exportScene(f.scene), errors); expect(errors).toEqual([]);
  expect(meshes(result.scene)[0].material.colorNode.instanced).toBeUndefined();
});

it('preserves non-indexed triangle values and independent attributes', async () => {
  const f = fixture(); f.mesh.geometry.setIndex(null);
  const errors = [], result = await load(await exportScene(f.scene), errors); expect(errors).toEqual([]);
  const mesh = meshes(result.scene)[0]; expect(mesh.geometry.index).toBeNull();
  expect(Array.from(mesh.material.colorNode.attribute.array)).toEqual(Array.from(f.data.array));
});

it.each([1, 2, 3, 4])('native backend update methods receive current Float32 values for width %s before and after import', async (width) => {
  const { default: WebGLAttributeUtils } = await import('three/src/renderers/webgl-fallback/utils/WebGLAttributeUtils.js');
  const { default: WebGPUAttributeUtils } = await import('three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js');
  const f = fixture(width), result = await load(await exportScene(f.scene));
  for (const node of [f.node, meshes(result.scene)[0].material.colorNode]) {
    node.value.array[0] = 0.5; node.value.needsUpdate = true;
    for (const gpu of [false, true]) {
      const upload = vi.fn();
      const utils = gpu ? new WebGPUAttributeUtils({ get: () => ({ buffer: {} }), device: { queue: { writeBuffer: upload } } }) :
        new WebGLAttributeUtils({ get: () => ({ bufferType: 34962, bufferGPU: {} }), gl: { bindBuffer() {}, bufferSubData: upload } });
      utils.updateAttribute(node.attribute);
      expect(upload).toHaveBeenCalledTimes(1); expect(upload.mock.calls[0][2]).toBe(node.value.array);
      expect(upload.mock.calls[0][2][0]).toBe(0.5);
    }
  }
});

it('leaves unselected graphs and hidden incompatible users outside export scope', async () => {
  const f = fixture(); f.scene.children[1].visible = false; f.scene.children[1].geometry = new BoxGeometry();
  const errors = [], result = await load(await exportScene(f.scene), errors); expect(errors).toEqual([]);
  expect(meshes(result.scene)).toHaveLength(1);
  f.node.bufferStride = 1;
  const ordinary = await load(await exportScene(f.scene, false, { entrypoints: ['opacityNode'] }), errors);
  expect(errors).toEqual([]); expect(meshes(ordinary.scene)[0].material.opacityNode).toBe(TSL.time);
});

it.each([1, 2, 3, 4])('native WGSL vertex layout retains Float32 stride, format and per-vertex stepping for width %s', async (width) => {
  const { default: WebGPUAttributeUtils } = await import('three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js');
  const f = fixture(width), result = await load(await exportScene(f.scene));
  for (const node of [f.node, meshes(result.scene)[0].material.colorNode]) {
    const utils = new WebGPUAttributeUtils({});
    expect(utils.createShaderVertexBuffers({ getAttributes: () => [node.attribute] })).toEqual([{
      arrayStride: width * 4, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: width === 1 ? 'float32' : `float32x${width}` }]
    }]);
  }
});

it.each([1, 2, 3, 4])('preserves native per-vertex displacement expression and fragment interpolation for width %s', async (width) => {
  const f = fixture(width);
  const flows = (material, geometry) => [false, true].flatMap((gpu) => ['vertex', 'fragment'].map((stage) => shader(material.positionNode, geometry, gpu, stage).code));
  const expected = flows(f.material, f.mesh.geometry);
  let scene = f.scene;
  for (let round = 0; round < 2; round++) {
    const errors = [], result = await load(await exportScene(scene, round === 1), errors); expect(errors).toEqual([]);
    const mesh = meshes(result.scene)[0];
    expect(flows(mesh.material, mesh.geometry)).toEqual(expected);
    expect(mesh.geometry.attributes.position.getX(1)).toBe(1);
    expect(mesh.geometry.attributes.position.getY(2)).toBeGreaterThan(1);
    scene = result.scene;
  }
});

it('rejects distinct graph attributes sharing backing memory instead of silently separating live aliases', async () => {
  const f = fixture();
  f.material.emissiveNode = TSL.bufferAttribute(new BufferAttribute(f.data.array.subarray(), 3));
  await expect(exportScene(f.scene)).rejects.toThrow(/BufferAttributeNode/);
});

it('falls back atomically for distinct accessor definitions aliasing one native bufferView', async () => {
  const json = await exportScene(fixture().scene), e = json.materials[0].extensions[extensionName];
  const first = e.nodes[e.entrypoints.colorNode], ref = first.links.value.$refAccessor;
  const duplicate = json.accessors.push(structuredClone(json.accessors[ref])) - 1;
  e.nodes.alias = { op: 'BufferAttributeNode', args: { bufferType: 'vec3' }, links: { value: { $refAccessor: duplicate } } };
  e.entrypoints.emissiveNode = 'alias';
  await expectFallback(json);
});

it.each([true, false])('rejects index views sharing graph attribute memory (cached geometry=%s)', async (cached) => {
  const f = fixture(3, false, 3, cached);
  const indices = new Uint16Array(f.data.array.buffer, f.data.array.byteOffset, 3);
  indices.set([0, 1, 2]);
  f.scene.children[1].geometry.setIndex(new BufferAttribute(indices, 1));
  await expect(exportScene(f.scene)).rejects.toThrow(/BufferAttributeNode/);
});

it.each([true, false])('falls back atomically for index/node accessors sharing a bufferView (cached geometry=%s)', async (cached) => {
  const f = fixture(3, false, 3, cached);
  f.data.array.fill(0); // The shared Uint16 view contains valid triangle indices.
  if (!cached) {
    f.scene.children[0].geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    f.scene.children[1].geometry.setAttribute('color', new Float32BufferAttribute(Array(9).fill(1), 3));
  }
  const json = await exportScene(f.scene), e = json.materials[0].extensions[extensionName];
  const ref = e.nodes[e.entrypoints.colorNode].links.value.$refAccessor;
  const data = json.accessors[ref], primitive = json.meshes.at(-1).primitives[0];
  const indices = structuredClone(json.accessors[primitive.indices]);
  expect(indices.componentType).toBe(5123);
  indices.bufferView = data.bufferView; indices.byteOffset = data.byteOffset ?? 0;
  indices.min = [0]; indices.max = [0];
  primitive.indices = json.accessors.push(indices) - 1;
  expect(primitive.indices).not.toBe(ref);
  const [a, b] = await expectFallback(json);
  expect(a.material === b.material).toBe(cached);
  if (!cached) expect(b.material.vertexColors).toBe(true);
});

it('leaves paired overrides in control even when an object previously used the default adapter', async () => {
  const f = fixture(); await exportScene(f.scene);
  f.node.bufferStride = 1; f.scene.children[1].geometry = new BoxGeometry();
  const serializer = createDefaultNodeSerializer({ overrides: { BufferAttributeNode: () => ({
    op: 'ConstNode', args: { value: 0.5, valueType: 'float', nodeType: 'float', precision: null }
  }) } });
  const errors = [], result = await load(await exportScene(f.scene, false, { nodeSerializer: serializer }), errors);
  expect(errors).toEqual([]); expect(meshes(result.scene)[0].material.colorNode.value).toBe(0.5);
});

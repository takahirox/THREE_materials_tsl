import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, PerspectiveCamera, OrthographicCamera, Vector4,
  FrontSide, BackSide, DoubleSide } from 'three';
import { MeshPhysicalNodeMaterial, IndexNode, FrontFacingNode, ScreenNode, ViewportDepthNode,
  NodeFrame, GLSLNodeBuilder, WGSLNodeBuilder, StandardNodeLibrary } from 'three/webgpu';
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
function shader(node, { gpu = false, stage = 'fragment', camera = new PerspectiveCamera(), side = FrontSide, multiDraw = false } = {}) {
  const material = new MeshPhysicalNodeMaterial({ side });
  const renderer = { backend: { isWebGPUBackend: gpu, extensions: { has: () => multiDraw } },
    library: new StandardNodeLibrary(), debug: { diagnostics: { keywords: false } } };
  const Builder = gpu ? WGSLNodeBuilder : GLSLNodeBuilder;
  const builder = new Builder(new Mesh(new BoxGeometry(), material), renderer);
  builder.camera = camera;
  builder.context.setupPositionView = () => material.setupPositionView(builder);
  builder.setShaderStage(stage);
  const flow = builder.flowStagesNode(node, node.getNodeType(builder));
  return { builder, code: { result: flow.result, code: flow.code, vertex: builder.flowCode.vertex,
    functions: (builder.codes[stage] ?? []).map(({ code }) => code) } };
}
const fixtures = [
  ...['vertex', 'instance', 'draw'].map((scope) => [`index ${scope}`, () => new IndexNode(scope)]),
  ['front facing', () => new FrontFacingNode()],
  ...['coordinate', 'uv', 'size', 'viewport'].map((scope) => [`screen ${scope}`, () => new ScreenNode(scope)]),
  ['depth', () => new ViewportDepthNode('depth')],
  ['linear default value', () => new ViewportDepthNode('linearDepth')],
  ['linear explicit null', () => new ViewportDepthNode('linearDepth', null)],
  ['linear linked', () => new ViewportDepthNode('linearDepth', TSL.float(0.4))],
  ['linear linked ordinary depth', () => new ViewportDepthNode('linearDepth', new ViewportDepthNode('depth'))],
  ['linear linked shared depth', () => new ViewportDepthNode('linearDepth', TSL.depth)]
];
it.each(fixtures)('round-trips twice with native identity and shader flow: %s', async (_, create) => {
  const source = new MeshPhysicalNodeMaterial();
  const node = create();
  Object.assign(node, { name: 'geometryValue', global: true, parents: true });
  source.colorNode = node; source.emissiveNode = node;
  if (node.type === 'ViewportDepthNode') source.depthNode = node;
  if (node.type === 'IndexNode' || (node.type === 'ScreenNode' && ['size', 'viewport'].includes(node.scope))) source.positionNode = node;
  let scene = sceneWith(source);
  const expected = shader(node).code;
  expect(expected.result).toBeTruthy();
  let json = await exportScene(scene);
  const graph = json.materials[0].extensions[extensionName];
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(json, errors); expect(errors).toEqual([]);
    const material = meshes(gltf.scene)[0].material; const actual = material.colorNode;
    expect(actual).toBeInstanceOf(node.constructor); expect(actual).not.toBe(node);
    expect(Object.values(TSL)).not.toContain(actual);
    expect(material.emissiveNode).toBe(actual);
    if (source.depthNode) expect(material.depthNode).toBe(actual);
    if (source.positionNode) expect(material.positionNode).toBe(actual);
    expect(actual.scope).toBe(node.scope); expect(actual.nodeType).toBe(node.nodeType);
    expect(actual.name).toBe('geometryValue'); expect(actual.global).toBe(true); expect(actual.parents).toBe(true);
    expect(shader(actual).code).toEqual(expected);
    // WGSL drawIndex is unavailable in native r186; do not fake a draw ID.
    if (node.scope !== 'draw') expect(shader(actual, { gpu: true }).code).toEqual(shader(node, { gpu: true }).code);
    if (source.positionNode) expect(shader(actual, { stage: 'vertex' }).code).toEqual(shader(node, { stage: 'vertex' }).code);
    if (node.valueNode) {
      expect(actual.valueNode.type).toBe(node.valueNode.type);
      if (Object.values(TSL).includes(node.valueNode)) expect(actual.valueNode).toBe(node.valueNode);
    }
    scene = gltf.scene; json = await exportScene(scene);
    expect(json.materials[0].extensions[extensionName]).toEqual(graph);
  }
});

it('preserves shared linked inputs and distinct ordinary instances within a shared material and GLB', async () => {
  const input = TSL.uniform(0.3), m = new MeshPhysicalNodeMaterial();
  m.colorNode = new ViewportDepthNode('linearDepth', input);
  m.emissiveNode = new ViewportDepthNode('linearDepth', input);
  m.roughnessNode = input; m.depthNode = m.colorNode;
  let scene = sceneWith(m, m);
  for (let round = 0; round < 2; round++) {
    const errors = []; const gltf = await load(await exportScene(scene, true), errors); expect(errors).toEqual([]);
    const [a, b] = meshes(gltf.scene).map((o) => o.material);
    expect(a).toBe(b); expect(a.colorNode).not.toBe(a.emissiveNode); expect(a.depthNode).toBe(a.colorNode);
    expect(a.colorNode.valueNode).toBe(a.emissiveNode.valueNode); expect(a.roughnessNode).toBe(a.colorNode.valueNode);
    a.roughnessNode.value = 0.7; expect(b.emissiveNode.valueNode.value).toBe(0.7);
    scene = gltf.scene;
  }
});

it.each(['size', 'viewport'])('preserves native per-render %s updates, resizing, DPR and render targets', async (scope) => {
  const source = new ScreenNode(scope), m = new MeshPhysicalNodeMaterial(); m.colorNode = source;
  // A previously built ScreenNode has updateType=render and must still export.
  const originalUniform = source.setup(); expect(source.updateType).toBe('render');
  const errors = []; const gltf = await load(await exportScene(sceneWith(m)), errors); expect(errors).toEqual([]);
  const actual = meshes(gltf.scene)[0].material.colorNode;
  expect(actual.updateType).toBe('none'); const uniform = actual.setup(); expect(actual.updateType).toBe('render');
  expect(uniform.groupNode).toBe(TSL.renderGroup);
  let target = null, width = 640, height = 480, ratio = 2;
  const renderer = { getRenderTarget: () => target, getDrawingBufferSize: (v) => v.set(width, height),
    getViewport: (v) => v.set(10, 20, width / ratio, height / ratio), getPixelRatio: () => ratio };
  const frame = new NodeFrame(); frame.renderer = renderer; frame.renderId = 1;
  const check = (expected) => {
    frame.updateNode(actual); expect(uniform.value.toArray()).toEqual(expected);
    source.update({ renderer }); expect(originalUniform.value.toArray()).toEqual(expected);
  };
  check(scope === 'size' ? [640, 480] : [20, 40, 640, 480]);
  width = 1200; height = 900; ratio = 3; frame.renderId++;
  check(scope === 'size' ? [1200, 900] : [30, 60, 1200, 900]);
  target = { width: 256, height: 128, viewport: new Vector4(2, 4, 64, 32) }; frame.renderId++;
  check(scope === 'size' ? [256, 128] : [2, 4, 64, 32]); // target viewport is already physical pixels
  target = null; frame.renderId++;
  check(scope === 'size' ? [1200, 900] : [30, 60, 1200, 900]);
  const args = createDefaultNodeSerializer()(actual).args;
  expect(Object.keys(args).sort()).toEqual(['global', 'name', 'nodeType', 'parents', 'scope']);
});

it.each([FrontSide, DoubleSide])('preserves front-facing stage/side behavior (%s)', async (side) => {
  const source = new MeshPhysicalNodeMaterial({ side }); source.colorNode = new FrontFacingNode();
  const actual = meshes((await load(await exportScene(sceneWith(source)))).scene)[0].material;
  expect(actual.side).toBe(side);
  for (const gpu of [false, true]) {
    const code = shader(actual.colorNode, { gpu, side }).code;
    expect(code).toEqual(shader(source.colorNode, { gpu, side }).code);
    expect(code.result).toContain(side === BackSide ? 'false' : gpu ? 'isFront' : 'gl_FrontFacing');
    expect(shader(actual.colorNode, { gpu, stage: 'vertex', side }).code.result).toBe('true');
  }
});

it('preserves the native BackSide branch but rejects its lossy ordinary glTF transport', async () => {
  const source = new FrontFacingNode();
  const encoded = createDefaultNodeSerializer()(source);
  const actual = createDefaultNodeResolver()(encoded.op, encoded.args, encoded.links);
  for (const gpu of [false, true]) {
    expect(shader(actual, { gpu, side: BackSide }).code).toEqual(shader(source, { gpu, side: BackSide }).code);
    expect(shader(actual, { gpu, side: BackSide }).code.result).toBe('false');
  }
  const m = new MeshPhysicalNodeMaterial({ side: BackSide }); m.colorNode = source;
  await expect(exportScene(sceneWith(m))).rejects.toThrow(/Unsupported/);
  // The same restriction applies when the node is nested in an expression.
  m.colorNode = TSL.select(source, TSL.vec3(1), TSL.vec3(0));
  await expect(exportScene(sceneWith(m))).rejects.toThrow(/Unsupported/);
});

it.each([false, true])('preserves draw-index native multi-draw / uniform selection (%s)', async (multiDraw) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = new IndexNode('draw');
  const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material.colorNode;
  const code = shader(actual, { stage: 'vertex', multiDraw }).code;
  expect(code).toEqual(shader(m.colorNode, { stage: 'vertex', multiDraw }).code);
  expect(code.result).toBe(multiDraw ? 'uint( gl_DrawID )' : 'nodeUniformDrawId');
});

it.each(['depth', 'linearDepth'])('uses the active camera and native live near/far uniforms for %s', async (scope) => {
  const source = new MeshPhysicalNodeMaterial(); source.depthNode = new ViewportDepthNode(scope);
  const actual = meshes((await load(await exportScene(sceneWith(source)))).scene)[0].material.depthNode;
  const perspective = new PerspectiveCamera(50, 1, 0.1, 1000), ortho = new OrthographicCamera(-1, 1, 1, -1, 2, 50);
  for (const camera of [perspective, ortho]) {
    for (const gpu of [false, true]) {
      const { builder, code } = shader(actual, { camera, gpu });
      expect(code).toEqual(shader(source.depthNode, { camera, gpu }).code);
      const uniforms = [...builder.nodes].filter((n) => ['cameraNear', 'cameraFar'].includes(n.name));
      expect(uniforms).toHaveLength(2);
      const frame = new NodeFrame(); frame.camera = camera; frame.renderId = 1;
      for (const n of uniforms) frame.updateNode(n);
      expect(uniforms.find((n) => n.name === 'cameraNear').value).toBe(camera.near);
      expect(uniforms.find((n) => n.name === 'cameraFar').value).toBe(camera.far);
      camera.near += 1; camera.far += 10; frame.renderId++;
      for (const n of uniforms) frame.updateNode(n);
      expect(uniforms.find((n) => n.name === 'cameraNear').value).toBe(camera.near);
      expect(uniforms.find((n) => n.name === 'cameraFar').value).toBe(camera.far);
    }
  }
  if (scope === 'depth') expect(shader(actual, { camera: perspective }).code).not.toEqual(shader(actual, { camera: ortho }).code);
});

it('preserves linearDepth linked conversion for perspective and orthographic cameras', async () => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = new ViewportDepthNode('linearDepth', TSL.float(0.4));
  const actual = meshes((await load(await exportScene(sceneWith(m)))).scene)[0].material.colorNode;
  for (const camera of [new PerspectiveCamera(), new OrthographicCamera()]) {
    for (const gpu of [false, true]) expect(shader(actual, { camera, gpu }).code).toEqual(shader(m.colorNode, { camera, gpu }).code);
  }
  expect(actual.setup({ camera: new OrthographicCamera() })).toBe(actual.valueNode);
  expect(actual.setup({ camera: new PerspectiveCamera() })).not.toBe(actual.valueNode);
});

const invalidExports = [
  ...['unknown', '__proto__', 'subgroup', 'invocationLocal', 'invocationSubgroup', undefined, null].map((scope) => () => new IndexNode(scope)),
  ...['unknown', 'viewportUV', undefined, null].map((scope) => () => new ScreenNode(scope)),
  ...['unknown', 'depthBase', undefined, null].map((scope) => () => new ViewportDepthNode(scope)),
  () => new ViewportDepthNode('depthBase', TSL.float(0.4)),
  () => new ViewportDepthNode('depth', TSL.float(0.4)), // native depth ignores this input
  () => Object.assign(new ViewportDepthNode('linearDepth'), { valueNode: undefined }),
  () => new ViewportDepthNode('linearDepth', 0.4),
  () => new ViewportDepthNode('linearDepth', [TSL.float(0.4)]),
  () => new ViewportDepthNode('linearDepth', TSL.vec2(0.4)),
  () => new ViewportDepthNode('linearDepth', new ScreenNode('size')),
  () => Object.assign(new FrontFacingNode(), { scope: 'front' }),
  () => Object.assign(new FrontFacingNode(), { nodeType: 'float' }),
  () => Object.assign(new IndexNode('vertex'), { renderer: {} }),
  () => Object.assign(new ViewportDepthNode('depth'), { camera: new PerspectiveCamera() }),
  () => Object.assign(new ScreenNode('uv'), { renderTarget: {} }),
  () => Object.assign(new ScreenNode('uv'), { updateType: 'render' }),
  () => Object.assign(new ScreenNode('size'), { updateType: 'frame' }),
  () => Object.assign(new ScreenNode('viewport'), { updateBeforeType: 'render' }),
  () => new ScreenNode('size').onRenderUpdate(() => 1),
  () => { class Custom extends IndexNode {} return new Custom('vertex'); },
  ...[() => new IndexNode('vertex'), () => new ScreenNode('size'), () => new FrontFacingNode(), () => new ViewportDepthNode('depth')].flatMap((create) => [
    () => Object.assign(create(), { extra: TSL.time }),
    () => Object.assign(create(), { _extra: { nested: [TSL.time] } }),
    () => create().before(TSL.time)
  ]),
  () => { const n = new ViewportDepthNode('linearDepth'); n.valueNode = n; return n; }
];
it.each(invalidExports.map((create, i) => [i, create]))('fails clearly for unsupported export variant %s', async (_, create) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = create();
  await expect(exportScene(sceneWith(m))).rejects.toThrow();
});

const invalidImports = [
  (e, n) => { n.args.scope = 'unknown'; }, (e, n) => { n.args.scope = '__proto__'; },
  (e, n) => { delete n.args.scope; }, (e, n) => { n.args.nodeType = 'vec2'; },
  (e, n) => { n.args.camera = {}; }, (e, n) => { n.args.renderer = {}; },
  (e, n) => { n.args.name = 'code()'; }, (e, n) => { n.args.parents = 1; },
  (e, n) => { n.args.scope = 'depthBase'; },
  (e, n) => { n.args.scope = 'depth'; }, // valueNode must be absent
  (e, n) => { n.links.valueNode = { $ref: 'missing' }; },
  (e, n) => { n.links.valueNode = { $refTex: 0 }; },
  (e, n) => { n.links.valueNode = [{ $ref: e.entrypoints.roughnessNode }]; },
  (e, n) => { n.links.valueNode = { $ref: e.entrypoints.roughnessNode, extra: 1 }; },
  (e, n) => { n.links.extra = { $ref: e.entrypoints.roughnessNode }; },
  (e, n) => { n.links.valueNode = { $ref: e.entrypoints.colorNode }; },
  (e, n) => { n.links.valueNode = { $ref: e.entrypoints.metalnessNode }; }, // vector input
  (e, n) => { n.op = 'ScreenNode'; n.args.scope = 'size'; n.args.nodeType = null; }, // extra input
  (e, n) => { n.op = 'FrontFacingNode'; n.args.nodeType = 'bool'; delete n.args.scope; },
  ...['subgroup', 'invocationLocal', 'invocationSubgroup', 'unknown'].map((scope) => (e, n) => {
    n.op = 'IndexNode'; n.args.scope = scope; n.args.nodeType = 'uint'; delete n.links;
  }),
  (e) => { e.nodes.unreachable = { op: 'ViewportDepthNode', args: { scope: 'depthBase' } }; },
  ...['frontFacing', 'screenUV', 'screenSize', 'viewport', 'depth', 'viewportLinearDepth', 'vertexIndex', 'drawIndex'].flatMap((op) => [
    (e, n) => { n.op = op; delete n.args; }, // shared ops cannot have links
    (e, n) => { n.op = op; delete n.links; } // shared ops cannot have args
  ])
];
it.each(invalidImports.map((mutate, i) => [i, mutate]))('atomically retains full ordinary material for malformed import %s', async (_, mutate) => {
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.6, metalness: 0.3, clearcoat: 0.4,
    transmission: 0.2, thickness: 0.5, ior: 1.6, transparent: true, opacity: 0.7, side: DoubleSide });
  m.color.setRGB(0.2, 0.4, 0.6); m.emissive.setRGB(0.1, 0.2, 0.3);
  m.userData = { purpose: 'ordinary material fallback' };
  m.colorNode = new ViewportDepthNode('linearDepth', TSL.float(0.4));
  m.roughnessNode = TSL.add(0.2, 0.3); m.metalnessNode = TSL.vec2(0.2);
  const json = await exportScene(sceneWith(m)); const e = json.materials[0].extensions[extensionName];
  mutate(e, e.nodes[e.entrypoints.colorNode]);
  const ordinary = meshes((await load(json, [], false)).scene)[0].material;
  const errors = []; const gltf = await load(json, errors); const actual = meshes(gltf.scene)[0].material;
  expect(errors).toHaveLength(1); expect(actual.isNodeMaterial).not.toBe(true);
  expect((await gltf.parser.getDependency('material', 0)).isNodeMaterial).not.toBe(true);
  for (const key of Object.keys(ordinary)) {
    if (['id', 'uuid', 'userData'].includes(key)) continue;
    expect(actual[key], key).toEqual(ordinary[key]);
  }
  // A plugin-disabled parser stores the unknown extension in userData; the
  // enabled parser recognizes it even when graph reconstruction fails.
  const { gltfExtensions, ...ordinaryExtras } = ordinary.userData;
  expect(actual.userData).toEqual(ordinaryExtras);
  for (const slot of ['colorNode', 'roughnessNode', 'metalnessNode']) expect(actual[slot]).toBeUndefined();
  expect(TSL.frontFacing.nodeType).toBe('bool'); expect(TSL.screenSize.scope).toBe('size');
  expect(TSL.depth.scope).toBe('depth');
});

it.each([
  ['IndexNode', () => new IndexNode('vertex')],
  ['FrontFacingNode', () => new FrontFacingNode()],
  ['ScreenNode', () => new ScreenNode('size')],
  ['ViewportDepthNode', () => new ViewportDepthNode('depth')]
])('rejects extra links and unknown state on imported %s', async (_, create) => {
  const m = new MeshPhysicalNodeMaterial(); m.colorNode = create(); m.roughnessNode = TSL.float(0.5);
  const json = await exportScene(sceneWith(m));
  for (const mode of ['extra link', 'renderer field']) {
    const malformed = structuredClone(json); const e = malformed.materials[0].extensions[extensionName];
    const node = e.nodes[e.entrypoints.colorNode];
    if (mode === 'extra link') node.links = { extra: { $ref: e.entrypoints.roughnessNode } };
    else node.args.renderer = 'external-renderer';
    const errors = []; const actual = meshes((await load(malformed, errors)).scene)[0].material;
    expect(errors).toHaveLength(1); expect(actual.isNodeMaterial).not.toBe(true);
    expect(actual.colorNode).toBeUndefined(); expect(actual.roughnessNode).toBeUndefined();
  }
});

it('retains exact shared singleton names and identity alongside ordinary instances', async () => {
  for (const shared of [TSL.vertexIndex, TSL.instanceIndex, TSL.drawIndex, TSL.invocationLocalIndex,
    TSL.invocationSubgroupIndex, TSL.subgroupIndex, TSL.frontFacing, TSL.screenUV, TSL.screenCoordinate,
    TSL.screenSize, TSL.viewport, TSL.depth, TSL.viewportLinearDepth]) {
    const m = new MeshPhysicalNodeMaterial(); m.colorNode = shared; m.emissiveNode = new FrontFacingNode();
    let scene = sceneWith(m);
    for (let round = 0; round < 2; round++) {
      const errors = []; const gltf = await load(await exportScene(scene), errors); expect(errors).toEqual([]);
      const actual = meshes(gltf.scene)[0].material;
      expect(actual.colorNode).toBe(shared); expect(actual.emissiveNode).not.toBe(TSL.frontFacing);
      scene = gltf.scene;
    }
  }
});

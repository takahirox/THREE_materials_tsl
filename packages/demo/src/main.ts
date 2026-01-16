import {
  Color,
  Group,
  BoxGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { ConstNode, MeshStandardNodeMaterial, PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import AttributeNode from 'three/src/nodes/core/AttributeNode.js';
import UniformNode from 'three/src/nodes/core/UniformNode.js';
import MathNode from 'three/src/nodes/math/MathNode.js';
import OperatorNode from 'three/src/nodes/math/OperatorNode.js';
import { time } from 'three/src/nodes/utils/Timer.js';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTFExporterPlugin, GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { MathNodeMethod } from 'three/src/nodes/math/MathNode.js';
import type { OperatorNodeOp } from 'three/src/nodes/math/OperatorNode.js';

import { THREEMaterialsTSLLoaderPlugin } from '@loader';
import { THREEMaterialsTSLExporterPlugin, getSharedTSLNodeName } from '@exporter';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const exportView = document.getElementById('exported') as HTMLPreElement;
const applyButton = document.getElementById('apply') as HTMLButtonElement;
const baseColorInput = document.getElementById('baseColor') as HTMLInputElement;
const lineColorInput = document.getElementById('lineColor') as HTMLInputElement;
const lineDensityInput = document.getElementById('lineDensity') as HTMLInputElement;
const lineDensityValue = document.getElementById('lineDensityValue') as HTMLSpanElement;
const lineWidthInput = document.getElementById('lineWidth') as HTMLInputElement;
const lineWidthValue = document.getElementById('lineWidthValue') as HTMLSpanElement;
const flowSpeedInput = document.getElementById('flowSpeed') as HTMLInputElement;
const flowSpeedValue = document.getElementById('flowSpeedValue') as HTMLSpanElement;
const roughnessInput = document.getElementById('roughness') as HTMLInputElement;
const roughnessValue = document.getElementById('roughnessValue') as HTMLSpanElement;
const metalnessInput = document.getElementById('metalness') as HTMLInputElement;
const metalnessValue = document.getElementById('metalnessValue') as HTMLSpanElement;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type NodeExportLike = {
  op: string;
  args?: JsonValue;
  links?: Record<string, unknown>;
};

const buildArgs = (entries: Array<[string, JsonValue | undefined]>) => {
  const args: Record<string, JsonValue> = {};
  for (const [key, value] of entries) {
    if (value !== undefined) args[key] = value;
  }
  return args;
};

const scene = new Scene();

const STRIPE_SPEED_SCALE = 3;

const camera = new PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0.2, 5);

const renderer = new WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const geometry = new BoxGeometry(1.2, 1.2, 1.2, 32, 32, 32);

const timeUniform = new UniformNode(0, 'float').setName('uTime');
const baseColor = new UniformNode(new Color(0.06, 0.11, 0.17), 'color');
const lineColor = new UniformNode(new Color(0.28, 0.94, 1.0), 'color');
const lineDensity = new UniformNode(16.0, 'float');
const lineWidth = new UniformNode(0.18, 'float');
const flowSpeed = new UniformNode(1.6, 'float');
const uvNode = new AttributeNode('uv', 'vec2');
const positionNode = new AttributeNode('position', 'vec3');
const stripeAxis = new ConstNode(new Vector2(1.0, 0.6), 'vec2');
const stripeCoord = new MathNode(MathNode.DOT, uvNode, stripeAxis);
const flowPhase = new OperatorNode(
  '+',
  new OperatorNode('*', stripeCoord, lineDensity),
  new OperatorNode('*', timeUniform, flowSpeed)
);
const stripeWave = new MathNode(MathNode.SIN, flowPhase);
const stripeAbs = new MathNode(MathNode.ABS, stripeWave);
const stripeEdge = new OperatorNode('-', new ConstNode(1, 'float'), lineWidth);
const stripeBand = new MathNode(MathNode.SMOOTHSTEP, stripeEdge, new ConstNode(1, 'float'), stripeAbs);

const animatedGlow = stripeBand;
const lineStrength = new ConstNode(1.8, 'float');
const glowBoost = new OperatorNode('*', animatedGlow, lineStrength);
const mixed = new OperatorNode('*', lineColor, glowBoost);
const finalColor = new OperatorNode('+', baseColor, mixed);

const material = new MeshStandardNodeMaterial();
material.emissiveNode = finalColor;
material.roughness = 0.1;
material.metalness = 0.9;

const originalMesh = new Mesh(geometry, material);
originalMesh.position.x = -1.4;

const rig = new Group();
rig.add(originalMesh);
scene.add(rig);


function createExporter() {
  const exporter = new GLTFExporter();
  exporter.register(
    (writer: GLTFWriter) =>
      new THREEMaterialsTSLExporterPlugin(writer, {
        entrypoints: ['emissiveNode'],
        includeThreeRevision: true,
        nodeSerializer: (node: unknown): NodeExportLike | null => {
          const sharedName = getSharedTSLNodeName(node);
          if (sharedName) {
            return {
              op: sharedName
            };
          }
          if (
            node === time ||
            (node && typeof node === 'object' && (node as { isUniformNode?: boolean }).isUniformNode &&
              (node as { name?: string }).name === 'uTime')
          ) {
            return {
              op: 'TimeNode',
              args: buildArgs([['nodeType', 'float']])
            };
          }

          if (node && typeof node === 'object' && (node as { type?: string }).type === 'AttributeNode') {
            const attributeName = (node as { getAttributeName?: () => string }).getAttributeName?.();
            const nodeType = (node as { nodeType?: string }).nodeType ?? null;
            return {
              op: 'AttributeNode',
              args: buildArgs([
                ['attributeName', attributeName],
                ['nodeType', nodeType]
              ])
            };
          }

          if (node && typeof node === 'object' && (node as { isMathNode?: boolean }).isMathNode) {
            const mathNode = node as { method: string; aNode?: unknown; bNode?: unknown; cNode?: unknown };
            return {
              op: 'MathNode',
              args: buildArgs([['method', mathNode.method]]),
              links: {
                aNode: mathNode.aNode,
                bNode: mathNode.bNode,
                cNode: mathNode.cNode
              }
            };
          }

          if (
            node &&
            typeof node === 'object' &&
            ((node as { isConstNode?: boolean }).isConstNode || (node as { isUniformNode?: boolean }).isUniformNode)
          ) {
            const value = (node as { value: unknown }).value;
            if (value instanceof Color) {
              return {
                op: 'ConstNode',
                args: {
                  value: [value.r, value.g, value.b],
                  valueType: 'color',
                  nodeType: 'color'
                }
              };
            }
            if (value instanceof Vector2) {
              return {
                op: 'ConstNode',
                args: {
                  value: [value.x, value.y],
                  valueType: 'vec2',
                  nodeType: 'vec2'
                }
              };
            }
            if (value instanceof Vector3) {
              return {
                op: 'ConstNode',
                args: {
                  value: [value.x, value.y, value.z],
                  valueType: 'vec3',
                  nodeType: 'vec3'
                }
              };
            }
            if (typeof value === 'number') {
              return {
                op: 'ConstNode',
                args: {
                  value,
                  valueType: 'float',
                  nodeType: 'float'
                }
              };
            }
          }

          if (node && typeof node === 'object' && (node as { isOperatorNode?: boolean }).isOperatorNode) {
            const op = (node as { op: string }).op;
            const aNode = (node as { aNode: unknown }).aNode;
            const bNode = (node as { bNode: unknown }).bNode;
            return {
              op: 'OperatorNode',
              args: buildArgs([['op', op]]),
              links: {
                aNode,
                bNode
              }
            };
          }

          return null;
        }
      }) as unknown as GLTFExporterPlugin
  );
  return exporter;
}

function createLoader() {
  const loader = new GLTFLoader();
  loader.register(
    (parser: GLTFParser) =>
      new THREEMaterialsTSLLoaderPlugin(parser, {
        materialType: MeshStandardNodeMaterial,
        supportedVersions: ['1.0'],
        onError: (error: unknown) => {
          exportView.textContent += `\n\nLoader error: ${error}`;
        },
        nodeResolver: (op: string, args: unknown) => {
        if (op === 'ConstNode') {
          const argObj = args as { value: unknown; valueType?: string; nodeType?: string };
          if (argObj.valueType === 'color' && Array.isArray(argObj.value)) {
            const [r, g, b] = argObj.value as number[];
            return new ConstNode(new Color(r, g, b), argObj.nodeType ?? 'color');
          }
          if (argObj.valueType === 'vec2' && Array.isArray(argObj.value)) {
            const [x, y] = argObj.value as number[];
            return new ConstNode(new Vector2(x, y), argObj.nodeType ?? 'vec2');
          }
          if (argObj.valueType === 'vec3' && Array.isArray(argObj.value)) {
            const [x, y, z] = argObj.value as number[];
            return new ConstNode(new Vector3(x, y, z), argObj.nodeType ?? 'vec3');
          }
          if (argObj.valueType === 'float') {
            return new ConstNode(argObj.value as number, argObj.nodeType ?? 'float');
          }
        }

        if (op === 'TimeNode') {
          return time;
        }

        if (op === 'AttributeNode') {
          const argObj = args as { attributeName?: string; nodeType?: string | null };
          return new AttributeNode(argObj.attributeName ?? 'uv', argObj.nodeType ?? null);
        }

        if (op === 'MathNode') {
          const argObj = args as { method: MathNodeMethod };
          const placeholder = new ConstNode(0, 'float');
          const MathNodeCtor = MathNode as unknown as new (
            method: MathNodeMethod,
            a: ConstNode<number>,
            b?: ConstNode<number>,
            c?: ConstNode<number>
          ) => MathNode;
          return new MathNodeCtor(argObj.method, placeholder);
        }

        if (op === 'OperatorNode') {
          const argObj = args as { op: OperatorNodeOp };
          const placeholder = new ConstNode(0, 'float');
          return new OperatorNode(argObj.op, placeholder, placeholder);
        }

          return null;
        }
      }) as unknown as GLTFLoaderPlugin
  );
  return loader;
}

let exportedGroup: Group | null = null;

async function roundTrip() {
  const exporter = createExporter();
  const exportScene = new Scene();
  const exportMesh = new Mesh(geometry, material);
  exportScene.add(exportMesh);

  exportView.textContent = 'Exporting...';

  const exported = await exporter.parseAsync(exportScene, { binary: false });
  const json = typeof exported === 'string' ? exported : JSON.stringify(exported, null, 2);
  let displayJson = json;
  try {
    const parsed = JSON.parse(json) as { buffers?: { uri?: string }[] };
    if (parsed.buffers) {
      for (const buffer of parsed.buffers) {
        if (buffer.uri && buffer.uri.length > 120) {
          const previewLength = 80;
          buffer.uri = `${buffer.uri.slice(0, previewLength)}... [${buffer.uri.length} chars total]`;
        }
      }
      displayJson = JSON.stringify(parsed, null, 2);
    }
  } catch {
    displayJson = json;
  }
  exportView.textContent = displayJson;

  const loader = createLoader();
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(json, '', resolve, reject);
  });

  await syncImportedMaterials(gltf);

  if (exportedGroup) {
    rig.remove(exportedGroup);
  }
  gltf.scene.position.x = 1.4;
  rig.add(gltf.scene);
  exportedGroup = gltf.scene;
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth === 0 || clientHeight === 0) return;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function animate(timeMs = 0) {
  resize();
  timeUniform.value = timeMs * 0.001;
  controls.update();

  renderer.render(scene, camera);
}

async function boot() {
  if (!('gpu' in navigator)) {
    exportView.textContent = 'WebGPU is not available in this browser.';
    return;
  }

  await renderer.init();

  const pmrem = new PMREMGenerator(renderer);
  const hdrUrl = `${import.meta.env.BASE_URL}env/venice_sunset_1k.hdr`;
  const hdrTexture = await new HDRLoader().loadAsync(hdrUrl);
  const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
  scene.background = envMap;
  scene.environment = envMap;
  hdrTexture.dispose();
  pmrem.dispose();

  applyParameters();

  roundTrip().catch((error) => {
    exportView.textContent = `Export failed: ${error}`;
  });

  renderer.setAnimationLoop(animate);
}

function applyParameters() {
  baseColor.value.set(baseColorInput.value);
  lineColor.value.set(lineColorInput.value);
  lineDensity.value = Number(lineDensityInput.value);
  lineWidth.value = Number(lineWidthInput.value);
  const flowSpeedScaled = Number(flowSpeedInput.value) * STRIPE_SPEED_SCALE;
  flowSpeed.value = flowSpeedScaled;
  material.roughness = Number(roughnessInput.value);
  material.metalness = Number(metalnessInput.value);


  lineDensityValue.textContent = lineDensityInput.value;
  lineWidthValue.textContent = lineWidthInput.value;
  flowSpeedValue.textContent = flowSpeedScaled.toFixed(2);
  roughnessValue.textContent = roughnessInput.value;
  metalnessValue.textContent = metalnessInput.value;
}

function bindInputs() {
  const updateOriginal = () => {
    applyParameters();
  };

  const inputs = [
    baseColorInput,
    lineColorInput,
    lineDensityInput,
    lineWidthInput,
    flowSpeedInput,
    roughnessInput,
    metalnessInput,
  ];

  for (const input of inputs) {
    input.addEventListener('input', updateOriginal);
  }

  applyButton.addEventListener('click', () => {
    applyParameters();
    applyButton.disabled = true;
    roundTrip()
      .catch((error) => {
        exportView.textContent = `Export failed: ${error}`;
      })
      .finally(() => {
        applyButton.disabled = false;
      });
  });
}

async function syncImportedMaterials(gltf: GLTF) {
  const parser = gltf.parser as GLTFParser;
  const associations = parser.associations;
  if (!parser.getDependencies || !associations) return;
  const materials = await parser.getDependencies('material');

  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;

    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const meshMaterial of meshMaterials) {
      const association = associations.get(meshMaterial);
      const materialIndex = association?.materials;
      if (materialIndex === undefined) continue;
      const source = materials[materialIndex] as MeshStandardNodeMaterial | undefined;
      if (!source || source === meshMaterial) continue;

      if (source.emissiveNode && !(meshMaterial as MeshStandardNodeMaterial).emissiveNode) {
        (meshMaterial as MeshStandardNodeMaterial).emissiveNode = source.emissiveNode;
        (meshMaterial as MeshStandardNodeMaterial).needsUpdate = true;
      }
    }
  });
}

bindInputs();
boot();

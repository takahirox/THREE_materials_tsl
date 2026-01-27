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
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTFExporterPlugin, GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js';

import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@loader';
import { THREEMaterialsTSLExporterPlugin, createDefaultNodeSerializer } from '@exporter';

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
const vertexAmplitudeInput = document.getElementById('vertexAmplitude') as HTMLInputElement;
const vertexAmplitudeValue = document.getElementById('vertexAmplitudeValue') as HTMLSpanElement;
const vertexSpeedInput = document.getElementById('vertexSpeed') as HTMLInputElement;
const vertexSpeedValue = document.getElementById('vertexSpeedValue') as HTMLSpanElement;
const roughnessInput = document.getElementById('roughness') as HTMLInputElement;
const roughnessValue = document.getElementById('roughnessValue') as HTMLSpanElement;
const metalnessInput = document.getElementById('metalness') as HTMLInputElement;
const metalnessValue = document.getElementById('metalnessValue') as HTMLSpanElement;

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
const vertexAmplitude = new UniformNode(0.08, 'float');
const vertexSpeed = new UniformNode(1.2, 'float');
const uvNode = new AttributeNode('uv', 'vec2');
const positionNode = new AttributeNode('position', 'vec3');
const stripeAxis = new ConstNode(new Vector2(1.0, 0.6), 'vec2');
const waveAxis = new ConstNode(new Vector3(0, 1, 0), 'vec3');
const phaseAxis = new ConstNode(new Vector3(0.45, 1, 0.45), 'vec3');
const stripeDetail = new ConstNode(1.8, 'float');
const vertexDetail = new ConstNode(4.0, 'float');
const stripeCoord = new MathNode(MathNode.DOT, uvNode, stripeAxis);
const vertexCoord = new MathNode(MathNode.DOT, positionNode, phaseAxis);
const stripeDensity = new OperatorNode('*', lineDensity, stripeDetail);
const flowPhase = new OperatorNode(
  '+',
  new OperatorNode('*', stripeCoord, stripeDensity),
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
const vertexPhase = new OperatorNode(
  '+',
  new OperatorNode('*', vertexCoord, vertexDetail),
  new OperatorNode('*', timeUniform, vertexSpeed)
);
const vertexWave = new MathNode(MathNode.SIN, vertexPhase);
const vertexOffset = new OperatorNode('*', waveAxis, new OperatorNode('*', vertexWave, vertexAmplitude));
const displacedPosition = new OperatorNode('+', positionNode, vertexOffset);

const material = new MeshStandardNodeMaterial();
material.emissiveNode = finalColor;
material.positionNode = displacedPosition;
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
        entrypoints: ['emissiveNode', 'positionNode'],
        includeThreeRevision: true,
        nodeSerializer: createDefaultNodeSerializer({
          overrides: {
            UniformNode: (node) => {
              const uniform = node as { isUniformNode?: boolean; name?: string };
              if (uniform.isUniformNode && uniform.name === 'uTime') {
                return { op: 'time' };
              }
              return null;
            }
          }
        })
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
        nodeResolver: createDefaultNodeResolver()
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
  vertexAmplitude.value = Number(vertexAmplitudeInput.value);
  vertexSpeed.value = Number(vertexSpeedInput.value);
  material.roughness = Number(roughnessInput.value);
  material.metalness = Number(metalnessInput.value);


  lineDensityValue.textContent = lineDensityInput.value;
  lineWidthValue.textContent = lineWidthInput.value;
  flowSpeedValue.textContent = flowSpeedScaled.toFixed(2);
  vertexAmplitudeValue.textContent = vertexAmplitudeInput.value;
  vertexSpeedValue.textContent = vertexSpeedInput.value;
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
    vertexAmplitudeInput,
    vertexSpeedInput,
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

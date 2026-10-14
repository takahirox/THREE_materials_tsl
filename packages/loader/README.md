# @takahirox/gltf-three-materials-tsl-loader

GLTFLoader plugin for [THREE_materials_tsl Draft v2.0](../../README.md).
Version 0.4.0 is v2.0-only. Earlier encodings use the ordinary glTF fallback.

## Install

```sh
npm install three @takahirox/gltf-three-materials-tsl-loader
```

## Usage

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@takahirox/gltf-three-materials-tsl-loader';

const loader = new GLTFLoader();
loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
  nodeResolver: createDefaultNodeResolver(),
  onError: (error) => console.warn('TSL material uses ordinary glTF fallback:', error)
}));
```

`nodeResolver` is required. Each material's required `materialType` selects its
own class; built-in mappings are `MeshBasicNodeMaterial`,
`MeshStandardNodeMaterial`, and `MeshPhysicalNodeMaterial`. There is no inferred
material type. Extend or override the mapping with subclasses of these families:

```ts
class CustomMaterial extends MeshPhysicalNodeMaterial {
  static get type() { return 'CustomMaterial'; }
}

loader.register((parser) => new THREEMaterialsTSLLoaderPlugin(parser, {
  materialTypes: { CustomMaterial },
  nodeResolver: createDefaultNodeResolver({
    overrides: { MyCustomNode: (args) => new MyCustomNode(args) }
  })
}));
```

Import `MeshPhysicalNodeMaterial` from `three/webgpu` in this example. The mapping
constructors take no arguments and must produce a NodeMaterial whose `type`
exactly matches the identifier. The removed `materialType` and
`supportedVersions` options have no replacement defaults.

## Supported scope

The reference implementation is tested with Three.js **r182** and mesh materials.
It preserves GLTFLoader's core PBR/alpha/texture values and its supported ordinary
material extensions, including physical clearcoat, transmission, volume, IOR,
specular, sheen, iridescence, anisotropy, dispersion and emissive strength.
`KHR_materials_unlit` uses `MeshBasicNodeMaterial`. A physical ordinary material
requires a physical NodeMaterial; incompatible pairings use fallback. New
material families or custom ordinary material extensions may need a property
transfer adapter in the plugin. Lines and points remain ordinary Three.js
materials, as created by GLTFLoader.

The plugin lets GLTFLoader construct ordinary materials and primitive-specific
clones first. In `afterRoot`, it prepares the graph and all replacements for each
material privately, then updates scene references, associations and dependency
caches. Shared materials stay shared, while clone-specific values such as vertex
colors, flat shading and normal scales stay distinct. Failed validation, type
resolution, or graph reconstruction leaves the original ordinary material and
its supported extensions intact. `onError` receives the failure; `onApplied`
receives each prepared NodeMaterial and its extension before publication. A
throwing `onApplied` also causes fallback for that material.

The default node resolver supports:

- Shared node objects exported by `three/tsl`, including `materialColor`, `time`
  and position/normal accessors. Their runtime identity and dynamic references
  are retained; file data cannot mutate their links.
- `ConstNode` and `UniformNode` with numeric, boolean, color, vector or matrix
  literals, using Three.js's deserialization (including precision).
- `AttributeNode`, `MathNode`, and `OperatorNode` with serialized inputs.

Entrypoints must name existing material properties ending in `Node`. All graph
nodes are checked, including unreachable definitions. Nested array/object links,
node references, texture references and accessor references are supported.
Custom resolvers receive `(op, args)` and return a node instance, a constructor,
or a factory. Return fresh instances for nodes with links; links are assigned
after construction. Factories/constructors receive array arguments positionally
and other arguments as one value. Custom code is consumer-supplied, never read
from the glTF file.

This is not a universal TSL deserializer: texture/buffer node classes, functions,
closures, renderer resources and arbitrary custom nodes require paired exporter
and resolver adapters. Runtime rendering still depends on Three.js's own node
semantics and renderer support. `three.revision` is optional diagnostic metadata;
it does not select a migration or gate loading.

## Development and tests

```sh
npm ci
npm run build
```

The shared integration suite lives in [the demo package](../demo/README.md#tests)
and tests both plugins with the real Three.js loader/exporter.

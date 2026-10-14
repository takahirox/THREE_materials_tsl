# @takahirox/gltf-three-materials-tsl-exporter

GLTFExporter plugin for [THREE_materials_tsl Draft v2.0](../../README.md).
Version 0.4.0 emits only v2.0, including the actual NodeMaterial's required
`materialType`. The former `version` option is removed.

## Install

```sh
npm install three @takahirox/gltf-three-materials-tsl-exporter
```

## Usage

```ts
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  THREEMaterialsTSLExporterPlugin,
  createDefaultNodeSerializer
} from '@takahirox/gltf-three-materials-tsl-exporter';

const exporter = new GLTFExporter();
exporter.register((writer) => new THREEMaterialsTSLExporterPlugin(writer, {
  nodeSerializer: createDefaultNodeSerializer(),
  includeThreeRevision: true
}));
```

By default, all populated node properties ending in `Node` are exported as
entrypoints. An optional `entrypoints: ['emissiveNode', 'positionNode']` selects
only those graph slots. A material with no selected graph emits only ordinary
glTF material data. Missing/invalid concrete material types, unsupported nodes,
cycles and unrepresentable links throw instead of silently losing graph data.
`threeRevision` can supply an informational revision string; neither revision
option changes the encoding or triggers migration.

## Supported scope

Tested with Three.js **r182**: `MeshBasicNodeMaterial`,
`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, and custom subclasses
retaining these ordinary material families. GLTFExporter uses their ordinary
material flags to export core color/metalness/roughness/emissive/alpha/texture
properties and its supported `KHR_materials_*` extensions. This includes unlit,
clearcoat, transmission, volume, IOR, specular, sheen, iridescence, anisotropy,
dispersion and emissive strength. The plugin does not replace these values with
TSL graph results. Author meaningful ordinary properties so viewers without TSL
support have a usable fallback; arbitrary graphs cannot be baked automatically.

The default serializer supports shared node objects from `three/tsl` (including
dynamic `materialColor` and `time`), `ConstNode`/`UniformNode` numeric, boolean,
color, vector and matrix literals, `AttributeNode`, `MathNode`, and `OperatorNode`.
It reuses Three.js serialization and child discovery with explicit input
handling. It preserves shared graph inputs. Unsupported classes or literal
value types require adapters; arbitrary functions, closures, shader code,
texture/buffer node classes and renderer resources are not automatically
serializable. Support across Three.js revisions is not guaranteed.

Provide paired serializer/resolver overrides for custom nodes:

```ts
const nodeSerializer = createDefaultNodeSerializer({
  overrides: {
    MyCustomNode: (node) => ({
      op: 'MyCustomNode',
      args: { strength: node.strength },
      links: {
        input: { node: node.input },
        resources: [{ texture: node.texture }, { accessor: node.attribute }]
      }
    })
  }
});
```

`args` must contain JSON literals. Links accept nodes (or `{ node }` wrappers),
`{ texture }`, `{ accessor }`, and nested arrays/objects of these targets.
Textures/accessors are exported through the glTF writer and resolved by the
loader. Missing accessor support or invalid link targets throw. Custom nodes
still need a matching consumer resolver; exporting a custom op does not make it
universally supported.

## Development and tests

```sh
npm ci
npm run build
```

The shared integration suite lives in [the demo package](../demo/README.md#tests)
and tests both plugins with the real Three.js loader/exporter.

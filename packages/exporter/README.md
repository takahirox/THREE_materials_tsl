# @takahirox/gltf-three-materials-tsl-exporter

GLTFExporter plugin for the THREE_materials_tsl extension.

## Install

```sh
npm install @takahirox/gltf-three-materials-tsl-exporter
```

## Usage

```ts
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  THREEMaterialsTSLExporterPlugin,
  createDefaultNodeSerializer,
  getSharedTSLNodeName
} from '@takahirox/gltf-three-materials-tsl-exporter';

const exporter = new GLTFExporter();
exporter.register(
  (writer) =>
    new THREEMaterialsTSLExporterPlugin(writer, {
      entrypoints: ['emissiveNode'],
      nodeSerializer: createDefaultNodeSerializer()
    })
);
```

`createDefaultNodeSerializer()` covers shared TSL nodes and common node types.
If you need custom handling, you can override by op name:

```ts
const serializer = createDefaultNodeSerializer({
  overrides: {
    ExampleNode: (node) => ({ op: 'ExampleNode', args: { /* ... */ } })
  }
});
```

## Spec

See the extension specification at `../README.md`.

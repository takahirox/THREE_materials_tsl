# @takahirox/gltf-three-materials-tsl-exporter

GLTFExporter plugin for the THREE_materials_tsl extension.

## Install

```sh
npm install @takahirox/gltf-three-materials-tsl-exporter
```

## Usage

```ts
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { THREEMaterialsTSLExporterPlugin, getSharedTSLNodeName } from '@takahirox/gltf-three-materials-tsl-exporter';

const exporter = new GLTFExporter();
exporter.register(
  (writer) =>
    new THREEMaterialsTSLExporterPlugin(writer, {
      entrypoints: ['emissiveNode'],
      nodeSerializer: (node) => {
        const shared = getSharedTSLNodeName(node);
        if (shared) {
          return { op: shared };
        }
        // Return { op, args?, links? } for custom nodes.
        return { op: 'ExampleNode' };
      }
    })
);
```

`getSharedTSLNodeName()` lets you preserve semantics for shared TSL nodes
like `time`, `positionLocal`, and `normalView` by emitting their names as `op`.

## Spec

See the extension specification at `../README.md`.

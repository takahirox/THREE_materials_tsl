# @takahirox/gltf-three-materials-tsl-loader

GLTFLoader plugin for the THREE_materials_tsl extension.

## Install

```sh
npm install @takahirox/gltf-three-materials-tsl-loader
```

## Usage

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { THREEMaterialsTSLLoaderPlugin, createDefaultNodeResolver } from '@takahirox/gltf-three-materials-tsl-loader';

const loader = new GLTFLoader();
loader.register(
  (parser) =>
    new THREEMaterialsTSLLoaderPlugin(parser, {
      nodeResolver: createDefaultNodeResolver()
    })
);
```

`createDefaultNodeResolver()` uses the Three.js TSL exports to resolve common node ops.
You can override or extend it for custom nodes:

```ts
const nodeResolver = createDefaultNodeResolver({
  overrides: {
    MyCustomNode: MyCustomNodeClass
  }
});
```

## Spec

See the extension specification at `../README.md`.

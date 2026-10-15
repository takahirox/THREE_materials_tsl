# Demo

NodeMaterial round-trip demo using the THREE_materials_tsl Draft v2.0 loader and
exporter. The loader resolves the exported material type and preserves ordinary
material values and primitive-specific clones without demo-side repairs.

## Run

```sh
npm ci
npm run dev
```

Open the local dev server URL shown by Vite. Rendering requires WebGPU.

## Tests

```sh
npm ci
npm test
npm run typecheck
npm run build
```

The Vitest suite imports both plugins' source through the same aliases and
Three.js deduplication as the demo. It uses real r186 GLTFLoader/GLTFExporter
round trips with embedded buffers. Node provides the test environment; small
FileReader/ProgressEvent shims cover buffer I/O, so a browser/GPU is unnecessary.
The original texture binding tests inject a Texture source. The additional
`textures.test.js` suite uses the demo-only `@napi-rs/canvas` development dependency
for real PNG encoding/decoding through the native writer/parser, including GLB
image bufferViews and repeated image/graph round trips. Tests exercise Three.js
material-reference updates and CPU image data, not GPU pixel output.

The tested versions are `three@0.186.1` and `@types/three@0.186.0`. See the
[r186 validation report](../../docs/three-r186-validation.md) for Issue #11's
clean-install, test, build and dependency-audit results.

Coverage includes standard/physical/unlit material types, ordinary PBR and
supported physical `KHR_materials_*` values, dynamic materialColor, repeated
round trips, shared graphs/materials, mesh-specific clones, texture transforms,
custom material/node mappings, nested texture/accessor links and atomic fallback
for malformed graphs and unsupported encodings. See the
[loader](../loader/README.md#supported-scope) and
[exporter](../exporter/README.md#supported-scope) for the supported node scope.
The [r186 coverage matrix](../../docs/tsl-node-coverage.md)
records the full class/shared-object audit. New expression families have repeated
round-trip and real Three.js GLSL builder tests, including fluent TSL graphs,
shared inputs, variable/interpolation fields, arrays, conditional selection and
rotation. These checks do not compile GPU programs or validate rendered pixels. See the
[2D texture audit and subset](../../docs/texture-node-support.md) for supported
sampling/query nodes, ordinary fallback transform restrictions and texture tests.

The [shading-node suite](test/shading.test.js) covers surface mapping, vertex
colors, color/output conversion and bit/packing through repeated real round trips.
It compares GLSL shader generation for every group and WGSL bit/packing generation,
including native and emulated packed-integer paths. It checks invalid variants and
atomic ordinary-material fallback; see the [shading audit](../../docs/shading-node-support.md).
Node-side checks do not establish GPU pixel correctness.

For all required checks from the repository root:

```sh
npm --prefix packages/loader ci
npm --prefix packages/exporter ci
npm --prefix packages/demo ci
npm --prefix packages/demo test
npm --prefix packages/loader run build
npm --prefix packages/exporter run build
npm --prefix packages/demo run typecheck
npm --prefix packages/demo run build
git diff --check
```

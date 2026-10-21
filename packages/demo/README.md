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

The [reference-node suite](test/references.test.js) checks every supported ordinary
MaterialNode/ModelNode scope and typed current-material property through two real
round trips, GLSL generation and native NodeFrame updates, including shared
materials, GLTFLoader clones, object transforms and atomic fallback. See the
[four-class audit and exact binding boundaries](../../docs/reference-node-support.md).

The [geometry-node suite](test/geometry.test.js) covers ordinary index, front-facing,
screen and viewport-depth instances through two real round trips, GLSL/WGSL
shader flow and native screen/camera updates. It checks singleton identity,
shared links, exact scope/stage restrictions and complete material fallback.
See the [scope audit and deferrals](../../docs/geometry-node-support.md).
These checks do not establish GPU pixel behavior.

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

The [uniform-array suite](test/uniformArrays.test.js) covers all seven bounded
scalar/color/vector types through repeated real round trips, GLSL/WGSL buffer
reads/declarations, native padding and per-render updates, shared parent/index
links, mutable snapshots and complete ordinary-material fallback. See the
[exact subset, r186 audit and check results](../../docs/uniform-array-support.md).
GPU compilation and rendered pixels are not established by these Node tests.

The [uniform-group suite](test/uniformGroups.test.js) covers exact object/render/
frame groups on ordinary UniformNode through two JSON glTF and GLB round trips,
shared references, ordinary material coexistence, strict export rejection and
complete import fallback. It checks native GLSL/WGSL flow, group order and binding
reuse/cloning, live packed values, and NodeFrame/NodeManager update behavior.
See the [group audit and independent-group deferrals](../../docs/uniform-group-support.md).
These CPU checks do not establish GPU compilation or rendered pixels.

The [BufferNode suite](test/buffers.test.js) covers bounded Float32Array `vec4`
and column-major `mat4` snapshots through two JSON glTF/GLB round trips, native
GLSL/WGSL expressions and declarations, element/index sharing, live native buffer
bindings and backend upload calls with mocked GPU endpoints. It also checks
strict export rejection and complete ordinary-material fallback. See the
[exact subset, source audit and deferrals](../../docs/buffer-node-support.md).
These CPU checks do not establish GPU compilation, upload success or pixels.

The [UserDataNode suite](test/userData.test.js) checks current-object scalar float
reads through two JSON glTF/GLB round trips, actual mesh extras, shared materials
with distinct values, cached geometry, material clones, multiple scenes and native
NodeFrame updates after mutations. It compares GLSL/WGSL vertex/fragment flow and
checks complete ordinary-material fallback for invalid graphs, extras and owners.
See the [exact subset, source audit and deferrals](../../docs/user-data-node-support.md).
Browser/GPU rendering was not performed; these CPU checks do not prove compilation
or rendered pixels.

The [BufferAttributeNode suite](test/bufferAttributes.test.js) covers all four
bounded static Float32 widths with inferred and matching explicit types through
two JSON glTF/GLB round trips on real indexed and non-indexed triangle geometries.
It compares native GLSL/WGSL attributes and fragment varyings, render-object
attribute selection, version scheduling and backend update calls with mocked
endpoints. It also checks shared/cached geometry, material clones and complete
fallback for malformed accessor/graph/geometry inputs. See the
[exact contract, source audit and deferred layouts](../../docs/buffer-attribute-node-support.md).
These CPU checks do not establish device uploads or pixel correctness.

The [renderer-reference suite](test/rendererReferences.test.js) covers independent
current-renderer `toneMappingExposure` float instances and exact singleton identity
through two JSON glTF/GLB round trips, native NodeFrame exposure changes, built and
unbuilt GLSL/WGSL flow, native render-group uniforms, material clones and complete
ordinary-material fallback. See the [source audit and exact boundaries](../../docs/renderer-reference-node-support.md).
These Node checks do not establish GPU compilation or pixels.

The [position-reference suite](test/positionReferences.test.js) checks native
current-rendered-Mesh local position reads through two JSON/GLB cycles, pure
translation matrices and TRS, transformed parents, shared materials, geometry and
material clones, multiple scenes, exact object association, native NodeFrame
updates and GLSL/WGSL CPU uniform flow. It verifies strict rejection and complete
ordinary material fallback. See the [bounded contract and installed source audit](../../docs/position-reference-node-support.md).
Browser/GPU compilation, uploads and rendered pixels were not validated.

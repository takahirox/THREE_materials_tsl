# Static BufferAttributeNode accessor round trips (Issue #33)

## Source and stable-version audit

Audited installed **three@0.186.1** source and bundled classes on 2026-10-17.
The [npm stable metadata](https://registry.npmjs.org/three/latest) was rechecked
during implementation and still reported **0.186.1**. The unchanged peer range
is not evidence of equivalent behavior in other Three.js revisions.

| Native source | Audited behavior and consequence |
| --- | --- |
| [BufferAttributeNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/accessors/BufferAttributeNode.js) | Constructor inputs are value, bufferType, bufferStride and bufferOffset. It initializes global=true, static usage, instanced=false and attribute=null, then an ordinary BufferAttribute with itemSize <=4 sets attribute=value, usage=value.usage and instanced=value.isInstancedBufferAttribute (normally **undefined**, not false). setup returns immediately for this existing attribute. Hydrating value alone would leave a constructor placeholder or wrong cached attribute active. |
| Same class: factories and inference | bufferAttribute uses that constructor and static usage. generateNodeType infers from the attribute only when bufferType is null, mutating bufferType but leaving nodeType null. Matching explicit float/vector types give equivalent shader declarations. Matrix factories construct multiple column nodes with stride/offset; those are excluded. In r186 the non-matrix factory return branch omits setInstanced(instanced), even for the named instancedBufferAttribute factory. The adapter checks actual native state; it does not repair or infer intent from factory names. True instancing flags and dynamic usage are rejected. |
| [InputNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/InputNode.js), [Node](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/Node.js), [NodeUtils](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeUtils.js) | BufferAttributeNode has no serialize/deserialize override. InputNode saves value/valueType/nodeType/precision; generic value serialization does not establish a glTF accessor or rebuild attribute/usage/instancing. getSerializeChildren discovers node-valued inputs, not ordinary BufferAttributes. Node child serialization alone omits these constructor/layout fields. Unknown own state, hidden child attachments and callbacks must therefore fail the explicit adapter, rather than disappear. |
| BufferAttributeNode and [NodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeBuilder.js) | getHash keys the builder global cache by **value object** for zero stride/offset. Repeated references to the exact attribute must reuse one accessor, even through distinct nodes. getBufferAttributeFromNode caches a NodeAttribute in vertex node data, generates nodeAttribute plus an index, and records its source node. generate writes that generated name into node.name. Native private caches, IDs, generated names and inferred bufferType are derived state; no renderer objects or cache contents are transported. |
| BufferAttributeNode, [VaryingNode](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/VaryingNode.js) | Vertex generation reads the native attribute directly. Fragment generation constructs a native varying whose setup/analyze/generate flow requests the vertex read and interpolation. The plugins do not substitute a geometry attribute, constant, expression array or hand-written varying. Compute use is outside this mesh-material subset. |
| [GLTFWriter](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/exporters/GLTFExporter.js): processAccessor/processBufferView | With **no geometry argument**, count defaults to attribute.count and no bufferView target or byteStride is inferred. Float32Array maps to FLOAT/5126, and widths 1–4 to SCALAR/VEC2/VEC3/VEC4. The writer computes min/max and copies view components as little-endian Float32 bytes into four-byte-aligned bufferViews. It can also dispatch integer arrays and matrix widths, which does not establish support here. Native zero-count accessors return null. |
| [GLTFParser](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js): getDependency/loadAccessor | Accessor dependencies are cached. Ordinary packed accessors create a BufferAttribute over a typed view of the bufferView with the accessor offset; mismatched byteStride creates an InterleavedBufferAttribute. Sparse and missing-bufferView paths have separate behavior. The adapter checks metadata **before** requesting its TSL accessor dependency, then checks the resolved native object/data. No bufferView target is needed for this node-owned vertex binding. |
| [GLSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js), [WGSLNodeBuilder](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/nodes/WGSLNodeBuilder.js) | getAttributesArray combines ordinary geometry attributes and node buffer attributes. GLSL declares layout(location) in float/vecN; WGSL declares @location float/vecN<f32> inputs. Native varyings carry fragment reads. Tests compare setup/analyze/generate results, vertex flow and both varying declarations; only generated attribute/varying numeric suffixes are normalized. |
| [RenderObject](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/RenderObject.js), [Geometries](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Geometries.js), [Attributes](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Attributes.js) | RenderObject selects nodeAttribute.node.attribute ahead of geometry-name lookup and collects it as a vertex buffer. Geometries forwards it to native attribute management; Attributes creates a vertex attribute and uploads again when its version advances. The restored attribute must be the parser accessor, not an obsolete placeholder. Replacing node.value alone after construction is not a supported rebinding operation. |
| [WebGLAttributeUtils](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgl-fallback/utils/WebGLAttributeUtils.js), [WebGPUAttributeUtils](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/utils/WebGPUAttributeUtils.js) | Full updates use bufferSubData / queue.writeBuffer with the current attribute array. Ordinary Float32 vertex widths have strides 4/8/12/16, zero offsets, per-vertex stepping and float32[/xN] WebGPU formats. Vec3 storage padding is a different path. Pending ranges, integer conversion/padding, instancing and upload history are excluded. Backend update tests use mocked endpoints, not devices. |

## Exact default contract

Export accepts exact bundled or source-module BufferAttributeNode prototypes;
import always constructs the bundled class used by three/tsl. Attribute values
must have exactly BufferAttribute or Float32BufferAttribute prototypes. Other
classes and subclasses inheriting the built-in operation ID fail export.

| Field | Accepted state |
| --- | --- |
| value | Ordinary undecorated Float32Array-backed BufferAttribute/Float32BufferAttribute; ordinary ArrayBuffer backing. Nonzero typed-view byte offsets are accepted as value snapshots, distinct from forbidden node layout offsets. |
| itemSize / count | Width 1, 2, 3 or 4; integral count 1–4096; array length exactly count × width. Maximum data is 64 KiB per node attribute. Every component must be finite; binary data preserves negative zero, subnormals and Float32 extremes. |
| bufferType / nodeType | Inferred null/null, native inferred matching-type/null after build, or matching explicit float/vec2/vec3/vec4 in both fields. Inferred post-build bufferType is normalized back to null constructor input. Mismatched explicit types and changed base type fail. |
| attribute / layout | attribute === value, bufferStride=0, bufferOffset=0. Geometry must not share the attribute, typed array or backing memory. Distinct graph attribute objects sharing backing memory require an alias adapter; exact repeated attribute objects reuse one accessor. |
| usage / instancing | StaticDrawUsage on node and attribute; ordinary native instanced=undefined and no instanced attribute flag. Explicit true/false changes are outside the native default subset. |
| base/input state | Native defaults: null precision, empty label (or native generated nodeAttribute plus numeric suffix), global=true, parents=false, all lifecycle types none. Attribute name is empty, normalized=false, gpuType=FloatType; updateRanges is an exact empty ordinary array. |
| runtime state | Native IDs, UUIDs, nonnegative versions, stack traces, known private build caches and generated names are omitted. All other own fields/symbols, getters, method overrides, callbacks, event listeners and child attachments fail export. |

Only ordinary exact Mesh objects with one non-array material and one emitted
triangle primitive are supported. Each using geometry must have a VEC3 position
attribute with count equal to the node attribute count, no instanced geometry,
morphs, indirect draw or restricted draw range. Indexed and non-indexed triangles
work; indices must be integral and within vertex bounds, with a multiple of three
elements. Wireframe, pivot changes, skinning, material arrays and multi-primitive
ownership are excluded. Counts 1 and 4096 are exercised using an indexed triangle;
a one-vertex triangle is necessarily degenerate. Representative three-vertex
cases have distinct, non-collinear geometry vertices and native per-vertex
displacement/color expressions.

Exporter beforeParse preflights selected graphs and every visible using object.
writeMesh checks the geometry; afterParse rechecks every exported nodeMap object
and its emitted primitive, including objects skipped by native geometry/material
caching. Hidden objects follow the writer's onlyVisible setting. Loader afterRoot
checks all material-using primitive definitions and actual rendered mesh objects
in **all loaded scenes**, after native geometry/material cloning. Raw primitive
and owning-node extensions, skin/camera attachments and morph targets are outside
the import allowlist. No Three.js core change was needed.

Compatible shared materials, reused geometry, independent geometry clones,
primitive-specific material clones and scene-root clones retain native behavior.
All affected users must pass before any material replacement is published.
Uninstantiated primitive definitions with incompatible vertex counts also fail.
No graph evaluation, shader calculation or geometry remapping is added.

## Encoding, hydration and identity

The existing Draft v2.0 graph encodes the node as:

```json
{
  "op": "BufferAttributeNode",
  "args": { "bufferType": null },
  "links": { "value": { "$refAccessor": 2 } }
}
```

args has exactly bufferType, either null or the matching float/vector type;
links has exactly value with one nonnegative integer $refAccessor. The accessor
carries width, count, component type and data. Numeric arrays are never duplicated
in args, and there is no new extension resource type or schema field.

The writer reuses processAccessor without geometry and caches accessor indices
by attribute object to preserve native hash sharing. The importer validates a
FLOAT SCALAR/VEC2/VEC3/VEC4 accessor, positive bounded count, false/absent
normalized, actual packed bufferView and backing buffer bounds, aligned offsets,
and absent sparse/layout/extension behavior. The default transport requires
absent target/byteStride; even an equivalent packed byteStride is intentionally
outside this narrow encoding. Optional min/max must match actual finite data.
Native types, itemSize/count, lifecycle/layout defaults and graph memory aliases
are checked after dependency resolution too.

Construction starts with a null value, so it cannot retain a placeholder
attribute. After value hydration the adapter uses a real native constructor to
restore its derived attribute, usage and instanced fields, asserts
**attribute === value === resolved parser accessor**, and validates geometry
before publication. It never changes the parser accessor or ordinary geometry.
The existing graph IDs preserve shared nodes/entrypoints within each material;
distinct material graphs construct distinct nodes. Repeated references to one
accessor retain the parser's attribute identity. External application references,
backing-memory aliases, mutable resource lifetimes and renderer caches are not a
portable identity contract.

This is a snapshot of the current view, not a frozen attribute. Native in-place
updates plus needsUpdate remain native version-based uploads after import;
resizing, rebinding, changing usage/layout or custom scheduling require explicit
application ownership. Pending partial ranges fail a subsequent default export.
No allocation history, update callback or GPU buffer is serialized.

## Atomic fallback and deferred adapters

The loader resolves/validates every definition, including unreachable ones,
before assigning entrypoints to private candidates and publishing any material.
Unknown/missing fields, malformed/dangling/wrong-kind accessor links, resource
loading failures, metadata/data mismatches, bad geometry bindings, unknown ops,
cycles, invalid unreachable nodes and reconstruction failures reject the entire
material. Existing ordinary material references, supported other KHR material
extensions, native clones and dependency caches remain unchanged. The negative
suite compares full material JSON against a plugin-disabled ordinary control,
with TSL recognized in both controls to avoid unknown-extension extras differences.
As with existing plugins, ordinary glTF itself must be loadable before afterRoot;
this adapter cannot recover core loader failures unrelated to its graph.

| Deferred variant | Reason and proposed paired adapter path |
| --- | --- |
| Interleaved buffers/attributes, nonzero stride/offset, matrices/column views | Native setup can create interleaved views and cache shared underlying buffers. Independent packed accessor snapshots would erase column/view relationships. Paired accessor and geometry adapters must specify shared bufferView layout, offsets/stride, matrix column ownership and backend declarations/bindings. |
| Integer, normalized, non-Float32/Float16 values and other shader types | Native type inference, GPU vertex formats and conversion/padding differ. Paired accessors must preserve componentType/normalized/gpuType and prove declarations, formats and values on both backends. |
| Instanced, storage, compute or indirect data | Require instance counts/divisors, allocation/access, dispatch and synchronization ownership. Use paired geometry/resource adapters with an explicit lifecycle and renderer contract, not static accessor conversion. |
| Dynamic usage, pending ranges and custom upload scheduling | Snapshot data does not encode renderer history or partial synchronization. Paired resource adapters need initial/full upload and subsequent scheduling/ownership rules; callbacks must remain consumer code. |
| Geometry aliases, distinct attribute wrappers sharing backing memory, external mutable identity | Duplicating values disconnects live aliasing and native cache keys. Exact repeated attributes already reuse accessors; broader aliases need paired shared-resource/view bindings and explicit lifetime ownership. |
| Material arrays, multiple primitives, skinning, morphs, non-Mesh objects, restricted draws and mesh/primitive extensions | Primitive splitting, vertex remapping, stage inputs and resource ownership have not been proven. Paired geometry/material adapters must validate every generated primitive/clone and preserve vertex correspondence. |
| Names/labels outside native generated form, changed precision/base state, custom methods/children/subclasses | These are additional semantics absent from the default constructor contract. A consumer-owned paired node adapter may define known data selectors and behavior; files must not carry callbacks, JavaScript, GLSL or WGSL. |
| Sparse/implicit-zero accessors, bufferView targets/strides, compressed or extension-defined layouts | The native parser has separate allocation/decoding branches, outside this writer's targetless packed accessor path. Paired accessor adapters must validate metadata, reconstructed views and repeated native geometry/shader behavior before widening the allowlist. |

Draft v2.0, materialType restoration, existing singleton/default-node behavior,
and removal of Draft v1.0 are unchanged. No version bump, npm publication,
executable code, shader source, renderer object or GPU buffer is added to files.

## Validation

The [focused suite](../packages/demo/test/bufferAttributes.test.js) performs two
real GLTFExporter → GLTFLoader round trips for every width 1–4 with inferred and
matching explicit types, JSON glTF and GLB, counts 1/3/4096, independent native
accessors, material entrypoints and graph/resource sharing. It exercises source
and bundled classes, nonzero typed-view offsets, Float32 limits/negative zero,
shared/cached meshes, material/geometry clones, multiple scenes, selected graphs,
strict source rejection and whole-material import fallback.

Native GLSL/WGSL setup/analyze/generate flows, declarations and vertex-to-fragment
varyings are compared before/after import, including per-vertex displacement
expressions. Native RenderObject selection, Attributes version scheduling,
WebGPU vertex layouts and native backend update methods with mocked endpoints
verify which CPU attribute/view would be bound/uploaded. These checks **do not
prove GPU compilation, device upload success or rendered pixels**. Optional
browser WebGL/WebGPU pixel smoke tests were not run. No post-merge verification
is required.

### Check results (2026-10-17)

Results below are from the final validation run; no tests were skipped.

| Command from repository root | Result |
| --- | --- |
| `npm --prefix packages/loader ci` | Passed; 0 vulnerabilities reported. |
| `npm --prefix packages/exporter ci` | Passed; 0 vulnerabilities reported. |
| `npm --prefix packages/demo ci` | Passed; 10 existing dependency advisories (3 moderate, 5 high, 2 critical). No dependency or lockfile changes. |
| `npm --prefix packages/demo test` | Passed: **11 files, 1732 tests**, including **221 BufferAttributeNode tests**; no skips. Existing texture-packing cases emit native merge/UV-channel warnings. |
| `npm --prefix packages/loader run build` | Passed. |
| `npm --prefix packages/exporter run build` | Passed. |
| `npm --prefix packages/demo run typecheck` | Passed. |
| `npm --prefix packages/demo run build` | Passed; Vite warned about a minified chunk exceeding 500 kB (1744.80 kB). |
| `git diff --check` / `git diff --cached --check` | Passed. |
| Browser WebGL/WebGPU visual checks | Not run (optional); devices and pixels remain unverified. |

Initial focused runs exposed test-harness assumptions about TSL conversion
wrappers, WGSL varying declaration arguments and Vitest matcher availability;
those fixtures were corrected. Negative cases also exposed missing sparse-range
length validation and the need to preflight positionless geometry before the
native writer skips it; both were fixed. The first full run caught an existing
custom-accessor test regression where a cached index bypassed a missing writer
hook. The exporter now checks the hook before using the cache. Final results
above supersede those intermediate failures.

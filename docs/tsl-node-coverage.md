# Three.js TSL node coverage

This is the default-plugin coverage inventory for [Issue #15](https://github.com/takahirox/THREE_materials_tsl/issues/15),
updated with [Issue #17](https://github.com/takahirox/THREE_materials_tsl/issues/17) 2D texture support,
[Issue #19](https://github.com/takahirox/THREE_materials_tsl/issues/19) shading and bit/packing nodes,
and [Issue #21](https://github.com/takahirox/THREE_materials_tsl/issues/21) dynamic material/model references.
It describes **Draft v2.0 only** and does not change the extension schema or promise universal TSL portability.

## Reference and audit method

Audited **Three.js r186**, using installed `three@0.186.1` and
`@types/three@0.186.0`. On **2026-10-15**, the
[latest stable GitHub release](https://github.com/mrdoob/three.js/releases/tag/r186)
was r186 and the [npm latest package](https://registry.npmjs.org/three/latest)
was 0.186.1; no version upgrade was needed. The peer range is unchanged and is
not evidence that every release in that range has this coverage.

The references are [r186 src/nodes](https://github.com/mrdoob/three.js/tree/r186/src/nodes),
[Nodes.js class exports](https://github.com/mrdoob/three.js/blob/r186/src/nodes/Nodes.js),
[Three.TSL.js public exports](https://github.com/mrdoob/three.js/blob/r186/src/Three.TSL.js),
and the installed 0.186.1 source. The audit compared constructor data, child
discovery, serialize/deserialize implementations and runtime setup/generation;
export presence alone does not establish serializability. The family table
below accounts for all 152 classes declared under the installed `src/nodes`, including
internal TSL classes; non-node support classes are listed separately.

There are **682 public TSL export names**: **179 node-object names** (178 distinct
objects, because aliases can share identity), **495 function-valued exports**, and
8 other exports. Functions include constructors, factories and combinators;
they are not automatically operation identifiers. Exact shared objects are
resolved before ordinary class adapters, so a supported singleton does not imply
support for other instances of its class.

## Class/family matrix

“Supported and tested” is the existing baseline. “Newly implemented and tested”
is the additional default coverage in this issue. “Requires a custom adapter”
means the default fails explicitly; resource/property conventions must be paired
between producer and consumer. “Deferred/unsupported” is an intentional boundary,
with an adapter path or future decision recorded in each row.

| Family | Status | Concrete classes/APIs | Scope, limitation, adapter path and next step |
| --- | --- | --- | --- |
| Existing defaults | **Supported and tested** | `ConstNode`, `UniformNode`, `AttributeNode`, `MathNode`, `OperatorNode` | Numeric/boolean/color/vector/matrix literals, attributes and math/operators. Uses Three.js value/precision serialization and deserialization; graph links retain identity. Uniform callbacks and non-default groups require adapters. |
| Expression construction | **Newly implemented and tested** | `SplitNode`, `JoinNode`, `ConvertNode`, `SetNode`, `FlipNode` | Swizzle components, ordered component updates/flips, explicit/inferred vector types and conversion overloads. Inputs and repeated references are retained. Three.js owns the shader operations. |
| Arrays and selection | **Newly implemented and tested** | `ArrayNode`, `ArrayElementNode`, `ConditionalNode` | Array element type/count, initializers or default initialization, element indices, condition/if/optional else inputs. This supports expression selection, not arbitrary JavaScript control flow. |
| Variables, vertex interpolation and rotation | **Newly implemented and tested** | `VarNode`, `VaryingNode`, `SubBuildNode`, `RotateNode` | Variable name/readOnly/intent, varying name and interpolation type/sampling, SubBuild name/type, and Euler order. Base name, nodeType, global and parents flags are retained. The r186 operation name for SubBuildNode is `SubBuild`. |
| 2D texture sampling and queries | **Supported and tested (#17)** | `TextureNode`, `TextureSizeNode`, `MaxMipLevelNode` | Ordinary RGBA8 image textures through native glTF resources; default/explicit UVs and channels, transforms/matrix updates, color space, sampler/mipmap intent, level/bias/offset/fetch, and internal base-node references. See the [supported subset and transform constraints](texture-node-support.md). |
| Advanced texture variants | **Requires a custom adapter / separate resource design** | `CubeTextureNode`, `Texture3DNode` and advanced `TextureNode` modes | Comparison/depth, gradients, gather, external mutable references, cube/volume/storage/render-target and custom resources fail explicitly. Paired adapters need agreed resource and lifetime semantics; shader code and live objects are never file data. |
| CPU buffers and attributes | **Requires a custom adapter** | `BufferNode`, `BufferAttributeNode`, `UniformArrayNode`, `UniformArrayElementNode` | Serialization omits buffer contents, layout/stride/offset, usage and some element metadata. Accessor links already work through custom adapters, but do not by themselves specify uniform packing, interleaving or instancing. Adapters can cover immutable, non-interleaved BufferAttributes; agree on allowed layout/type/count and normalized/integer behavior, then add real buffer and shader tests. |
| Current material/model references | **Supported subset (#21)** | `MaterialNode`, `ModelNode`, `MaterialReferenceNode` | Explicit mesh/glTF material scopes, six current-object model scopes, and current-material scalar/color/vec2 properties with exact types. Native runtime updates, graph sharing and primitive clones are preserved only when native glTF transports the referenced initial values unchanged; disabled extension state, sheen normalization and normal-scale magnitude/sign restrictions are checked on export. MaterialNode roughness requires matching UV channel, transform parameters and wrap/filter settings when both roughnessMap and metalnessMap exist, because native packing uses metalnessMap's sampling. No foreign material, arbitrary property path, array/buffer or texture reference. See the [exact scope/property allowlists and audit](reference-node-support.md). |
| Explicit object and other live references | **Requires a custom adapter** | `ReferenceNode`, `ReferenceBaseNode`, `ReferenceElementNode`, `RendererReferenceNode`, `UserDataNode`, `Object3DNode` | Object identity, property paths and consumer lifetimes require paired adapters. Object3DNode's null object is unbound, not the current mesh; explicit objects lack graph/glTF bindings and are never silently retargeted. Use ModelNode for current-mesh semantics or consumer-owned binding IDs with a matching resolver. See the [binding contract](reference-node-support.md#modelnode-scopes-and-object-bindings). |
| Bit/packing math | **Supported and tested (#19)** | `BitcastNode`, `BitcountNode`, `PackFloatNode`, `UnpackFloatNode`, `Packed4x8IntegerNode` | 32-bit numeric scalar/vector bitcasts, three integer bitcount methods, snorm/unorm 2x16/4x8 and float16 2x16, all eight signed/unsigned packed-integer methods. Float-to-float bitcasts (no r186 GLSL intrinsic), invalid widths/types/layouts and wrong arity fail. See the [exact per-class variants](shading-node-support.md). |
| Surface mapping | **Supported and tested (#19)** | `NormalMapNode`, `BumpMapNode` | Tangent/object space, optional scales, tangent RG/GA unpacking and ordinary 2D textures. Object-space packed normals are incompatible in Three.js and rejected. Three.js owns derivatives, tangent frames and wireframe behavior. See [variants and tests](shading-node-support.md). |
| Color and final output | **Supported and tested (#19)** | `ColorSpaceNode`, `ToneMappingNode`, `RenderOutputNode` | Built-in sRGB/linear spaces, working/output context sentinels, seven standard tone selections, exposure/color links, null versus omitted output configuration. Custom space/tone registrations require consumer adapters; no executable library or renderer settings are stored. Consumers arrange one final output transform; see the [output contract](shading-node-support.md#output-transform-contract). |
| Vertex colors | **Supported subset (#19)** | `VertexColorNode` | Index 0 or omitted index, native geometry/interpolation and white fallback. Nonzero indices are deferred because native glTF tools rename color1 to _COLOR1/_color1, breaking lookup; paired geometry adapters are needed. Export rejects them. See [the exact boundary](shading-node-support.md). |
| Per-instance ranges | **Deferred/unsupported** | `RangeNode` | Per-instance generated range data needs geometry/instancing resource design and paired adapters; not ordinary constructor data. |
| Statements and scope | **Deferred/unsupported** | `AssignNode`, `BypassNode`, `StackNode`, `PropertyNode`, `ParameterNode`, `LoopNode`, `ContextNode`, `OverrideContextNode`, `IsolateNode`, `SampleNode`, `FunctionOverloadingNode` | Statement ordering, lexical scope, builder caches/context overrides, loop callbacks and function dispatch cannot be inferred from arbitrary links. Exact shared PropertyNode exports remain supported. Adapters can encode a small data-only, predefined operation; a general solution needs an explicit scope/control-flow design and cannot embed closures or shader code. Do not treat these as generic expression nodes. |
| Structures and render outputs | **Deferred/unsupported** | `StructNode`, `StructTypeNode`, `MemberNode`, `OutputStructNode`, `MRTNode` | Struct layouts, named member types and multi-render-target attachment semantics require additional agreement beyond ordinary material entrypoints; upstream child serialization is insufficient. Paired adapters can reconstruct fixed consumer-known structs; discuss schema-neutral layout/attachment conventions before general defaults. |
| Renderer/geometry builtins | **Requires a custom adapter** | `BuiltinNode`, `IndexNode`, `UniformGroupNode`, `ScreenNode`, `ViewportDepthNode`, `FrontFacingNode`, `PointUVNode`, `VelocityNode`, `ClippingNode` | Only exact shared exports have portable names in the current registry. Arbitrary scopes, group update lifetimes, previous-frame data and clipping/viewport context are not fully serialized. Adapters can select predefined scopes in an agreed renderer context; specify the allowed scopes/stages and lifecycle before supporting ordinary instances. |
| Storage and compute | **Deferred/unsupported** | `StorageBufferNode`, `StorageTextureNode`, `StorageTexture3DNode`, `StorageArrayElementNode`, `ComputeBuiltinNode`, `ComputeNode`, `AtomicFunctionNode`, `BarrierNode`, `SubgroupFunctionNode`, `WorkgroupInfoNode`, `WorkgroupInfoElementNode` | glTF material graphs provide neither storage allocation/access modes nor dispatch, synchronization, workgroup/subgroup guarantees and compute scheduling. Shared compute identifiers can resolve by name but this does not make compute graphs renderable as mesh materials. An adapter only works with an external resource/scheduling contract; decide that contract separately, not via ad hoc material fields. |
| Render targets, passes and environment resources | **Deferred/unsupported** | `PassNode`, `PassTextureNode`, `PassMultipleTextureNode`, `ToonOutlinePassNode`, `ViewportTextureNode`, `ViewportDepthTextureNode`, `ViewportSharedTextureNode`, `RTTNode`, `ReflectorNode`, `ReflectorBaseNode`, `CubeMapNode`, `PMREMNode` | These allocate or depend on renderer passes, cameras/scenes, generated textures, framebuffer history or environment preprocessing absent from ordinary glTF texture/accessor links. A consumer-specific adapter can bind preexisting resources; general portability needs resource ownership, scheduling and lifetime decisions outside this issue. |
| Lighting nodes | **Deferred/unsupported** | `LightingNode`, `AnalyticLightNode`, `AmbientLightNode`, `DirectionalLightNode`, `HemisphereLightNode`, `PointLightNode`, `SpotLightNode`, `ProjectorLightNode`, `IESSpotLightNode`, `RectAreaLightNode`, `LightProbeNode`, `LightsNode`, `LightingContextNode`, `EnvironmentNode`, `BasicEnvironmentNode`, `IrradianceNode`, `AONode`, `BasicLightMapNode`, `ShadowBaseNode`, `ShadowNode`, `PointShadowNode` | Light/scene references, lighting models, shadow filtering and renderer-created resources need more than material links. glTF light extensions do not provide all of these semantics. A paired adapter can select consumer-known lighting behavior; first define light-reference and shadow-resource bindings and lifecycle. The plugins continue to let Three.js supply normal material lighting. |
| Shadow filters | **Deferred/unsupported** | `ShadowFilterNode` | The r186 module supplies filter functions rather than a standalone ShadowFilterNode class. Function-backed filters belong to Three.js lighting setup; a consumer may select predefined filters with an adapter. Do not serialize shader source or callbacks. |
| Executable code and TSL closures | **Deferred/unsupported** | `CodeNode`, `ExpressionNode`, `FunctionNode`, `FunctionCallNode`, `ShaderNodeInternal`, `ShaderCallNodeInternal`, `FnNode` | Arbitrary JavaScript/GLSL/WGSL and captured closures are not data-only glTF. Raw-code serialization is deliberately rejected even when Three.js has serialize(). A paired adapter may identify a fixed consumer-supplied operation and serialize only its data; it must never evaluate code from the file. General function portability would need a separate language/design decision. |
| Callbacks and diagnostics | **Deferred/unsupported** | `DebugNode`, `EventNode`, `InspectorNode` | Callbacks, inspectors and debug side effects belong to the application, not glTF. Consumer adapters may reconnect named, predefined behavior out of band; do not embed executable callbacks. Ordinary nodes with app-installed update callbacks also fail export; shared time/material accessors retain Three.js-owned behavior. |
| Base node classes | **Deferred/unsupported** | `Node`, `TempNode`, `InputNode` | These are implementation bases, not portable concrete shader operations. Custom subclasses need explicit data-only serializer/resolver adapters defining their concrete behavior; never instantiate an arbitrary constructor by file-supplied name. |

The following source classes are **support infrastructure, not standalone
serializable nodes/APIs**: `NodeFunctionInput`, `StructType`, `NodeAttribute`, `NodeCode`, `NodeError`, `NodeFrame`, `NodeFunction`, `NodeUniform`, `NodeVar`, `NodeVarying`, `NodeCache`, `NodeBuilder`, `NodeParser`, `StackTrace`, `GLSLNodeParser`, `GLSLNodeFunction`, `LightingModel`, `BasicLightingModel`, `PhongLightingModel`, `PhysicalLightingModel`, `ShadowMaskModel`, `ToonLightingModel`, `VolumetricLightingModel`.
These provide builders, parsers, caches, stack traces, descriptors, runtime
uniforms/variables and lighting models; they are not candidates for graph ops.
`ShadowFilterNode.js` is included above as a module/API rather than a class.

## Shared object inventory

Every name below is **supported and tested for identity resolution**, with no
arguments or file-provided links. They resolve to the actual objects exported by
`three/tsl`, including their built-in runtime updates and internal graph. Tests
also exercise material-reference updates and repeated round trips with `time`,
`materialColor` and position accessors. Identity checks are not a promise of
renderability in every stage/material or GPU validation of every singleton.
In particular, compute and line/point builtins retain their Three.js context
requirements; the plugins still support mesh material families only.

Grouped by the shared object's runtime class (this is not an ordinary-instance
allowlist):

| Runtime class | Exported shared node names |
| --- | --- |
| `AttributeNode` | `normalGeometry`, `positionGeometry`, `tangentGeometry` |
| `ComputeBuiltinNode` | `globalId`, `localId`, `numWorkgroups`, `subgroupSize`, `workgroupId` |
| `ConstNode` | `EPSILON`, `HALF_PI`, `INFINITY`, `PI`, `PI2`, `TWO_PI` |
| `FrontFacingNode` | `frontFacing` |
| `IndexNode` | `drawIndex`, `instanceIndex`, `invocationLocalIndex`, `invocationSubgroupIndex`, `subgroupIndex`, `vertexIndex` |
| `MaterialNode` | `materialAO`, `materialAlphaTest`, `materialAnisotropy`, `materialAttenuationColor`, `materialAttenuationDistance`, `materialClearcoat`, `materialClearcoatNormal`, `materialClearcoatRoughness`, `materialColor`, `materialDispersion`, `materialEmissive`, `materialIOR`, `materialIridescence`, `materialIridescenceIOR`, `materialIridescenceThickness`, `materialLightMap`, `materialLineDashOffset`, `materialLineDashSize`, `materialLineGapSize`, `materialLineScale`, `materialLineWidth`, `materialMetalness`, `materialNormal`, `materialOpacity`, `materialPointSize`, `materialReflectivity`, `materialRetroreflectivity`, `materialRotation`, `materialRoughness`, `materialSheen`, `materialSheenRoughness`, `materialShininess`, `materialSpecular`, `materialSpecularColor`, `materialSpecularIntensity`, `materialSpecularStrength`, `materialThickness`, `materialTransmission` |
| `ModelNode` | `modelDirection`, `modelPosition`, `modelRadius`, `modelScale`, `modelViewPosition`, `modelWorldMatrix` |
| `PointUVNode` | `pointUV` |
| `PropertyNode` | `alphaT`, `ambientOcclusion`, `anisotropy`, `anisotropyB`, `anisotropyT`, `attenuationColor`, `attenuationDistance`, `batchColor`, `batchIndirectIndex`, `clearcoat`, `clearcoatRoughness`, `dashSize`, `diffuseColor`, `diffuseContribution`, `dispersion`, `emissive`, `gapSize`, `instanceColor`, `ior`, `iridescence`, `iridescenceIOR`, `iridescenceThickness`, `metalness`, `output`, `pointWidth`, `retroreflectivity`, `roughness`, `shadowPositionWorld`, `sheen`, `sheenRoughness`, `shininess`, `specularColor`, `specularColorBlended`, `specularF90`, `thickness`, `transmission` |
| `RendererReferenceNode` | `toneMappingExposure` |
| `ScreenNode` | `screenCoordinate`, `screenSize`, `screenUV`, `viewport` |
| `SplitNode` | `viewportSize` |
| `UniformGroupNode` | `frameGroup`, `objectGroup`, `renderGroup` |
| `UniformNode` | `backgroundBlurriness`, `backgroundIntensity`, `backgroundRotation`, `cameraFar`, `cameraNear`, `deltaTime`, `frameId`, `materialAnisotropyVector`, `materialEnvIntensity`, `materialEnvRotation`, `materialRefractionRatio`, `modelNormalMatrix`, `modelWorldMatrixInverse`, `screenDPR`, `time` |
| `VarNode` | `TBNViewMatrix`, `bentNormalView`, `bitangentGeometry`, `bitangentLocal`, `bitangentView`, `bitangentViewFrame`, `bitangentWorld`, `cameraNormalMatrix`, `cameraPosition`, `cameraProjectionMatrix`, `cameraProjectionMatrixInverse`, `cameraViewMatrix`, `cameraViewport`, `cameraWorldMatrix`, `clearcoatNormalView`, `clipSpace`, `faceDirection`, `highpModelNormalViewMatrix`, `highpModelViewMatrix`, `matcapUV`, `mediumpModelViewMatrix`, `modelViewMatrix`, `normalFlat`, `normalLocal`, `normalView`, `normalViewGeometry`, `normalWorld`, `normalWorldGeometry`, `parallaxDirection`, `positionView`, `positionViewDirection`, `positionWorld`, `positionWorldDirection`, `reflectVector`, `reflectView`, `refractVector`, `refractView`, `tangentLocal`, `tangentView`, `tangentViewFrame`, `tangentWorld`, `transformedClearcoatNormalView`, `transformedNormalView`, `transformedNormalWorld`, `viewportCoordinate`, `viewportUV` |
| `VaryingNode` | `cameraIndex`, `modelViewProjection`, `positionLocal`, `positionPrevious` |
| `VelocityNode` | `velocity` |
| `ViewportDepthNode` | `depth`, `viewportLinearDepth` |

## Functions are APIs, not serialized operations

| API/factory family | Examples | Representation and status |
| --- | --- | --- |
| Literal/vector/type construction | `float`, `int`, `uint`, `bool`, `vec2/3/4`, `ivec*`, `uvec*`, `bvec*`, `mat*`, `color`, `uniform` | Supported when the produced ConstNode/UniformNode/JoinNode/ConvertNode and inputs fit the matrix. Literal types remain numeric/boolean/color/vector/matrix; this does not add arbitrary object/array-buffer uniforms. |
| Arithmetic and component methods | `add`, `mul`, `sin`, `mix`, `clamp`, `.xyz`, `.setXY`, `.flipY` | Supported when lowered to supported MathNode/OperatorNode and new expression/VarNode families. The file contains the node operations, never the function itself. |
| Array, selection and interpolation | `array`, `.element`, `select`, `varying`, `vertexStage`, `.toVarying`, `rotate`, `.toVar`, `.toConst`, `.toVarIntent`, `subBuild` | Newly supported emitted node families. JavaScript control-flow statements, assignment stacks and arbitrary closures are not included. |
| Accessor factories | `attribute`, `uv`, `vertexColor`, `materialReference`, `reference`, `userData`, `texture`, `buffer`, `storage` | `attribute`/`uv` produce supported AttributeNode graphs; `vertexColor` supports index 0 or omitted index. `texture` supports the constrained 2D subset above. `materialReference` supports the exact current-material property/type allowlist in the [reference audit](reference-node-support.md); other factories require an adapter or are deferred as listed by their emitted classes. A factory returning a supported exact shared object can use its shared name. |
| Shader functions and control flow | `Fn`, `If`, `Loop`, `Break`, `Continue`, `Discard`, `Return`, `glslFn`, `wgslFn` | Deferred/unsupported as standalone ops; closures/code/ordering cannot be inferred from data. A named consumer-defined data adapter may select predefined behavior, never execute file-provided code. |
| Higher-level function libraries | `checker`, `hash`, `triNoise3D`, `mx_*`, BRDF/BSDF, fog, packing, oscillators, UV helpers, shapes, skinning/morph/instance/batch helpers | Inspect the returned graph, not the API name. Pure helpers that lower entirely to supported nodes work; many emit ShaderCallNodeInternal, context/renderer nodes or other unsupported classes. They are deferred when those classes occur, for the reasons in the matrix. A paired adapter can select a predefined consumer implementation and data parameters. No generic function invocation/deserialization exists. |

## Implementation boundary and failure behavior

Issue #15 added 12 classes: component construction/conversion, arrays,
conditional expressions, variables, varyings/sub-builds and rotation. Issue #17
adds ordinary 2D TextureNode and two query classes, with explicit resource state
and private post-hydration validation before publication. Issue #19 adds the 11
named surface/color/output, vertex-color and bit/packing classes with the exact
[variant boundaries](shading-node-support.md) above. It reuses
Three.js serialize/deserialize where fields exist and records small explicit
constructor fields where they do not. Issue #21 adds the
[audited current-material/model subsets](reference-node-support.md), with binding
validation against every prepared material clone and explicit Object3DNode
deferral. Child discovery is checked against each
adapter; the graph writer owns traversal, sharing and cycle detection. No shader
operation is reimplemented here. Names/types/components/interpolation settings
are data with validated domains; constructors are explicitly imported, never
looked up or invoked from arbitrary file data.

The loader passes encoded links as an optional third resolver argument
`(op, args, links)`, so new defaults can validate required inputs, array shape,
argument fields and node-reference kinds **before** assigning links. Custom
resolvers written for `(op, args)` still work. Wrappers that delegate to the
default resolver should forward all three arguments. Unsupported classes, missing
inputs, unknown new-adapter fields, dangling references, invalid resources and
cycles fail the entire material graph, including unreachable definitions. The
ordinary glTF material is retained, with no successful entrypoint published early.

Export fails for unsupported nodes, extra meaningful links, invalid new-adapter
fields/inputs, subclasses inheriting built-in operation IDs and app-installed callbacks. Uniforms with
non-default groups require adapters. Exact shared nodes retain their Three.js
runtime behavior without recursively serializing their internals. New-adapter
array inputs must be dense arrays of nodes; arbitrary nested object/array/resource
links remain supported through explicit adapters and are tested separately.

Texture/accessor links are existing Draft v2.0 capabilities. TextureNode now has
the [paired constrained 2D defaults](texture-node-support.md); BufferNode still
requires an adapter. See the
[exporter adapter contract](../packages/exporter/README.md#supported-scope) and
[loader resolver contract](../packages/loader/README.md#supported-scope).

## Validation

The [integration suite](../packages/demo/test/roundtrip.test.js) tests every new
class through real GLTFExporter → GLTFLoader and two successive round trips,
checking fields, values, shared references and canonical graph equality. Each
new family also runs Three.js's GLSLNodeBuilder setup/analyze/generate stages and
compares generated fragment/vertex flow before and after import. Additional tests
cover default array initialization, optional else, 2D rotation, unnamed varyings,
fluent TSL graphs and live material/position/time references. All 179 exported
shared names are checked by identity. Malformed new graphs and representative
unsupported code/resource/closure nodes are checked for explicit failure or
whole-material fallback. Existing custom nested texture/accessor tests remain.

Required commands and outcomes for this issue are recorded in
[the validation report](tsl-node-coverage-validation.md).
Issue #21's reference scopes, runtime bindings and check outcomes are recorded in the
[reference audit](reference-node-support.md).
Issue #19's shading variants and check outcomes are recorded in the
[shading audit](shading-node-support.md).
Issue #17's texture subset and actual check outcomes are recorded in the
[texture audit and validation](texture-node-support.md#validation).
Browser/WebGPU visual checks were not run. Node shader generation and integration
tests do not compile GPU programs or validate rendered pixels.

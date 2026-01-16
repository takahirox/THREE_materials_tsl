# THREE_materials_tsl

glTF Vendor Extension — Draft v1.0

Demo: https://takahirox.github.io/THREE_materials_tsl/

## Plugins

Reference implementations for Three.js are available as separate packages:

- Loader plugin: https://www.npmjs.com/package/@takahirox/gltf-three-materials-tsl-loader
- Exporter plugin: https://www.npmjs.com/package/@takahirox/gltf-three-materials-tsl-exporter

Install:

```sh
npm install @takahirox/gltf-three-materials-tsl-loader @takahirox/gltf-three-materials-tsl-exporter
```

## Status

* **Draft**
* Vendor extension for **Three.js**
* Not ratified by Khronos
* Subject to change

## Overview

`THREE_materials_tsl` is a vendor-specific glTF extension that allows
`Three.js TSL / NodeMaterial` graphs to be serialized into glTF
without embedding or executing JavaScript code.

The extension stores a node graph as declarative JSON.
A compatible Three.js consumer reconstructs the graph by resolving
each node operation via the Three.js NodeRegistry and wiring
references described in the extension.

This extension is a serialization container, not a general-purpose
shading language specification.

## Motivation

[`Three.js TSL`](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) is
typically authored and executed as JavaScript code.
While flexible, embedding or evaluating JavaScript source inside glTF
is undesirable for security, portability, and tooling reasons.

`THREE_materials_tsl` provides a minimal, data-only representation of a
TSL node graph that can be safely stored in glTF and reconstructed by a
compatible Three.js runtime.

## Design Goals

* Serialize `TSL / NodeMaterial` graphs without eval
* Use pure JSON data only
* Enable round-tripping in Three.js (TSL → glTF → TSL)
* Keep the specification minimal and implementation-driven

## Non-Goals

This extension does not attempt to provide:

* Cross-engine or cross-runtime compatibility
* Standardized shader semantics
* MaterialX or KHR_* compatibility
* Embedded GLSL / WGSL / HLSL source code
* Full semantic validation of node graphs

## Extension Placement

The extension MUST be defined under a glTF material:

```javascript
materials[i].extensions.THREE_materials_tsl
```

Standard glTF material properties SHOULD be preserved as a fallback.

## Top-Level Object

### Required Properties

* version (string): Node graph encoding version
* entrypoints (object): Slot name → nodeId mapping
* nodes (object): Node dictionary

### Optional Properties

* three (object): Three.js metadata (non-normative)
* compat (object): Compatibility hints (non-normative)

### Structure

```json
{
  "version": "1.0",
  "three": { "revision": "r160" },
  "entrypoints": { "...": "nodeId" },
  "nodes": { "...": { ... } },
  "compat": { ... }
}
```

### version

version specifies the node graph encoding version used by this extension.
Implementations MUST ignore the extension data if the version is not supported.

### three (optional)

The optional three object provides informational metadata about the Three.js
version used to author the material.

This information is intended for debugging and tooling purposes only.
Implementations MUST NOT require this information to match the runtime Three.js
version in order to interpret the extension.

#### three.revision (optional)

A string representing the Three.js revision (for example, "r160").

## Entry Points

### Definition

entrypoints is a dictionary mapping implementation-defined slot names
to node identifiers.

Example:

```json
"entrypoints": {
  "colorNode": "outColor",
  "positionNode": "outPosition"
}
```

* Keys are strings
* Values MUST reference a nodeId defined in nodes
* At least one entrypoint MUST be present

### Semantics

The meaning of entrypoint keys is implementation-defined.

A Three.js consumer MAY apply entrypoints by assigning:

```javascript
material[slotName] = resolvedNode
```

Entry point keys are expected to correspond to NodeMaterial properties,
but this specification does not standardize or restrict them.

---

## Node Dictionary

### Node Identifiers

Each node is identified by a nodeId, which MUST be unique within the
nodes object.

### Node Definition

A node definition object contains:

* op (required): NodeRegistry registration key
* args (optional): JSON literal arguments
* links (optional): Input references

## Operations (op)

* op MUST be a string identifying a node known to the consumer via the
  Three.js NodeRegistry.
* No fallback resolution mechanism is defined.
* If an op cannot be resolved, the extension MUST be ignored.

All operation semantics are delegated to the Three.js implementation.

### op name conventions (non-normative)

Implementations MAY use two forms:

* **Node class names** (e.g. `ConstNode`, `MathNode`, `OperatorNode`) which are instantiated with `args` and `links`.
* **Shared TSL instances** (e.g. `time`, `positionLocal`, `normalView`) which are resolved to existing TSL node objects.

Using shared instance names preserves runtime semantics for built-in nodes.

## Arguments (args)

* args MUST contain only JSON literal values
* Executable code or expressions are not representable

Interpretation of arguments is implementation-defined.

## Links (links)

links describes how node inputs are wired.

### Link Value Forms

* Node reference: `{ "$ref": "nodeId" }`
* Texture reference: `{ "$refTex": n }`
* Accessor reference: `{ "$refAccessor": n }`

Texture references point to `glTF.textures[n]`.
Accessor references point to `glTF.accessors[n]`.

The consumer is expected to resolve these references to runtime objects
such as `THREE.Texture` or `BufferAttribute`.

## Compatibility Hints (compat)

compat MAY be provided for diagnostics and tooling.

All fields are hints only and MAY be ignored by consumers.

## Consumer Requirements

A consumer MUST ignore the entire extension and fall back to standard
glTF material behavior if:

* An entrypoint references a non-existent nodeId
* A reference points to a missing nodeId
* A graph cycle is detected
* An op cannot be resolved
* A texture or accessor index is out of range

## Security Considerations

* No executable code is embedded
* No dynamic evaluation is required
* All content is declarative data

import * as TSL from 'three/src/nodes/TSL.js';

import type { JsonValue, NodeResolver } from './THREEMaterialsTSLLoaderPlugin.js';

type ResolverOptions = {
  overrides?: Record<string, unknown>;
};

const buildRegistry = () => {
  const registry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(TSL)) {
    registry[key] = value;
  }
  return registry;
};

const registry = buildRegistry();

export const createDefaultNodeResolver = (options: ResolverOptions = {}): NodeResolver => {
  const overrides = options.overrides ?? {};
  return (op: string, _args?: JsonValue) => {
    if (op in overrides) return overrides[op];
    if (op === 'TimeNode') {
      return (TSL as { time?: unknown }).time ?? null;
    }
    return registry[op] ?? null;
  };
};

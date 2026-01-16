import * as TSL from 'three/src/nodes/TSL.js';

const sharedNodeNames = new Map<unknown, string>();

for (const [name, value] of Object.entries(TSL)) {
  if (value && typeof value === 'object' && (value as { isNode?: boolean }).isNode) {
    sharedNodeNames.set(value, name);
  }
}

export const getSharedTSLNodeName = (node: unknown): string | null => {
  return sharedNodeNames.get(node) ?? null;
};

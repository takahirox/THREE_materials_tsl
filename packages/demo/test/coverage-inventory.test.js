import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { it, expect } from 'vitest';
import * as TSL from 'three/tsl';
import { REVISION } from 'three';

it('keeps the published r186 inventory complete against Three.js source and shared exports', () => {
  const coverage = readFileSync(new URL('../../../docs/tsl-node-coverage.md', import.meta.url), 'utf8');
  expect(REVISION).toBe('186');
  const nodeDirectory = new URL('../src/nodes/', pathToFileURL(createRequire(import.meta.url).resolve('three')));
  const classes = new Set();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.js')) {
        for (const match of readFileSync(path, 'utf8').matchAll(/^class (\w+)/gm)) {
          classes.add(match[1]);
          expect(coverage, `${match[1]} from ${fileURLToPath(path)}`).toContain('`' + match[1] + '`');
        }
      }
    }
  }
  visit(nodeDirectory);
  expect(classes.size).toBe(152);
  const shared = Object.entries(TSL).filter(([, value]) => value && typeof value === 'object' && value.isNode);
  expect(shared.length).toBe(179);
  expect(new Set(shared.map(([, value]) => value)).size).toBe(178);
  expect(Object.keys(TSL).length).toBe(682);
  expect(Object.values(TSL).filter((value) => typeof value === 'function').length).toBe(495);
  for (const [name] of shared) expect(coverage).toContain('`' + name + '`');
});

import { test, expect } from 'bun:test'

test('exports public API', async () => {
  const mod = await import('../dist/index.mjs')
  expect(typeof mod.createManager).toBe('function')
  expect(typeof mod.requestDevice).toBe('function')
  expect(typeof mod.version).toBe('string')
})

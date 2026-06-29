import test from "node:test";
import assert from "node:assert/strict";

test("exports public API", async () => {
  const mod = await import("../dist/index.js");
  assert.equal(typeof mod.Manager.create, "function");
  assert.equal(typeof mod.requestDevice, "function");
  assert.equal(typeof mod.version, "string");
});

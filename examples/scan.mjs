import { Manager } from "../dist/index.js";

const manager = await Manager.create();
const [adapter] = await manager.adapters();

if (!adapter) {
  throw new Error("No Bluetooth adapters found");
}

console.log(`Scanning with ${adapter.info}`);
const reader = adapter.scan().getReader();

setTimeout(() => reader.cancel(), 10_000);

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(value.peripheralId, await value.properties());
}

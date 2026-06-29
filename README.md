# btleplug-js

Node.js bindings for [btleplug](https://github.com/deviceplug/btleplug), built with napi-rs.

`@nakasyou/btleplug-js` is the public entry package. Native binaries are published as optional platform packages such as `@nakasyou/btleplug-js-linux-x64-gnu` and `@nakasyou/btleplug-js-darwin-arm64`.

## Install

```sh
npm install @nakasyou/btleplug-js
```

## Low-level API

```js
import { Manager } from "@nakasyou/btleplug-js";

const manager = await Manager.create();
const [adapter] = await manager.adapters();

await adapter.startScan();
await new Promise((resolve) => setTimeout(resolve, 5000));

for (const peripheral of await adapter.peripherals()) {
  console.log(await peripheral.properties());
}

await adapter.stopScan();
```

## Streams

```js
const stream = adapter.scan();

for await (const peripheral of stream) {
  console.log(peripheral.peripheralId, await peripheral.properties());
  break;
}
```

Notifications are also exposed as a standard `ReadableStream`:

```js
await peripheral.connect();
await peripheral.discoverServices();
await peripheral.subscribe(serviceUuid, characteristicUuid);

for await (const event of peripheral.notifications()) {
  console.log(event.uuid, event.value);
}
```

## Web Bluetooth-compatible facade

```js
import { requestDevice } from "@nakasyou/btleplug-js";

const device = await requestDevice({
  filters: [{ services: ["0000180d-0000-1000-8000-00805f9b34fb"] }],
});

const server = await device.gatt.connect();
const service = await server.getPrimaryService("0000180d-0000-1000-8000-00805f9b34fb");
const characteristic = await service.getCharacteristic("00002a37-0000-1000-8000-00805f9b34fb");

await characteristic.startNotifications();
characteristic.addEventListener("characteristicvaluechanged", () => {
  console.log(characteristic.value);
});
```

The compatibility layer intentionally maps the central/client side of Web Bluetooth onto native desktop BLE APIs. Browser permission UI, secure contexts, and chooser UX are not reproduced.

## Platform notes

- Linux uses BlueZ through btleplug. Users generally need Bluetooth permissions and a running BlueZ daemon.
- macOS may require terminal/app Bluetooth permissions.
- Windows uses the WinRT BLE stack.

## Publishing

This repository is configured for npm Trusted Publishing through GitHub Actions OIDC. Publishing is done by creating a GitHub release:

```sh
npm version patch
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes
```

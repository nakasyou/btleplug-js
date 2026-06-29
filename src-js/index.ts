import { createRequire } from "node:module";
import { arch, platform } from "node:process";

type NativeModule = {
  nativeVersion(): string;
  createManager(): Promise<NativeManager>;
  managerAdapters(managerId: number): Promise<NativeAdapter[]>;
  adapterInfo(adapterId: number): Promise<string>;
  adapterStartScan(adapterId: number, options?: ScanOptions): Promise<void>;
  adapterStopScan(adapterId: number): Promise<void>;
  adapterPeripherals(adapterId: number): Promise<NativePeripheral[]>;
  adapterPeripheral(adapterId: number, peripheralId: string): Promise<NativePeripheral>;
  adapterOpenEventStream(adapterId: number): Promise<number>;
  adapterNextEvent(streamId: number): Promise<CentralEvent | null>;
  adapterCloseEventStream(streamId: number): Promise<void>;
  peripheralProperties(peripheralId: number): Promise<PeripheralProperties | null>;
  peripheralConnect(peripheralId: number): Promise<void>;
  peripheralDisconnect(peripheralId: number): Promise<void>;
  peripheralIsConnected(peripheralId: number): Promise<boolean>;
  peripheralDiscoverServices(peripheralId: number): Promise<void>;
  peripheralServices(peripheralId: number): ServiceInfo[];
  peripheralCharacteristics(peripheralId: number): CharacteristicInfo[];
  peripheralRead(peripheralId: number, serviceUuid: string, characteristicUuid: string): Promise<Uint8Array>;
  peripheralWrite(
    peripheralId: number,
    serviceUuid: string,
    characteristicUuid: string,
    data: Uint8Array,
    options?: WriteOptions,
  ): Promise<void>;
  peripheralSubscribe(peripheralId: number, serviceUuid: string, characteristicUuid: string): Promise<void>;
  peripheralUnsubscribe(peripheralId: number, serviceUuid: string, characteristicUuid: string): Promise<void>;
  peripheralOpenNotificationStream(peripheralId: number): Promise<number>;
  peripheralNextNotification(streamId: number): Promise<NotificationEvent | null>;
  peripheralCloseNotificationStream(streamId: number): Promise<void>;
};

export type NativeManager = { id: number };
export type NativeAdapter = { id: number; info: string };
export type NativePeripheral = { id: number; peripheralId: string };
export type ScanOptions = { services?: string[] };
export type WriteOptions = { withoutResponse?: boolean };

export type PeripheralProperties = {
  address: string;
  addressType?: string;
  localName?: string;
  advertisementName?: string;
  txPowerLevel?: number;
  rssi?: number;
  manufacturerData: Array<{ companyIdentifier: number; data: Uint8Array }>;
  serviceData: Array<{ uuid: string; data: Uint8Array }>;
  services: string[];
  class?: number;
};

export type ServiceInfo = {
  uuid: string;
  primary: boolean;
  characteristics: CharacteristicInfo[];
};

export type CharacteristicInfo = {
  uuid: string;
  serviceUuid: string;
  properties: string[];
  descriptors: Array<{
    uuid: string;
    serviceUuid: string;
    characteristicUuid: string;
  }>;
};

export type CentralEvent = {
  eventType: string;
  peripheralId?: string;
  adapterState?: string;
  rssi?: number;
  manufacturerData?: Array<{ companyIdentifier: number; data: Uint8Array }>;
  serviceData?: Array<{ uuid: string; data: Uint8Array }>;
  services?: string[];
};

export type NotificationEvent = {
  uuid: string;
  serviceUuid: string;
  value: Uint8Array;
};

export type RequestDeviceOptions = {
  filters?: Array<{
    services?: string[];
    name?: string;
    namePrefix?: string;
  }>;
  optionalServices?: string[];
  acceptAllDevices?: boolean;
  timeout?: number;
};

const native = loadNative();

export const version = native.nativeVersion();

export async function createBluetooth(): Promise<Bluetooth> {
  const manager = await Manager.create();
  const adapters = await manager.adapters();
  const adapter = adapters[0];
  if (!adapter) {
    throw new Error("No Bluetooth adapters found");
  }
  return new Bluetooth(adapter);
}

export async function requestDevice(options: RequestDeviceOptions = {}): Promise<BluetoothDevice> {
  return (await createBluetooth()).requestDevice(options);
}

export class Manager {
  private constructor(private readonly handle: NativeManager) {}

  static async create(): Promise<Manager> {
    return new Manager(await native.createManager());
  }

  async adapters(): Promise<Adapter[]> {
    const adapters = await native.managerAdapters(this.handle.id);
    return adapters.map((adapter) => new Adapter(adapter));
  }
}

export class Adapter {
  readonly id: number;
  readonly info: string;

  constructor(private readonly handle: NativeAdapter) {
    this.id = handle.id;
    this.info = handle.info;
  }

  refreshInfo(): Promise<string> {
    return native.adapterInfo(this.id);
  }

  startScan(options: ScanOptions = {}): Promise<void> {
    return native.adapterStartScan(this.id, normalizeScanOptions(options));
  }

  stopScan(): Promise<void> {
    return native.adapterStopScan(this.id);
  }

  async peripherals(): Promise<Peripheral[]> {
    const peripherals = await native.adapterPeripherals(this.id);
    return peripherals.map((peripheral) => new Peripheral(peripheral));
  }

  async peripheral(peripheralId: string): Promise<Peripheral> {
    return new Peripheral(await native.adapterPeripheral(this.id, peripheralId));
  }

  events(): ReadableStream<CentralEvent> {
    let streamId: number | undefined;
    return new ReadableStream<CentralEvent>({
      start: async () => {
        streamId = await native.adapterOpenEventStream(this.id);
      },
      pull: async (controller) => {
        if (streamId === undefined) {
          return;
        }
        const event = await native.adapterNextEvent(streamId);
        if (event) {
          controller.enqueue(event);
        } else {
          controller.close();
        }
      },
      cancel: async () => {
        if (streamId !== undefined) {
          await native.adapterCloseEventStream(streamId);
        }
      },
    });
  }

  scan(options: ScanOptions = {}): ReadableStream<Peripheral> {
    const seen = new Set<string>();
    const eventStream = this.events();
    const reader = eventStream.getReader();

    return new ReadableStream<Peripheral>({
      start: async () => {
        await this.startScan(options);
      },
      pull: async (controller) => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          if (value.peripheralId && !seen.has(value.peripheralId)) {
            seen.add(value.peripheralId);
            controller.enqueue(await this.peripheral(value.peripheralId));
            return;
          }
        }
      },
      cancel: async () => {
        await Promise.allSettled([reader.cancel(), this.stopScan()]);
      },
    });
  }
}

export class Peripheral {
  readonly id: number;
  readonly peripheralId: string;

  constructor(private readonly handle: NativePeripheral) {
    this.id = handle.id;
    this.peripheralId = handle.peripheralId;
  }

  properties(): Promise<PeripheralProperties | null> {
    return native.peripheralProperties(this.id);
  }

  connect(): Promise<void> {
    return native.peripheralConnect(this.id);
  }

  disconnect(): Promise<void> {
    return native.peripheralDisconnect(this.id);
  }

  isConnected(): Promise<boolean> {
    return native.peripheralIsConnected(this.id);
  }

  discoverServices(): Promise<void> {
    return native.peripheralDiscoverServices(this.id);
  }

  services(): ServiceInfo[] {
    return native.peripheralServices(this.id);
  }

  characteristics(): CharacteristicInfo[] {
    return native.peripheralCharacteristics(this.id);
  }

  read(serviceUuid: string, characteristicUuid: string): Promise<Uint8Array> {
    return native.peripheralRead(this.id, serviceUuid, characteristicUuid);
  }

  write(serviceUuid: string, characteristicUuid: string, data: BufferSource, options: WriteOptions = {}): Promise<void> {
    return native.peripheralWrite(this.id, serviceUuid, characteristicUuid, toUint8Array(data), options);
  }

  subscribe(serviceUuid: string, characteristicUuid: string): Promise<void> {
    return native.peripheralSubscribe(this.id, serviceUuid, characteristicUuid);
  }

  unsubscribe(serviceUuid: string, characteristicUuid: string): Promise<void> {
    return native.peripheralUnsubscribe(this.id, serviceUuid, characteristicUuid);
  }

  notifications(): ReadableStream<NotificationEvent> {
    let streamId: number | undefined;
    return new ReadableStream<NotificationEvent>({
      start: async () => {
        streamId = await native.peripheralOpenNotificationStream(this.id);
      },
      pull: async (controller) => {
        if (streamId === undefined) {
          return;
        }
        const event = await native.peripheralNextNotification(streamId);
        if (event) {
          controller.enqueue(event);
        } else {
          controller.close();
        }
      },
      cancel: async () => {
        if (streamId !== undefined) {
          await native.peripheralCloseNotificationStream(streamId);
        }
      },
    });
  }
}

export class Bluetooth extends EventTarget {
  constructor(private readonly adapter: Adapter) {
    super();
  }

  async getAvailability(): Promise<boolean> {
    return true;
  }

  async requestDevice(options: RequestDeviceOptions = {}): Promise<BluetoothDevice> {
    validateRequestDeviceOptions(options);
    const serviceFilter = collectServiceFilters(options);
    const timeout = options.timeout ?? 10_000;
    const deadline = Date.now() + timeout;
    const reader = this.adapter.scan(serviceFilter ? { services: serviceFilter } : {}).getReader();

    try {
      while (Date.now() < deadline) {
        const result = await Promise.race([
          reader.read(),
          delay(Math.min(250, Math.max(0, deadline - Date.now()))).then(() => undefined),
        ]);
        if (!result || result.done) {
          continue;
        }
        const properties = await result.value.properties();
        if (matchesRequestDeviceOptions(properties, options)) {
          return new BluetoothDevice(result.value, properties ?? undefined);
        }
      }
    } finally {
      await reader.cancel();
    }

    throw new DOMException("No matching Bluetooth device found", "NotFoundError");
  }
}

export class BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name: string | undefined;
  readonly gatt: BluetoothRemoteGATTServer;

  constructor(readonly peripheral: Peripheral, properties?: PeripheralProperties) {
    super();
    this.id = peripheral.peripheralId;
    this.name = properties?.localName ?? properties?.advertisementName;
    this.gatt = new BluetoothRemoteGATTServer(this);
  }
}

export class BluetoothRemoteGATTServer {
  constructor(readonly device: BluetoothDevice) {}

  get connected(): boolean {
    return false;
  }

  async connect(): Promise<this> {
    await this.device.peripheral.connect();
    await this.device.peripheral.discoverServices();
    return this;
  }

  async disconnect(): Promise<void> {
    await this.device.peripheral.disconnect();
  }

  async getPrimaryServices(service?: string): Promise<BluetoothRemoteGATTService[]> {
    await this.device.peripheral.discoverServices();
    return this.device.peripheral
      .services()
      .filter((item) => !service || item.uuid === service)
      .map((item) => new BluetoothRemoteGATTService(this.device, item));
  }

  async getPrimaryService(service: string): Promise<BluetoothRemoteGATTService> {
    const found = (await this.getPrimaryServices(service))[0];
    if (!found) {
      throw new DOMException("Service not found", "NotFoundError");
    }
    return found;
  }
}

export class BluetoothRemoteGATTService {
  readonly uuid: string;
  readonly isPrimary: boolean;

  constructor(readonly device: BluetoothDevice, private readonly info: ServiceInfo) {
    this.uuid = info.uuid;
    this.isPrimary = info.primary;
  }

  async getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]> {
    const characteristics = this.info.characteristics.filter((item) => !characteristic || item.uuid === characteristic);
    return characteristics.map((item) => new BluetoothRemoteGATTCharacteristic(this, item));
  }

  async getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic> {
    const found = (await this.getCharacteristics(characteristic))[0];
    if (!found) {
      throw new DOMException("Characteristic not found", "NotFoundError");
    }
    return found;
  }
}

export class BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  value?: DataView;
  #reader: ReadableStreamDefaultReader<NotificationEvent> | undefined;

  constructor(readonly service: BluetoothRemoteGATTService, private readonly info: CharacteristicInfo) {
    super();
    this.uuid = info.uuid;
    this.properties = new BluetoothCharacteristicProperties(info.properties);
  }

  async readValue(): Promise<DataView> {
    const bytes = await this.service.device.peripheral.read(this.info.serviceUuid, this.info.uuid);
    this.value = toDataView(bytes);
    return this.value;
  }

  async writeValue(value: BufferSource): Promise<void> {
    await this.writeValueWithResponse(value);
  }

  async writeValueWithResponse(value: BufferSource): Promise<void> {
    await this.service.device.peripheral.write(this.info.serviceUuid, this.info.uuid, value);
  }

  async writeValueWithoutResponse(value: BufferSource): Promise<void> {
    await this.service.device.peripheral.write(this.info.serviceUuid, this.info.uuid, value, { withoutResponse: true });
  }

  async startNotifications(): Promise<this> {
    await this.service.device.peripheral.subscribe(this.info.serviceUuid, this.info.uuid);
    const reader = this.service.device.peripheral.notifications().getReader();
    this.#reader = reader;
    void this.#pumpNotifications(reader);
    return this;
  }

  async stopNotifications(): Promise<this> {
    await this.service.device.peripheral.unsubscribe(this.info.serviceUuid, this.info.uuid);
    await this.#reader?.cancel();
    this.#reader = undefined;
    return this;
  }

  async #pumpNotifications(reader: ReadableStreamDefaultReader<NotificationEvent>): Promise<void> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || reader !== this.#reader) {
        return;
      }
      if (value.uuid === this.info.uuid && value.serviceUuid === this.info.serviceUuid) {
        this.value = toDataView(value.value);
        this.dispatchEvent(new Event("characteristicvaluechanged"));
      }
    }
  }
}

export class BluetoothCharacteristicProperties {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly authenticatedSignedWrites: boolean;
  readonly extendedProperties: boolean;

  constructor(properties: string[]) {
    const set = new Set(properties);
    this.broadcast = set.has("broadcast");
    this.read = set.has("read");
    this.writeWithoutResponse = set.has("writeWithoutResponse");
    this.write = set.has("write");
    this.notify = set.has("notify");
    this.indicate = set.has("indicate");
    this.authenticatedSignedWrites = set.has("authenticatedSignedWrites");
    this.extendedProperties = set.has("extendedProperties");
  }
}

function loadNative(): NativeModule {
  const require = createRequire(import.meta.url);
  const targets = nativeCandidates();
  const failures: string[] = [];

  for (const target of targets) {
    try {
      return require(target) as NativeModule;
    } catch (error) {
      failures.push(`${target}: ${(error as Error).message}`);
    }
  }

  throw new Error(`Unable to load btleplug-js native binding.\n${failures.join("\n")}`);
}

function nativeCandidates(): string[] {
  const triple = platformTriple();
  return [`../btleplug_js.${triple}.node`, `@nakasyou/btleplug-js-${triple}`];
}

function platformTriple(): string {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64-gnu";
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu";
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

function normalizeScanOptions(options: ScanOptions): ScanOptions {
  const services = options.services?.map(normalizeUuid);
  return services ? { services } : {};
}

function validateRequestDeviceOptions(options: RequestDeviceOptions): void {
  if (!options.acceptAllDevices && (!options.filters || options.filters.length === 0)) {
    throw new TypeError("requestDevice requires acceptAllDevices or at least one filter");
  }
}

function collectServiceFilters(options: RequestDeviceOptions): string[] | undefined {
  const services = new Set<string>();
  for (const filter of options.filters ?? []) {
    for (const service of filter.services ?? []) {
      services.add(normalizeUuid(service));
    }
  }
  return services.size === 0 ? undefined : [...services];
}

function matchesRequestDeviceOptions(properties: PeripheralProperties | null, options: RequestDeviceOptions): boolean {
  if (options.acceptAllDevices) {
    return true;
  }
  const name = properties?.localName ?? properties?.advertisementName ?? "";
  const advertisedServices = new Set(properties?.services ?? []);

  return (options.filters ?? []).some((filter) => {
    const nameMatches = filter.name === undefined || filter.name === name;
    const prefixMatches = filter.namePrefix === undefined || name.startsWith(filter.namePrefix);
    const servicesMatch = (filter.services ?? []).every((service) => advertisedServices.has(normalizeUuid(service)));
    return nameMatches && prefixMatches && servicesMatch;
  });
}

function normalizeUuid(uuid: string): string {
  if (/^[0-9a-f]{4}$/i.test(uuid)) {
    return `0000${uuid.toLowerCase()}-0000-1000-8000-00805f9b34fb`;
  }
  if (/^[0-9a-f]{8}$/i.test(uuid)) {
    return `${uuid.toLowerCase()}-0000-1000-8000-00805f9b34fb`;
  }
  return uuid.toLowerCase();
}

function toUint8Array(value: BufferSource): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function toDataView(value: Uint8Array): DataView {
  return new DataView(value.buffer, value.byteOffset, value.byteLength);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

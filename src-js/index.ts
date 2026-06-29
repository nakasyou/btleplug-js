import { createRequire } from 'node:module'
import { arch, platform } from 'node:process'

interface NativeModule {
  nativeVersion(): string
  createManager(): Promise<NativeManager>
  managerAdapters(managerId: number): Promise<NativeAdapter[]>
  adapterInfo(adapterId: number): Promise<string>
  adapterStartScan(adapterId: number, options?: ScanOptions): Promise<void>
  adapterStopScan(adapterId: number): Promise<void>
  adapterPeripherals(adapterId: number): Promise<NativePeripheral[]>
  adapterPeripheral(adapterId: number, peripheralId: string): Promise<NativePeripheral>
  adapterOpenEventStream(adapterId: number): Promise<number>
  adapterNextEvent(streamId: number): Promise<CentralEvent | null>
  adapterCloseEventStream(streamId: number): Promise<void>
  peripheralProperties(peripheralId: number): Promise<PeripheralProperties | null>
  peripheralConnect(peripheralId: number): Promise<void>
  peripheralDisconnect(peripheralId: number): Promise<void>
  peripheralIsConnected(peripheralId: number): Promise<boolean>
  peripheralDiscoverServices(peripheralId: number): Promise<void>
  peripheralServices(peripheralId: number): ServiceInfo[]
  peripheralCharacteristics(peripheralId: number): CharacteristicInfo[]
  peripheralRead(
    peripheralId: number,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<Uint8Array>
  peripheralWrite(
    peripheralId: number,
    serviceUuid: string,
    characteristicUuid: string,
    data: Uint8Array,
    options?: WriteOptions,
  ): Promise<void>
  peripheralSubscribe(
    peripheralId: number,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<void>
  peripheralUnsubscribe(
    peripheralId: number,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<void>
  peripheralOpenNotificationStream(peripheralId: number): Promise<number>
  peripheralNextNotification(streamId: number): Promise<NotificationEvent | null>
  peripheralCloseNotificationStream(streamId: number): Promise<void>
}

export interface NativeManager {
  id: number
}

export interface NativeAdapter {
  id: number
  info: string
}

export interface NativePeripheral {
  id: number
  peripheralId: string
}

export interface ScanOptions {
  services?: string[]
}

export interface WriteOptions {
  withoutResponse?: boolean
}

export interface PeripheralProperties {
  address: string
  addressType?: string
  localName?: string
  advertisementName?: string
  txPowerLevel?: number
  rssi?: number
  manufacturerData: Array<{ companyIdentifier: number; data: Uint8Array }>
  serviceData: Array<{ uuid: string; data: Uint8Array }>
  services: string[]
  class?: number
}

export interface ServiceInfo {
  uuid: string
  primary: boolean
  characteristics: CharacteristicInfo[]
}

export interface CharacteristicInfo {
  uuid: string
  serviceUuid: string
  properties: string[]
  descriptors: Array<{
    uuid: string
    serviceUuid: string
    characteristicUuid: string
  }>
}

export interface CentralEvent {
  eventType: string
  peripheralId?: string
  adapterState?: string
  rssi?: number
  manufacturerData?: Array<{ companyIdentifier: number; data: Uint8Array }>
  serviceData?: Array<{ uuid: string; data: Uint8Array }>
  services?: string[]
}

export interface NotificationEvent {
  uuid: string
  serviceUuid: string
  value: Uint8Array
}

export interface RequestDeviceOptions {
  filters?: Array<{
    services?: string[]
    name?: string
    namePrefix?: string
  }>
  optionalServices?: string[]
  acceptAllDevices?: boolean
  timeout?: number
}

export interface Manager {
  adapters(): Promise<Adapter[]>
}

export interface Adapter {
  readonly id: number
  readonly info: string
  refreshInfo(): Promise<string>
  startScan(options?: ScanOptions): Promise<void>
  stopScan(): Promise<void>
  peripherals(): Promise<Peripheral[]>
  peripheral(peripheralId: string): Promise<Peripheral>
  events(): ReadableStream<CentralEvent>
  scan(options?: ScanOptions): ReadableStream<Peripheral>
}

export interface Peripheral {
  readonly id: number
  readonly peripheralId: string
  properties(): Promise<PeripheralProperties | null>
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): Promise<boolean>
  discoverServices(): Promise<void>
  services(): ServiceInfo[]
  characteristics(): CharacteristicInfo[]
  read(serviceUuid: string, characteristicUuid: string): Promise<Uint8Array>
  write(
    serviceUuid: string,
    characteristicUuid: string,
    data: BufferSource,
    options?: WriteOptions,
  ): Promise<void>
  subscribe(serviceUuid: string, characteristicUuid: string): Promise<void>
  unsubscribe(serviceUuid: string, characteristicUuid: string): Promise<void>
  notifications(): ReadableStream<NotificationEvent>
}

export interface Bluetooth extends EventTargetFacade {
  getAvailability(): Promise<boolean>
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>
}

export interface BluetoothDevice extends EventTargetFacade {
  readonly id: string
  readonly name: string | undefined
  readonly peripheral: Peripheral
  readonly gatt: BluetoothRemoteGATTServer
}

export interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice
  readonly connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): Promise<void>
  getPrimaryServices(service?: string): Promise<BluetoothRemoteGATTService[]>
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>
}

export interface BluetoothRemoteGATTService {
  readonly device: BluetoothDevice
  readonly uuid: string
  readonly isPrimary: boolean
  getCharacteristics(characteristic?: string): Promise<BluetoothRemoteGATTCharacteristic[]>
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>
}

export interface BluetoothRemoteGATTCharacteristic extends EventTargetFacade {
  readonly service: BluetoothRemoteGATTService
  readonly uuid: string
  readonly properties: BluetoothCharacteristicProperties
  value: DataView | undefined
  readValue(): Promise<DataView>
  writeValue(value: BufferSource): Promise<void>
  writeValueWithResponse(value: BufferSource): Promise<void>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
}

export interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean
  readonly read: boolean
  readonly writeWithoutResponse: boolean
  readonly write: boolean
  readonly notify: boolean
  readonly indicate: boolean
  readonly authenticatedSignedWrites: boolean
  readonly extendedProperties: boolean
}

export interface EventTargetFacade {
  addEventListener: EventTarget['addEventListener']
  removeEventListener: EventTarget['removeEventListener']
  dispatchEvent: EventTarget['dispatchEvent']
}

const native = loadNative()

export const version = native.nativeVersion()

export async function createManager(): Promise<Manager> {
  return createManagerFromNative(await native.createManager())
}

export async function createBluetooth(): Promise<Bluetooth> {
  const manager = await createManager()
  const adapters = await manager.adapters()
  const adapter = adapters[0]
  if (!adapter) {
    throw new Error('No Bluetooth adapters found')
  }
  return createBluetoothFromAdapter(adapter)
}

export async function requestDevice(options: RequestDeviceOptions = {}): Promise<BluetoothDevice> {
  return (await createBluetooth()).requestDevice(options)
}

function createManagerFromNative(handle: NativeManager): Manager {
  return {
    async adapters() {
      const adapters = await native.managerAdapters(handle.id)
      return adapters.map(createAdapter)
    },
  }
}

function createAdapter(handle: NativeAdapter): Adapter {
  const adapter: Adapter = {
    id: handle.id,
    info: handle.info,
    refreshInfo() {
      return native.adapterInfo(handle.id)
    },
    startScan(options: ScanOptions = {}) {
      return native.adapterStartScan(handle.id, normalizeScanOptions(options))
    },
    stopScan() {
      return native.adapterStopScan(handle.id)
    },
    async peripherals() {
      const peripherals = await native.adapterPeripherals(handle.id)
      return peripherals.map(createPeripheral)
    },
    async peripheral(peripheralId: string) {
      return createPeripheral(await native.adapterPeripheral(handle.id, peripheralId))
    },
    events() {
      let streamId: number | undefined

      return new ReadableStream<CentralEvent>({
        start: async () => {
          streamId = await native.adapterOpenEventStream(handle.id)
        },
        pull: async (controller) => {
          if (streamId === undefined) {
            return
          }
          const event = await native.adapterNextEvent(streamId)
          if (event) {
            controller.enqueue(event)
          } else {
            controller.close()
          }
        },
        cancel: async () => {
          if (streamId !== undefined) {
            await native.adapterCloseEventStream(streamId)
          }
        },
      })
    },
    scan(options: ScanOptions = {}) {
      const seen = new Set<string>()
      const eventStream = adapter.events()
      const reader = eventStream.getReader()

      return new ReadableStream<Peripheral>({
        start: async () => {
          await adapter.startScan(options)
        },
        pull: async (controller) => {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) {
              controller.close()
              return
            }
            if (value.peripheralId && !seen.has(value.peripheralId)) {
              seen.add(value.peripheralId)
              controller.enqueue(await adapter.peripheral(value.peripheralId))
              return
            }
          }
        },
        cancel: async () => {
          await Promise.allSettled([reader.cancel(), adapter.stopScan()])
        },
      })
    },
  }

  return adapter
}

function createPeripheral(handle: NativePeripheral): Peripheral {
  return {
    id: handle.id,
    peripheralId: handle.peripheralId,
    properties() {
      return native.peripheralProperties(handle.id)
    },
    connect() {
      return native.peripheralConnect(handle.id)
    },
    disconnect() {
      return native.peripheralDisconnect(handle.id)
    },
    isConnected() {
      return native.peripheralIsConnected(handle.id)
    },
    discoverServices() {
      return native.peripheralDiscoverServices(handle.id)
    },
    services() {
      return native.peripheralServices(handle.id)
    },
    characteristics() {
      return native.peripheralCharacteristics(handle.id)
    },
    read(serviceUuid: string, characteristicUuid: string) {
      return native.peripheralRead(handle.id, serviceUuid, characteristicUuid)
    },
    write(
      serviceUuid: string,
      characteristicUuid: string,
      data: BufferSource,
      options: WriteOptions = {},
    ) {
      return native.peripheralWrite(
        handle.id,
        serviceUuid,
        characteristicUuid,
        toUint8Array(data),
        options,
      )
    },
    subscribe(serviceUuid: string, characteristicUuid: string) {
      return native.peripheralSubscribe(handle.id, serviceUuid, characteristicUuid)
    },
    unsubscribe(serviceUuid: string, characteristicUuid: string) {
      return native.peripheralUnsubscribe(handle.id, serviceUuid, characteristicUuid)
    },
    notifications() {
      let streamId: number | undefined

      return new ReadableStream<NotificationEvent>({
        start: async () => {
          streamId = await native.peripheralOpenNotificationStream(handle.id)
        },
        pull: async (controller) => {
          if (streamId === undefined) {
            return
          }
          const event = await native.peripheralNextNotification(streamId)
          if (event) {
            controller.enqueue(event)
          } else {
            controller.close()
          }
        },
        cancel: async () => {
          if (streamId !== undefined) {
            await native.peripheralCloseNotificationStream(streamId)
          }
        },
      })
    },
  }
}

function createBluetoothFromAdapter(adapter: Adapter): Bluetooth {
  return {
    ...createEventTargetFacade(),
    async getAvailability() {
      return true
    },
    async requestDevice(options: RequestDeviceOptions = {}) {
      validateRequestDeviceOptions(options)
      const serviceFilter = collectServiceFilters(options)
      const timeout = options.timeout ?? 10_000
      const deadline = Date.now() + timeout
      const reader = adapter.scan(serviceFilter ? { services: serviceFilter } : {}).getReader()

      try {
        while (Date.now() < deadline) {
          const result = await Promise.race([
            reader.read(),
            delay(Math.min(250, Math.max(0, deadline - Date.now()))).then(() => undefined),
          ])
          if (!result || result.done) {
            continue
          }
          const properties = await result.value.properties()
          if (matchesRequestDeviceOptions(properties, options)) {
            return createBluetoothDevice(result.value, properties ?? undefined)
          }
        }
      } finally {
        await reader.cancel()
      }

      throw new DOMException('No matching Bluetooth device found', 'NotFoundError')
    },
  }
}

function createBluetoothDevice(
  peripheral: Peripheral,
  properties?: PeripheralProperties,
): BluetoothDevice {
  const eventTarget = createEventTargetFacade()
  const device = {
    ...eventTarget,
    id: peripheral.peripheralId,
    name: properties?.localName ?? properties?.advertisementName,
    peripheral,
  } as Omit<BluetoothDevice, 'gatt'> & { gatt?: BluetoothRemoteGATTServer }

  device.gatt = createBluetoothRemoteGattServer(device as BluetoothDevice)
  return device as BluetoothDevice
}

function createBluetoothRemoteGattServer(device: BluetoothDevice): BluetoothRemoteGATTServer {
  let connected = false

  return {
    device,
    get connected() {
      return connected
    },
    async connect() {
      await device.peripheral.connect()
      await device.peripheral.discoverServices()
      connected = true
      return this
    },
    async disconnect() {
      await device.peripheral.disconnect()
      connected = false
    },
    async getPrimaryServices(service?: string) {
      await device.peripheral.discoverServices()
      return device.peripheral
        .services()
        .filter((item) => !service || item.uuid === normalizeUuid(service))
        .map((item) => createBluetoothRemoteGattService(device, item))
    },
    async getPrimaryService(service: string) {
      const found = (await this.getPrimaryServices(service))[0]
      if (!found) {
        throw new DOMException('Service not found', 'NotFoundError')
      }
      return found
    },
  }
}

function createBluetoothRemoteGattService(
  device: BluetoothDevice,
  info: ServiceInfo,
): BluetoothRemoteGATTService {
  const service: BluetoothRemoteGATTService = {
    device,
    uuid: info.uuid,
    isPrimary: info.primary,
    async getCharacteristics(characteristic?: string) {
      return info.characteristics
        .filter((item) => !characteristic || item.uuid === normalizeUuid(characteristic))
        .map((item) => createBluetoothRemoteGattCharacteristic(service, item))
    },
    async getCharacteristic(characteristic: string) {
      const found = (await service.getCharacteristics(characteristic))[0]
      if (!found) {
        throw new DOMException('Characteristic not found', 'NotFoundError')
      }
      return found
    },
  }

  return service
}

function createBluetoothRemoteGattCharacteristic(
  service: BluetoothRemoteGATTService,
  info: CharacteristicInfo,
): BluetoothRemoteGATTCharacteristic {
  const events = createEventTargetFacade()
  let reader: ReadableStreamDefaultReader<NotificationEvent> | undefined

  const characteristic: BluetoothRemoteGATTCharacteristic = {
    ...events,
    service,
    uuid: info.uuid,
    properties: createBluetoothCharacteristicProperties(info.properties),
    value: undefined,
    async readValue() {
      const bytes = await service.device.peripheral.read(info.serviceUuid, info.uuid)
      characteristic.value = toDataView(bytes)
      return characteristic.value
    },
    async writeValue(value: BufferSource) {
      await characteristic.writeValueWithResponse(value)
    },
    async writeValueWithResponse(value: BufferSource) {
      await service.device.peripheral.write(info.serviceUuid, info.uuid, value)
    },
    async writeValueWithoutResponse(value: BufferSource) {
      await service.device.peripheral.write(info.serviceUuid, info.uuid, value, {
        withoutResponse: true,
      })
    },
    async startNotifications() {
      await service.device.peripheral.subscribe(info.serviceUuid, info.uuid)
      reader = service.device.peripheral.notifications().getReader()
      void pumpNotifications(characteristic, info, reader)
      return characteristic
    },
    async stopNotifications() {
      await service.device.peripheral.unsubscribe(info.serviceUuid, info.uuid)
      await reader?.cancel()
      reader = undefined
      return characteristic
    },
  }

  return characteristic
}

async function pumpNotifications(
  characteristic: BluetoothRemoteGATTCharacteristic,
  info: CharacteristicInfo,
  reader: ReadableStreamDefaultReader<NotificationEvent>,
): Promise<void> {
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      return
    }
    if (value.uuid === info.uuid && value.serviceUuid === info.serviceUuid) {
      characteristic.value = toDataView(value.value)
      characteristic.dispatchEvent(new Event('characteristicvaluechanged'))
    }
  }
}

function createBluetoothCharacteristicProperties(
  properties: string[],
): BluetoothCharacteristicProperties {
  const set = new Set(properties)
  return {
    broadcast: set.has('broadcast'),
    read: set.has('read'),
    writeWithoutResponse: set.has('writeWithoutResponse'),
    write: set.has('write'),
    notify: set.has('notify'),
    indicate: set.has('indicate'),
    authenticatedSignedWrites: set.has('authenticatedSignedWrites'),
    extendedProperties: set.has('extendedProperties'),
  }
}

function createEventTargetFacade(): EventTargetFacade {
  const target = new EventTarget()
  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
}

function loadNative(): NativeModule {
  const require = createRequire(import.meta.url)
  const targets = nativeCandidates()
  const failures: string[] = []

  for (const target of targets) {
    try {
      return require(target) as NativeModule
    } catch (error) {
      failures.push(`${target}: ${(error as Error).message}`)
    }
  }

  throw new Error(`Unable to load btleplug-js native binding.\n${failures.join('\n')}`)
}

function nativeCandidates(): string[] {
  const triple = platformTriple()
  return [`../btleplug_js.${triple}.node`, `@nakasyou/btleplug-js-${triple}`]
}

function platformTriple(): string {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64-msvc'
  throw new Error(`Unsupported platform: ${platform} ${arch}`)
}

function normalizeScanOptions(options: ScanOptions): ScanOptions {
  const services = options.services?.map(normalizeUuid)
  return services ? { services } : {}
}

function validateRequestDeviceOptions(options: RequestDeviceOptions): void {
  if (!options.acceptAllDevices && (!options.filters || options.filters.length === 0)) {
    throw new TypeError('requestDevice requires acceptAllDevices or at least one filter')
  }
}

function collectServiceFilters(options: RequestDeviceOptions): string[] | undefined {
  const services = new Set<string>()
  for (const filter of options.filters ?? []) {
    for (const service of filter.services ?? []) {
      services.add(normalizeUuid(service))
    }
  }
  return services.size === 0 ? undefined : [...services]
}

function matchesRequestDeviceOptions(
  properties: PeripheralProperties | null,
  options: RequestDeviceOptions,
): boolean {
  if (options.acceptAllDevices) {
    return true
  }
  const name = properties?.localName ?? properties?.advertisementName ?? ''
  const advertisedServices = new Set(properties?.services ?? [])

  return (options.filters ?? []).some((filter) => {
    const nameMatches = filter.name === undefined || filter.name === name
    const prefixMatches = filter.namePrefix === undefined || name.startsWith(filter.namePrefix)
    const servicesMatch = (filter.services ?? []).every((service) =>
      advertisedServices.has(normalizeUuid(service)),
    )
    return nameMatches && prefixMatches && servicesMatch
  })
}

function normalizeUuid(uuid: string): string {
  if (/^[0-9a-f]{4}$/i.test(uuid)) {
    return `0000${uuid.toLowerCase()}-0000-1000-8000-00805f9b34fb`
  }
  if (/^[0-9a-f]{8}$/i.test(uuid)) {
    return `${uuid.toLowerCase()}-0000-1000-8000-00805f9b34fb`
  }
  return uuid.toLowerCase()
}

function toUint8Array(value: BufferSource): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function toDataView(value: Uint8Array): DataView {
  return new DataView(value.buffer, value.byteOffset, value.byteLength)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

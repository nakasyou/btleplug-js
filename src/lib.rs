use std::{
    collections::HashMap,
    pin::Pin,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

use btleplug::{
    api::{
        Central, CentralEvent, CharPropFlags, Characteristic, Manager as _, Peripheral as _,
        ScanFilter, ValueNotification, WriteType, bleuuid::BleUuid,
    },
    platform::{Adapter, Manager, Peripheral},
};
use futures::{Stream, StreamExt};
use napi::{Error, Status, bindgen_prelude::*};
use napi_derive::napi;
use once_cell::sync::Lazy;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

type CentralEventStream = Pin<Box<dyn Stream<Item = CentralEvent> + Send>>;
type NotificationStream = Pin<Box<dyn Stream<Item = ValueNotification> + Send>>;

static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static MANAGERS: Lazy<Mutex<HashMap<u32, Manager>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static ADAPTERS: Lazy<Mutex<HashMap<u32, Adapter>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static PERIPHERALS: Lazy<Mutex<HashMap<u32, Peripheral>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static EVENTS: Lazy<AsyncMutex<HashMap<u32, CentralEventStream>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));
static NOTIFICATIONS: Lazy<AsyncMutex<HashMap<u32, NotificationStream>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

#[napi(object)]
pub struct NativeManager {
    pub id: u32,
}

#[napi(object)]
pub struct NativeAdapter {
    pub id: u32,
    pub info: String,
}

#[napi(object)]
pub struct NativePeripheral {
    pub id: u32,
    pub peripheral_id: String,
}

#[napi(object)]
pub struct ScanOptions {
    pub services: Option<Vec<String>>,
}

#[napi(object)]
pub struct PeripheralProperties {
    pub address: String,
    pub address_type: Option<String>,
    pub local_name: Option<String>,
    pub advertisement_name: Option<String>,
    pub tx_power_level: Option<i16>,
    pub rssi: Option<i16>,
    pub manufacturer_data: Vec<ManufacturerData>,
    pub service_data: Vec<ServiceData>,
    pub services: Vec<String>,
    pub class: Option<u32>,
}

#[napi(object)]
pub struct ManufacturerData {
    pub company_identifier: u32,
    pub data: Buffer,
}

#[napi(object)]
pub struct ServiceData {
    pub uuid: String,
    pub data: Buffer,
}

#[napi(object)]
pub struct ServiceInfo {
    pub uuid: String,
    pub primary: bool,
    pub characteristics: Vec<CharacteristicInfo>,
}

#[napi(object)]
pub struct CharacteristicInfo {
    pub uuid: String,
    pub service_uuid: String,
    pub properties: Vec<String>,
    pub descriptors: Vec<DescriptorInfo>,
}

#[napi(object)]
pub struct DescriptorInfo {
    pub uuid: String,
    pub service_uuid: String,
    pub characteristic_uuid: String,
}

#[napi(object)]
pub struct CentralEventInfo {
    pub event_type: String,
    pub peripheral_id: Option<String>,
    pub adapter_state: Option<String>,
    pub rssi: Option<i16>,
    pub manufacturer_data: Option<Vec<ManufacturerData>>,
    pub service_data: Option<Vec<ServiceData>>,
    pub services: Option<Vec<String>>,
}

#[napi(object)]
pub struct NotificationInfo {
    pub uuid: String,
    pub service_uuid: String,
    pub value: Buffer,
}

#[napi(object)]
pub struct WriteOptions {
    pub without_response: Option<bool>,
}

#[napi]
pub fn native_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[napi]
pub async fn create_manager() -> Result<NativeManager> {
    let manager = Manager::new().await.map_err(to_napi_error)?;
    let id = insert_sync(&MANAGERS, manager)?;
    Ok(NativeManager { id })
}

#[napi]
pub async fn manager_adapters(manager_id: u32) -> Result<Vec<NativeAdapter>> {
    let manager = get_sync(&MANAGERS, manager_id, "manager")?;
    let adapters = manager.adapters().await.map_err(to_napi_error)?;
    let mut out = Vec::with_capacity(adapters.len());

    for adapter in adapters {
        let info = adapter.adapter_info().await.map_err(to_napi_error)?;
        let id = insert_sync(&ADAPTERS, adapter)?;
        out.push(NativeAdapter { id, info });
    }

    Ok(out)
}

#[napi]
pub async fn adapter_info(adapter_id: u32) -> Result<String> {
    get_sync(&ADAPTERS, adapter_id, "adapter")?
        .adapter_info()
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn adapter_start_scan(adapter_id: u32, options: Option<ScanOptions>) -> Result<()> {
    let adapter = get_sync(&ADAPTERS, adapter_id, "adapter")?;
    adapter
        .start_scan(scan_filter(options)?)
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn adapter_stop_scan(adapter_id: u32) -> Result<()> {
    get_sync(&ADAPTERS, adapter_id, "adapter")?
        .stop_scan()
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn adapter_peripherals(adapter_id: u32) -> Result<Vec<NativePeripheral>> {
    let adapter = get_sync(&ADAPTERS, adapter_id, "adapter")?;
    let peripherals = adapter.peripherals().await.map_err(to_napi_error)?;
    Ok(peripherals
        .into_iter()
        .map(|peripheral| {
            let peripheral_id = peripheral.id().to_string();
            let id = insert_sync(&PERIPHERALS, peripheral)?;
            Ok(NativePeripheral { id, peripheral_id })
        })
        .collect::<Result<Vec<_>>>()?)
}

#[napi]
pub async fn adapter_peripheral(
    adapter_id: u32,
    peripheral_id: String,
) -> Result<NativePeripheral> {
    let adapter = get_sync(&ADAPTERS, adapter_id, "adapter")?;
    let peripheral = adapter
        .peripherals()
        .await
        .map_err(to_napi_error)?
        .into_iter()
        .find(|peripheral| peripheral.id().to_string() == peripheral_id)
        .ok_or_else(|| Error::new(Status::InvalidArg, "peripheral not found"))?;
    let id = insert_sync(&PERIPHERALS, peripheral)?;
    Ok(NativePeripheral { id, peripheral_id })
}

#[napi]
pub async fn adapter_open_event_stream(adapter_id: u32) -> Result<u32> {
    let adapter = get_sync(&ADAPTERS, adapter_id, "adapter")?;
    let stream = adapter.events().await.map_err(to_napi_error)?;
    let id = next_id();
    EVENTS.lock().await.insert(id, stream);
    Ok(id)
}

#[napi]
pub async fn adapter_next_event(stream_id: u32) -> Result<Option<CentralEventInfo>> {
    let mut streams = EVENTS.lock().await;
    let stream = streams
        .get_mut(&stream_id)
        .ok_or_else(|| missing_error("event stream", stream_id))?;
    Ok(stream.next().await.map(central_event_to_info))
}

#[napi]
pub async fn adapter_close_event_stream(stream_id: u32) -> Result<()> {
    EVENTS.lock().await.remove(&stream_id);
    Ok(())
}

#[napi]
pub async fn peripheral_properties(peripheral_id: u32) -> Result<Option<PeripheralProperties>> {
    let peripheral = get_sync(&PERIPHERALS, peripheral_id, "peripheral")?;
    peripheral
        .properties()
        .await
        .map(|properties| properties.map(peripheral_properties_to_info))
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_connect(peripheral_id: u32) -> Result<()> {
    get_sync(&PERIPHERALS, peripheral_id, "peripheral")?
        .connect()
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_disconnect(peripheral_id: u32) -> Result<()> {
    get_sync(&PERIPHERALS, peripheral_id, "peripheral")?
        .disconnect()
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_is_connected(peripheral_id: u32) -> Result<bool> {
    get_sync(&PERIPHERALS, peripheral_id, "peripheral")?
        .is_connected()
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_discover_services(peripheral_id: u32) -> Result<()> {
    get_sync(&PERIPHERALS, peripheral_id, "peripheral")?
        .discover_services()
        .await
        .map_err(to_napi_error)
}

#[napi]
pub fn peripheral_services(peripheral_id: u32) -> Result<Vec<ServiceInfo>> {
    Ok(get_sync(&PERIPHERALS, peripheral_id, "peripheral")?
        .services()
        .into_iter()
        .map(service_to_info)
        .collect())
}

#[napi]
pub fn peripheral_characteristics(peripheral_id: u32) -> Result<Vec<CharacteristicInfo>> {
    Ok(get_sync(&PERIPHERALS, peripheral_id, "peripheral")?
        .characteristics()
        .into_iter()
        .map(characteristic_to_info)
        .collect())
}

#[napi]
pub async fn peripheral_read(
    peripheral_id: u32,
    service_uuid: String,
    characteristic_uuid: String,
) -> Result<Buffer> {
    let peripheral = get_sync(&PERIPHERALS, peripheral_id, "peripheral")?;
    let characteristic = find_characteristic(&peripheral, &service_uuid, &characteristic_uuid)?;
    peripheral
        .read(&characteristic)
        .await
        .map(Buffer::from)
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_write(
    peripheral_id: u32,
    service_uuid: String,
    characteristic_uuid: String,
    data: Buffer,
    options: Option<WriteOptions>,
) -> Result<()> {
    let peripheral = get_sync(&PERIPHERALS, peripheral_id, "peripheral")?;
    let characteristic = find_characteristic(&peripheral, &service_uuid, &characteristic_uuid)?;
    let write_type = if options
        .and_then(|options| options.without_response)
        .unwrap_or(false)
    {
        WriteType::WithoutResponse
    } else {
        WriteType::WithResponse
    };
    peripheral
        .write(&characteristic, data.as_ref(), write_type)
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_subscribe(
    peripheral_id: u32,
    service_uuid: String,
    characteristic_uuid: String,
) -> Result<()> {
    let peripheral = get_sync(&PERIPHERALS, peripheral_id, "peripheral")?;
    let characteristic = find_characteristic(&peripheral, &service_uuid, &characteristic_uuid)?;
    peripheral
        .subscribe(&characteristic)
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_unsubscribe(
    peripheral_id: u32,
    service_uuid: String,
    characteristic_uuid: String,
) -> Result<()> {
    let peripheral = get_sync(&PERIPHERALS, peripheral_id, "peripheral")?;
    let characteristic = find_characteristic(&peripheral, &service_uuid, &characteristic_uuid)?;
    peripheral
        .unsubscribe(&characteristic)
        .await
        .map_err(to_napi_error)
}

#[napi]
pub async fn peripheral_open_notification_stream(peripheral_id: u32) -> Result<u32> {
    let peripheral = get_sync(&PERIPHERALS, peripheral_id, "peripheral")?;
    let stream = peripheral.notifications().await.map_err(to_napi_error)?;
    let id = next_id();
    NOTIFICATIONS.lock().await.insert(id, stream);
    Ok(id)
}

#[napi]
pub async fn peripheral_next_notification(stream_id: u32) -> Result<Option<NotificationInfo>> {
    let mut streams = NOTIFICATIONS.lock().await;
    let stream = streams
        .get_mut(&stream_id)
        .ok_or_else(|| missing_error("notification stream", stream_id))?;
    Ok(stream.next().await.map(notification_to_info))
}

#[napi]
pub async fn peripheral_close_notification_stream(stream_id: u32) -> Result<()> {
    NOTIFICATIONS.lock().await.remove(&stream_id);
    Ok(())
}

fn insert_sync<T>(map: &Mutex<HashMap<u32, T>>, value: T) -> Result<u32> {
    let id = next_id();
    map.lock()
        .map_err(|_| Error::new(Status::GenericFailure, "state lock poisoned"))?
        .insert(id, value);
    Ok(id)
}

fn get_sync<T: Clone>(map: &Mutex<HashMap<u32, T>>, id: u32, label: &str) -> Result<T> {
    map.lock()
        .map_err(|_| Error::new(Status::GenericFailure, "state lock poisoned"))?
        .get(&id)
        .cloned()
        .ok_or_else(|| missing_error(label, id))
}

fn next_id() -> u32 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

fn scan_filter(options: Option<ScanOptions>) -> Result<ScanFilter> {
    let services = options
        .and_then(|options| options.services)
        .unwrap_or_default()
        .into_iter()
        .map(|uuid| parse_uuid(&uuid))
        .collect::<Result<Vec<_>>>()?;
    Ok(ScanFilter { services })
}

fn find_characteristic(
    peripheral: &Peripheral,
    service_uuid: &str,
    characteristic_uuid: &str,
) -> Result<Characteristic> {
    let service_uuid = parse_uuid(service_uuid)?;
    let characteristic_uuid = parse_uuid(characteristic_uuid)?;
    peripheral
        .characteristics()
        .into_iter()
        .find(|characteristic| {
            characteristic.service_uuid == service_uuid
                && characteristic.uuid == characteristic_uuid
        })
        .ok_or_else(|| Error::new(Status::InvalidArg, "characteristic not found"))
}

fn parse_uuid(value: &str) -> Result<Uuid> {
    Uuid::parse_str(value).map_err(|err| Error::new(Status::InvalidArg, err.to_string()))
}

fn peripheral_properties_to_info(
    properties: btleplug::api::PeripheralProperties,
) -> PeripheralProperties {
    PeripheralProperties {
        address: properties.address.to_string(),
        address_type: properties.address_type.map(|value| format!("{value:?}")),
        local_name: properties.local_name,
        advertisement_name: properties.advertisement_name,
        tx_power_level: properties.tx_power_level,
        rssi: properties.rssi,
        manufacturer_data: properties
            .manufacturer_data
            .into_iter()
            .map(|(company_identifier, data)| ManufacturerData {
                company_identifier: company_identifier.into(),
                data: Buffer::from(data),
            })
            .collect(),
        service_data: properties
            .service_data
            .into_iter()
            .map(|(uuid, data)| ServiceData {
                uuid: uuid.to_short_string(),
                data: Buffer::from(data),
            })
            .collect(),
        services: properties
            .services
            .into_iter()
            .map(|uuid| uuid.to_short_string())
            .collect(),
        class: properties.class,
    }
}

fn service_to_info(service: btleplug::api::Service) -> ServiceInfo {
    ServiceInfo {
        uuid: service.uuid.to_short_string(),
        primary: service.primary,
        characteristics: service
            .characteristics
            .into_iter()
            .map(characteristic_to_info)
            .collect(),
    }
}

fn characteristic_to_info(characteristic: Characteristic) -> CharacteristicInfo {
    CharacteristicInfo {
        uuid: characteristic.uuid.to_short_string(),
        service_uuid: characteristic.service_uuid.to_short_string(),
        properties: char_properties(characteristic.properties),
        descriptors: characteristic
            .descriptors
            .into_iter()
            .map(|descriptor| DescriptorInfo {
                uuid: descriptor.uuid.to_short_string(),
                service_uuid: descriptor.service_uuid.to_short_string(),
                characteristic_uuid: descriptor.characteristic_uuid.to_short_string(),
            })
            .collect(),
    }
}

fn central_event_to_info(event: CentralEvent) -> CentralEventInfo {
    match event {
        CentralEvent::DeviceDiscovered(id) => event_with_id("deviceDiscovered", id),
        CentralEvent::DeviceUpdated(id) => event_with_id("deviceUpdated", id),
        CentralEvent::DeviceConnected(id) => event_with_id("deviceConnected", id),
        CentralEvent::DeviceDisconnected(id) => event_with_id("deviceDisconnected", id),
        CentralEvent::DeviceServicesModified(id) => event_with_id("deviceServicesModified", id),
        CentralEvent::StateUpdate(state) => CentralEventInfo {
            event_type: "stateUpdate".to_string(),
            peripheral_id: None,
            adapter_state: Some(format!("{state:?}")),
            rssi: None,
            manufacturer_data: None,
            service_data: None,
            services: None,
        },
        CentralEvent::RssiUpdate { id, rssi } => CentralEventInfo {
            event_type: "rssiUpdate".to_string(),
            peripheral_id: Some(id.to_string()),
            adapter_state: None,
            rssi: Some(rssi),
            manufacturer_data: None,
            service_data: None,
            services: None,
        },
        CentralEvent::ManufacturerDataAdvertisement {
            id,
            manufacturer_data,
        } => CentralEventInfo {
            event_type: "manufacturerDataAdvertisement".to_string(),
            peripheral_id: Some(id.to_string()),
            adapter_state: None,
            rssi: None,
            manufacturer_data: Some(
                manufacturer_data
                    .into_iter()
                    .map(|(company_identifier, data)| ManufacturerData {
                        company_identifier: company_identifier.into(),
                        data: Buffer::from(data),
                    })
                    .collect(),
            ),
            service_data: None,
            services: None,
        },
        CentralEvent::ServiceDataAdvertisement { id, service_data } => CentralEventInfo {
            event_type: "serviceDataAdvertisement".to_string(),
            peripheral_id: Some(id.to_string()),
            adapter_state: None,
            rssi: None,
            manufacturer_data: None,
            service_data: Some(
                service_data
                    .into_iter()
                    .map(|(uuid, data)| ServiceData {
                        uuid: uuid.to_short_string(),
                        data: Buffer::from(data),
                    })
                    .collect(),
            ),
            services: None,
        },
        CentralEvent::ServicesAdvertisement { id, services } => CentralEventInfo {
            event_type: "servicesAdvertisement".to_string(),
            peripheral_id: Some(id.to_string()),
            adapter_state: None,
            rssi: None,
            manufacturer_data: None,
            service_data: None,
            services: Some(
                services
                    .into_iter()
                    .map(|uuid| uuid.to_short_string())
                    .collect(),
            ),
        },
    }
}

fn event_with_id(event_type: &str, id: btleplug::platform::PeripheralId) -> CentralEventInfo {
    CentralEventInfo {
        event_type: event_type.to_string(),
        peripheral_id: Some(id.to_string()),
        adapter_state: None,
        rssi: None,
        manufacturer_data: None,
        service_data: None,
        services: None,
    }
}

fn notification_to_info(notification: ValueNotification) -> NotificationInfo {
    NotificationInfo {
        uuid: notification.uuid.to_short_string(),
        service_uuid: notification.service_uuid.to_short_string(),
        value: Buffer::from(notification.value),
    }
}

fn char_properties(properties: CharPropFlags) -> Vec<String> {
    [
        (CharPropFlags::BROADCAST, "broadcast"),
        (CharPropFlags::READ, "read"),
        (
            CharPropFlags::WRITE_WITHOUT_RESPONSE,
            "writeWithoutResponse",
        ),
        (CharPropFlags::WRITE, "write"),
        (CharPropFlags::NOTIFY, "notify"),
        (CharPropFlags::INDICATE, "indicate"),
        (
            CharPropFlags::AUTHENTICATED_SIGNED_WRITES,
            "authenticatedSignedWrites",
        ),
        (CharPropFlags::EXTENDED_PROPERTIES, "extendedProperties"),
    ]
    .into_iter()
    .filter_map(|(flag, name)| properties.contains(flag).then(|| name.to_string()))
    .collect()
}

fn missing_error(label: &str, id: u32) -> Error {
    Error::new(Status::InvalidArg, format!("unknown {label} id {id}"))
}

fn to_napi_error(error: btleplug::Error) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

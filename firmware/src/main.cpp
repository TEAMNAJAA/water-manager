#include <Arduino.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <StreamString.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <esp_camera.h>
#include <esp_task_wdt.h>
#include <time.h>

#include <algorithm>
#include <vector>

#include "camera_pins.h"
#include "certs.h"

#ifndef NAMJAI_SERVER
#define NAMJAI_SERVER ""
#endif
#ifndef NAMJAI_TOKEN
#define NAMJAI_TOKEN ""
#endif

constexpr const char* FW = "0.1.0";
constexpr int LED_A = 13, LED_B = 12, STATUS_LED = 33, FLASH_LED = 4;
constexpr int CH_A = 4, CH_B = 5;
constexpr uint32_t WDT_S = 120, MIN_INTERVAL = 300, FLUSH_BUDGET_MS = 300000, WIFI_RETRY_MS = 300000;
constexpr size_t FREE_MARGIN = 48 * 1024;

struct Item {
  uint32_t seq;
  String path;
};

Preferences prefs;
String server, token, deviceId, lastError;
uint32_t interval = 3600, seq = 0, boot = 0, failedShots = 0;
uint8_t ledDuty = 180;
bool cameraOk = false, captureNow = true, quickPending = true;
time_t nextEpoch = 0;
uint32_t nextMs = 0, lastWifiTry = 0;

bool synced() { return time(nullptr) > 1700000000; }

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_EXT: return "external";
    default: return "other";
  }
}

bool startCamera() {
  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, HIGH);
  delay(100);
  digitalWrite(PWDN_GPIO_NUM, LOW);
  delay(100);
  camera_config_t c = {};
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.ledc_timer = LEDC_TIMER_0;
  c.ledc_channel = LEDC_CHANNEL_0;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_SVGA;
  c.jpeg_quality = 12;
  c.fb_count = 1;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  esp_camera_deinit();
  return esp_camera_init(&c) == ESP_OK;
}

camera_fb_t* shoot(int channel) {
  ledcWrite(channel, ledDuty);
  delay(250);
  if (camera_fb_t* stale = esp_camera_fb_get()) esp_camera_fb_return(stale);
  camera_fb_t* fb = esp_camera_fb_get();
  ledcWrite(channel, 0);
  return fb;
}

std::vector<Item> queue() {
  std::vector<Item> items;
  File dir = LittleFS.open("/q");
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String name = f.name();
    items.push_back({(uint32_t)strtoul(name.c_str(), nullptr, 10), "/q/" + name});
  }
  std::sort(items.begin(), items.end(), [](const Item& a, const Item& b) { return a.seq < b.seq || (a.seq == b.seq && a.path < b.path); });
  return items;
}

size_t fsFree() { return LittleFS.totalBytes() - LittleFS.usedBytes(); }

bool store(camera_fb_t* fb, char light, uint32_t s, time_t t) {
  auto items = queue();
  for (size_t i = 0; fsFree() < fb->len + FREE_MARGIN && i < items.size(); i++) LittleFS.remove(items[i].path);
  if (fsFree() < fb->len + FREE_MARGIN) return false;
  char path[80];
  snprintf(path, sizeof(path), "/q/%lu_%c_%lu_%lu_%lu.jpg", (unsigned long)s, light, (unsigned long)t, (unsigned long)boot, (unsigned long)millis());
  File f = LittleFS.open(path, FILE_WRITE);
  if (!f) return false;
  bool ok = f.write(fb->buf, fb->len) == fb->len;
  f.close();
  if (!ok) LittleFS.remove(path);
  return ok;
}

void capture() {
  digitalWrite(STATUS_LED, LOW);
  if (!cameraOk) cameraOk = startCamera();
  uint32_t s = ++seq;
  prefs.putUInt("seq", seq);
  time_t t = synced() ? time(nullptr) : 0;
  int saved = 0;
  for (auto [channel, light] : {std::pair{CH_A, 'a'}, std::pair{CH_B, 'b'}}) {
    esp_task_wdt_reset();
    camera_fb_t* fb = cameraOk ? shoot(channel) : nullptr;
    if (!fb) continue;
    saved += store(fb, light, s, t);
    esp_camera_fb_return(fb);
  }
  failedShots = saved ? 0 : failedShots + 1;
  if (!saved) {
    lastError = cameraOk ? "store_failed" : "camera_failed";
    cameraOk = false;
  }
  digitalWrite(STATUS_LED, HIGH);
  if (failedShots >= 3) ESP.restart();
}

bool post(const String& path, const char* type, Stream* body, size_t len, const std::vector<std::pair<String, String>>& headers, String* reply) {
  if (WiFi.status() != WL_CONNECTED || server.isEmpty()) return false;
  WiFiClientSecure secure;
  WiFiClient plain;
  bool tls = server.startsWith("https://");
  if (tls) secure.setCACert(ROOT_CAS);
  HTTPClient http;
  if (!http.begin(tls ? (WiFiClient&)secure : plain, server + path)) return false;
  http.setTimeout(20000);
  http.addHeader("Content-Type", type);
  http.addHeader("Authorization", "Bearer " + token);
  http.addHeader("X-Device", deviceId);
  for (auto& [k, v] : headers) http.addHeader(k, v);
  int code = http.sendRequest("POST", body, len);
  if (reply && code > 0) *reply = http.getString();
  http.end();
  if (code <= 0) lastError = "http_" + String(code);
  return (code >= 200 && code < 300) || code == 409;
}

bool send(const Item& item) {
  String name = item.path.substring(3);
  unsigned long s, t, b, ms;
  char light;
  if (sscanf(name.c_str(), "%lu_%c_%lu_%lu_%lu.jpg", &s, &light, &t, &b, &ms) != 5) return true;
  if (!t && b == boot && synced()) t = time(nullptr) - (millis() - ms) / 1000;
  File f = LittleFS.open(item.path, FILE_READ);
  if (!f) return true;
  bool ok = post("/api/clip/photo", "image/jpeg", &f, f.size(),
                 {{"X-Seq", String(s)}, {"X-Light", String(light)}, {"X-Captured-At", String(t)}, {"X-Boot", String(b)}, {"X-Ms", String(ms)}}, nullptr);
  f.close();
  return ok;
}

void flush() {
  uint32_t start = millis();
  for (auto& item : queue()) {
    esp_task_wdt_reset();
    if (millis() - start > FLUSH_BUDGET_MS || !send(item)) return;
    LittleFS.remove(item.path);
  }
}

long field(const String& json, const char* key, long fallback) {
  int i = json.indexOf(String("\"") + key + "\"");
  if (i < 0) return fallback;
  i = json.indexOf(':', i);
  String rest = json.substring(i + 1);
  rest.trim();
  if (rest.startsWith("true")) return 1;
  if (rest.startsWith("false")) return 0;
  return rest.toInt();
}

void heartbeat() {
  auto items = queue();
  size_t bytes = 0;
  for (auto& item : items) {
    File f = LittleFS.open(item.path, FILE_READ);
    bytes += f ? f.size() : 0;
  }
  String body = "{\"fw\":\"" + String(FW) + "\",\"boot\":" + boot + ",\"seq\":" + seq + ",\"uptime\":" + millis() / 1000 +
                ",\"reset\":\"" + resetReason() + "\",\"rssi\":" + WiFi.RSSI() + ",\"heap\":" + ESP.getFreeHeap() +
                ",\"psram\":" + ESP.getFreePsram() + ",\"queue\":" + (unsigned long)items.size() + ",\"queue_bytes\":" + (unsigned long)bytes +
                ",\"fs_free\":" + (unsigned long)fsFree() + ",\"camera\":" + (cameraOk ? "true" : "false") +
                ",\"time\":" + (unsigned long)(synced() ? time(nullptr) : 0) + ",\"interval\":" + interval + ",\"led\":" + ledDuty +
                ",\"error\":\"" + lastError + "\"}";
  StreamString s;
  s.print(body);
  String reply;
  if (post("/api/clip/heartbeat", "application/json", &s, s.length(), {}, &reply)) {
    lastError = "";
    uint32_t next = field(reply, "interval", interval);
    if (next >= MIN_INTERVAL && next != interval) {
      interval = next;
      prefs.putUInt("interval", interval);
      nextEpoch = 0;
    }
    ledDuty = constrain(field(reply, "led", ledDuty), 0, 255);
    captureNow = field(reply, "capture_now", 0);
  }
}

bool due() {
  if (captureNow) return true;
  if (synced()) {
    time_t now = time(nullptr);
    if (!nextEpoch) nextEpoch = (now / interval + 1) * interval;
    return now >= nextEpoch;
  }
  return (int32_t)(millis() - nextMs) >= 0;
}

void schedule() {
  captureNow = false;
  if (synced()) nextEpoch = (time(nullptr) / interval + 1) * interval;
  nextMs = millis() + interval * 1000;
}

void connect(bool portal) {
  WiFiManager wm;
  WiFiManagerParameter pServer("server", "Server URL", server.c_str(), 120);
  WiFiManagerParameter pToken("token", "Device token", token.c_str(), 80);
  wm.addParameter(&pServer);
  wm.addParameter(&pToken);
  wm.setConfigPortalTimeout(300);
  wm.setConnectTimeout(30);
  String ap = "NamJai-" + deviceId;
  bool ok = portal ? wm.startConfigPortal(ap.c_str()) : wm.autoConnect(ap.c_str());
  if (String(pServer.getValue()) != server || String(pToken.getValue()) != token) {
    server = pServer.getValue();
    token = pToken.getValue();
    while (server.endsWith("/")) server.remove(server.length() - 1);
    prefs.putString("server", server);
    prefs.putString("token", token);
  }
  if (!ok) lastError = "wifi";
}

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH);
  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, LOW);
  ledcSetup(CH_A, 5000, 8);
  ledcSetup(CH_B, 5000, 8);
  ledcAttachPin(LED_A, CH_A);
  ledcAttachPin(LED_B, CH_B);
  ledcWrite(CH_A, 0);
  ledcWrite(CH_B, 0);

  prefs.begin("namjai");
  uint64_t mac = ESP.getEfuseMac();
  char id[16];
  snprintf(id, sizeof(id), "clip-%06llx", (mac >> 24) & 0xFFFFFF);
  deviceId = id;
  server = prefs.getString("server", NAMJAI_SERVER);
  token = prefs.getString("token", NAMJAI_TOKEN);
  interval = std::max(MIN_INTERVAL, prefs.getUInt("interval", 3600));
  ledDuty = prefs.getUChar("led", 180);
  seq = prefs.getUInt("seq", 0);
  boot = prefs.getUInt("boot", 0) + 1;
  prefs.putUInt("boot", boot);
  uint32_t quick = prefs.getUInt("quick", 0) + 1;
  prefs.putUInt("quick", quick);

  if (!LittleFS.begin(true)) lastError = "fs";
  LittleFS.mkdir("/q");
  cameraOk = startCamera();
  if (!cameraOk) lastError = "camera_failed";

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  connect(quick >= 3 || server.isEmpty());
  configTzTime("ICT-7", "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 20 && WiFi.status() == WL_CONNECTED && !synced(); i++) delay(250);

  esp_task_wdt_init(WDT_S, true);
  esp_task_wdt_add(nullptr);
  nextMs = millis();
}

void loop() {
  esp_task_wdt_reset();
  if (quickPending && millis() > 10000) {
    prefs.putUInt("quick", 0);
    quickPending = false;
  }
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > WIFI_RETRY_MS) {
    lastWifiTry = millis();
    WiFi.reconnect();
  }
  if (due()) {
    schedule();
    capture();
    if (WiFi.status() == WL_CONNECTED) {
      heartbeat();
      flush();
    } else {
      lastError = "offline";
    }
  }
  delay(1000);
}

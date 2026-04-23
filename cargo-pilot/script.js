// Cargo Pilot — Tycoon UserApp
// Job detection, route guidance, runway monitoring, transformer automation,
// cargo tracking, settings, and AFK alerts for the Cargo Pilot job.

if (typeof console !== "undefined") {
  console.log = function () {};
  console.warn = function () {};
  console.info = function () {};
  console.debug = function () {};
}

// ---------- Config ----------
const REQUIRED_JOB = "cargopilot";
const BXP_KEY = "exp_token_a|piloting|cargos";

// GTA V airport coordinates — approximations; refine in-game as needed.
// SSIA = Sandy Shores International Airport
// MGA  = Mt. Gordo / "Mt. Godo" area airstrip
// SCHIA = San Chanski (placeholder — adjust to actual in-game coords)
const CARGO_ROUTE = [
  { key: "SSIA", label: "SSIA", fullName: "Sandy Shores Intl", x: 1747, y: 3273 },
  { key: "MGA", label: "Mt. Godo", fullName: "Mt. Godo Airstrip", x: 2120, y: 4790 },
  { key: "SCHIA", label: "San Chanski", fullName: "San Chanski Intl", x: -1037, y: -2987 }
];

const RUNWAY_KINDS = ["MAIN", "SIDE", "JET"];
const ARRIVAL_RADIUS = 200;
const BLIP_ID = "cp_next_airport";
const NEXT_LEG_TRIGGER = "cp_advance_leg";
const ATC_TRIGGER = "cp_call_atc";
const GEAR_TRIGGER = "cp_toggle_gear";

// Allow runway/ATC interoperability with servers that use a different nick
// for the San Chanski airport key.
const AIRPORT_ALIASES = {
  SCHIA: ["SCHIA", "SCA"]
};

const OPACITY_LEVELS = [0.95, 0.75, 0.5, 0.25];

const STORAGE_PREFIX = "cargoPilot_";
const STORAGE = {
  settings: STORAGE_PREFIX + "settings",
  routeIndex: STORAGE_PREFIX + "routeIndex",
  panels: STORAGE_PREFIX + "panels",
  opacityIdx: STORAGE_PREFIX + "opacityIdx"
};

const DEFAULT_SETTINGS = {
  theme: "nightflight",
  fontScale: 1,
  bgOpacity: 0.85,
  runwayPref: "MAIN",
  autoTransformer: true,
  afkAlertEnabled: true,
  afkTimeoutSec: 60
};

const ALERT_COOLDOWN_MS = 25000;
const AFK_MOVE_EPSILON = 3.5; // distance units; small movement = still AFK

// ---------- State ----------
const state = {
  settings: { ...DEFAULT_SETTINGS },
  cache: {},
  job: "",
  vehicle: null,
  aircraftModel: "",
  onFoot: true,
  inOwnAircraft: false,
  isPilotJob: false,
  pos: { x: null, y: null },
  routeIndex: 0,
  runways: {}, // airportKey -> {MAIN, SIDE, JET}
  landingGear: null,
  menuOpen: false,
  menuChoices: [],
  inventoryObj: null,
  weight: null,
  maxWeight: null,
  bxp: null,
  lastAfkPos: null,
  lastAfkMoveAt: Date.now(),
  lastAlertAt: 0,
  opacityIdx: 0,
  lastArrivedAt: 0,
  isAutomating: false,
  menuSessionAutomated: false,
  runwaySeenAirports: new Set(),
  lastTriggerValues: {} // trigger_<name> -> last seen value (for edge detection)
};

// ---------- Storage helpers ----------
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function loadSettings() {
  const saved = loadJSON(STORAGE.settings, {});
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
}
function saveSettings() {
  saveJSON(STORAGE.settings, state.settings);
}

// ---------- Panels ----------
const PANEL_IDS = ["cp-main", "cp-runway-panel", "cp-cargo-panel", "cp-settings-panel"];

function loadPanelLayouts() {
  const saved = loadJSON(STORAGE.panels, {});
  for (const id of PANEL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const layout = saved[id];
    if (!layout) continue;
    if (Number.isFinite(layout.x)) el.style.left = clampToViewport(layout.x, "x") + "px";
    if (Number.isFinite(layout.y)) el.style.top = clampToViewport(layout.y, "y") + "px";
    if (Number.isFinite(layout.w) && layout.w >= 260) el.style.width = layout.w + "px";
    if (Number.isFinite(layout.h) && layout.h >= 160) el.style.height = layout.h + "px";
    if (layout.visible === true) el.classList.remove("hidden");
    else if (layout.visible === false) el.classList.add("hidden");
  }
}

function savePanelLayouts() {
  // Preserve previously saved geometry for hidden panels; getBoundingClientRect
  // returns zeros when display:none, which would otherwise clobber the user's
  // arrangement on the next reload.
  const payload = loadJSON(STORAGE.panels, {});
  for (const id of PANEL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const isHidden = el.classList.contains("hidden");
    if (isHidden) {
      if (payload[id]) payload[id].visible = false;
      else payload[id] = { visible: false };
      continue;
    }
    const rect = el.getBoundingClientRect();
    payload[id] = {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      visible: true
    };
  }
  saveJSON(STORAGE.panels, payload);
}

function clampToViewport(v, axis) {
  const max = axis === "x" ? window.innerWidth - 80 : window.innerHeight - 40;
  return Math.max(0, Math.min(v, max));
}

// Dragging and resizing using pointer events
let pointerAction = null; // { kind, panel, startX, startY, origX, origY, origW, origH }

function onPanelPointerDown(event) {
  if (event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;

  const dragHandle = target.closest("[data-drag-handle]");
  const resizeHandle = target.closest("[data-resize-handle]");
  const actionSource = resizeHandle || dragHandle;
  if (!actionSource) return;

  // Don't start drag from buttons
  if (target.closest("button, input, select, [data-close]")) return;

  const panel = actionSource.closest(".cp-panel");
  if (!panel) return;

  const rect = panel.getBoundingClientRect();
  pointerAction = {
    kind: resizeHandle ? "resize" : "drag",
    panel,
    startX: event.clientX,
    startY: event.clientY,
    origX: rect.left,
    origY: rect.top,
    origW: rect.width,
    origH: rect.height
  };

  // Promote to top
  panel.style.zIndex = String(nextZ());

  try { actionSource.setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
}

let zCounter = 100;
function nextZ() { zCounter += 1; return zCounter; }

function onPanelPointerMove(event) {
  if (!pointerAction) return;
  const { kind, panel, startX, startY, origX, origY, origW, origH } = pointerAction;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  if (kind === "drag") {
    const nx = clampToViewport(origX + dx, "x");
    const ny = clampToViewport(origY + dy, "y");
    panel.style.left = nx + "px";
    panel.style.top = ny + "px";
  } else if (kind === "resize") {
    const nw = Math.max(260, Math.min(window.innerWidth - 20, origW + dx));
    const nh = Math.max(160, Math.min(window.innerHeight - 20, origH + dy));
    panel.style.width = nw + "px";
    panel.style.height = nh + "px";
  }
}

function onPanelPointerUp() {
  if (!pointerAction) return;
  pointerAction = null;
  savePanelLayouts();
}

function togglePanel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden");
  if (!el.classList.contains("hidden")) el.style.zIndex = String(nextZ());
  savePanelLayouts();
}

function showPanel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.style.zIndex = String(nextZ());
  savePanelLayouts();
}

// ---------- Opacity ----------
function loadOpacity() {
  state.opacityIdx = parseInt(localStorage.getItem(STORAGE.opacityIdx) || "0", 10) || 0;
}
function cycleOpacity() {
  state.opacityIdx = (state.opacityIdx + 1) % OPACITY_LEVELS.length;
  localStorage.setItem(STORAGE.opacityIdx, String(state.opacityIdx));
  applyOpacity();
}
function applyOpacity() {
  const base = state.settings.bgOpacity ?? 0.85;
  const mul = OPACITY_LEVELS[state.opacityIdx] ?? 1;
  document.documentElement.style.setProperty("--cp-bg-opacity", String(base * mul));
}

// ---------- Theme / font ----------
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.settings.theme);
}
function applyFontScale() {
  const s = Math.max(0.85, Math.min(1.6, state.settings.fontScale ?? 1));
  document.documentElement.style.setProperty("--cp-font-scale", String(s));
  const el = document.getElementById("cp-font-val");
  if (el) el.textContent = Math.round(s * 100) + "%";
}
function applyBgOpacity() {
  const o = Math.max(0, Math.min(1, state.settings.bgOpacity ?? 0.85));
  const el = document.getElementById("cp-bg-val");
  if (el) el.textContent = Math.round(o * 100) + "%";
  applyOpacity();
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg, ms = 2000) {
  const t = document.getElementById("cp-toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------- Post to game ----------
function post(msg) {
  try {
    window.parent.postMessage(msg, "*");
  } catch {}
}

function sendNotification(text) {
  post({ type: "notification", text });
}

function sendSfx(n) {
  post({ type: "sfx", sfx: n });
}

function sendCommand(command) {
  post({ type: "sendCommand", command });
}

function setBlipRoute(airport) {
  if (!airport) return;
  post({
    type: "buildBlip",
    id: BLIP_ID,
    x: airport.x,
    y: airport.y,
    sprite: 10,
    color: 27,
    alwaysVisible: true,
    route: true,
    ticked: false,
    name: "Cargo: " + airport.label
  });
}

function clearBlip() {
  post({ type: "removeBlip", id: BLIP_ID });
}

function requestData() {
  const runwayKeys = [];
  for (const airport of CARGO_ROUTE) {
    const aliases = aliasesForAirport(airport.key);
    for (const alias of aliases) {
      for (const kind of RUNWAY_KINDS) {
        runwayKeys.push("runway_" + alias + "_" + kind);
      }
    }
  }

  // Per Example2 docs, keys prefixed with `trigger_`, `chest_`, `temp_` are not
  // cached and cannot be returned by getNamedData — they arrive as push events
  // when they fire / open / change, so we don't include them here.
  post({
    type: "getNamedData",
    keys: [
      "job", "job_name", "job_title", "vehicle", "vehicleClass", "aircraft",
      "pos_x", "pos_y", "pos_z",
      "landing_gear", "inventory", "weight", "max_weight",
      "menu_open", "menu", "menu_choices",
      ...runwayKeys,
      BXP_KEY
    ]
  });
}

function aliasesForAirport(airportKey) {
  return AIRPORT_ALIASES[airportKey] || [airportKey];
}

function canonicalAirportKey(airportKey) {
  for (const [canonical, aliases] of Object.entries(AIRPORT_ALIASES)) {
    if (aliases.includes(airportKey)) return canonical;
  }
  return airportKey;
}

function resolveAtcAirportKey(airportKey) {
  const aliases = aliasesForAirport(airportKey);
  for (const alias of aliases) {
    if (state.runwaySeenAirports.has(alias)) return alias;
  }
  return aliases[0] || airportKey;
}

// Tycoon prepends "trigger_" to the registered trigger name when sending values.
// Triggers fire as a changing numeric token per press — detect the change edge.
function handleTrigger(triggerName, onFire) {
  const key = "trigger_" + triggerName;
  if (!(key in state.cache) && !(key in state.lastTriggerValues)) return;
  const current = state.cache[key];
  const previous = state.lastTriggerValues[key];
  state.lastTriggerValues[key] = current;
  if (previous === undefined) return; // first observation — establish baseline
  if (current === previous) return;
  if (current == null || current === 0 || current === false) return;
  onFire();
}

function registerTriggers() {
  post({ type: "registerTrigger", trigger: NEXT_LEG_TRIGGER, name: "Cargo Pilot: Advance Leg" });
  post({ type: "registerTrigger", trigger: ATC_TRIGGER, name: "Cargo Pilot: Call ATC" });
  post({ type: "registerTrigger", trigger: GEAR_TRIGGER, name: "Cargo Pilot: Toggle Landing Gear" });
}

// ---------- Route logic ----------
function currentLeg() {
  const from = CARGO_ROUTE[state.routeIndex % CARGO_ROUTE.length];
  const to = CARGO_ROUTE[(state.routeIndex + 1) % CARGO_ROUTE.length];
  return { from, to };
}

function distanceTo(airport) {
  if (state.pos.x == null || state.pos.y == null) return Infinity;
  const dx = state.pos.x - airport.x;
  const dy = state.pos.y - airport.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestAirport() {
  let best = null;
  let bestDist = Infinity;
  for (const a of CARGO_ROUTE) {
    const d = distanceTo(a);
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return { airport: best, distance: bestDist };
}

function advanceLegIfArrived() {
  const { to } = currentLeg();
  if (!to) return;
  const dist = distanceTo(to);
  if (dist > ARRIVAL_RADIUS) return;
  const now = Date.now();
  if (now - state.lastArrivedAt < 30000) return; // dedupe
  state.lastArrivedAt = now;
  advanceLeg(true);
}

function advanceLeg(auto) {
  state.routeIndex = (state.routeIndex + 1) % CARGO_ROUTE.length;
  localStorage.setItem(STORAGE.routeIndex, String(state.routeIndex));
  const { to } = currentLeg();
  setBlipRoute(to);
  if (auto) {
    sendNotification("Cargo Pilot: Arrived. Next leg -> " + to.label);
    sendSfx(5);
  } else {
    sendNotification("Cargo Pilot: Next leg -> " + to.label);
  }
  renderRoute();
}

function renderRoute() {
  const { from, to } = currentLeg();
  const elFrom = document.getElementById("cp-leg-from");
  const elTo = document.getElementById("cp-leg-to");
  const elMeta = document.getElementById("cp-leg-meta");
  const elNext = document.getElementById("cp-cargo-next");
  if (elFrom) elFrom.textContent = from.label;
  if (elTo) elTo.textContent = to.label;
  if (elMeta) {
    const d = distanceTo(to);
    if (Number.isFinite(d)) {
      elMeta.textContent = "Distance to " + to.label + ": " + Math.round(d) + "m";
    } else {
      elMeta.textContent = "Distance: --";
    }
  }
  if (elNext) elNext.textContent = "Next Stop: " + to.label + " (" + to.fullName + ")";
}

// ---------- Runway rendering ----------
function parseRunwayKey(key) {
  // runway_SSIA_MAIN -> { airport: "SSIA", kind: "MAIN" }
  const m = /^runway_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/.exec(key);
  if (!m) return null;
  return { airport: m[1].toUpperCase(), kind: m[2].toUpperCase() };
}

function ingestRunway(key, value) {
  const parsed = parseRunwayKey(key);
  if (!parsed) return;
  const airport = canonicalAirportKey(parsed.airport);
  const kind = parsed.kind;
  state.runwaySeenAirports.add(parsed.airport);
  if (!state.runways[airport]) state.runways[airport] = {};
  state.runways[airport][kind] = String(value || "").toLowerCase();
}

function runwayDotClass(status) {
  switch (status) {
    case "free": return "cp-dot cp-dot-free";
    case "occupied": return "cp-dot cp-dot-occupied";
    case "reserved": return "cp-dot cp-dot-reserved";
    default: return "cp-dot cp-dot-unknown";
  }
}

function runwayStatusLabel(status) {
  if (!status) return "unknown";
  return status;
}

function renderRunways() {
  renderRunwayPanel();
  renderNearestRunwaySummary();
}

function renderRunwayPanel() {
  const container = document.getElementById("cp-runway-list");
  if (!container) return;
  container.innerHTML = "";
  const pref = state.settings.runwayPref || "MAIN";

  for (const airport of CARGO_ROUTE) {
    const group = document.createElement("div");
    group.className = "cp-runway-group";

    const header = document.createElement("div");
    header.className = "cp-runway-group-header";
    const title = document.createElement("span");
    title.className = "cp-runway-group-title";
    title.textContent = airport.label;
    const meta = document.createElement("span");
    meta.className = "cp-runway-group-meta";
    const d = distanceTo(airport);
    meta.textContent = Number.isFinite(d) ? Math.round(d) + "m" : "";
    header.appendChild(title);
    header.appendChild(meta);
    group.appendChild(header);

    const runways = state.runways[airport.key] || {};

    for (const kind of RUNWAY_KINDS) {
      const status = runways[kind] || "";
      const row = document.createElement("div");
      row.className = "cp-runway-row";
      if (kind === pref) row.classList.add("preferred");

      const left = document.createElement("div");
      left.innerHTML = '<span class="' + runwayDotClass(status) + '"></span>' +
        '<span class="cp-runway-name">' + kind + '</span>';

      const right = document.createElement("div");
      right.textContent = runwayStatusLabel(status);

      row.appendChild(left);
      row.appendChild(right);
      group.appendChild(row);
    }

    container.appendChild(group);
  }
}

function renderNearestRunwaySummary() {
  const wrap = document.getElementById("cp-runway-quick");
  const nearestEl = document.getElementById("cp-nearest");
  if (!wrap || !nearestEl) return;
  wrap.innerHTML = "";
  const { airport, distance } = nearestAirport();
  if (!airport) {
    nearestEl.textContent = "Nearest airport: --";
    return;
  }
  nearestEl.textContent = "Nearest: " + airport.label +
    (Number.isFinite(distance) ? " (" + Math.round(distance) + "m)" : "");

  const runways = state.runways[airport.key] || {};
  const pref = state.settings.runwayPref || "MAIN";

  // Show preferred first, then the others
  const ordered = [pref, ...RUNWAY_KINDS.filter(k => k !== pref)];
  for (const kind of ordered) {
    const status = runways[kind] || "";
    const row = document.createElement("div");
    row.className = "cp-runway-row";
    if (kind === pref) row.classList.add("preferred");
    const left = document.createElement("div");
    left.innerHTML = '<span class="' + runwayDotClass(status) + '"></span>' +
      '<span class="cp-runway-name">' + kind + '</span>';
    const right = document.createElement("div");
    right.textContent = runwayStatusLabel(status);
    row.appendChild(left);
    row.appendChild(right);
    wrap.appendChild(row);
  }
}

function pickPreferredRunway(airportKey) {
  const runways = state.runways[airportKey] || {};
  const pref = state.settings.runwayPref || "MAIN";
  const order = [pref, ...RUNWAY_KINDS.filter(k => k !== pref)];
  // Prefer free runways; any non-occupied beats occupied
  for (const kind of order) {
    const s = runways[kind];
    if (s && s !== "occupied") return { kind, status: s };
  }
  // Fallback: anything
  for (const kind of order) {
    if (runways[kind]) return { kind, status: runways[kind] };
  }
  return { kind: pref, status: "" };
}

function callATC() {
  const { airport } = nearestAirport();
  if (!airport) { showToast("No nearby airport"); return; }
  const pick = pickPreferredRunway(airport.key);
  const atcAirport = resolveAtcAirportKey(airport.key);
  const cmd = "atc-call " + atcAirport + " " + pick.kind;
  sendCommand(cmd);
  sendNotification("Cargo Pilot: ATC call -> " + airport.label + " " + pick.kind);
  showToast("ATC: " + airport.label + " " + pick.kind);
}

function toggleLandingGear() {
  sendCommand("landing-gear");
  showToast("Landing gear toggled");
}

// ---------- Cargo inventory ----------
function parseInventory(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    const p = JSON.parse(raw);
    return (p && typeof p === "object") ? p : null;
  } catch { return null; }
}

function isCargoItem(id) {
  if (!id) return false;
  const lid = String(id).toLowerCase();
  return lid.includes("cargo") || lid.includes("crate") || lid.includes("pallet") ||
    lid.includes("parcel") || lid.includes("package") || lid.includes("freight");
}

function renderCargoInventory() {
  const listEl = document.getElementById("cp-cargo-inv");
  const trunkEl = document.getElementById("cp-cargo-trunk");
  const weightEl = document.getElementById("cp-cargo-weight");
  if (!listEl || !trunkEl) return;

  listEl.innerHTML = "";
  trunkEl.innerHTML = "";

  let personHas = false;
  const inv = state.inventoryObj;
  if (inv && typeof inv === "object") {
    for (const [id, entry] of Object.entries(inv)) {
      const amount = typeof entry === "object" ? (entry.amount ?? entry.count ?? 0) : entry;
      if (!amount) continue;
      if (!isCargoItem(id)) continue;
      personHas = true;
      const row = document.createElement("div");
      row.className = "cp-cargo-item";
      row.innerHTML = '<span class="cp-cargo-name">' + escapeHtml(String(id)) + '</span>' +
        '<span class="cp-cargo-qty">&times;' + escapeHtml(String(amount)) + '</span>';
      listEl.appendChild(row);
    }
  }
  listEl.classList.toggle("cp-empty", !personHas);
  if (!personHas) listEl.textContent = "(empty)";

  // Plane trunk: parse any chest_* key that contains cargo
  let trunkHas = false;
  for (const [key, value] of Object.entries(state.cache)) {
    if (!key.startsWith("chest_")) continue;
    const parsed = parseInventory(value);
    if (!parsed) continue;
    for (const [id, entry] of Object.entries(parsed)) {
      const amount = typeof entry === "object" ? (entry.amount ?? entry.count ?? 0) : entry;
      if (!amount) continue;
      if (!isCargoItem(id)) continue;
      trunkHas = true;
      const row = document.createElement("div");
      row.className = "cp-cargo-item";
      row.innerHTML = '<span class="cp-cargo-name">' + escapeHtml(String(id)) + '</span>' +
        '<span class="cp-cargo-qty">&times;' + escapeHtml(String(amount)) + '</span>';
      trunkEl.appendChild(row);
    }
  }
  trunkEl.classList.toggle("cp-empty", !trunkHas);
  if (!trunkHas) trunkEl.textContent = "(empty)";

  if (weightEl) {
    if (state.weight != null && state.maxWeight != null) {
      weightEl.textContent = "Weight: " + Number(state.weight).toFixed(1) + " / " +
        Number(state.maxWeight).toFixed(1);
    } else {
      weightEl.textContent = "Weight: -- / --";
    }
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Transformer automation ----------
function coerceBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1";
  }
  return Boolean(v);
}
function normalizeChoices(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function choiceText(choice) {
  if (!choice) return "";
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) return String(choice[0] ?? "");
  return "";
}

function findChoiceContaining(tokens) {
  const lowered = tokens.map(t => t.toLowerCase());
  for (const c of state.menuChoices) {
    const t = choiceText(c).toLowerCase();
    if (lowered.every(tok => t.includes(tok))) return choiceText(c);
  }
  return null;
}

function forceChoice(label) {
  post({ type: "forceMenuChoice", choice: label, mod: 0 });
}

function tryTransformerAutomation() {
  if (!state.settings.autoTransformer) return;
  if (state.isAutomating) return;
  if (state.menuSessionAutomated) return;
  if (!state.menuOpen) return;
  if (!Array.isArray(state.menuChoices) || state.menuChoices.length === 0) return;

  const menuTitle = String(state.cache.menu || "").toLowerCase();
  const choiceBlob = state.menuChoices.map(choiceText).join(" | ").toLowerCase();
  const isCargoMenu = menuTitle.includes("cargo") || menuTitle.includes("transformer") ||
    choiceBlob.includes("cargo") || choiceBlob.includes("pickup") || choiceBlob.includes("sell");
  if (!isCargoMenu) return;

  state.isAutomating = true;
  state.menuSessionAutomated = true;

  const { airport } = nearestAirport();
  const airportKey = airport ? airport.key : null;
  const isPickup = airportKey === "SSIA"; // first airport is pickup-only

  (async () => {
    try {
      if (!isPickup) {
        // Try sell first
        const sellChoice = findChoiceContaining(["sell"]) ||
          findChoiceContaining(["deliver"]) ||
          findChoiceContaining(["unload"]);
        if (sellChoice) {
          forceChoice(sellChoice);
          showToast("Auto-sell: " + sellChoice);
          await sleep(800);
          // Reopen transformer for pickup
          post({ type: "forceMenuBack" });
          await sleep(300);
          sendCommand("vrp-reopen");
          await sleep(600);
        }
      }

      // Pickup
      const pickChoice = findChoiceContaining(["pickup"]) ||
        findChoiceContaining(["take", "cargo"]) ||
        findChoiceContaining(["load"]);
      if (pickChoice) {
        forceChoice(pickChoice);
        showToast("Auto-pickup: " + pickChoice);
      }
    } finally {
      state.isAutomating = false;
      // Re-assert the session guard. The sell flow itself closes+reopens the
      // menu via forceMenuBack/vrp-reopen, and each transition flips
      // menuSessionAutomated back to false in handleIncoming. Without this
      // re-assert the next poll would run the full sell+pickup sequence again.
      state.menuSessionAutomated = true;
    }
  })();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- AFK detection ----------
function checkAfk() {
  if (!state.settings.afkAlertEnabled) return;
  if (!state.isPilotJob) return;
  if (state.pos.x == null) return;

  const now = Date.now();
  if (!state.lastAfkPos) {
    state.lastAfkPos = { x: state.pos.x, y: state.pos.y };
    state.lastAfkMoveAt = now;
    return;
  }
  const dx = state.pos.x - state.lastAfkPos.x;
  const dy = state.pos.y - state.lastAfkPos.y;
  const moved = Math.sqrt(dx * dx + dy * dy);
  if (moved > AFK_MOVE_EPSILON) {
    state.lastAfkPos = { x: state.pos.x, y: state.pos.y };
    state.lastAfkMoveAt = now;
    return;
  }
  const idleMs = now - state.lastAfkMoveAt;
  if (idleMs >= state.settings.afkTimeoutSec * 1000) {
    if (now - state.lastAlertAt >= ALERT_COOLDOWN_MS) {
      state.lastAlertAt = now;
      sendSfx(9);
      sendNotification("Cargo Pilot: AFK for " + Math.floor(idleMs / 1000) + "s");
      showToast("AFK alert");
    }
  }
}

// ---------- UI visibility ----------
function updateVisibility() {
  const main = document.getElementById("cp-main");
  if (!main) return;
  const shouldShow = state.isPilotJob && state.inOwnAircraft;
  if (shouldShow) {
    main.classList.remove("hidden");
  } else {
    main.classList.add("hidden");
    // Also hide sub-panels when not in job/vehicle
    document.getElementById("cp-runway-panel")?.classList.add("hidden");
    document.getElementById("cp-cargo-panel")?.classList.add("hidden");
    document.getElementById("cp-settings-panel")?.classList.add("hidden");
  }

  // Status pill
  const statusEl = document.getElementById("cp-status");
  if (statusEl) {
    if (!state.isPilotJob) {
      statusEl.textContent = "Not Cargo Job";
      statusEl.className = "cp-pill cp-pill-idle";
    } else if (state.onFoot) {
      statusEl.textContent = "On Foot";
      statusEl.className = "cp-pill cp-pill-warn";
    } else {
      statusEl.textContent = "Flying";
      statusEl.className = "cp-pill cp-pill-active";
    }
  }

  const gearEl = document.getElementById("cp-gear-state");
  if (gearEl) gearEl.textContent = "Landing gear: " + (state.landingGear || "--");

  const bxpEl = document.getElementById("cp-bxp");
  if (bxpEl) bxpEl.textContent = state.bxp != null ? Number(state.bxp).toLocaleString() : "--";
}

// ---------- Data ingestion ----------
function handleIncoming(data) {
  if (!data || typeof data !== "object") return;

  const toFiniteNumber = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return null;
      const parsed = Number(t);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  for (const [key, value] of Object.entries(data)) {
    if (key === "menu_choices") {
      state.menuChoices = normalizeChoices(value);
    } else if (key === "menu_open") {
      const wasOpen = state.menuOpen;
      state.menuOpen = coerceBool(value);
      state.cache[key] = state.menuOpen;
      if (!wasOpen && state.menuOpen) {
        state.menuSessionAutomated = false;
        setTimeout(tryTransformerAutomation, 150);
      } else if (wasOpen && !state.menuOpen) {
        state.menuSessionAutomated = false;
      }
    } else if (key.startsWith("runway_")) {
      ingestRunway(key, value);
      state.cache[key] = value;
    } else {
      state.cache[key] = value;
    }
  }

  // Job — use || so an empty string in data.job falls through to job_name/job_title.
  const rawJob = data.job || data.job_name || data.job_title;
  if (typeof rawJob === "string") {
    state.job = rawJob;
    const norm = rawJob.toLowerCase();
    state.isPilotJob = norm.includes(REQUIRED_JOB) || norm.includes("cargo pilot");
  }

  // Vehicle
  if (typeof data.vehicle === "string") {
    state.vehicle = data.vehicle;
    state.onFoot = data.vehicle === "onFoot";
  }
  // data.aircraft is the OWNED spawned aircraft model name — it does not imply
  // the player is currently inside it. Only mark as in-own-aircraft when the
  // current occupied vehicle matches the spawned aircraft model.
  if (typeof data.aircraft === "string") {
    state.aircraftModel = data.aircraft;
  }
  state.inOwnAircraft = Boolean(
    state.aircraftModel && state.vehicle && state.vehicle !== "onFoot" &&
      String(state.vehicle).toLowerCase() === String(state.aircraftModel).toLowerCase()
  );

  // Position
  const posX = toFiniteNumber(data.pos_x);
  const posY = toFiniteNumber(data.pos_y);
  if (posX != null) state.pos.x = posX;
  if (posY != null) state.pos.y = posY;

  // Landing gear
  if (typeof data.landing_gear === "string") state.landingGear = data.landing_gear;

  // Weight / inventory
  const weight = toFiniteNumber(data.weight);
  const maxWeight = toFiniteNumber(data.max_weight);
  if (weight != null) state.weight = weight;
  if (maxWeight != null) state.maxWeight = maxWeight;
  const inv = parseInventory(data.inventory);
  if (inv) state.inventoryObj = inv;

  // BXP
  const bxp = toFiniteNumber(data[BXP_KEY]);
  if (bxp != null) state.bxp = bxp;

  // Triggers (game sends as trigger_<name>; detect edge per pizza-job pattern)
  handleTrigger(NEXT_LEG_TRIGGER, () => advanceLeg(false));
  handleTrigger(ATC_TRIGGER, callATC);
  handleTrigger(GEAR_TRIGGER, toggleLandingGear);

  // Auto advance
  if (state.isPilotJob && state.inOwnAircraft) advanceLegIfArrived();

  // Menu re-check in case choices arrived after menu_open in a later payload.
  // Guarded by state.menuSessionAutomated so we don't re-fire per poll.
  if (state.menuOpen && state.menuChoices.length > 0 && !state.menuSessionAutomated) {
    setTimeout(tryTransformerAutomation, 150);
  }

  renderAll();
}

function renderAll() {
  renderRoute();
  renderRunways();
  renderCargoInventory();
  updateVisibility();
}

window.addEventListener("message", (event) => {
  const envelope = event.data;
  if (!envelope || typeof envelope !== "object") return;
  const data = (envelope.data && typeof envelope.data === "object")
    ? envelope.data
    : (envelope.payload && typeof envelope.payload === "object")
      ? envelope.payload
      : envelope;
  handleIncoming(data);
});

// ---------- Init ----------
function initSettingsUI() {
  const fontInput = document.getElementById("cp-font-input");
  const bgInput = document.getElementById("cp-bg-input");
  const themeSel = document.getElementById("cp-theme-select");
  const prefSel = document.getElementById("cp-runway-pref");
  const autoChk = document.getElementById("cp-auto-transformer");
  const afkChk = document.getElementById("cp-afk-alert");
  const afkInput = document.getElementById("cp-afk-input");
  const afkVal = document.getElementById("cp-afk-val");

  if (fontInput) {
    fontInput.value = String(state.settings.fontScale);
    fontInput.addEventListener("input", () => {
      state.settings.fontScale = parseFloat(fontInput.value);
      applyFontScale();
      saveSettings();
    });
  }
  if (bgInput) {
    bgInput.value = String(state.settings.bgOpacity);
    bgInput.addEventListener("input", () => {
      state.settings.bgOpacity = parseFloat(bgInput.value);
      applyBgOpacity();
      saveSettings();
    });
  }
  if (themeSel) {
    themeSel.value = state.settings.theme;
    themeSel.addEventListener("change", () => {
      state.settings.theme = themeSel.value;
      applyTheme();
      saveSettings();
    });
  }
  if (prefSel) {
    prefSel.value = state.settings.runwayPref;
    prefSel.addEventListener("change", () => {
      state.settings.runwayPref = prefSel.value;
      saveSettings();
      renderRunways();
    });
  }
  if (autoChk) {
    autoChk.checked = Boolean(state.settings.autoTransformer);
    autoChk.addEventListener("change", () => {
      state.settings.autoTransformer = autoChk.checked;
      saveSettings();
    });
  }
  if (afkChk) {
    afkChk.checked = Boolean(state.settings.afkAlertEnabled);
    afkChk.addEventListener("change", () => {
      state.settings.afkAlertEnabled = afkChk.checked;
      saveSettings();
    });
  }
  if (afkInput) {
    afkInput.value = String(state.settings.afkTimeoutSec);
    if (afkVal) afkVal.textContent = String(state.settings.afkTimeoutSec);
    afkInput.addEventListener("input", () => {
      state.settings.afkTimeoutSec = parseInt(afkInput.value, 10) || 60;
      if (afkVal) afkVal.textContent = String(state.settings.afkTimeoutSec);
      saveSettings();
    });
  }
}

function initHeaderButtons() {
  document.getElementById("cp-btn-runway")?.addEventListener("click", () => togglePanel("cp-runway-panel"));
  document.getElementById("cp-btn-cargo")?.addEventListener("click", () => togglePanel("cp-cargo-panel"));
  document.getElementById("cp-btn-settings")?.addEventListener("click", () => togglePanel("cp-settings-panel"));
  document.getElementById("cp-btn-opacity")?.addEventListener("click", cycleOpacity);
  document.getElementById("cp-btn-min")?.addEventListener("click", () => {
    const panel = document.getElementById("cp-main");
    if (panel) panel.classList.toggle("minimized");
  });

  document.getElementById("cp-btn-next-leg")?.addEventListener("click", () => advanceLeg(false));
  document.getElementById("cp-btn-set-gps")?.addEventListener("click", () => {
    const { to } = currentLeg();
    setBlipRoute(to);
    showToast("GPS set to " + to.label);
  });
  document.getElementById("cp-btn-toggle-gear")?.addEventListener("click", toggleLandingGear);
  document.getElementById("cp-btn-call-atc")?.addEventListener("click", callATC);

  // Close buttons on sub-panels
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sel = btn.getAttribute("data-close");
      if (sel) {
        document.querySelector(sel)?.classList.add("hidden");
        savePanelLayouts();
      }
    });
  });
}

function initDragResize() {
  document.addEventListener("pointerdown", onPanelPointerDown);
  document.addEventListener("pointermove", onPanelPointerMove);
  document.addEventListener("pointerup", onPanelPointerUp);
  window.addEventListener("blur", onPanelPointerUp);
}

function initKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      post({ type: "pin" });
    }
  });
}

function init() {
  loadSettings();
  loadOpacity();
  state.routeIndex = parseInt(localStorage.getItem(STORAGE.routeIndex) || "0", 10) || 0;

  applyTheme();
  applyFontScale();
  applyBgOpacity();

  initSettingsUI();
  initHeaderButtons();
  initDragResize();
  initKeyboard();
  loadPanelLayouts();

  registerTriggers();

  renderAll();

  // Polling / checks
  requestData();
  setInterval(requestData, 4000);
  setInterval(checkAfk, 2000);
  setInterval(savePanelLayouts, 10000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

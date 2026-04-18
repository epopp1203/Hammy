// Disable console logging to reduce FiveM log file spam
if (typeof console !== 'undefined') {
  console.log = function() {};
  console.warn = function() {};
  console.info = function() {};
  console.debug = function() {};
}

const REQUIRED_JOB = "miner"
let isMinerJob = false;
let lastWeight = null;
let lastMaxWeight = null;
let lastInventoryObj = null;
let sessionStartTime = null;
let sessionTimerId = null;
let isMinimized = false;
let isHorizontal = false;
let sessionTotalMined = 0;
let lastTotalOre = 0;
let hasInitialized = false;
let inventoryAlertTriggered = false;
let INVENTORY_ALERT_THRESHOLD = parseInt(localStorage.getItem("miningTracker_threshold")) || 95;
let isMuted = localStorage.getItem("miningTracker_muted") === "true";
let lastAlertPlayedAt = 0;
const ALERT_COOLDOWN_MS = 25000;

// Session persistence
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
let sessionExchangeCount = 0;

// Opacity cycling
const OPACITY_LEVELS = [0.95, 0.70, 0.40, 0.20];
let opacityIndex = parseInt(localStorage.getItem("miningTracker_opacity") || "0");

// Auto-exchange toggle
let autoExchangeEnabled = localStorage.getItem("miningTracker_autoExchange") !== "false";

// Inventory ETA
const weightHistory = [];
const WEIGHT_HISTORY_MS = 5 * 60 * 1000;

// HUD debounce
let hudDebounceTimer = null;

// Waiting state
let waitingStateTimer = null;
let lastDataUpdateAt = 0;
let dataHealthTimerId = null;
const DATA_DELAYED_MS = 5000;
const DATA_STALE_MS = 15000;

// NEW: one-shot initial request + capped retry
let hasRequestedInitialData = false;
let initialDataRetryTimer = null;
let initialDataRetries = 0;
const MAX_INITIAL_RETRIES = 3;

const ORE_KEYS = ["mining_copper", "mining_iron"];
const oreLog = {
  mining_copper: [],
  mining_iron: []
};
const hasFirstGain = {
  mining_copper: false,
  mining_iron: false
};
const RECENT_WINDOW_MS = 2 * 60 * 1000;

window.state = { cache: {} };

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let windowStartX = 0;
let windowStartY = 0;

function coerceMenuOpen(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") return false;
  }
  return Boolean(value);
}

function normalizeMenuChoices(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseInventoryValue(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === "object") return rawValue;
  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function initializeDragging() {
  const draggableWindow = document.getElementById("draggableWindow");
  const header = document.querySelector(".dashboard-header");
  
  if (!draggableWindow || !header) return;
  
  const savedPosition = getSavedPosition();
  if (savedPosition) {
    draggableWindow.style.left = savedPosition.x + "px";
    draggableWindow.style.top = savedPosition.y + "px";
  }
  
  header.style.cursor = "move";
  header.addEventListener("mousedown", startDragging);
  document.addEventListener("mousemove", drag);
  document.addEventListener("mouseup", stopDragging);
  
  const minimizeBtn = document.getElementById("minimizeBtn");
  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", toggleMinimize);
  }
  
  const layoutBtn = document.getElementById("layoutBtn");
  if (layoutBtn) {
    layoutBtn.addEventListener("click", toggleLayout);
  }
  
  const savedLayout = getSavedLayout();
  if (savedLayout === "horizontal") {
    toggleLayout(false);
  }
}

function toggleMinimize() {
  const container = document.getElementById("draggableWindow");
  isMinimized = !isMinimized;
  
  if (isMinimized) {
    container.classList.add("minimized");
  } else {
    container.classList.remove("minimized");
  }
}

function toggleLayout(save = true) {
  const container = document.getElementById("draggableWindow");
  const layoutBtn = document.getElementById("layoutBtn");
  
  isHorizontal = !isHorizontal;
  
  if (isHorizontal) {
    container.classList.add("horizontal");
    if (layoutBtn) {
      layoutBtn.innerHTML = '<i class="fas fa-arrows-alt-v"></i>';
      layoutBtn.title = "Layout: Toggle vertical/horizontal";
      layoutBtn.setAttribute("data-tooltip", "Layout: Horizontal now");
    }
  } else {
    container.classList.remove("horizontal");
    if (layoutBtn) {
      layoutBtn.innerHTML = '<i class="fas fa-arrows-alt-h"></i>';
      layoutBtn.title = "Layout: Toggle vertical/horizontal";
      layoutBtn.setAttribute("data-tooltip", "Layout: Vertical now");
    }
  }
  
  if (save) {
    saveLayout();
  }
}

function saveLayout() {
  const layout = isHorizontal ? "horizontal" : "vertical";
  localStorage.setItem("miningTracker_layout", layout);
}

function getSavedLayout() {
  try {
    return localStorage.getItem("miningTracker_layout");
  } catch {
    return null;
  }
}

function startDragging(e) {
  isDragging = true;
  const draggableWindow = document.getElementById("draggableWindow");
  
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  
  const rect = draggableWindow.getBoundingClientRect();
  windowStartX = rect.left;
  windowStartY = rect.top;
  
  e.preventDefault();
}

function drag(e) {
  if (!isDragging) return;
  
  const draggableWindow = document.getElementById("draggableWindow");
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;
  
  const newX = windowStartX + deltaX;
  const newY = windowStartY + deltaY;
  
  const maxX = window.innerWidth - draggableWindow.offsetWidth;
  const maxY = window.innerHeight - draggableWindow.offsetHeight;
  
  const boundedX = Math.max(0, Math.min(newX, maxX));
  const boundedY = Math.max(0, Math.min(newY, maxY));
  
  draggableWindow.style.left = boundedX + "px";
  draggableWindow.style.top = boundedY + "px";
}

function stopDragging() {
  if (isDragging) {
    isDragging = false;
    savePosition();
  }
}

function savePosition() {
  const draggableWindow = document.getElementById("draggableWindow");
  const rect = draggableWindow.getBoundingClientRect();
  
  const position = {
    x: rect.left,
    y: rect.top
  };
  
  localStorage.setItem("miningTracker_position", JSON.stringify(position));
}

function getSavedPosition() {
  try {
    const saved = localStorage.getItem("miningTracker_position");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function toggleUI(visible) {
  document.getElementById("draggableWindow").style.display = visible ? "block" : "none";
  if (visible && !sessionStartTime) {
    sessionStartTime = Date.now();
    startSessionTimer();
  }
  if (!visible && sessionStartTime && (sessionTotalMined > 0 || sessionExchangeCount > 0)) {
    showSessionSummary();
  }
}

function startSessionTimer() {
  if (sessionTimerId) return;
  sessionTimerId = setInterval(updateSessionTime, 1000);
}

function updateSessionTime() {
  if (!sessionStartTime) return;
  
  const elapsed = Date.now() - sessionStartTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  
  const sessionTimeEl = document.getElementById("session-time");
  if (sessionTimeEl) {
    sessionTimeEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

function updateInventoryWarningState(isWarning) {
  const inventoryCard = document.querySelector('.inventory-card');
  const warningBadge = document.getElementById('alert-warning-badge');

  if (inventoryCard) {
    inventoryCard.classList.toggle('alerting', isWarning);
  }
  if (warningBadge) {
    warningBadge.hidden = !isWarning;
  }
}

function playInventoryAlertSound() {

  if (isMuted) return; // Exit if muted

  const now = Date.now();
  if (now - lastAlertPlayedAt < ALERT_COOLDOWN_MS) return;

  const alertAudio = document.getElementById('alertSound');

  if (alertAudio) {

    alertAudio.currentTime = 0;

    alertAudio.play().catch(() => {});

    lastAlertPlayedAt = now;

  }

}
function initializeAlertSettings() {

  const muteBtn = document.getElementById("muteBtn");

  const thresholdSelect = document.getElementById("thresholdSelect");


  if (isMuted) updateMuteUI();

  if (thresholdSelect) thresholdSelect.value = INVENTORY_ALERT_THRESHOLD;


  if (muteBtn) {

    muteBtn.addEventListener("click", () => {

      isMuted = !isMuted;

      localStorage.setItem("miningTracker_muted", isMuted);

      updateMuteUI();

    });

  }


  if (thresholdSelect) {

    thresholdSelect.addEventListener("change", (e) => {

      INVENTORY_ALERT_THRESHOLD = parseInt(e.target.value);

      localStorage.setItem("miningTracker_threshold", INVENTORY_ALERT_THRESHOLD);

    });

  }

}


function updateMuteUI() {

  const muteBtn = document.getElementById("muteBtn");

  if (!muteBtn) return;

  const icon = muteBtn.querySelector("i");

  if (isMuted) {

    muteBtn.classList.add("muted");

    icon.className = "fas fa-volume-mute";
    muteBtn.setAttribute("data-tooltip", "Sound Muted");

  } else {

    muteBtn.classList.remove("muted");

    icon.className = "fas fa-volume-up";
    muteBtn.setAttribute("data-tooltip", "Sound On");

  }

}

function saveSessionData() {
  if (!sessionStartTime) return;
  try {
    const data = {
      startTime: sessionStartTime,
      totalMined: sessionTotalMined,
      lastTotalOre: lastTotalOre,
      exchangeCount: sessionExchangeCount,
      timestamp: Date.now()
    };
    localStorage.setItem("miningTracker_session", JSON.stringify(data));
  } catch {}
}

function loadSessionData() {
  try {
    const saved = localStorage.getItem("miningTracker_session");
    if (!saved) return;
    const data = JSON.parse(saved);
    if (Date.now() - data.timestamp > SESSION_TTL_MS) {
      localStorage.removeItem("miningTracker_session");
      return;
    }
    sessionStartTime = data.startTime || null;
    sessionTotalMined = data.totalMined || 0;
    lastTotalOre = data.lastTotalOre || 0;
    sessionExchangeCount = data.exchangeCount || 0;
    const exchEl = document.getElementById("total-exchanges");
    if (exchEl) exchEl.textContent = sessionExchangeCount.toLocaleString();
    if (sessionStartTime) startSessionTimer();
  } catch {}
}

function resetSessionMetrics() {
  sessionStartTime = Date.now();
  sessionTotalMined = 0;
  lastTotalOre = 0;
  sessionExchangeCount = 0;
  lastIronVoucherCount = null;
  lastCopperVoucherCount = null;

  for (const ore of ORE_KEYS) {
    oreLog[ore] = [];
    hasFirstGain[ore] = false;
  }

  try {
    localStorage.removeItem("miningTracker_session");
  } catch {}

  const exchEl = document.getElementById("total-exchanges");
  const minedEl = document.getElementById("total-mined");
  const vouchersEl = document.getElementById("total-vouchers");
  const sessionTimeEl = document.getElementById("session-time");

  if (exchEl) exchEl.textContent = "0";
  if (minedEl) minedEl.textContent = "0";
  if (vouchersEl) vouchersEl.textContent = "0";
  if (sessionTimeEl) sessionTimeEl.textContent = "00:00:00";

  weightHistory.length = 0;
  saveSessionData();
}

function getSessionSummaryText() {
  const now = Date.now();
  const elapsed = sessionStartTime ? now - sessionStartTime : 0;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  const copperOre = lastInventoryObj?.mining_copper?.amount ?? 0;
  const ironOre = lastInventoryObj?.mining_iron?.amount ?? 0;
  const copperVouchers = lastInventoryObj?.mining_token_copper?.amount ?? 0;
  const ironVouchers = lastInventoryObj?.mining_token_iron?.amount ?? 0;

  return [
    "Mining Dashboard Session Summary",
    `Session Time: ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
    `Total Mined: ${(sessionTotalMined + copperOre + ironOre).toLocaleString()}`,
    `Current Ore - Copper: ${copperOre.toLocaleString()}, Iron: ${ironOre.toLocaleString()}`,
    `Total Vouchers: ${(copperVouchers + ironVouchers).toLocaleString()}`,
    `Exchanges: ${sessionExchangeCount.toLocaleString()}`
  ].join("\n");
}

async function copySessionSummary() {
  const copyBtn = document.getElementById("copySummaryBtn");
  const text = getSessionSummaryText();
  let copied = false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {}
  }

  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    document.body.removeChild(textarea);
  }

  if (copyBtn) {
    copyBtn.title = copied
      ? "Copy: Summary copied"
      : "Copy: Clipboard blocked";
    copyBtn.setAttribute(
      "data-tooltip",
      copied
        ? "Copy: Summary copied"
        : "Copy: Clipboard blocked"
    );
  }

  if (copied) {
    window.parent.postMessage({ type: "notification", text: "Mining summary copied to clipboard." }, "*");
  }
}

function initializeSessionButtons() {
  const resetBtn = document.getElementById("resetSessionBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetSessionMetrics();
      if (lastWeight !== null && lastMaxWeight !== null && lastInventoryObj) {
        updateHUD(lastWeight, lastMaxWeight);
      }
      resetBtn.title = "Reset: Session reset";
      resetBtn.setAttribute("data-tooltip", "Reset: Session reset");
      window.parent.postMessage({ type: "notification", text: "Mining session metrics reset." }, "*");
    });
  }

  const copyBtn = document.getElementById("copySummaryBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      copySessionSummary();
    });
  }
}

function updateDataHealthStatus() {
  const statusEl = document.getElementById("data-status");
  if (!statusEl) return;

  const ageMs = lastDataUpdateAt ? (Date.now() - lastDataUpdateAt) : Number.POSITIVE_INFINITY;

  statusEl.classList.remove("live", "delayed", "stale");
  if (ageMs < DATA_DELAYED_MS) {
    statusEl.classList.add("live");
    statusEl.textContent = "Live";
    statusEl.title = "Data Health: receiving fresh updates";
  } else if (ageMs < DATA_STALE_MS) {
    statusEl.classList.add("delayed");
    statusEl.textContent = "Delayed";
    statusEl.title = "Data Health: updates slowed, waiting for next payload";
  } else {
    statusEl.classList.add("stale");
    statusEl.textContent = hasInitialized ? "Stale" : "Waiting";
    statusEl.title = hasInitialized
      ? "Data Health: no update recently, data may be stale"
      : "Data Health: waiting for initial data";
  }
}

function startDataHealthMonitor() {
  if (dataHealthTimerId) return;
  updateDataHealthStatus();
  dataHealthTimerId = setInterval(updateDataHealthStatus, 1000);
}

function showSessionSummary() {
  const elapsed = Date.now() - sessionStartTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  const copperVouchers = lastInventoryObj?.mining_token_copper?.amount ?? 0;
  const ironVouchers = lastInventoryObj?.mining_token_iron?.amount ?? 0;
  const toast = document.getElementById("session-toast");
  const body = document.getElementById("toast-body");
  if (toast && body) {
    body.innerHTML = `
      <div>Time: ${timeStr}</div>
      <div>Mined: ${sessionTotalMined.toLocaleString()}</div>
      <div>Vouchers: ${(copperVouchers + ironVouchers).toLocaleString()}</div>
      <div>Exchanges: ${sessionExchangeCount.toLocaleString()}</div>
    `;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 6000);
  }
}

function updateMinimizedStats() {
  const stats = document.getElementById("minimized-stats");
  if (!stats) return;
  const pct = (lastWeight != null && lastMaxWeight != null)
    ? Math.round((lastWeight / lastMaxWeight) * 100)
    : "--";
  const cu = lastInventoryObj?.mining_copper?.amount ?? 0;
  stats.textContent = `${pct}% ${cu}`;
}

function updateInventoryETA(weight, maxWeight) {
  const etaEl = document.getElementById("inv-eta");
  if (!etaEl) return;
  const now = Date.now();
  weightHistory.push({ time: now, weight });
  while (weightHistory.length > 1 && now - weightHistory[0].time > WEIGHT_HISTORY_MS) {
    weightHistory.shift();
  }
  if (weightHistory.length < 2) { etaEl.textContent = ""; return; }
  const oldest = weightHistory[0];
  const elapsed = now - oldest.time;
  const gained = weight - oldest.weight;
  if (gained <= 0 || elapsed <= 0) { etaEl.textContent = ""; return; }
  const fillRatePerMs = gained / elapsed;
  const remaining = maxWeight - weight;
  const etaMs = remaining / fillRatePerMs;
  if (etaMs <= 0) { etaEl.textContent = ""; return; }
  const etaMins = Math.round(etaMs / 60000);
  if (etaMins <= 0) {
    etaEl.textContent = "Full <1m";
  } else if (etaMins < 60) {
    etaEl.textContent = `Full ~${etaMins}m`;
  } else {
    const h = Math.floor(etaMins / 60);
    const m = etaMins % 60;
    etaEl.textContent = `Full ~${h}h${m}m`;
  }
}

function initializeAutoExchangeBtn() {
  const btn = document.getElementById("autoExchangeBtn");
  if (!btn) return;
  updateAutoExchangeUI();
  btn.addEventListener("click", () => {
    autoExchangeEnabled = !autoExchangeEnabled;
    localStorage.setItem("miningTracker_autoExchange", autoExchangeEnabled);
    updateAutoExchangeUI();
  });
}

function updateAutoExchangeUI() {
  const btn = document.getElementById("autoExchangeBtn");
  if (!btn) return;
  if (autoExchangeEnabled) {
    btn.classList.add("active");
    btn.title = "Auto On";
    btn.setAttribute("data-tooltip", "Auto On");
  } else {
    btn.classList.remove("active");
    btn.title = "Auto Off";
    btn.setAttribute("data-tooltip", "Auto Off");
  }
}

function initializeOpacityBtn() {
  const btn = document.getElementById("opacityBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    opacityIndex = (opacityIndex + 1) % OPACITY_LEVELS.length;
    localStorage.setItem("miningTracker_opacity", opacityIndex);
    applyOpacity();
  });
}

function applyOpacity() {
  const container = document.getElementById("draggableWindow");
  if (container) {
    container.style.background = `rgba(15, 23, 35, ${OPACITY_LEVELS[opacityIndex]})`;
  }
}

function startWaitingStateTimer() {
  waitingStateTimer = setTimeout(() => {
    if (!hasInitialized) {
      const ws = document.getElementById("waiting-state");
      if (ws) ws.hidden = false;
    }
  }, 2000);
}

function checkInventoryThreshold(percentage) {
  const isWarning = percentage > INVENTORY_ALERT_THRESHOLD;

  if (isWarning) {
    if (!inventoryAlertTriggered) {
      inventoryAlertTriggered = true;
      playInventoryAlertSound();
    }
  } else {
    inventoryAlertTriggered = false;
  }

  updateInventoryWarningState(isWarning);
}

function updateHUD(weight, maxWeight) {
  const invCurrent = document.getElementById("inv-current");
  const invMax = document.getElementById("inv-max");
  const invPercent = document.getElementById("inv-percent");
  const inventoryProgress = document.getElementById("inventoryProgress");

  const roundedWeight = weight !== null ? weight.toFixed(1) : "--";
  const roundedMax = maxWeight !== null ? maxWeight.toFixed(1) : "--";
  const hasValidWeight = (weight != null && maxWeight != null && maxWeight > 0);
  const invPercentValue = hasValidWeight ? ((weight / maxWeight) * 100).toFixed(1) : "--";
  
  if (invCurrent) invCurrent.textContent = roundedWeight;
  if (invMax) invMax.textContent = roundedMax;
  if (invPercent) invPercent.textContent = invPercentValue + "%";
  
  if (hasValidWeight) {
    const percentage = (weight / maxWeight) * 100;
    if (inventoryProgress) {
      inventoryProgress.style.width = percentage + "%";
      if (percentage >= 90) {
        inventoryProgress.classList.add('danger');
        inventoryProgress.classList.remove('warn');
      } else if (percentage >= 70) {
        inventoryProgress.classList.add('warn');
        inventoryProgress.classList.remove('danger');
      } else {
        inventoryProgress.classList.remove('warn', 'danger');
      }
    }
    checkInventoryThreshold(percentage);
    updateInventoryETA(weight, maxWeight);
  }

  const copperRate = getOreRate("mining_copper");
  const copperTotal = document.getElementById("copper-total");
  const copperVouchers = document.getElementById("copper-vouchers");
  const copperHr = document.getElementById("copper-hr");
  const copperMin = document.getElementById("copper-min");

  const copperAmount = lastInventoryObj?.mining_copper?.amount ?? 0;
  const copperVoucherCount = lastInventoryObj?.mining_token_copper?.amount ?? 0;

  if (copperTotal) {
    copperTotal.textContent = copperAmount.toLocaleString();
    if (copperAmount === 0) {
      copperTotal.classList.add('ore-zero');
    } else {
      copperTotal.classList.remove('ore-zero');
    }
  }
  if (copperVouchers) copperVouchers.textContent = copperVoucherCount.toLocaleString();
  if (copperHr) copperHr.textContent = copperRate.hr.toLocaleString();
  if (copperMin) copperMin.textContent = copperRate.min;

  const copperTrendEl = document.getElementById("copper-trend");
  if (copperTrendEl) {
    if (copperRate.trend === 1)       { copperTrendEl.textContent = '▲'; copperTrendEl.className = 'rate-trend trend-up'; }
    else if (copperRate.trend === -1) { copperTrendEl.textContent = '▼'; copperTrendEl.className = 'rate-trend trend-down'; }
    else                              { copperTrendEl.textContent = '—'; copperTrendEl.className = 'rate-trend trend-neutral'; }
  }

  const ironRate = getOreRate("mining_iron");
  const ironTotal = document.getElementById("iron-total");
  const ironVouchers = document.getElementById("iron-vouchers");
  const ironHr = document.getElementById("iron-hr");
  const ironMin = document.getElementById("iron-min");

  const ironAmount = lastInventoryObj?.mining_iron?.amount ?? 0;
  const ironVoucherCount = lastInventoryObj?.mining_token_iron?.amount ?? 0;

  if (ironTotal) {
    ironTotal.textContent = ironAmount.toLocaleString();
    if (ironAmount === 0) {
      ironTotal.classList.add('ore-zero');
    } else {
      ironTotal.classList.remove('ore-zero');
    }
  }
  if (ironVouchers) ironVouchers.textContent = ironVoucherCount.toLocaleString();
  if (ironHr) ironHr.textContent = ironRate.hr.toLocaleString();
  if (ironMin) ironMin.textContent = ironRate.min;

  const ironTrendEl = document.getElementById("iron-trend");
  if (ironTrendEl) {
    if (ironRate.trend === 1)       { ironTrendEl.textContent = '▲'; ironTrendEl.className = 'rate-trend trend-up'; }
    else if (ironRate.trend === -1) { ironTrendEl.textContent = '▼'; ironTrendEl.className = 'rate-trend trend-down'; }
    else                            { ironTrendEl.textContent = '—'; ironTrendEl.className = 'rate-trend trend-neutral'; }
  }

  updateMinimizedStats();
  updatePerformanceMetrics();
}

function updatePerformanceMetrics() {
  const totalMinedEl = document.getElementById("total-mined");
  const totalVouchersEl = document.getElementById("total-vouchers");
  
  if (lastInventoryObj) {
    const copperAmount = lastInventoryObj?.mining_copper?.amount ?? 0;
    const ironAmount = lastInventoryObj?.mining_iron?.amount ?? 0;
    const copperVouchers = lastInventoryObj?.mining_token_copper?.amount ?? 0;
    const ironVouchers = lastInventoryObj?.mining_token_iron?.amount ?? 0;
    
    const currentTotalOre = copperAmount + ironAmount;
    
    if (currentTotalOre < lastTotalOre) {
      const exchanged = lastTotalOre - currentTotalOre;
      sessionTotalMined += exchanged;
    }
    
    lastTotalOre = currentTotalOre;
    
    const totalMined = sessionTotalMined + currentTotalOre;
    const totalVouchers = copperVouchers + ironVouchers;
    
    if (totalMinedEl) totalMinedEl.textContent = totalMined.toLocaleString();
    if (totalVouchersEl) totalVouchersEl.textContent = totalVouchers.toLocaleString();
    saveSessionData();
  }
  
  updateBXP();
}

function updateBXP() {
  if (!lastInventoryObj) return;

  const totalBxpEl = document.getElementById("total-bxp");
  if (!totalBxpEl) return;

  const expectedKey = "exp_token_a|farming|mining";
  const altKey = expectedKey.replace("exp_token_a|", "exp_token|");

  const primary = lastInventoryObj?.[expectedKey]?.amount ?? 0;
  const alt     = lastInventoryObj?.[altKey]?.amount ?? 0;

  const miningTotal = primary + alt;
  totalBxpEl.textContent = miningTotal.toLocaleString();

}

function updateOreLog(oreType, amount) {
  const now = Date.now();
  const log = oreLog[oreType];
  if (!hasFirstGain[oreType]) {
    log.push({ time: now, count: amount });
    hasFirstGain[oreType] = true;
  } else {
    const last = log[log.length - 1];
    if (last.count !== amount) {
      if (amount > last.count) {
        log.push({ time: now, count: amount });
        if (log.length > 200) log.shift();
      } else {
        last.count = amount;
        log.push({ time: now, count: amount });
        if (log.length > 200) log.shift();
      }
    }
  }
}

function getOreRate(oreType) {
  const log = oreLog[oreType];
  if (!hasFirstGain[oreType] || log.length < 2) return { hr: 0, min: 0, trend: 0 };
  
  const now = Date.now();
  
  const miningOnlyLog = [];
  let lastValidCount = 0;
  
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (i === 0 || entry.count >= lastValidCount) {
      miningOnlyLog.push(entry);
      lastValidCount = entry.count;
    }
  }
  
  if (miningOnlyLog.length < 2) return { hr: 0, min: 0, trend: 0 };
  
  const [first, last] = [miningOnlyLog[0], miningOnlyLog[miningOnlyLog.length - 1]];
  const sessionDuration = last.time - first.time;
  const sessionCount = last.count - first.count;
  const sessionHours = sessionDuration / 3600000;
  const sessionRateHr = sessionHours > 0 ? sessionCount / sessionHours : 0;

  const recentMiningEntries = miningOnlyLog.filter(entry => now - entry.time <= RECENT_WINDOW_MS);
  let recentRateHr = 0;
  
  if (recentMiningEntries.length >= 2) {
    const recentFirst = recentMiningEntries[0];
    const recentLast = recentMiningEntries[recentMiningEntries.length - 1];
    const recentCount = recentLast.count - recentFirst.count;
    const recentDuration = recentLast.time - recentFirst.time;
    const recentHours = recentDuration / 3600000;
    if (recentHours > 0) recentRateHr = recentCount / recentHours;
  } else {
    return { hr: Math.round(sessionRateHr), min: Math.round(sessionRateHr / 60), trend: 0 };
  }

  const sessionWeight = Math.min(sessionDuration / RECENT_WINDOW_MS, 1.0);
  const hybridHr = sessionRateHr * sessionWeight + recentRateHr * (1 - sessionWeight);
  let trend = 0;
  if (sessionRateHr > 0) {
    if (recentRateHr > sessionRateHr * 1.1) trend = 1;
    else if (recentRateHr < sessionRateHr * 0.9) trend = -1;
  }
  return { hr: Math.round(hybridHr), min: Math.round(hybridHr / 60), trend };
}

let lastIronVoucherCount = null;
let lastCopperVoucherCount = null;
let isExchanging = false;
let lastReopenTime = 0;
let hasReopenedForLeftovers = false;
const REOPEN_COOLDOWN = 5000;
const MAX_REOPEN_COOLDOWN = 30000;
let reopenCooldownMs = REOPEN_COOLDOWN;
let reopenAttemptCount = 0;

function shouldReopenMenu() {
  const now = Date.now();
  if (now - lastReopenTime < reopenCooldownMs) return false;
  lastReopenTime = now;
  reopenAttemptCount += 1;
  reopenCooldownMs = Math.min(REOPEN_COOLDOWN * Math.pow(2, Math.max(0, reopenAttemptCount - 1)), MAX_REOPEN_COOLDOWN);
  return true;
}

function resetReopenBackoff() {
  reopenAttemptCount = 0;
  reopenCooldownMs = REOPEN_COOLDOWN;
}

async function tryAutoVoucherExchange() {
  if (!autoExchangeEnabled) return;
  const choices = window.state.cache.menu_choices ?? [];
  const inv = lastInventoryObj;
  
  if (isExchanging || !inv || choices.length === 0 || !window.state.cache.menu_open) return;

  const hasIronExchange = choices.some(c => c[0]?.includes("Exchange Iron Ore"));
  const hasCopperExchange = choices.some(c => c[0]?.includes("Exchange Copper Ore"));
  const hasIronX10 = choices.some(c => c[0]?.includes("Exchange Iron Ore x10"));
  const hasCopperX10 = choices.some(c => c[0]?.includes("Exchange Copper Ore x10"));
  const hasIronSingle = choices.some(c => c[0]?.includes("Exchange Iron Ore") && !c[0]?.includes("x10"));
  const hasCopperSingle = choices.some(c => c[0]?.includes("Exchange Copper Ore") && !c[0]?.includes("x10"));
  
  let ironLeft = inv["mining_iron"]?.amount ?? 0;
  let copperLeft = inv["mining_copper"]?.amount ?? 0;
  
  const needsIronSingle = ironLeft > 0 && ironLeft < 10 && !hasIronSingle;
  const needsCopperSingle = copperLeft > 0 && copperLeft < 10 && !hasCopperSingle;
  
  if ((needsIronSingle || needsCopperSingle) && (ironLeft > 0 || copperLeft > 0) && shouldReopenMenu()) {
    window.parent.postMessage({ type: "forceMenuBack" }, "*");
    await new Promise(r => setTimeout(r, 300));
    window.parent.postMessage({ type: "sendCommand", command: "vrp-reopen" }, "*");
    isExchanging = false;
    return;
  }
  
  if (!hasIronExchange && !hasCopperExchange) return;

  isExchanging = true;

  const selectOption = async (label) => {
    const option = choices.find(c => c[0]?.includes(label))?.[0];
    if (option) {
      window.parent.postMessage({ type: 'forceMenuChoice', choice: option, mod: 0 }, '*');
      await new Promise(res => setTimeout(res, 500));
      sessionExchangeCount++;
      saveSessionData();
      const exchEl = document.getElementById("total-exchanges");
      if (exchEl) exchEl.textContent = sessionExchangeCount.toLocaleString();
      return true;
    }
    return false;
  };

  if (lastIronVoucherCount !== null && ironLeft > 0 && ironLeft === lastIronVoucherCount) {
    lastIronVoucherCount = null;
    ironLeft = 0;
  }

  if (lastCopperVoucherCount !== null && copperLeft > 0 && copperLeft === lastCopperVoucherCount) {
    lastCopperVoucherCount = null;
    copperLeft = 0;
  }

  if (copperLeft > 0 && hasCopperExchange) {
    if (copperLeft >= 10 && hasCopperX10) {
      const success = await selectOption("Exchange Copper Ore x10");
      if (success) lastCopperVoucherCount = null;
    } else if (copperLeft >= 1 && hasCopperSingle) {
      const success = await selectOption("Exchange Copper Ore");
      if (success) lastCopperVoucherCount = null;
    }
  }

  if (ironLeft > 0 && hasIronExchange) {
    if (ironLeft >= 10 && hasIronX10) {
      const success = await selectOption("Exchange Iron Ore x10");
      if (success) lastIronVoucherCount = null;
    } else if (ironLeft >= 1 && hasIronSingle) {
      const success = await selectOption("Exchange Iron Ore");
      if (success) lastIronVoucherCount = null;
    }
  }

  isExchanging = false;
}

function scheduleInitialRetry() {
  if (hasInitialized || initialDataRetries >= MAX_INITIAL_RETRIES) return;
  clearTimeout(initialDataRetryTimer);
  const delay = 3000 * Math.pow(2, initialDataRetries);
  initialDataRetryTimer = setTimeout(() => {
    if (!hasInitialized) {
      initialDataRetries += 1;
      hasRequestedInitialData = false;
      requestInitialData();
    }
  }, delay);
}

function requestInitialData() {
  if (hasRequestedInitialData || hasInitialized) return;
  hasRequestedInitialData = true;
  window.parent.postMessage({ type: "getData" }, "*");
  scheduleInitialRetry();
}

window.addEventListener("message", (event) => {
  const envelope = event.data;
  if (!envelope || typeof envelope !== "object") return;

  // Tycoon payloads can arrive in different shapes depending on bridge source.
  const data = (envelope.data && typeof envelope.data === "object")
    ? envelope.data
    : (envelope.payload && typeof envelope.payload === "object")
      ? envelope.payload
      : envelope;
  if (!data || typeof data !== 'object') return;

  lastDataUpdateAt = Date.now();

  if (!hasInitialized) {
    hasInitialized = true;
    clearTimeout(initialDataRetryTimer);
    clearTimeout(waitingStateTimer);
    const ws = document.getElementById("waiting-state");
    if (ws) ws.hidden = true;
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === 'menu_choices') {
      window.state.cache[key] = normalizeMenuChoices(value);
    } else if (key === 'menu_open') {
      const menuOpen = coerceMenuOpen(value);
      window.state.cache[key] = menuOpen;

      if (!menuOpen) {
        isExchanging = false;
        hasReopenedForLeftovers = false;
      }

      if (menuOpen) {
        resetReopenBackoff();
        setTimeout(() => tryAutoVoucherExchange(), 100);
      }
    } else {
      window.state.cache[key] = value;
    }
  }

  if (data.menu_choices && window.state.cache.menu_open && !isExchanging && data.menu_open == null) {
    setTimeout(() => tryAutoVoucherExchange(), 100);
  }

  const rawJob = data.job ?? data.job_name ?? data.job_title ?? data.jobName ?? data.jobTitle;
  const normalizedJob = typeof rawJob === "string" ? rawJob.trim().toLowerCase() : "";
  if (normalizedJob) {
    if (!normalizedJob.includes(REQUIRED_JOB)) {
      isMinerJob = false;
      toggleUI(false);
      return;
    } else {
      isMinerJob = true;
      toggleUI(true);
    }
  }

  if (typeof data.weight === "number") lastWeight = data.weight;
  if (typeof data.max_weight === "number") lastMaxWeight = data.max_weight;

  let invObj = null;
  invObj = parseInventoryValue(data.inventory)
    || parseInventoryValue(data?.cache?.inventory)
    || parseInventoryValue(envelope.inventory)
    || parseInventoryValue(envelope?.cache?.inventory);

  if (invObj) {
    lastInventoryObj = invObj;
  } else if (lastInventoryObj) {
    invObj = lastInventoryObj;
  }

  if (invObj && lastWeight !== null && lastMaxWeight !== null) {
    for (const ore of ORE_KEYS) {
      const amount = invObj[ore]?.amount || 0;
      updateOreLog(ore, amount);
    }
    clearTimeout(hudDebounceTimer);
    hudDebounceTimer = setTimeout(() => updateHUD(lastWeight, lastMaxWeight), 100);
    
    if (!isExchanging && autoExchangeEnabled) {
      const ironAmount = invObj["mining_iron"]?.amount ?? 0;
      const copperAmount = invObj["mining_copper"]?.amount ?? 0;

      if ((ironAmount === 0 && copperAmount === 0) || (ironAmount >= 10 && copperAmount >= 10)) {
        hasReopenedForLeftovers = false;
      }

      if (ironAmount > 0 || copperAmount > 0) {
        if (!window.state.cache.menu_open && ((ironAmount > 0 && ironAmount < 10) || (copperAmount > 0 && copperAmount < 10))) {
          if (!hasReopenedForLeftovers && shouldReopenMenu()) {
            hasReopenedForLeftovers = true;
            setTimeout(() => {
              window.parent.postMessage({ type: "sendCommand", command: "vrp-reopen" }, "*");
            }, 500);
          }
        }

        if (window.state.cache.menu_open) {
          const choices = window.state.cache.menu_choices ?? [];
          const hasIronSingle = choices.some(c => c[0]?.includes("Exchange Iron Ore") && !c[0]?.includes("x10"));
          const hasCopperSingle = choices.some(c => c[0]?.includes("Exchange Copper Ore") && !c[0]?.includes("x10"));

          const needsIronSingle = ironAmount > 0 && ironAmount < 10 && !hasIronSingle;
          const needsCopperSingle = copperAmount > 0 && copperAmount < 10 && !hasCopperSingle;

          if ((needsIronSingle || needsCopperSingle) && shouldReopenMenu()) {
            setTimeout(() => {
              window.parent.postMessage({ type: "forceMenuBack" }, "*");
              setTimeout(() => {
                window.parent.postMessage({ type: "sendCommand", command: "vrp-reopen" }, "*");
              }, 300);
            }, 100);
          }
        }
      }
    }
  }
});

window.onload = () => {

  loadSessionData();

  toggleUI(false);

  initializeDragging();

  initializeAlertSettings();

  initializeAutoExchangeBtn();

  initializeOpacityBtn();

  initializeSessionButtons();

  applyOpacity();

  startDataHealthMonitor();

  const escapeListener = (e) => {

    if (e.key === "Escape") {

      window.parent.postMessage({type: "pin"}, "*");

    }

    if (e.key === "F6") {

      toggleMinimize();

    }

  };

  window.addEventListener('keydown', escapeListener);

  updateInventoryWarningState(false);

  startWaitingStateTimer();

  requestInitialData();

};
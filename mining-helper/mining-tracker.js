// Disable console logging to reduce FiveM log file spam
if (typeof console !== 'undefined') {
  console.log = function() {};
  console.warn = function() {};
  console.info = function() {};
  console.debug = function() {};
}

const REQUIRED_JOB = "miner"
let isMinerJob = false;
let isMonitoring = false;
let lastWeight = null;
let lastMaxWeight = null;
let lastInventoryObj = null;
let lastPrintedWeight = null;
let lastMenuOpenTime = 0;
let didReopenIron = false;
let didReopenCopper = false;
let sessionStartTime = null;
let isMinimized = false;
let isHorizontal = false;
let sessionTotalMined = 0;
let lastTotalOre = 0;
let hasInitialized = false;
let inventoryAlertTriggered = false;
const INVENTORY_ALERT_THRESHOLD = 95;

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
      layoutBtn.title = "Switch to Vertical";
    }
  } else {
    container.classList.remove("horizontal");
    if (layoutBtn) {
      layoutBtn.innerHTML = '<i class="fas fa-arrows-alt-h"></i>';
      layoutBtn.title = "Switch to Horizontal";
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
}

function startSessionTimer() {
  setInterval(updateSessionTime, 1000);
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
  const alertAudio = document.getElementById('alertSound');
  if (alertAudio) {
    alertAudio.currentTime = 0; // Restart sound
    alertAudio.play().catch(() => {}); // Play and ignore browser block errors
  }
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
  const invPercentValue = (weight != null && maxWeight != null) ? ((weight / maxWeight) * 100).toFixed(1) : "--";
  
  if (invCurrent) invCurrent.textContent = roundedWeight;
  if (invMax) invMax.textContent = roundedMax;
  if (invPercent) invPercent.textContent = invPercentValue + "%";
  
  if (weight != null && maxWeight != null) {
    const percentage = (weight / maxWeight) * 100;
    if (inventoryProgress) {
      inventoryProgress.style.width = percentage + "%";
    }
    checkInventoryThreshold(percentage);
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
  if (!hasFirstGain[oreType] || log.length < 2) return { hr: 0, min: 0 };
  
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
  
  if (miningOnlyLog.length < 2) return { hr: 0, min: 0 };
  
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
    return { hr: Math.round(sessionRateHr), min: Math.round(sessionRateHr / 60) };
  }

  const sessionWeight = Math.min(sessionDuration / RECENT_WINDOW_MS, 1.0);
  const hybridHr = sessionRateHr * sessionWeight + recentRateHr * (1 - sessionWeight);
  return { hr: Math.round(hybridHr), min: Math.round(hybridHr / 60) };
}

let lastIronVoucherCount = null;
let lastCopperVoucherCount = null;
let isExchanging = false;
let lastReopenTime = 0;
let hasReopenedForLeftovers = false;
const REOPEN_COOLDOWN = 5000;

function shouldReopenMenu() {
  const now = Date.now();
  if (now - lastReopenTime < REOPEN_COOLDOWN) return false;
  lastReopenTime = now;
  return true;
}

async function tryAutoVoucherExchange() {
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
  const data = event.data?.data;
  if (!data || typeof data !== 'object') return;

  if (!hasInitialized) {
    hasInitialized = true;
    clearTimeout(initialDataRetryTimer);
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === 'menu_choices') {
      try {
        window.state.cache[key] = JSON.parse(value ?? '[]');
      } catch {
        window.state.cache[key] = [];
      }
    } else if (key === 'menu_open') {
      window.state.cache[key] = Boolean(value);

      if (value === false) {
        isExchanging = false;
        hasReopenedForLeftovers = false;
      }

      if (value === true) {
        setTimeout(() => tryAutoVoucherExchange(), 100);
      }
    } else {
      window.state.cache[key] = value;
    }
  }

  if (data.menu_choices && window.state.cache.menu_open && !isExchanging) {
    setTimeout(() => tryAutoVoucherExchange(), 100);
  }

  const job = data.job?.toLowerCase();
  if (job) {
    if (job !== REQUIRED_JOB) {
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
  if (data.inventory) {
    try {
      invObj = typeof data.inventory === "string" ? JSON.parse(data.inventory) : data.inventory;
      if (invObj) lastInventoryObj = invObj;
    } catch {}
  } else if (lastInventoryObj) {
    invObj = lastInventoryObj;
  }

  if (invObj && lastWeight !== null && lastMaxWeight !== null) {
    for (const ore of ORE_KEYS) {
      const amount = invObj[ore]?.amount || 0;
      updateOreLog(ore, amount);
    }
    updateHUD(lastWeight, lastMaxWeight);
    
    if (!isExchanging) {
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
  toggleUI(false);
  initializeDragging();

  const escapeListener = (e) => {
    if (e.key === "Escape") {
      window.parent.postMessage({type: "pin"}, "*");
    }
  };
  window.addEventListener('keydown', escapeListener);

  updateInventoryWarningState(false);
  requestInitialData();
};

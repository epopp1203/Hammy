const TRACKED_ITEMS = [
	"Pizza",
	"Chicken Nuggets",
	"Fries",
	"Expensive Water",
	"Onion Rings",
	"Soda"
];

const PANEL_LAYOUT_STORAGE_KEY = "pizzaJobPanelLayout";
const DEBUG_PANEL_LAYOUT_STORAGE_KEY = "pizzaJobDebugPanelLayout";
const SETTINGS_STORAGE_KEY = "pizzaJobSettings";
const VERBOSE_RAW_DEBUG_STORAGE_KEY = "pizzaJobVerboseRawDebug";
const DEBUG_FILTER_STORAGE_KEY = "pizzaJobDebugFilterMode";
const INTEGRATION_POLL_INTERVAL_MS = 1500;
const VEHICLE_TRUNK_REFRESH_COOLDOWN_MS = 800;
const TYCOON_OPEN_TRUNK_COMMANDS = ["rm_trunk", "rm_cabtrunk"];
const PIZZA_DELIVERY_JOB_NAME = "Pizza Delivery";

const TRUNK_ITEM_KEY_ALIASES = {
	Pizza: ["Pizza", "pizza", "pizza_slice"],
	"Chicken Nuggets": ["Chicken Nuggets", "chicken_nuggets", "nuggets"],
	Fries: ["Fries", "fries"],
	"Expensive Water": ["Expensive Water", "expensive_water", "water_expensive", "dasani", "water"],
	"Onion Rings": ["Onion Rings", "onion_rings", "onionrings"],
	Soda: ["Soda", "soda"]
};


const TRACKED_ITEM_MATCH_TOKENS = {
	Pizza: ["pizza"],
	"Chicken Nuggets": ["chicken", "nugget"],
	Fries: ["fries", "fry"],
	"Expensive Water": ["expensive", "water"],
	"Onion Rings": ["onion", "ring"],
	Soda: ["soda"]
};

const TYCOON_ITEM_ID_BY_TRACKED = {
	Pizza: "pizza",
	"Chicken Nuggets": "nuggets",
	Fries: "fries",
	"Expensive Water": "dasani",
	"Onion Rings": "onionrings",
	Soda: "soda"
};

const TRACKED_ITEM_WEIGHTS_KG = {
	Pizza: 10.0,
	"Chicken Nuggets": 6.0,
	Fries: 5.0,
	"Expensive Water": 5.0,
	"Onion Rings": 6.0,
	Soda: 5.0
};

function generateRandomOrderId() {
	return Math.floor(Math.random() * 9000) + 1000;
}

function createEmptyTrackedItemTable() {
	return TRACKED_ITEMS.reduce((table, item) => {
		table[item] = 0;
		return table;
	}, {});
}

function createInitialTycoonTrunkState() {
	return {
		activeChestId: null,
		menuOpen: false,
		menuName: "",
		menuChoices: [],
		layoutOrder: [],
		promptOpen: false,
		lastMenuChoice: "",
		lastMenuChoiceAt: 0,
		lastTakeItem: "",
		lastTakeAt: 0,
		busy: false
	};
}

const state = {
	orderId: generateRandomOrderId(),
	order: createEmptyTrackedItemTable(),
	trunk: createEmptyTrackedItemTable(),
	inventory: createEmptyTrackedItemTable(),
	settings: {
		lowThreshold: 5,
		bgOpacity: 0.82,
		gpsEnabled: true,
		gpsX: null,
		gpsY: null
	},
	playerJobName: "",
	isPizzaDeliveryActive: false,
	orderSync: {
		source: "Local",
		at: null
	},
	tycoonTrunk: createInitialTycoonTrunkState()
};

const refs = {
	app: document.getElementById("app"),
	topbar: document.querySelector(".topbar"),
	panelResizeHandle: document.getElementById("panel-resize-handle"),
	orderId: document.getElementById("order-id"),
	orderSyncMeta: document.getElementById("order-sync-meta"),
	orderList: document.getElementById("order-list"),
	trunkList: document.getElementById("trunk-list"),
	trunkAlertCount: document.getElementById("trunk-alert-count"),
	clearOrderBtn: document.getElementById("clear-order-btn"),
	settingsToggleBtn: document.getElementById("settings-toggle-btn"),
	resetPanelBtn: document.getElementById("reset-panel-btn"),
	debugToggleBtn: document.getElementById("debug-toggle-btn"),
	debugPanel: document.getElementById("debug-panel"),
	debugLog: document.getElementById("debug-log"),
	debugClearBtn: document.getElementById("debug-clear-btn"),
	debugCopyBtn: document.getElementById("debug-copy-btn"),
	debugCloseBtn: document.getElementById("debug-close-btn"),
	debugToolbar: document.getElementById("debug-toolbar"),
	debugFilterSelect: document.getElementById("debug-filter-select"),
	debugVerboseToggle: document.getElementById("debug-verbose-toggle"),
	settingsPanel: document.getElementById("settings-panel"),
	settingsCloseBtn: document.getElementById("settings-close-btn"),
	lowThresholdInput: document.getElementById("low-threshold-input"),
	bgOpacityInput: document.getElementById("bg-opacity-input"),
	bgOpacityValue: document.getElementById("bg-opacity-value"),
	gpsEnabledInput: document.getElementById("gps-enabled-input"),
	applyGpsBtn: document.getElementById("apply-gps-btn"),
	toast: document.getElementById("toast")
};

const panelState = {
	dragging: false,
	resizing: false,
	startX: 0,
	startY: 0,
	startLeft: 0,
	startTop: 0,
	startWidth: 0,
	startHeight: 0
};

const debugPanelState = {
	dragging: false,
	startX: 0,
	startY: 0,
	startLeft: 0,
	startTop: 0
};

let lastVehicleTrunkRefreshAt = 0;
let lastInVehicleState = null;
let lastTycoonPromptSeenAt = 0;
let lastFocusedTycoonPayloadSignature = "";

function normalizeJobName(jobName) {
	return typeof jobName === "string" ? jobName.trim() : "";
}

function setPizzaJobAppVisible(isVisible) {
	refs.app.classList.toggle("hidden", !isVisible);
	if (!isVisible) {
		refs.settingsPanel.classList.add("hidden");
		setDebugPanelOpen(false);
	}
}

function requestPassiveTycoonState(reason = "job-state") {
	window.parent.postMessage(
		{
			type: "getData",
			reason
		},
		"*"
	);
}

function setPlayerJobState(jobName) {
	const normalizedJobName = normalizeJobName(jobName);
	const isPizzaDeliveryActive = normalizedJobName === PIZZA_DELIVERY_JOB_NAME;
	const jobChanged = normalizedJobName !== state.playerJobName;
	const activeChanged = isPizzaDeliveryActive !== state.isPizzaDeliveryActive;

	if (!jobChanged && !activeChanged) {
		return;
	}

	state.playerJobName = normalizedJobName;
	state.isPizzaDeliveryActive = isPizzaDeliveryActive;

	if (!isPizzaDeliveryActive) {
		resetPizzaJobRuntimeState();
		setPizzaJobAppVisible(false);
		return;
	}

	setPizzaJobAppVisible(true);

	if (activeChanged) {
		requestNuiData();
		refreshVehicleTrunkInventory("job-activated");
		render();
	}
}

function updatePlayerJobStateFromPayload(payload) {
	if (!payload || typeof payload !== "object") {
		return;
	}

	const nextJobName = normalizeJobName(payload.job_name) || normalizeJobName(payload.job_title);
	if (nextJobName) {
		setPlayerJobState(nextJobName);
	}
}

function resetPizzaJobRuntimeState() {
	state.orderId = generateRandomOrderId();
	state.order = createEmptyTrackedItemTable();
	state.trunk = createEmptyTrackedItemTable();
	state.inventory = createEmptyTrackedItemTable();
	state.orderSync.source = "Waiting for Pizza Delivery";
	state.orderSync.at = null;
	state.tycoonTrunk = createInitialTycoonTrunkState();
	state.settings.gpsX = null;
	state.settings.gpsY = null;
	lastVehicleTrunkRefreshAt = 0;
	lastInVehicleState = null;
	lastTycoonPromptSeenAt = 0;
	lastFocusedTycoonPayloadSignature = "";
	saveSettings();
	render();

	if (!window.GetParentResourceName) {
		return;
	}

	const payload = { action: "clearWaypoint" };
	window.postMessage(payload, "*");
	const resourceName = window.GetParentResourceName();
	fetch(`https://${resourceName}/clearWaypoint`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(payload)
	}).catch(() => {
		// Ignore endpoint errors during local browser testing.
	});
}

function ordersEqual(leftOrder, rightOrder) {
	if (!leftOrder || !rightOrder) {
		return false;
	}

	return TRACKED_ITEMS.every((item) => Number(leftOrder[item]) === Number(rightOrder[item]));
}

function trunksEqual(leftTrunk, rightTrunk) {
	if (!leftTrunk || !rightTrunk) {
		return false;
	}

	return TRACKED_ITEMS.every((item) => Number(leftTrunk[item]) === Number(rightTrunk[item]));
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function tryParseJsonObject(rawValue) {
	if (rawValue && typeof rawValue === "object") {
		return rawValue;
	}

	if (typeof rawValue !== "string") {
		return null;
	}

	const trimmed = rawValue.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

function parseLikelySerializedPayload(data) {
	if (!data || typeof data !== "object") {
		return data;
	}

	const parsed = { ...data };
	const keysToParse = [
		"trunk",
		"trunkInventory",
		"trunk_inventory",
		"vehicleTrunk",
		"vehicle_trunk",
		"vehicleTrunkInventory",
		"vehicle_trunk_inventory",
		"inventory",
		"trunks",
		"storages",
		"items",
		"storage"
	];

	for (const key of keysToParse) {
		if (!(key in parsed)) {
			continue;
		}
		const maybeParsed = tryParseJsonObject(parsed[key]);
		if (maybeParsed) {
			parsed[key] = maybeParsed;
		}
	}

	return parsed;
}

function extractAmountValue(raw) {
	if (raw && typeof raw === "object") {
		const objectAmount = Number(raw.amount);
		if (Number.isFinite(objectAmount)) {
			return objectAmount;
		}
	}

	const numeric = Number(raw);
	if (Number.isFinite(numeric)) {
		return numeric;
	}

	return null;
}

function resolveTrackedItemKey(rawKey) {
	if (typeof rawKey !== "string") {
		return null;
	}

	const normalizedKey = rawKey.toLowerCase();

	for (const item of TRACKED_ITEMS) {
		const aliases = TRUNK_ITEM_KEY_ALIASES[item] || [item];
		if (aliases.some((alias) => alias.toLowerCase() === normalizedKey)) {
			return item;
		}
	}

	for (const item of TRACKED_ITEMS) {
		const tokens = TRACKED_ITEM_MATCH_TOKENS[item] || [];
		if (tokens.length > 0 && tokens.every((token) => normalizedKey.includes(token))) {
			return item;
		}
	}

	return null;
}

function showToast(message, timeoutMs = 2400) {
	refs.toast.textContent = message;
	refs.toast.classList.remove("hidden");
	window.clearTimeout(showToast.timer);
	showToast.timer = window.setTimeout(() => {
		refs.toast.classList.add("hidden");
	}, timeoutMs);
}

const DEBUG_MAX_ENTRIES = 1000;

function isVerboseRawDebugEnabled() {
	try {
		return localStorage.getItem(VERBOSE_RAW_DEBUG_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

function setVerboseRawDebugEnabled(enabled) {
	try {
		localStorage.setItem(VERBOSE_RAW_DEBUG_STORAGE_KEY, enabled ? "true" : "false");
	} catch {
		// Ignore storage failures.
	}
}

function getDebugFilterMode() {
	const selectedValue = refs.debugFilterSelect?.value;
	if (["focused", "server", "all"].includes(selectedValue)) {
		return selectedValue;
	}

	try {
		const stored = localStorage.getItem(DEBUG_FILTER_STORAGE_KEY);
		return ["focused", "server", "all"].includes(stored) ? stored : "focused";
	} catch {
		return "focused";
	}
}

function setDebugFilterMode(mode) {
	const safeMode = ["focused", "server", "all"].includes(mode) ? mode : "focused";
	if (refs.debugFilterSelect) {
		refs.debugFilterSelect.value = safeMode;
	}

	try {
		localStorage.setItem(DEBUG_FILTER_STORAGE_KEY, safeMode);
	} catch {
		// Ignore storage failures.
	}
}

function setDebugToolbarOpen(isOpen) {
	if (!refs.debugToolbar) {
		return;
	}

	refs.debugToolbar.classList.toggle("hidden", !isOpen);
}

function setDebugPanelOpen(isOpen) {
	if (!refs.debugPanel) {
		return;
	}

	refs.debugPanel.classList.toggle("hidden", !isOpen);
	if (isOpen) {
		setDebugToolbarOpen(true);
	}
	if (!isOpen) {
		debugPanelState.dragging = false;
	}
	saveDebugPanelLayout();
}

function isRelevantFocusedTycoonPayload(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return false;
	}

	const keys = Object.keys(data);
	if (keys.some((key) => key.startsWith("chest_"))) {
		return true;
	}

	const relevantKeys = new Set([
		"menu_open",
		"menu",
		"menu_choice",
		"menu_choices",
		"prompt",
		"prompt_open",
		"prompt_title",
		"prompt_number_only",
		"chest",
		"inventory",
		"notification",
		"trunkWeight",
		"trunkCapacity",
		"weight",
		"action",
		"event"
	]);

	return keys.some((key) => relevantKeys.has(key));
}

function getFocusedTycoonPayloadSignature(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return "";
	}

	const signatureSource = {
		menu_open: data.menu_open,
		menu: data.menu,
		menu_choice: data.menu_choice,
		menu_choices: data.menu_choices,
		prompt: data.prompt,
		prompt_open: data.prompt_open,
		prompt_title: data.prompt_title,
		chest: data.chest,
		notification: data.notification,
		trunkWeight: data.trunkWeight,
		trunkCapacity: data.trunkCapacity,
		weight: data.weight,
		inventory: data.inventory
	};

	for (const key of Object.keys(data).sort()) {
		if (key.startsWith("chest_")) {
			signatureSource[key] = data[key];
		}
	}

	try {
		return JSON.stringify(signatureSource);
	} catch {
		return "";
	}
}

function getDebugEntryTone(raw) {
	if (raw?.type === "pizza-job-debug") {
		return "action";
	}

	if (raw?.type === "data" && raw?.fromTycoonScript === true) {
		return "server";
	}

	return "client";
}

function wasRecentAnyTycoonTakeSuccess(windowMs = 1400) {
	return Date.now() - state.tycoonTrunk.lastTakeAt <= windowMs;
}

function isLikelyPostSuccessRootTrunkMenuPayload(data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return false;
	}

	const keys = Object.keys(data).sort();
	if (keys.length !== 3 || keys[0] !== "menu" || keys[1] !== "menu_choices" || keys[2] !== "menu_open") {
		return false;
	}

	if (data.menu_open !== true || typeof data.menu !== "string") {
		return false;
	}

	const menuName = data.menu.toLowerCase();
	if (!menuName.includes("trunk")) {
		return false;
	}

	const menuChoices = parseMenuChoices(data.menu_choices).map((choice) =>
		Array.isArray(choice) ? cleanMenuChoiceLabel(choice[0]).toLowerCase() : ""
	);

	return menuChoices.includes("put") && menuChoices.includes("take");
}

function shouldSkipDebugPayload(raw) {
	if (!raw || typeof raw !== "object") {
		return false;
	}

	const filterMode = getDebugFilterMode();
	if (filterMode === "all") {
		return false;
	}

	if (raw.type === "pizza-job-debug") {
		return false;
	}

	if (filterMode === "server") {
		return !(raw.type === "data" && raw.fromTycoonScript === true);
	}

	if (raw.type !== "data" || raw.fromTycoonScript !== true) {
		return true;
	}

	if (filterMode === "focused" && wasRecentAnyTycoonTakeSuccess() && isLikelyPostSuccessRootTrunkMenuPayload(raw.data)) {
		return true;
	}

	if (isVerboseRawDebugEnabled()) {
		return false;
	}

	if (Array.isArray(raw.data) && raw.data.length === 0) {
		return true;
	}

	if (!raw.data || typeof raw.data !== "object" || Array.isArray(raw.data)) {
		return false;
	}

	const keys = Object.keys(raw.data);
	if (keys.length === 0) {
		return true;
	}

	const noisyCameraKeys = new Set([
		"cam_heading",
		"cam_x",
		"cam_y",
		"cam_z",
		"cam_roll",
		"cam_pitch",
		"pos_x",
		"pos_y",
		"pos_z",
		"pos_h",
		"speed"
	]);

	if (!isRelevantFocusedTycoonPayload(raw.data)) {
		return true;
	}

	return keys.every((key) => noisyCameraKeys.has(key));
}

function debugLogMessage(raw) {
	if (!refs.debugLog) {
		return;
	}

	if (shouldSkipDebugPayload(raw)) {
		return;
	}

	if (
		getDebugFilterMode() === "focused" &&
		raw?.type === "data" &&
		raw?.fromTycoonScript === true &&
		raw.data &&
		typeof raw.data === "object" &&
		!Array.isArray(raw.data)
	) {
		const keys = Object.keys(raw.data);
		if (keys.length > 20) {
			const signature = getFocusedTycoonPayloadSignature(raw.data);
			if (signature && signature === lastFocusedTycoonPayloadSignature) {
				return;
			}
			lastFocusedTycoonPayloadSignature = signature;
		}
	}

	const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	let text;
	try {
		text = JSON.stringify(raw, null, 0);
	} catch {
		text = String(raw);
	}

	const entry = document.createElement("div");
	entry.className = `debug-entry debug-entry-${getDebugEntryTone(raw)}`;
	entry.innerHTML = `<span class="debug-ts">${ts}</span>${text}`;
	refs.debugLog.prepend(entry);

	while (refs.debugLog.children.length > DEBUG_MAX_ENTRIES) {
		refs.debugLog.removeChild(refs.debugLog.lastChild);
	}
}

function getSyncDisplayText() {
	if (!state.orderSync.at) {
		return `Last Sync: ${state.orderSync.source}`;
	}

	const timestamp = new Date(state.orderSync.at).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit"
	});
	return `Last Sync: ${state.orderSync.source} at ${timestamp}`;
}

function markOrderSynced(sourceLabel) {
	state.orderSync.source = sourceLabel;
	state.orderSync.at = Date.now();
}

function isMobileLayout() {
	return window.matchMedia("(max-width: 980px)").matches;
}

function getMinPanelSize() {
	const styles = window.getComputedStyle(document.documentElement);
	const minWidth = parseFloat(styles.getPropertyValue("--panel-min-width")) || 700;
	const minHeight = parseFloat(styles.getPropertyValue("--panel-min-height")) || 400;
	return { minWidth, minHeight };
}

function savePanelLayout() {
	if (isMobileLayout()) {
		return;
	}

	const payload = {
		left: refs.app.offsetLeft,
		top: refs.app.offsetTop,
		width: refs.app.offsetWidth,
		height: refs.app.offsetHeight
	};

	localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
}

function loadPanelLayout() {
	if (isMobileLayout()) {
		return;
	}

	const raw = localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
	if (!raw) {
		return;
	}

	try {
		const parsed = JSON.parse(raw);
		const { minWidth, minHeight } = getMinPanelSize();
		const width = clamp(Number(parsed.width) || 0, minWidth, window.innerWidth);
		const height = clamp(Number(parsed.height) || 0, minHeight, window.innerHeight);

		const maxLeft = Math.max(0, window.innerWidth - width);
		const maxTop = Math.max(0, window.innerHeight - height);
		const left = clamp(Number(parsed.left) || 0, 0, maxLeft);
		const top = clamp(Number(parsed.top) || 0, 0, maxTop);

		refs.app.style.width = `${width}px`;
		refs.app.style.height = `${height}px`;
		refs.app.style.left = `${left}px`;
		refs.app.style.top = `${top}px`;
	} catch {
		localStorage.removeItem(PANEL_LAYOUT_STORAGE_KEY);
	}
}

function saveDebugPanelLayout() {
	if (!refs.debugPanel) {
		return;
	}

	const payload = {
		open: !refs.debugPanel.classList.contains("hidden"),
		filterMode: getDebugFilterMode(),
		verboseRaw: isVerboseRawDebugEnabled()
	};

	if (!isMobileLayout() && !refs.debugPanel.classList.contains("hidden")) {
		payload.left = refs.debugPanel.offsetLeft;
		payload.top = refs.debugPanel.offsetTop;
		payload.width = refs.debugPanel.offsetWidth;
		payload.height = refs.debugPanel.offsetHeight;
	}

	localStorage.setItem(DEBUG_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
}

function loadDebugPanelLayout() {
	if (!refs.debugPanel) {
		return;
	}

	const raw = localStorage.getItem(DEBUG_PANEL_LAYOUT_STORAGE_KEY);
	if (!raw) {
		setDebugFilterMode(getDebugFilterMode());
		if (refs.debugVerboseToggle) {
			refs.debugVerboseToggle.checked = isVerboseRawDebugEnabled();
		}
		setDebugToolbarOpen(true);
		return;
	}

	try {
		const parsed = JSON.parse(raw);
		setDebugFilterMode(parsed.filterMode);
		setVerboseRawDebugEnabled(parsed.verboseRaw === true);
		if (refs.debugVerboseToggle) {
			refs.debugVerboseToggle.checked = isVerboseRawDebugEnabled();
		}
		setDebugToolbarOpen(true);
		refs.debugPanel.classList.toggle("hidden", parsed.open !== true);

		if (!isMobileLayout() && parsed.open === true) {
			const defaultWidth = refs.debugPanel.offsetWidth || 680;
			const defaultHeight = refs.debugPanel.offsetHeight || 340;
			const width = clamp(Number(parsed.width) || defaultWidth, 380, window.innerWidth - 24);
			const height = clamp(Number(parsed.height) || defaultHeight, 220, window.innerHeight - 24);
			const maxLeft = Math.max(0, window.innerWidth - width);
			const maxTop = Math.max(0, window.innerHeight - height);
			const left = clamp(Number(parsed.left) || 0, 0, maxLeft);
			const top = clamp(Number(parsed.top) || 0, 0, maxTop);

			refs.debugPanel.style.width = `${width}px`;
			refs.debugPanel.style.height = `${height}px`;
			refs.debugPanel.style.left = `${left}px`;
			refs.debugPanel.style.top = `${top}px`;
		}
	} catch {
		localStorage.removeItem(DEBUG_PANEL_LAYOUT_STORAGE_KEY);
	}
}

function saveSettings() {
	localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function loadSettings() {
	const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
	if (!raw) {
		return;
	}

	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed.lowThreshold === "number") {
			state.settings.lowThreshold = clamp(Math.round(parsed.lowThreshold), 1, 99);
		}
		if (typeof parsed.bgOpacity === "number") {
			state.settings.bgOpacity = clamp(parsed.bgOpacity, 0, 1);
		}
		if (typeof parsed.gpsEnabled === "boolean") {
			state.settings.gpsEnabled = parsed.gpsEnabled;
		}
		if (typeof parsed.gpsX === "number") {
			state.settings.gpsX = parsed.gpsX;
		}
		if (typeof parsed.gpsY === "number") {
			state.settings.gpsY = parsed.gpsY;
		}
	} catch {
		localStorage.removeItem(SETTINGS_STORAGE_KEY);
	}
}

function applyWindowBackgroundOpacity() {
	const sliderOpacity = clamp(state.settings.bgOpacity, 0, 1);
	// Use a non-linear curve so low-opacity values change more gradually.
	const baseOpacity = clamp(Math.pow(sliderOpacity, 1.35), 0, 1);
	const surfaceOpacity = clamp(baseOpacity * 0.76, 0, 0.9);
	const overlayOpacity = clamp(baseOpacity * 0.9, 0, 0.95);
	const subtleOpacity = clamp(baseOpacity * 0.56, 0, 0.8);

	refs.app.style.setProperty("--window-bg-opacity", baseOpacity.toFixed(2));
	refs.app.style.setProperty("--window-surface-opacity", surfaceOpacity.toFixed(2));
	refs.app.style.setProperty("--window-overlay-opacity", overlayOpacity.toFixed(2));
	refs.app.style.setProperty("--window-subtle-opacity", subtleOpacity.toFixed(2));
}

function getOrderCompletionState() {
	const totalRequested = TRACKED_ITEMS.reduce((sum, item) => sum + state.order[item], 0);
	const totalRemaining = TRACKED_ITEMS.reduce(
		(sum, item) => sum + Math.max(state.order[item] - state.inventory[item], 0),
		0
	);
	return {
		hasOrder: totalRequested > 0,
		isComplete: totalRequested > 0 && totalRemaining === 0
	};
}

function clearWaypointData() {
	state.settings.gpsX = null;
	state.settings.gpsY = null;

	const payload = { action: "clearWaypoint" };
	window.postMessage(payload, "*");

	if (window.GetParentResourceName) {
		const resourceName = window.GetParentResourceName();
		fetch(`https://${resourceName}/clearWaypoint`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		}).catch(() => {
			// Ignore endpoint errors during local browser testing.
		});
	}

	saveSettings();
	render();
}

function handleOrderCompletion() {
	const completion = getOrderCompletionState();
	if (!completion.isComplete) {
		return;
	}

	clearWaypointData();
	showToast("Order complete. Mission marker waypoint cleared.");
}

function normalizeOrderPayload(orderPayload) {
	if (!orderPayload || typeof orderPayload !== "object") {
		return null;
	}

	const normalized = {};
	TRACKED_ITEMS.forEach((item) => {
		const value = Number(orderPayload[item]);
		normalized[item] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
	});
	return normalized;
}

function normalizeTrackedItemTable(payload) {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	const normalized = {};
	TRACKED_ITEMS.forEach((item) => {
		normalized[item] = 0;
	});

	for (const [rawKey, rawValue] of Object.entries(payload)) {
		const trackedItem = resolveTrackedItemKey(rawKey);
		if (!trackedItem) {
			continue;
		}

		const amount = extractAmountValue(rawValue);
		if (amount === null) {
			continue;
		}

		normalized[trackedItem] += Math.max(0, Math.floor(amount));
	}

	return normalized;
}

function normalizeHammyItemsArray(itemsArray) {
	if (!Array.isArray(itemsArray)) {
		return null;
	}

	const normalized = {};
	TRACKED_ITEMS.forEach((item) => {
		normalized[item] = 0;
	});

	for (const entry of itemsArray) {
		if (!entry || typeof entry !== "object") {
			continue;
		}

		const entryName = entry.item?.name || entry.item?.id || entry.item?.vrpName || entry.name;
		const amount = extractAmountValue(entry.amount);
		if (typeof entryName !== "string" || amount === null) {
			continue;
		}

		const trackedItem = resolveTrackedItemKey(entryName);
		if (trackedItem) {
			normalized[trackedItem] += Math.max(0, Math.floor(amount));
		}
	}

	return normalized;
}

function resolveVehicleTrunkInventoryFromPayload(data) {
	if (!data || typeof data !== "object") {
		return null;
	}

	const parsedData = parseLikelySerializedPayload(data);

	if (Array.isArray(parsedData.trunks)) {
		const activeTrunk =
			parsedData.trunks.find((entry) => entry?.active || entry?.isActive || entry?.inVehicle) ||
			parsedData.trunks[0];
		if (activeTrunk?.inventory && typeof activeTrunk.inventory === "object") {
			return { inventory: activeTrunk.inventory, source: "Hammy Vehicle trunk" };
		}
	}

	if (Array.isArray(parsedData.storages)) {
		const vehicleStorage = parsedData.storages.find((entry) => {
			const typeValue = entry?.storage?.type;
			if (typeof typeValue !== "string") {
				return false;
			}
			const normalizedType = typeValue.toLowerCase();
			return (
				normalizedType === "vehicle" ||
				normalizedType === "trunk" ||
				normalizedType === "vehicle_trunk"
			);
		});
		if (vehicleStorage?.items) {
			const normalized = normalizeHammyItemsArray(vehicleStorage.items);
			if (normalized) {
				return { inventory: normalized, source: "Hammy Vehicle storage" };
			}
		}
	}

	if (
		parsedData.storage &&
		typeof parsedData.storage === "object" &&
		typeof parsedData.storage.type === "string" &&
		["vehicle", "trunk", "vehicle_trunk"].includes(parsedData.storage.type.toLowerCase()) &&
		Array.isArray(parsedData.items)
	) {
		const normalized = normalizeHammyItemsArray(parsedData.items);
		if (normalized) {
			return { inventory: normalized, source: "Hammy Vehicle storage" };
		}
	}

	if (parsedData.vehicle && parsedData.inventory && typeof parsedData.inventory === "object") {
		return { inventory: parsedData.inventory, source: "Vehicle trunk" };
	}

	if (isVehicleInventoryContext(parsedData) && parsedData.inventory && typeof parsedData.inventory === "object") {
		return { inventory: parsedData.inventory, source: "Vehicle inventory context" };
	}

	const trunkPayload = getTrunkPayloadFromAny(parsedData);
	if (trunkPayload) {
		return { inventory: trunkPayload, source: "Vehicle trunk" };
	}

	return null;
}

function getTrunkPayloadFromAny(data) {
	if (!data || typeof data !== "object") {
		return null;
	}

	const parsedData = parseLikelySerializedPayload(data);

	return (
		parsedData.trunk ||
		parsedData.trunkInventory ||
		parsedData.trunk_inventory ||
		parsedData.vehicleTrunk ||
		parsedData.vehicle_trunk ||
		parsedData.vehicleTrunkInventory ||
		parsedData.vehicle_trunk_inventory ||
		null
	);
}

function extractTycoonChestInventory(data) {
	if (!data || typeof data !== "object") {
		return null;
	}

	for (const [key, value] of Object.entries(data)) {
		if (!key.startsWith("chest_")) {
			continue;
		}
		const parsed = tryParseJsonObject(value);
		if (!parsed || typeof parsed !== "object") {
			continue;
		}

		const layoutOrder = [];
		for (const rawItemKey of Object.keys(parsed)) {
			const trackedItem = resolveTrackedItemKey(rawItemKey);
			if (trackedItem && !layoutOrder.includes(trackedItem)) {
				layoutOrder.push(trackedItem);
			}
		}

		const normalized = normalizeTrackedItemTable(parsed);
		if (normalized) {
			return {
				inventory: normalized,
				chestId: key.slice("chest_".length),
				layoutOrder
			};
		}
	}

	return null;
}

function isTrunkMenuOpen(data) {
	if (!data || typeof data !== "object") {
		return false;
	}

	if (typeof data.menu_open !== "boolean") {
		return false;
	}

	if (!data.menu_open) {
		return false;
	}

	const menuName = typeof data.menu === "string" ? data.menu.toLowerCase() : "";
	return menuName.includes("trunk");
}

function parseMenuChoices(rawChoices) {
	if (Array.isArray(rawChoices)) {
		return rawChoices;
	}

	const parsed = tryParseJsonObject(rawChoices);
	if (Array.isArray(parsed)) {
		return parsed;
	}

	return [];
}

function cleanMenuChoiceLabel(rawLabel) {
	if (typeof rawLabel !== "string") {
		return "";
	}

	return rawLabel
		.replace(/<[^>]*>/g, "")
		.replace(/&#\d+;/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function findTycoonMenuChoice(...candidateLabels) {
	const candidates = candidateLabels.map((label) => label.toLowerCase());
	for (const choice of state.tycoonTrunk.menuChoices) {
		if (!Array.isArray(choice) || typeof choice[0] !== "string") {
			continue;
		}
		const normalized = cleanMenuChoiceLabel(choice[0]).toLowerCase();
		if (candidates.includes(normalized)) {
			return choice[0];
		}
	}
	return null;
}

function getTycoonMenuChoiceLabels(limit = 12) {
	if (!Array.isArray(state.tycoonTrunk.menuChoices)) {
		return [];
	}

	const labels = [];
	for (const choice of state.tycoonTrunk.menuChoices) {
		if (!Array.isArray(choice) || typeof choice[0] !== "string") {
			continue;
		}
		const cleaned = cleanMenuChoiceLabel(choice[0]);
		if (cleaned) {
			labels.push(cleaned);
		}
		if (labels.length >= limit) {
			break;
		}
	}

	return labels;
}

function forceTycoonMenuChoice(rawChoiceLabel, mod = 0) {
	if (typeof rawChoiceLabel !== "string" || !rawChoiceLabel.trim()) {
		return false;
	}

	window.parent.postMessage(
		{
			type: "forceMenuChoice",
			choice: rawChoiceLabel,
			mod
		},
		"*"
	);

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "force-menu-choice",
		choice: cleanMenuChoiceLabel(rawChoiceLabel),
		mod
	});

	return true;
}

function requestTycoonMenuState(reason = "") {
	const payloads = [
		{ type: "getData" },
		{ type: "getData", scope: "menu" },
		{ type: "getData", scope: "menuState" },
		{
			type: "getData",
			include: ["menu_open", "menu", "menu_choices", "menu_choice", "prompt", "prompt_open", "chest"],
			reason
		}
	];

	for (const payload of payloads) {
		window.parent.postMessage(payload, "*");
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "menu-state-request",
		reason,
		variants: payloads.length
	});
}

async function pulseTycoonMenuState(reason, pulses = 1, delayMs = 70) {
	const count = Math.max(1, Math.floor(Number(pulses) || 1));
	for (let index = 0; index < count; index += 1) {
		requestTycoonMenuState(`${reason}-${index + 1}`);
		await new Promise((resolve) => window.setTimeout(resolve, delayMs));
	}
}

async function nudgeTycoonMenuStateIfStale(reason = "") {
	if (!state.tycoonTrunk.menuOpen || state.tycoonTrunk.menuChoices.length > 0) {
		return;
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "menu-state-stale-nudge",
		reason,
		menuName: state.tycoonTrunk.menuName,
		menuChoicesKnown: state.tycoonTrunk.menuChoices.length
	});

	window.parent.postMessage({ type: "forceMenuBack" }, "*");
	await new Promise((resolve) => window.setTimeout(resolve, 50));
	window.parent.postMessage({ type: "openMainMenu" }, "*");
	await pulseTycoonMenuState(`stale-nudge-${reason}`, 1, 70);
}

function getTycoonTransitionSnapshot() {
	return JSON.stringify({
		menuOpen: state.tycoonTrunk.menuOpen,
		menuName: state.tycoonTrunk.menuName,
		promptOpen: state.tycoonTrunk.promptOpen,
		lastMenuChoice: state.tycoonTrunk.lastMenuChoice,
		lastMenuChoiceAt: state.tycoonTrunk.lastMenuChoiceAt
	});
}

async function forceTycoonMenuChoiceWithWait(rawChoiceLabel, mod = 0, timeoutMs = 320) {
	const startedSnapshot = getTycoonTransitionSnapshot();
	if (!forceTycoonMenuChoice(rawChoiceLabel, mod)) {
		return false;
	}

	await waitForCondition(() => getTycoonTransitionSnapshot() !== startedSnapshot, timeoutMs, 40);
	return true;
}

function forceTycoonSubmitValue(value) {
	const numeric = Math.max(1, Math.floor(Number(value) || 1));
	window.parent.postMessage(
		{
			type: "forceSubmitValue",
			value: String(numeric)
		},
		"*"
	);

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "force-submit-value",
		value: numeric
	});

	return true;
}

function getMenuKeyCode(keyName) {
	const normalized = String(keyName || "").toLowerCase();
	if (normalized === "up") {
		return 38;
	}
	if (normalized === "down") {
		return 40;
	}
	if (normalized === "left") {
		return 37;
	}
	if (normalized === "right") {
		return 39;
	}
	if (normalized === "enter") {
		return 13;
	}
	if (normalized === "back") {
		return 8;
	}
	if (normalized === "home") {
		return 36;
	}
	return 0;
}

function postTycoonMenuKeyVariants(keyName) {
	const keyCode = getMenuKeyCode(keyName);
	const upperKey = String(keyName || "").toUpperCase();
	const payloads = [
		{ type: "forceMenuKey", key: keyName },
		{ type: "menuKeyPress", key: keyName },
		{ type: "keyPress", key: keyName },
		{ type: "simulateKeyPress", key: keyName },
		{ type: "mMenuKey", key: keyName },
		{ type: "menuInput", key: keyName },
		{ type: "menuControl", control: upperKey },
		{ type: "controlPress", control: upperKey },
		{ type: "forceControl", control: upperKey },
		{ action: "menuKey", type: "menuKey", key: keyName },
		{ action: "mMenuKey", type: "mMenuKey", key: keyName },
		{ action: "menuControl", type: "menuControl", control: upperKey },
		{ type: "forceMenuKey", key: keyName, keyCode },
		{ type: "menuKeyPress", key: keyName, keyCode },
		{ type: "keyPress", key: keyName, keyCode },
		{ type: "simulateKeyPress", key: keyName, keyCode },
		{ type: "menuControl", control: upperKey, keyCode },
		{ type: "controlPress", control: upperKey, keyCode }
	];

	for (const payload of payloads) {
		window.parent.postMessage(payload, "*");
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "force-menu-key",
		key: keyName,
		keyCode,
		control: upperKey,
		variants: payloads.length
	});
}

async function pressTycoonMenuKey(keyName, repeat = 1, delayMs = 70) {
	const times = Math.max(1, Math.floor(Number(repeat) || 1));
	for (let index = 0; index < times; index += 1) {
		postTycoonMenuKeyVariants(keyName);
		await new Promise((resolve) => window.setTimeout(resolve, delayMs));
	}
}

function getTycoonLayoutIndexForItem(trackedItem) {
	if (!Array.isArray(state.tycoonTrunk.layoutOrder) || state.tycoonTrunk.layoutOrder.length === 0) {
		return -1;
	}

	return state.tycoonTrunk.layoutOrder.findIndex((entry) => entry === trackedItem);
}

async function takeFromTycoonMenuByLayoutKeystrokes(trackedItem, requestedAmount = 1) {
	const safeAmount = Math.max(1, Math.floor(Number(requestedAmount) || 1));
	const itemIndex = getTycoonLayoutIndexForItem(trackedItem);
	if (itemIndex < 0) {
		debugLogMessage({
			type: "pizza-job-debug",
			stage: "layout-key-nav-missing-item",
			trackedItem,
			layoutOrder: Array.isArray(state.tycoonTrunk.layoutOrder)
				? [...state.tycoonTrunk.layoutOrder]
				: []
		});
		return false;
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "layout-key-nav-start",
		trackedItem,
		itemIndex,
		layoutSize: state.tycoonTrunk.layoutOrder.length,
		amount: safeAmount
	});

	await pulseTycoonMenuState("key-nav-start", 1, 70);

	// Keystroke-only m_menu flow: select first option (expected to be Take) via Enter.
	await pressTycoonMenuKey("home", 1, 70);
	await pressTycoonMenuKey("up", 6, 55);
	await pressTycoonMenuKey("enter", 1, 95);
	await new Promise((resolve) => window.setTimeout(resolve, 70));
	await pulseTycoonMenuState("key-nav-after-open", 1, 70);

	// Normalize cursor to top and select by known item index.
	await pressTycoonMenuKey("home", 1, 70);
	await pressTycoonMenuKey("up", 6, 55);
	if (itemIndex > 0) {
		await pressTycoonMenuKey("down", itemIndex, 60);
	}
	await pressTycoonMenuKey("enter", 1, 90);
	await pulseTycoonMenuState("key-nav-after-item-enter", 1, 70);

	// If prompt doesn't show, retry once with stronger reset and alternate open.
	const promptOpened = await waitForCondition(() => state.tycoonTrunk.promptOpen, 220, 35);
	if (!promptOpened) {
		await nudgeTycoonMenuStateIfStale("key-nav-no-prompt-first-pass");
		await pressTycoonMenuKey("back", 1, 80);
		await pressTycoonMenuKey("enter", 1, 95);
		await pressTycoonMenuKey("up", 14, 50);
		if (itemIndex > 0) {
			await pressTycoonMenuKey("down", itemIndex, 58);
		}
		await pressTycoonMenuKey("enter", 1, 90);
	}

	await waitForCondition(() => state.tycoonTrunk.promptOpen, 320, 35);
	await pulseTycoonMenuState("key-nav-before-submit", 1, 70);
	forceTycoonSubmitValue(safeAmount);
	await pressTycoonMenuKey("enter", 1, 90);
	await runTycoonTakeConfirmLadder(trackedItem, safeAmount, TYCOON_ITEM_ID_BY_TRACKED[trackedItem] || "");

	return true;
}

function sendTycoonCommand(command) {
	if (typeof command !== "string" || !command.trim()) {
		return false;
	}

	window.parent.postMessage(
		{
			type: "sendCommand",
			command
		},
		"*"
	);

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "force-send-command",
		command
	});

	return true;
}

function forceTycoonChoiceFromCandidates(candidates, mod = 0) {
	const seen = new Set();
	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			continue;
		}
		const trimmed = candidate.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		if (forceTycoonMenuChoice(trimmed, mod)) {
			debugLogMessage({
				type: "pizza-job-debug",
				stage: "fallback-force-literal",
				choice: trimmed,
				mod
			});
			return true;
		}
	}
	return false;
}

function markTycoonTakeSuccess(trackedItem) {
	if (typeof trackedItem !== "string" || !trackedItem.trim()) {
		return;
	}

	state.tycoonTrunk.lastTakeItem = trackedItem;
	state.tycoonTrunk.lastTakeAt = Date.now();
}

function wasRecentTycoonTakeSuccess(trackedItem, windowMs = 1300) {
	if (state.tycoonTrunk.lastTakeItem !== trackedItem) {
		return false;
	}

	return Date.now() - state.tycoonTrunk.lastTakeAt <= windowMs;
}

function getTrackedItemLabelWithWeight(item) {
	const weight = Number(TRACKED_ITEM_WEIGHTS_KG[item]);
	if (!Number.isFinite(weight)) {
		return item;
	}

	return `${item} (${weight.toFixed(2)} kg)`;
}

async function runTycoonTakeConfirmLadder(trackedItem, requestedAmount, itemId = "") {
	const safeAmount = Math.max(1, Math.floor(Number(requestedAmount) || 1));
	const modVariants = Array.from(new Set([0, -1, 1, -safeAmount, safeAmount]));
	const itemCandidates = [
		trackedItem,
		itemId,
		itemId.replace(/_/g, " "),
		`<span sort='A'></span>${trackedItem}`,
		`<span sort='A'></span>${itemId}`
	].filter(Boolean);

	for (const mod of modVariants) {
		if (wasRecentTycoonTakeSuccess(trackedItem)) {
			debugLogMessage({
				type: "pizza-job-debug",
				stage: "fallback-stop-after-success",
				trackedItem,
				reason: "recent-success-before-mod"
			});
			break;
		}

		await new Promise((resolve) => window.setTimeout(resolve, 45));
		if (state.tycoonTrunk.promptOpen) {
			forceTycoonSubmitValue(safeAmount);
		}

		const currentItemOption = findTycoonMenuChoice(trackedItem);
		if (currentItemOption) {
			await forceTycoonMenuChoiceWithWait(currentItemOption, mod);
		} else {
			forceTycoonChoiceFromCandidates(itemCandidates, mod);
		}

		const promptOpened = await waitForCondition(() => state.tycoonTrunk.promptOpen, 160, 30);
		if (promptOpened) {
			forceTycoonSubmitValue(safeAmount);
			await waitForCondition(() => wasRecentTycoonTakeSuccess(trackedItem), 220, 30);
			if (wasRecentTycoonTakeSuccess(trackedItem)) {
				debugLogMessage({
					type: "pizza-job-debug",
					stage: "fallback-stop-after-success",
					trackedItem,
					reason: "recent-success-after-submit"
				});
				break;
			}
		}
	}

	const confirmCandidates = [
		"Confirm",
		"Submit",
		"Accept",
		"Done",
		"Take",
		"Yes",
		"Ok",
		"Okay"
	];

	for (const confirmLabel of confirmCandidates) {
		if (wasRecentTycoonTakeSuccess(trackedItem)) {
			break;
		}

		const option = findTycoonMenuChoice(confirmLabel);
		if (!option) {
			continue;
		}

		forceTycoonMenuChoice(option, 0);
		await new Promise((resolve) => window.setTimeout(resolve, 45));
		if (state.tycoonTrunk.promptOpen) {
			forceTycoonSubmitValue(safeAmount);
		}

		await waitForCondition(() => wasRecentTycoonTakeSuccess(trackedItem), 220, 30);

		debugLogMessage({
			type: "pizza-job-debug",
			stage: "fallback-confirm-choice",
			choice: cleanMenuChoiceLabel(option)
		});

		if (wasRecentTycoonTakeSuccess(trackedItem)) {
			break;
		}

		break;
	}
}

function waitForCondition(checkFn, timeoutMs = 1200, intervalMs = 60) {
	return new Promise((resolve) => {
		const started = Date.now();
		const timer = window.setInterval(() => {
			if (checkFn()) {
				window.clearInterval(timer);
				resolve(true);
				return;
			}

			if (Date.now() - started >= timeoutMs) {
				window.clearInterval(timer);
				resolve(false);
			}
		}, intervalMs);
	});
}

function isTycoonTakeSubmenuReady(trackedItem) {
	const menuName = cleanMenuChoiceLabel(state.tycoonTrunk.menuName).toLowerCase();
	return menuName === "take" || Boolean(findTycoonMenuChoice(trackedItem));
}

async function takeFromTycoonMenuFallback(trackedItem, requestedAmount = 1) {
	const itemId = TYCOON_ITEM_ID_BY_TRACKED[trackedItem] || "";
	const takeSubmenuReady = isTycoonTakeSubmenuReady(trackedItem);
	if (!takeSubmenuReady) {
		const takeOption = findTycoonMenuChoice("Take");
		const usedTakeChoice =
			takeOption ||
			findTycoonMenuChoice("<span sort='A'></span>Take") ||
			"Take";
		if (!takeOption) {
			debugLogMessage({
				type: "pizza-job-debug",
				stage: "fallback-missing-take-option",
				menuName: state.tycoonTrunk.menuName
			});
		}

		if (!(await forceTycoonMenuChoiceWithWait(usedTakeChoice, 0, 220))) {
			return false;
		}

		// Give the Take submenu a brief chance to materialize so we can use real item choices.
		await waitForCondition(() => isTycoonTakeSubmenuReady(trackedItem), 160, 30);
	}

	const itemOption = findTycoonMenuChoice(trackedItem);
	if (itemOption) {
		await forceTycoonMenuChoiceWithWait(itemOption, 0, 220);
		debugLogMessage({
			type: "pizza-job-debug",
			stage: "fallback-item-choice",
			trackedItem,
			via: "menu-choices"
		});
		const promptOpened = await waitForCondition(() => state.tycoonTrunk.promptOpen, 220, 30);
		if (promptOpened) {
			forceTycoonSubmitValue(requestedAmount);
			await waitForCondition(
				() => wasRecentTycoonTakeSuccess(trackedItem) || !state.tycoonTrunk.promptOpen,
				620,
				30
			);
			if (!state.tycoonTrunk.promptOpen) {
				return true;
			}
		}
		if (wasRecentTycoonTakeSuccess(trackedItem)) {
			return true;
		}
		await runTycoonTakeConfirmLadder(trackedItem, requestedAmount, itemId);
		return true;
	}

	const fallbackCandidates = [
		trackedItem,
		itemId,
		itemId.replace(/_/g, " "),
		`<span sort='A'></span>${trackedItem}`,
		`<span sort='A'></span>${itemId}`
	];
	const forced = forceTycoonChoiceFromCandidates(fallbackCandidates, 0);
	if (!forced) {
		debugLogMessage({
			type: "pizza-job-debug",
			stage: "fallback-item-choice-missing",
			trackedItem,
			itemId
		});
		return false;
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "fallback-item-choice",
		trackedItem,
		via: "literal"
	});

	let promptOpened = await waitForCondition(
		() => state.tycoonTrunk.promptOpen || isTycoonTakeSubmenuReady(trackedItem),
		160,
		30
	);

	if (!state.tycoonTrunk.promptOpen) {
		const resolvedItemOption = findTycoonMenuChoice(trackedItem);
		if (resolvedItemOption) {
			await forceTycoonMenuChoiceWithWait(resolvedItemOption, 0, 180);
			promptOpened = await waitForCondition(() => state.tycoonTrunk.promptOpen, 180, 30);
		} else {
			promptOpened = false;
		}
	}

	if (!promptOpened) {
		await new Promise((resolve) => window.setTimeout(resolve, 55));
		forceTycoonChoiceFromCandidates(fallbackCandidates, 0);
		promptOpened = await waitForCondition(() => state.tycoonTrunk.promptOpen, 180, 30);
	}

	if (promptOpened) {
		forceTycoonSubmitValue(requestedAmount);
		await waitForCondition(
			() => wasRecentTycoonTakeSuccess(trackedItem) || !state.tycoonTrunk.promptOpen,
			620,
			30
		);
		if (!state.tycoonTrunk.promptOpen) {
			return true;
		}
	}
	if (wasRecentTycoonTakeSuccess(trackedItem)) {
		return true;
	}
	await runTycoonTakeConfirmLadder(trackedItem, requestedAmount, itemId);

	return true;
}

function hasTycoonTrunkContext() {
	return Boolean(state.tycoonTrunk.menuOpen && state.tycoonTrunk.activeChestId);
}

async function ensureTycoonTrunkContext(reason = "") {
	if (hasTycoonTrunkContext()) {
		return true;
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "trunk-open-start",
		reason,
		menuOpen: state.tycoonTrunk.menuOpen,
		activeChestId: state.tycoonTrunk.activeChestId
	});

	refreshVehicleTrunkInventory(`ensure-trunk-${reason || "action"}`);
	requestTycoonMenuState(`ensure-trunk-${reason || "action"}-initial`);

	const existingContextReady = await waitForCondition(hasTycoonTrunkContext, 120, 30);
	if (existingContextReady) {
		debugLogMessage({
			type: "pizza-job-debug",
			stage: "trunk-open-success",
			via: "existing-context",
			reason,
			chest: state.tycoonTrunk.activeChestId
		});
		return true;
	}

	for (const command of TYCOON_OPEN_TRUNK_COMMANDS) {
		sendTycoonCommand(command);
		requestTycoonMenuState(`ensure-trunk-${reason || "action"}-${command}`);
		refreshVehicleTrunkInventory(`ensure-trunk-${command}`);

		const opened = await waitForCondition(hasTycoonTrunkContext, command === "rm_trunk" ? 520 : 620, 35);
		if (opened) {
			debugLogMessage({
				type: "pizza-job-debug",
				stage: "trunk-open-success",
				via: command,
				reason,
				chest: state.tycoonTrunk.activeChestId
			});
			return true;
		}
	}

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "trunk-open-failed",
		reason,
		menuOpen: state.tycoonTrunk.menuOpen,
		activeChestId: state.tycoonTrunk.activeChestId
	});

	return false;
}

async function requestTycoonTrunkTake(trackedItem, amount) {
	const itemId = TYCOON_ITEM_ID_BY_TRACKED[trackedItem];
	if (!itemId) {
		showToast(`No Tycoon item mapping for ${trackedItem}.`);
		debugLogMessage({
			type: "pizza-job-debug",
			stage: "take-blocked",
			reason: "missing-item-map",
			trackedItem
		});
		return false;
	}

	if (!(await ensureTycoonTrunkContext(`take-${itemId}`))) {
		showToast("Could not open your trunk automatically. Try facing the trunk and try again.");
		debugLogMessage({
			type: "pizza-job-debug",
			stage: "take-blocked",
			reason: "missing-trunk-context",
			menuOpen: state.tycoonTrunk.menuOpen,
			activeChestId: state.tycoonTrunk.activeChestId,
			trackedItem,
			amount
		});
		return false;
	}

	const safeAmount = Math.max(1, Math.floor(Number(amount) || 1));
	const beforeInventory = state.inventory[trackedItem] || 0;
	const beforeTrunk = state.trunk[trackedItem] || 0;
	const hasStateChanged = () =>
		(state.inventory[trackedItem] || 0) !== beforeInventory || (state.trunk[trackedItem] || 0) !== beforeTrunk;
	debugLogMessage({
		type: "pizza-job-debug",
		stage: "take-dispatch",
		trackedItem,
		itemId,
		amount: safeAmount,
		chest: state.tycoonTrunk.activeChestId
	});

	debugLogMessage({
		type: "pizza-job-debug",
		stage: "m-menu-primary-start",
		trackedItem,
		itemId,
		amount: safeAmount
	});

	await pulseTycoonMenuState("m-menu-primary-start", 1, 70);

	const hasDirectMenuChoices = Boolean(
		state.tycoonTrunk.menuOpen &&
			state.tycoonTrunk.menuChoices.length > 0 &&
			(findTycoonMenuChoice("Take") || isTycoonTakeSubmenuReady(trackedItem))
	);

	if (!hasDirectMenuChoices) {
		const keyNavTriggered = await takeFromTycoonMenuByLayoutKeystrokes(trackedItem, safeAmount);
		if (keyNavTriggered) {
			const keyNavWorked = await waitForCondition(hasStateChanged, 650, 50);
			if (keyNavWorked) {
				debugLogMessage({
					type: "pizza-job-debug",
					stage: "m-menu-key-nav-success",
					trackedItem,
					itemId,
					amount: safeAmount
				});
				return true;
			}

			debugLogMessage({
				type: "pizza-job-debug",
				stage: "m-menu-key-nav-no-change",
				trackedItem,
				itemId,
				amount: safeAmount
			});
		}
	}

	const promptSeenBeforeFallback = lastTycoonPromptSeenAt;
	const fallbackTriggered = await takeFromTycoonMenuFallback(trackedItem, safeAmount);
	if (fallbackTriggered) {
		const promptObservedDuringFallback =
			state.tycoonTrunk.promptOpen || lastTycoonPromptSeenAt > promptSeenBeforeFallback;
		if (!promptObservedDuringFallback) {
			await nudgeTycoonMenuStateIfStale("literal-fallback-no-prompt");
			debugLogMessage({
				type: "pizza-job-debug",
				stage: "fallback-no-prompt",
				trackedItem,
				menuName: state.tycoonTrunk.menuName,
				menuChoicesKnown: state.tycoonTrunk.menuChoices.length
			});
		}

		const mMenuWorked = await waitForCondition(hasStateChanged, promptObservedDuringFallback ? 800 : 400, 50);
		if (mMenuWorked) {
			debugLogMessage({
				type: "pizza-job-debug",
				stage: "m-menu-primary-success",
				trackedItem,
				itemId,
				amount: safeAmount
			});
			return true;
		}
	}

	showToast("No inventory change detected after the working menu flow.");
	debugLogMessage({
		type: "pizza-job-debug",
		stage: "m-menu-primary-no-change",
		trackedItem,
		itemId,
		amount: safeAmount,
		menuOpen: state.tycoonTrunk.menuOpen,
		menuName: state.tycoonTrunk.menuName,
		activeChestId: state.tycoonTrunk.activeChestId,
		menuChoices: getTycoonMenuChoiceLabels()
	});
	return false;
}

function isVehicleInventoryContext(data) {
	if (!data || typeof data !== "object") {
		return false;
	}

	const storageType = data.storage?.type;
	if (typeof storageType === "string") {
		const normalizedType = storageType.toLowerCase();
		if (["vehicle", "trunk", "vehicle_trunk"].includes(normalizedType)) {
			return true;
		}
	}

	const storageId = data.storage?.id;
	if (typeof storageId === "string") {
		const normalizedId = storageId.toLowerCase();
		if (normalizedId.startsWith("veh_") || normalizedId.includes("trunk")) {
			return true;
		}
	}

	const eventName = getEventNameFromAny(data).toLowerCase();
	if (eventName.includes("trunk") || eventName.includes("vehicle")) {
		return true;
	}

	return false;
}

function getInVehicleStateFromAny(data) {
	if (!data || typeof data !== "object") {
		return null;
	}

	if (typeof data.inVehicle === "boolean") {
		return data.inVehicle;
	}
	if (typeof data.in_vehicle === "boolean") {
		return data.in_vehicle;
	}
	if (typeof data.isInVehicle === "boolean") {
		return data.isInVehicle;
	}
	if (typeof data.is_in_vehicle === "boolean") {
		return data.is_in_vehicle;
	}
	if (typeof data.vehicleEntered === "boolean") {
		return data.vehicleEntered;
	}
	if (typeof data.vehicle_entered === "boolean") {
		return data.vehicle_entered;
	}

	return null;
}

function getEventNameFromAny(data) {
	if (!data || typeof data !== "object") {
		return "";
	}

	const candidates = [data.action, data.event, data.type, data.name];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}

	return "";
}

function shouldRefreshFromVehicleStateChange(nextState) {
	if (typeof nextState !== "boolean") {
		return false;
	}

	if (lastInVehicleState === null) {
		lastInVehicleState = nextState;
		return true;
	}

	if (lastInVehicleState !== nextState) {
		lastInVehicleState = nextState;
		return true;
	}

	return false;
}

function applyTrunkInventoryFromVehicle(payload, sourceLabel = "vehicle trunk") {
	const normalized = normalizeTrackedItemTable(payload);
	if (!normalized) {
		return;
	}

	if (trunksEqual(state.trunk, normalized)) {
		return;
	}

	state.trunk = normalized;
	renderTrunk();
	showToast(`Trunk Inventory synced from ${sourceLabel}.`, 1800);
}

function refreshVehicleTrunkInventory(reason) {
	if (!state.isPizzaDeliveryActive) {
		return;
	}

	const now = Date.now();
	if (now - lastVehicleTrunkRefreshAt < VEHICLE_TRUNK_REFRESH_COOLDOWN_MS) {
		return;
	}
	lastVehicleTrunkRefreshAt = now;

	// Broad compatibility: some bridges only respond to plain getData.
	window.parent.postMessage(
		{
			type: "getData"
		},
		"*"
	);

	window.parent.postMessage({
		type: "getData",
		scope: "vehicleTrunk",
		reason
	}, "*");

	if (!window.GetParentResourceName) {
		return;
	}

	const resourceName = window.GetParentResourceName();
	fetch(`https://${resourceName}/getVehicleTrunkInventory`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ reason })
	})
		.then((response) => response.json())
		.then((payload) => {
			if (payload?.trunk) {
				applyTrunkInventoryFromVehicle(payload.trunk, "vehicle trunk");
			}
		})
		.catch(() => {
			// Endpoint may not exist in local browser testing.
		});
}

function parseOrderFromText(orderText) {
	if (typeof orderText !== "string" || !orderText.trim()) {
		return null;
	}

	const parsed = {};
	TRACKED_ITEMS.forEach((item) => {
		const escapedItem = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`${escapedItem}\\s*[:x-]?\\s*(\\d+)`, "i");
		const match = orderText.match(regex);
		parsed[item] = match ? Math.max(0, Number(match[1])) : 0;
	});

	if (Object.values(parsed).every((value) => value === 0)) {
		return null;
	}

	return parsed;
}

function updateOrderFromSource(orderPayload, sourceLabel) {
	const normalized = normalizeOrderPayload(orderPayload);
	if (!normalized) {
		return;
	}

	if (ordersEqual(state.order, normalized)) {
		return;
	}

	state.order = normalized;
	state.orderId = generateRandomOrderId();
	markOrderSynced(sourceLabel);
	render();
	showToast(`Order synced from ${sourceLabel}.`);
}

function updateOrderFromText(orderText, sourceLabel) {
	const parsed = parseOrderFromText(orderText);
	if (!parsed) {
		return;
	}

	if (ordersEqual(state.order, parsed)) {
		return;
	}

	state.order = parsed;
	state.orderId = generateRandomOrderId();
	markOrderSynced(sourceLabel);
	render();
	showToast(`Order parsed from ${sourceLabel}.`);
}

function updateOrderFromPizzaDeliveryWindow(windowPayload) {
	if (!windowPayload || typeof windowPayload !== "object") {
		return;
	}

	if (windowPayload.order && typeof windowPayload.order === "object") {
		updateOrderFromSource(windowPayload.order, "Pizza Delivery 0/1 window");
		return;
	}

	if (typeof windowPayload.text === "string") {
		updateOrderFromText(windowPayload.text, "Pizza Delivery 0/1 window");
	}
}

function handleIncomingOrderPayload(payload) {
	if (!payload || typeof payload !== "object") {
		return false;
	}

	if (payload.action === "pizzaDeliveryWindow") {
		updateOrderFromPizzaDeliveryWindow(payload);
		return true;
	}

	if (payload.action === "pizzaDeliveryOrder" && payload.order) {
		updateOrderFromSource(payload.order, "Pizza Delivery window");
		return true;
	}

	if (
		(payload.action === "pizzaDeliveryWindowText" || payload.action === "pizzaDeliveryOrderText") &&
		typeof payload.text === "string"
	) {
		updateOrderFromText(
			payload.text,
			payload.action === "pizzaDeliveryWindowText" ? "Pizza Delivery 0/1 window" : "Pizza Delivery window"
		);
		return true;
	}

	return false;
}

function updateMissionMarker(markerPayload) {
	if (!markerPayload || typeof markerPayload !== "object") {
		return;
	}

	const x = Number(markerPayload.x);
	const y = Number(markerPayload.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return;
	}

	state.settings.gpsX = x;
	state.settings.gpsY = y;
	saveSettings();
	render();
}

function handleIncomingMarkerPayload(payload) {
	if (!payload || typeof payload !== "object") {
		return false;
	}

	if ((payload.action === "missionMarkerUpdate" || payload.action === "yellowMarkerUpdate") && payload.marker) {
		updateMissionMarker(payload.marker);
		return true;
	}

	return false;
}

function requestNuiData() {
	if (!state.isPizzaDeliveryActive) {
		return;
	}

	if (!window.GetParentResourceName) {
		return;
	}

	const resourceName = window.GetParentResourceName();
	fetch(`https://${resourceName}/getPizzaDeliveryOrder`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: "{}"
	})
		.then((response) => response.json())
		.then((payload) => {
			if (payload?.order) {
				updateOrderFromSource(payload.order, "Pizza Delivery window");
			} else if (payload?.text) {
				updateOrderFromText(payload.text, "Pizza Delivery window");
			}
		})
		.catch(() => {
			// Ignore polling errors while endpoint is unavailable.
		});

	fetch(`https://${resourceName}/getPizzaDeliveryWindow`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: "{}"
	})
		.then((response) => response.json())
		.then((payload) => {
			updateOrderFromPizzaDeliveryWindow(payload);
		})
		.catch(() => {
			// Ignore polling errors while endpoint is unavailable.
		});

	fetch(`https://${resourceName}/getMissionMarker`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: "{}"
	})
		.then((response) => response.json())
		.then((payload) => {
			if (payload?.marker) {
				updateMissionMarker(payload.marker);
			}
		})
		.catch(() => {
			// Ignore polling errors while endpoint is unavailable.
		});
}

function resetPanelLayout() {
	if (isMobileLayout()) {
		refs.app.style.left = "";
		refs.app.style.top = "";
		refs.app.style.width = "";
		refs.app.style.height = "";
		localStorage.removeItem(PANEL_LAYOUT_STORAGE_KEY);
		return;
	}

	refs.app.style.left = "24px";
	refs.app.style.top = "24px";
	refs.app.style.width = "min(760px, calc(100vw - 48px))";
	refs.app.style.height = "min(460px, calc(100vh - 48px))";
	localStorage.removeItem(PANEL_LAYOUT_STORAGE_KEY);
}

function startDrag(event) {
	if (isMobileLayout()) {
		return;
	}

	const target = event.target;
	if (target instanceof HTMLElement && target.closest("button")) {
		return;
	}

	panelState.dragging = true;
	panelState.startX = event.clientX;
	panelState.startY = event.clientY;
	panelState.startLeft = refs.app.offsetLeft;
	panelState.startTop = refs.app.offsetTop;
}

function startResize(event) {
	if (isMobileLayout()) {
		return;
	}

	event.preventDefault();
	panelState.resizing = true;
	panelState.startX = event.clientX;
	panelState.startY = event.clientY;
	panelState.startWidth = refs.app.offsetWidth;
	panelState.startHeight = refs.app.offsetHeight;
}

function startDebugPanelDrag(event) {
	if (isMobileLayout() || !refs.debugPanel) {
		return;
	}

	const target = event.target;
	if (target instanceof HTMLElement && target.closest("button")) {
		return;
	}

	debugPanelState.dragging = true;
	debugPanelState.startX = event.clientX;
	debugPanelState.startY = event.clientY;
	debugPanelState.startLeft = refs.debugPanel.offsetLeft;
	debugPanelState.startTop = refs.debugPanel.offsetTop;
}

function onPointerMove(event) {
	if (panelState.dragging) {
		const nextLeft = panelState.startLeft + (event.clientX - panelState.startX);
		const nextTop = panelState.startTop + (event.clientY - panelState.startY);

		const maxLeft = Math.max(0, window.innerWidth - refs.app.offsetWidth);
		const maxTop = Math.max(0, window.innerHeight - refs.app.offsetHeight);

		refs.app.style.left = `${clamp(nextLeft, 0, maxLeft)}px`;
		refs.app.style.top = `${clamp(nextTop, 0, maxTop)}px`;
	}

	if (panelState.resizing) {
		const { minWidth, minHeight } = getMinPanelSize();
		const nextWidth = panelState.startWidth + (event.clientX - panelState.startX);
		const nextHeight = panelState.startHeight + (event.clientY - panelState.startY);

		const maxWidth = window.innerWidth - refs.app.offsetLeft;
		const maxHeight = window.innerHeight - refs.app.offsetTop;

		refs.app.style.width = `${clamp(nextWidth, minWidth, maxWidth)}px`;
		refs.app.style.height = `${clamp(nextHeight, minHeight, maxHeight)}px`;
	}

	if (debugPanelState.dragging && refs.debugPanel) {
		const nextLeft = debugPanelState.startLeft + (event.clientX - debugPanelState.startX);
		const nextTop = debugPanelState.startTop + (event.clientY - debugPanelState.startY);
		const maxLeft = Math.max(0, window.innerWidth - refs.debugPanel.offsetWidth);
		const maxTop = Math.max(0, window.innerHeight - refs.debugPanel.offsetHeight);

		refs.debugPanel.style.left = `${clamp(nextLeft, 0, maxLeft)}px`;
		refs.debugPanel.style.top = `${clamp(nextTop, 0, maxTop)}px`;
	}
}

function stopPointerAction() {
	const changed = panelState.dragging || panelState.resizing;
	const debugChanged = debugPanelState.dragging || (refs.debugPanel && !refs.debugPanel.classList.contains("hidden"));
	panelState.dragging = false;
	panelState.resizing = false;
	debugPanelState.dragging = false;
	if (changed) {
		savePanelLayout();
	}
	if (debugChanged) {
		saveDebugPanelLayout();
	}
}

function clearOrder() {
	TRACKED_ITEMS.forEach((item) => {
		state.order[item] = 0;
	});
	markOrderSynced("Manual (Clear)");
	clearWaypointData();
	render();
	showToast("Order cleared.");
}

async function moveOne(itemName) {
	if (state.tycoonTrunk.busy) {
		showToast("Please wait, previous trunk action is still processing.");
		return;
	}

	if (state.trunk[itemName] <= 0) {
		showToast(`No ${itemName} left in trunk.`);
		return;
	}

	state.tycoonTrunk.busy = true;
	try {
		const requested = await requestTycoonTrunkTake(itemName, 1);
		if (requested) {
			showToast(`Requested +1 ${itemName} from trunk.`);
		}
	} finally {
		window.setTimeout(() => {
			state.tycoonTrunk.busy = false;
		}, 300);
	}
}

async function moveNeeded(itemName) {
	if (state.tycoonTrunk.busy) {
		showToast("Please wait, previous trunk action is still processing.");
		return;
	}

	const needed = Math.max(state.order[itemName] - state.inventory[itemName], 0);
	if (needed <= 0) {
		showToast(`${itemName} already covered for this order.`);
		return;
	}

	const transferable = Math.min(needed, state.trunk[itemName]);
	if (transferable <= 0) {
		showToast(`No ${itemName} in trunk.`);
		return;
	}

	state.tycoonTrunk.busy = true;
	try {
		const requested = await requestTycoonTrunkTake(itemName, transferable);
		if (requested) {
			showToast(`Requested ${transferable} ${itemName} from trunk.`);
		}
	} finally {
		window.setTimeout(() => {
			state.tycoonTrunk.busy = false;
		}, 300);
	}
}
function getLowStockItems() {
	return TRACKED_ITEMS.filter((item) => state.trunk[item] <= state.settings.lowThreshold);
}

function setWaypoint(x, y) {
	const payload = {
		action: "setWaypoint",
		x,
		y
	};

	// FiveM-friendly hook: your Lua/JS client can listen for this message from NUI.
	window.postMessage(payload, "*");

	// Optional NUI callback endpoint if this page is hosted by a FiveM resource.
	if (window.GetParentResourceName) {
		const resourceName = window.GetParentResourceName();
		fetch(`https://${resourceName}/setWaypoint`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(payload)
		}).catch(() => {
			// Ignore endpoint errors so local browser testing still works.
		});
	}
}

function applyGpsSettings() {
	state.settings.gpsEnabled = refs.gpsEnabledInput.checked;

	if (!state.settings.gpsEnabled) {
		saveSettings();
		showToast("GPS waypoint is disabled in settings.");
		return;
	}

	if (state.settings.gpsX === null || state.settings.gpsY === null) {
		saveSettings();
		showToast("No mission marker data available yet.");
		return;
	}

	setWaypoint(state.settings.gpsX, state.settings.gpsY);
	saveSettings();
	showToast(`Waypoint set to X: ${state.settings.gpsX}, Y: ${state.settings.gpsY}.`);
}

function renderOrder() {
	refs.orderId.textContent = `#${state.orderId}`;
	refs.orderList.innerHTML = "";

	TRACKED_ITEMS.forEach((item) => {
		const ordered = state.order[item];
		const have = state.inventory[item];
		const remaining = Math.max(ordered - have, 0);
		const row = document.createElement("div");
		row.className = `item-row ${remaining === 0 && ordered > 0 ? "fulfilled" : ""}`;
		row.innerHTML = `
			<div class="name">${getTrackedItemLabelWithWeight(item)}</div>
			<div class="qty">Order: ${ordered} | In Bag: ${have} | Need: ${remaining}</div>
			<button class="btn btn-secondary btn-tiny" data-move-needed="${item}">Take Needed</button>
		`;
		refs.orderList.appendChild(row);
	});
}

function renderTrunk() {
	refs.trunkList.innerHTML = "";
	const lows = getLowStockItems();
	refs.trunkAlertCount.textContent = `${lows.length} Low`;

	TRACKED_ITEMS.forEach((item) => {
		const row = document.createElement("div");
		const isLow = state.trunk[item] <= state.settings.lowThreshold;
		row.className = `item-row ${isLow ? "low-stock" : ""}`;
		row.innerHTML = `
			<div class="name">${getTrackedItemLabelWithWeight(item)}</div>
			<div class="qty">In Trunk: ${state.trunk[item]}</div>
			<button class="btn btn-secondary btn-tiny" data-move-one="${item}">Move +1</button>
		`;
		refs.trunkList.appendChild(row);
	});
}

function render() {
	renderOrder();
	renderTrunk();
	if (refs.orderSyncMeta) {
		refs.orderSyncMeta.textContent = getSyncDisplayText();
	}

	refs.lowThresholdInput.value = String(state.settings.lowThreshold);
	refs.bgOpacityInput.value = String(state.settings.bgOpacity);
	refs.bgOpacityValue.textContent = `${Math.round(state.settings.bgOpacity * 100)}%`;
	refs.gpsEnabledInput.checked = state.settings.gpsEnabled;
	applyWindowBackgroundOpacity();
}

function setupEventHandlers() {
	refs.topbar.addEventListener("pointerdown", startDrag);
	const debugHeader = refs.debugPanel.querySelector(".debug-header");
	if (debugHeader) {
		debugHeader.addEventListener("pointerdown", startDebugPanelDrag);
	}
	refs.panelResizeHandle.addEventListener("pointerdown", startResize);
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stopPointerAction);
	window.addEventListener("blur", stopPointerAction);

	refs.clearOrderBtn.addEventListener("click", clearOrder);

	refs.resetPanelBtn.addEventListener("click", () => {
		resetPanelLayout();
		showToast("Panel layout reset.");
	});

	refs.debugToggleBtn.addEventListener("click", () => {
		setDebugPanelOpen(refs.debugPanel.classList.contains("hidden"));
	});

	refs.debugCloseBtn.addEventListener("pointerdown", (event) => {
		event.stopPropagation();
	});

	refs.debugCloseBtn.addEventListener("click", () => {
		setDebugPanelOpen(false);
	});

	refs.debugClearBtn.addEventListener("click", () => {
		refs.debugLog.innerHTML = "";
	});

	refs.debugCopyBtn.addEventListener("click", () => {
		const entries = Array.from(refs.debugLog.children)
			.reverse()
			.map((el) => el.textContent)
			.join("\n");

		// navigator.clipboard is blocked in FiveM NUI — use legacy execCommand fallback.
		const ta = document.createElement("textarea");
		ta.value = entries;
		ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		showToast(ok ? "Log copied to clipboard." : "Copy failed — select log text manually.", 2400);
	});

	refs.debugFilterSelect.addEventListener("change", () => {
		setDebugFilterMode(refs.debugFilterSelect.value);
		saveDebugPanelLayout();
		showToast(`Debug filter set to ${refs.debugFilterSelect.options[refs.debugFilterSelect.selectedIndex].text}.`, 1800);
	});

	refs.debugVerboseToggle.addEventListener("change", () => {
		setVerboseRawDebugEnabled(refs.debugVerboseToggle.checked);
		saveDebugPanelLayout();
		showToast(refs.debugVerboseToggle.checked ? "Verbose raw payloads enabled." : "Verbose raw payloads disabled.", 1800);
	});

	refs.settingsToggleBtn.addEventListener("click", () => {
		refs.settingsPanel.classList.toggle("hidden");
	});

	refs.settingsCloseBtn.addEventListener("click", () => {
		refs.settingsPanel.classList.add("hidden");
	});

	refs.lowThresholdInput.addEventListener("change", () => {
		const parsed = Number(refs.lowThresholdInput.value);
		state.settings.lowThreshold = clamp(Number.isNaN(parsed) ? 5 : parsed, 1, 99);
		saveSettings();
		render();
		showToast(`Low stock threshold set to ${state.settings.lowThreshold}.`);
	});

	refs.bgOpacityInput.addEventListener("input", () => {
		const parsed = Number(refs.bgOpacityInput.value);
		state.settings.bgOpacity = clamp(Number.isNaN(parsed) ? 0.82 : parsed, 0, 1);
		refs.bgOpacityValue.textContent = `${Math.round(state.settings.bgOpacity * 100)}%`;
		applyWindowBackgroundOpacity();
		saveSettings();
	});

	refs.applyGpsBtn.addEventListener("click", applyGpsSettings);

	refs.orderList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const itemName = target.dataset.moveNeeded;
		if (itemName) {
			moveNeeded(itemName);
		}
	});

	refs.trunkList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const itemName = target.dataset.moveOne;
		if (itemName) {
			moveOne(itemName);
		}
	});

	window.addEventListener("message", (event) => {
		// Log every raw message so the debug panel shows real incoming payload shapes.
		debugLogMessage(event.data);

		const topLevelData = tryParseJsonObject(event.data) || event.data;
		if (!topLevelData || typeof topLevelData !== "object") {
			return;
		}

		const payloads = [topLevelData];
		const nestedPayload = tryParseJsonObject(topLevelData.data) || topLevelData.data;
		if (nestedPayload && typeof nestedPayload === "object") {
			payloads.push(nestedPayload);
		}

		for (const data of payloads) {
			if (!data || typeof data !== "object") {
				continue;
			}

			const parsedData = parseLikelySerializedPayload(data);
			updatePlayerJobStateFromPayload(parsedData);
			if (!state.isPizzaDeliveryActive) {
				continue;
			}

			if (typeof parsedData.chest === "string") {
				state.tycoonTrunk.activeChestId = parsedData.chest === "none" ? null : parsedData.chest;
			}

			if (typeof parsedData.menu_open === "boolean") {
				state.tycoonTrunk.menuOpen = isTrunkMenuOpen(parsedData);
			}

			if (typeof parsedData.menu === "string") {
				state.tycoonTrunk.menuName = parsedData.menu;
			}

			if (typeof parsedData.menu_choice === "string") {
				state.tycoonTrunk.lastMenuChoice = cleanMenuChoiceLabel(parsedData.menu_choice);
				state.tycoonTrunk.lastMenuChoiceAt = Date.now();
			}

			if (typeof parsedData.notification === "string") {
				const receivedMatch = parsedData.notification.match(/Received\s+\d+\s+~g~(.+?)~s~/i);
				if (receivedMatch && typeof receivedMatch[1] === "string") {
					const trackedItem = resolveTrackedItemKey(receivedMatch[1].trim());
					if (trackedItem) {
						markTycoonTakeSuccess(trackedItem);
					}
				}
			}

			if (typeof parsedData.prompt === "boolean") {
				state.tycoonTrunk.promptOpen = parsedData.prompt;
				if (parsedData.prompt) {
					lastTycoonPromptSeenAt = Date.now();
				}
			}

			if (typeof parsedData.prompt_open === "boolean") {
				state.tycoonTrunk.promptOpen = parsedData.prompt_open;
				if (parsedData.prompt_open) {
					lastTycoonPromptSeenAt = Date.now();
				}
			}

			if ("menu_choices" in parsedData) {
				state.tycoonTrunk.menuChoices = parseMenuChoices(parsedData.menu_choices);
			}

			const isInventoryUpdateAction = parsedData.action === "updateInventories";
			const passiveInventory = isInventoryUpdateAction ? null : normalizeTrackedItemTable(parsedData.inventory);
			if (passiveInventory) {
				state.inventory = passiveInventory;
				render();
				handleOrderCompletion();
			}

			const eventName = getEventNameFromAny(parsedData);

			// Optional inbound update for in-game integrations.
			if (isInventoryUpdateAction) {
				let parsedTrunk = normalizeTrackedItemTable(parsedData.trunk);
				if (!parsedTrunk && isVehicleInventoryContext(parsedData)) {
					parsedTrunk = normalizeTrackedItemTable(parsedData.inventory);
				}
				if (parsedTrunk && !trunksEqual(state.trunk, parsedTrunk)) {
					state.trunk = parsedTrunk;
				}

				const parsedInventory = normalizeTrackedItemTable(parsedData.inventory);
				if (parsedInventory) {
					state.inventory = parsedInventory;
				}

				render();
				handleOrderCompletion();
			}

			if (["vehicleEntered", "enteredVehicle"].includes(eventName)) {
				refreshVehicleTrunkInventory("vehicle-enter");
			}

			if (["vehicleExited", "exitedVehicle"].includes(eventName)) {
				refreshVehicleTrunkInventory("vehicle-exit");
			}

			if (eventName === "vehicleStateChanged") {
				const stateFromPayload = getInVehicleStateFromAny(parsedData);
				if (typeof stateFromPayload === "boolean") {
					refreshVehicleTrunkInventory(stateFromPayload ? "vehicle-enter" : "vehicle-exit");
				}
			}

			const vehicleTrunkData = resolveVehicleTrunkInventoryFromPayload(parsedData);
			if (vehicleTrunkData) {
				applyTrunkInventoryFromVehicle(vehicleTrunkData.inventory, vehicleTrunkData.source);
			}

			const tycoonChest = extractTycoonChestInventory(parsedData);
			if (tycoonChest) {
				state.tycoonTrunk.activeChestId = tycoonChest.chestId;
				state.tycoonTrunk.layoutOrder = Array.isArray(tycoonChest.layoutOrder)
					? tycoonChest.layoutOrder
					: [];
				applyTrunkInventoryFromVehicle(tycoonChest.inventory, "Tycoon trunk");
			}

			// Tycoon sends {vehicle:"modelName"} on enter and {vehicle:"onFoot"} on exit.
			if (typeof parsedData.vehicle === "string") {
				const nowInVehicle = parsedData.vehicle !== "onFoot";
				if (shouldRefreshFromVehicleStateChange(nowInVehicle) && nowInVehicle) {
					refreshVehicleTrunkInventory("vehicle-enter");
				}
			}

			const inVehicleState = getInVehicleStateFromAny(parsedData);
			if (shouldRefreshFromVehicleStateChange(inVehicleState)) {
				refreshVehicleTrunkInventory(inVehicleState ? "vehicle-enter" : "vehicle-exit");
			}

			handleIncomingOrderPayload(parsedData);
			handleIncomingMarkerPayload(parsedData);
		}
	});

	window.addEventListener("resize", () => {
		if (isMobileLayout()) {
			resetPanelLayout();
			saveDebugPanelLayout();
			return;
		}

		const maxLeft = Math.max(0, window.innerWidth - refs.app.offsetWidth);
		const maxTop = Math.max(0, window.innerHeight - refs.app.offsetHeight);
		refs.app.style.left = `${clamp(refs.app.offsetLeft, 0, maxLeft)}px`;
		refs.app.style.top = `${clamp(refs.app.offsetTop, 0, maxTop)}px`;

		if (refs.debugPanel && !refs.debugPanel.classList.contains("hidden")) {
			const maxDebugLeft = Math.max(0, window.innerWidth - refs.debugPanel.offsetWidth);
			const maxDebugTop = Math.max(0, window.innerHeight - refs.debugPanel.offsetHeight);
			refs.debugPanel.style.left = `${clamp(refs.debugPanel.offsetLeft, 0, maxDebugLeft)}px`;
			refs.debugPanel.style.top = `${clamp(refs.debugPanel.offsetTop, 0, maxDebugTop)}px`;
			saveDebugPanelLayout();
		}
	});

	if (window.GetParentResourceName) {
		window.setInterval(() => {
			if (state.isPizzaDeliveryActive) {
				requestNuiData();
				return;
			}

			requestPassiveTycoonState("job-state-poll");
		}, INTEGRATION_POLL_INTERVAL_MS);
		requestPassiveTycoonState("initial-load");
	}
}

setupEventHandlers();
loadSettings();
loadPanelLayout();
loadDebugPanelLayout();
resetPizzaJobRuntimeState();
setPizzaJobAppVisible(false);
render();

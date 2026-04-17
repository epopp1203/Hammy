const TRACKED_ITEMS = [
	"Pizza",
	"Chicken Nuggets",
	"Fries",
	"Expensive Water",
	"Onion Rings",
	"Soda"
];

const state = {
	orderId: 1001,
	order: {
		Pizza: 3,
		"Chicken Nuggets": 2,
		Fries: 2,
		"Expensive Water": 1,
		"Onion Rings": 1,
		Soda: 2
	},
	trunk: {
		Pizza: 8,
		"Chicken Nuggets": 6,
		Fries: 6,
		"Expensive Water": 4,
		"Onion Rings": 5,
		Soda: 7
	},
	inventory: {
		Pizza: 0,
		"Chicken Nuggets": 0,
		Fries: 0,
		"Expensive Water": 0,
		"Onion Rings": 0,
		Soda: 0
	},
	settings: {
		lowThreshold: 5,
		gpsEnabled: true,
		gpsX: 224.54,
		gpsY: -895.21
	}
};

const refs = {
	orderId: document.getElementById("order-id"),
	orderList: document.getElementById("order-list"),
	trunkList: document.getElementById("trunk-list"),
	inventoryList: document.getElementById("inventory-list"),
	trunkAlertCount: document.getElementById("trunk-alert-count"),
	clearOrderBtn: document.getElementById("clear-order-btn"),
	simulateOrderBtn: document.getElementById("simulate-order-btn"),
	settingsToggleBtn: document.getElementById("settings-toggle-btn"),
	settingsPanel: document.getElementById("settings-panel"),
	settingsCloseBtn: document.getElementById("settings-close-btn"),
	lowThresholdInput: document.getElementById("low-threshold-input"),
	gpsEnabledInput: document.getElementById("gps-enabled-input"),
	gpsXInput: document.getElementById("gps-x-input"),
	gpsYInput: document.getElementById("gps-y-input"),
	applyGpsBtn: document.getElementById("apply-gps-btn"),
	toast: document.getElementById("toast")
};

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

function showToast(message, timeoutMs = 2400) {
	refs.toast.textContent = message;
	refs.toast.classList.remove("hidden");
	window.clearTimeout(showToast.timer);
	showToast.timer = window.setTimeout(() => {
		refs.toast.classList.add("hidden");
	}, timeoutMs);
}

function generateRandomOrder() {
	const next = {};
	TRACKED_ITEMS.forEach((item) => {
		next[item] = Math.floor(Math.random() * 4);
	});

	if (Object.values(next).every((count) => count === 0)) {
		next[TRACKED_ITEMS[Math.floor(Math.random() * TRACKED_ITEMS.length)]] = 1;
	}

	state.orderId += 1;
	state.order = next;
	render();
}

function clearOrder() {
	TRACKED_ITEMS.forEach((item) => {
		state.order[item] = 0;
	});
	render();
	showToast("Order cleared.");
}

function moveOne(itemName) {
	if (state.trunk[itemName] <= 0) {
		showToast(`No ${itemName} left in trunk.`);
		return;
	}
	state.trunk[itemName] -= 1;
	state.inventory[itemName] += 1;
	render();
	maybeWarnLow(itemName);
}

function moveNeeded(itemName) {
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

	state.trunk[itemName] -= transferable;
	state.inventory[itemName] += transferable;
	render();
	maybeWarnLow(itemName);
}

function maybeWarnLow(itemName) {
	if (state.trunk[itemName] <= state.settings.lowThreshold) {
		showToast(`Low stock: ${itemName} in trunk is at ${state.trunk[itemName]}.`);
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
	state.settings.gpsX = Number(refs.gpsXInput.value) || 0;
	state.settings.gpsY = Number(refs.gpsYInput.value) || 0;

	if (!state.settings.gpsEnabled) {
		showToast("GPS waypoint is disabled in settings.");
		return;
	}

	setWaypoint(state.settings.gpsX, state.settings.gpsY);
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
			<div class="name">${item}</div>
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
			<div class="name">${item}</div>
			<div class="qty">In Trunk: ${state.trunk[item]}</div>
			<button class="btn btn-secondary btn-tiny" data-move-one="${item}">Move +1</button>
		`;
		refs.trunkList.appendChild(row);
	});
}

function renderInventory() {
	refs.inventoryList.innerHTML = "";
	TRACKED_ITEMS.forEach((item) => {
		const row = document.createElement("div");
		row.className = "item-row";
		row.innerHTML = `
			<div class="name">${item}</div>
			<div class="qty">In Inventory: ${state.inventory[item]}</div>
			<div></div>
		`;
		refs.inventoryList.appendChild(row);
	});
}

function render() {
	renderOrder();
	renderTrunk();
	renderInventory();

	refs.lowThresholdInput.value = String(state.settings.lowThreshold);
	refs.gpsEnabledInput.checked = state.settings.gpsEnabled;
	refs.gpsXInput.value = String(state.settings.gpsX);
	refs.gpsYInput.value = String(state.settings.gpsY);
}

function setupEventHandlers() {
	refs.clearOrderBtn.addEventListener("click", clearOrder);
	refs.simulateOrderBtn.addEventListener("click", () => {
		generateRandomOrder();
		showToast("New random order loaded.");
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
		render();
		showToast(`Low stock threshold set to ${state.settings.lowThreshold}.`);
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
		const data = event.data;
		if (!data || typeof data !== "object") {
			return;
		}

		// Optional inbound update for in-game integrations.
		if (data.action === "updateInventories") {
			TRACKED_ITEMS.forEach((item) => {
				if (typeof data.trunk?.[item] === "number") {
					state.trunk[item] = Math.max(0, Math.floor(data.trunk[item]));
				}
				if (typeof data.inventory?.[item] === "number") {
					state.inventory[item] = Math.max(0, Math.floor(data.inventory[item]));
				}
			});
			render();
		}
	});
}

setupEventHandlers();
render();

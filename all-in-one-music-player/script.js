const THEME_PRESETS = {
	aurora: {
		label: "Aurora",
		accent: "#7c5cff",
		accent2: "#18d7ff",
		accentInk: "#050816",
		bg0: "#060812",
		bg1: "#0f1524",
		bg2: "#182235"
	},
	midnight: {
		label: "Midnight",
		accent: "#ff6b6b",
		accent2: "#f9a826",
		accentInk: "#180d0a",
		bg0: "#05070d",
		bg1: "#111727",
		bg2: "#1d2434"
	},
	sunset: {
		label: "Sunset",
		accent: "#ff7b54",
		accent2: "#ffd166",
		accentInk: "#24110b",
		bg0: "#14090c",
		bg1: "#2a1616",
		bg2: "#46302a"
	},
	neon: {
		label: "Neon",
		accent: "#00f5b0",
		accent2: "#7b61ff",
		accentInk: "#03130f",
		bg0: "#04080b",
		bg1: "#101625",
		bg2: "#152439"
	},
	ocean: {
		label: "Ocean",
		accent: "#2ec4ff",
		accent2: "#2af598",
		accentInk: "#04161f",
		bg0: "#03121e",
		bg1: "#0b2635",
		bg2: "#133b4d"
	}
};

const SERVICE_DEFINITIONS = [
	{ id: "spotify", name: "Spotify", detail: "Playback & playlists", connected: false },
	{ id: "apple", name: "Apple Music", detail: "Library sync", connected: false },
	{ id: "youtube", name: "YouTube", detail: "Videos & podcasts", connected: false },
	{ id: "youtubeMusic", name: "YouTube Music", detail: "Artist radio", connected: false },
	{ id: "soundcloud", name: "SoundCloud", detail: "Creator mixes", connected: false },
	{ id: "tidal", name: "TIDAL", detail: "Hi-Fi listening", connected: false }
];

const QUEUE_ITEMS = [
	{ title: "Neon Skyline", artist: "Nova Lane" },
	{ title: "Blue Hour", artist: "Ellis V" },
	{ title: "Backbeat Bloom", artist: "Lumi Chord" },
	{ title: "Afterglow", artist: "Sage Key" }
];

const state = {
	theme: "aurora",
	fontScale: 1,
	bgOpacity: 0.82,
	services: SERVICE_DEFINITIONS.reduce((acc, service) => ({ ...acc, [service.id]: { ...service } }), {}),
	isPlaying: true,
	volume: 76
};

const refs = {
	app: document.getElementById("app"),
	serviceList: document.getElementById("service-list"),
	queueList: document.getElementById("queue-list"),
	settingsPanel: document.getElementById("settings-panel"),
	settingsToggleBtn: document.getElementById("settings-toggle-btn"),
	settingsCloseBtn: document.getElementById("settings-close-btn"),
	themeSelect: document.getElementById("theme-select"),
	themeValue: document.getElementById("theme-value"),
	fontSizeInput: document.getElementById("font-size-input"),
	fontSizeValue: document.getElementById("font-size-value"),
	opacityInput: document.getElementById("opacity-input"),
	opacityValue: document.getElementById("opacity-value"),
	playBtn: document.getElementById("play-btn"),
	volumeRange: document.getElementById("volume-range"),
	connectAllBtn: document.getElementById("connect-all-btn"),
	toast: document.getElementById("toast")
};

function saveSettings() {
	localStorage.setItem("musicPlayerSettings", JSON.stringify({
		theme: state.theme,
		fontScale: state.fontScale,
		bgOpacity: state.bgOpacity,
		services: state.services
	}));
}

function loadSettings() {
	const saved = localStorage.getItem("musicPlayerSettings");
	if (!saved) return;

	try {
		const parsed = JSON.parse(saved);
		state.theme = parsed.theme || state.theme;
		state.fontScale = parsed.fontScale || state.fontScale;
		state.bgOpacity = parsed.bgOpacity || state.bgOpacity;
		state.services = { ...state.services, ...parsed.services };
	} catch (error) {
		console.warn("Could not read music player settings.", error);
	}
}

function applyTheme() {
	const preset = THEME_PRESETS[state.theme] || THEME_PRESETS.aurora;
	document.documentElement.style.setProperty("--accent", preset.accent);
	document.documentElement.style.setProperty("--accent-2", preset.accent2);
	document.documentElement.style.setProperty("--accent-ink", preset.accentInk);
	document.documentElement.style.setProperty("--bg-0", preset.bg0);
	document.documentElement.style.setProperty("--bg-1", preset.bg1);
	document.documentElement.style.setProperty("--bg-2", preset.bg2);
	document.documentElement.style.setProperty("--ui-font-scale", state.fontScale);
	document.documentElement.style.setProperty("--window-bg-opacity", state.bgOpacity);
	refs.themeValue.textContent = preset.label;
	refs.themeSelect.value = state.theme;
	refs.fontSizeInput.value = state.fontScale;
	refs.fontSizeValue.textContent = `${Math.round(state.fontScale * 100)}%`;
	refs.opacityInput.value = state.bgOpacity;
	refs.opacityValue.textContent = `${Math.round(state.bgOpacity * 100)}%`;
}

function renderServices() {
	refs.serviceList.innerHTML = Object.values(state.services).map((service) => `
		<div class="service-item">
			<div class="service-name">
				<strong>${service.name}</strong>
				<span>${service.detail}</span>
			</div>
			<button class="btn btn-secondary service-btn" data-service-id="${service.id}">
				${service.connected ? "Connected" : "Connect"}
			</button>
		</div>
	`).join("");
}

function renderQueue() {
	refs.queueList.innerHTML = QUEUE_ITEMS.map((item, index) => `
		<li class="queue-item">
			<div>
				<strong>${item.title}</strong>
				<div><span>${item.artist}</span></div>
			</div>
			<span>#${index + 1}</span>
		</li>
	`).join("");
}

function showToast(message) {
	refs.toast.textContent = message;
	refs.toast.classList.remove("hidden");
	window.clearTimeout(showToast.timeoutId);
	showToast.timeoutId = window.setTimeout(() => refs.toast.classList.add("hidden"), 1800);
}

function toggleSettingsPanel() {
	refs.settingsPanel.classList.toggle("hidden");
}

function connectService(serviceId) {
	const service = state.services[serviceId];
	if (!service) return;
	service.connected = !service.connected;
	renderServices();
	saveSettings();
	showToast(service.connected ? `${service.name} connected` : `${service.name} disconnected`);
}

function connectAllServices() {
	Object.values(state.services).forEach((service) => {
		service.connected = true;
	});
	renderServices();
	saveSettings();
	showToast("All services connected");
}

function updatePlaybackButton() {
	refs.playBtn.textContent = state.isPlaying ? "Pause" : "Play";
}

function bindEvents() {
	refs.settingsToggleBtn.addEventListener("click", toggleSettingsPanel);
	refs.settingsCloseBtn.addEventListener("click", toggleSettingsPanel);
	refs.themeSelect.addEventListener("change", (event) => {
		state.theme = event.target.value;
		applyTheme();
		saveSettings();
	});
	refs.fontSizeInput.addEventListener("input", (event) => {
		state.fontScale = Number(event.target.value);
		applyTheme();
		saveSettings();
	});
	refs.opacityInput.addEventListener("input", (event) => {
		state.bgOpacity = Number(event.target.value);
		applyTheme();
		saveSettings();
	});
	refs.playBtn.addEventListener("click", () => {
		state.isPlaying = !state.isPlaying;
		updatePlaybackButton();
		showToast(state.isPlaying ? "Playback resumed" : "Playback paused");
	});
	refs.volumeRange.addEventListener("input", (event) => {
		state.volume = Number(event.target.value);
		showToast(`Volume ${state.volume}%`);
	});
	refs.connectAllBtn.addEventListener("click", connectAllServices);
	refs.serviceList.addEventListener("click", (event) => {
		const button = event.target.closest("button[data-service-id]");
		if (!button) return;
		connectService(button.getAttribute("data-service-id"));
	});
}

function init() {
	loadSettings();
	applyTheme();
	renderServices();
	renderQueue();
	updatePlaybackButton();
	bindEvents();
}

init();

// --- js/auth.js: Security Passcode & Config Management ---

async function hashString(str) {
  if (!str) return "";
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSavedPasscodeHash() {
  const cfg = loadConfig();
  return (cfg && cfg.passcodeHash) || localStorage.getItem("TACTICAL_HUD_PASS_HASH") || "";
}

function isHudUnlocked() {
  const passHash = getSavedPasscodeHash();
  if (!passHash) return true; // No password configured
  return sessionStorage.getItem("TACTICAL_HUD_SESSION_AUTH") === "true";
}

function lockHud() {
  const passHash = getSavedPasscodeHash();
  if (!passHash) return alert("No passcode set. You can configure one in ⚙️ Settings.");
  sessionStorage.removeItem("TACTICAL_HUD_SESSION_AUTH");
  document.getElementById("passcodeInput").value = "";
  document.getElementById("lockErrorMsg").style.display = "none";
  document.getElementById("lockScreenOverlay").classList.remove("hidden");
  document.getElementById("passcodeInput").focus();
}

async function attemptUnlock() {
  const entered = document.getElementById("passcodeInput").value;
  const targetHash = getSavedPasscodeHash();
  const enteredHash = await hashString(entered);

  if (enteredHash === targetHash) {
    sessionStorage.setItem("TACTICAL_HUD_SESSION_AUTH", "true");
    document.getElementById("lockScreenOverlay").classList.add("hidden");
    document.getElementById("lockErrorMsg").style.display = "none";
    syncHud();
  } else {
    const err = document.getElementById("lockErrorMsg");
    err.textContent = "Invalid Passcode. Access Denied.";
    err.style.display = "block";
    document.getElementById("passcodeInput").value = "";
    document.getElementById("passcodeInput").focus();
  }
}

function checkLockGate() {
  if (!isHudUnlocked()) {
    document.getElementById("lockScreenOverlay").classList.remove("hidden");
    document.getElementById("passcodeInput").focus();
    return false;
  }
  return true;
}

function loadConfig() {
  let localCfg = {};
  try {
    localCfg = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    localCfg = {};
  }
  const winCfg = window.HUD_CONFIG || {};

  // Deep merge board maps and properties so credentials in either file or localStorage are recognized
  const mergedBoards = { ...(localCfg.boards || {}), ...(winCfg.boards || {}) };

  const merged = {
    ...localCfg,
    ...winCfg,
    boards: mergedBoards,
    apiKey: winCfg.apiKey || localCfg.apiKey || "",
    token: winCfg.token || localCfg.token || "",
    passcode: winCfg.passcode || localCfg.passcode || "",
    passcodeHash: winCfg.passcodeHash || localCfg.passcodeHash || "",
    calendarWebhook: winCfg.calendarWebhook || localCfg.calendarWebhook || ""
  };

  if (!merged.apiKey && !merged.token) return null;
  return merged;
}

function openSettings() {
  const cfg = loadConfig() || { boards: {} };
  document.getElementById("cfgPasscode").value = cfg.passcode || "";
  document.getElementById("cfgApiKey").value = cfg.apiKey || "";
  document.getElementById("cfgToken").value = cfg.token || "";
  document.getElementById("cfgBoardWork").value = (cfg.boards && cfg.boards.work) || "";
  document.getElementById("cfgBoardLife").value = (cfg.boards && cfg.boards.life) || "";
  document.getElementById("cfgBoardVi").value = (cfg.boards && cfg.boards.vi) || "";
  document.getElementById("cfgBoardLab").value = (cfg.boards && cfg.boards.lab) || "";
  document.getElementById("cfgBoardGrowth").value = (cfg.boards && cfg.boards.growth) || "";
  const calInput = document.getElementById("cfgCalendarWebhook");
  if (calInput) calInput.value = cfg.calendarWebhook || "";
  document.getElementById("settingsModal").classList.add("open");
}

function closeSettings() {
  document.getElementById("settingsModal").classList.remove("open");
}

function importJsonConfig() {
  try {
    const parsed = JSON.parse(document.getElementById("jsonPasteBox").value.trim());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    closeSettings();
    syncHud();
  } catch (e) { alert("Invalid JSON string. Copy the exact configuration block."); }
}

async function saveSettings() {
  const enteredPass = document.

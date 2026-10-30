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

  // Populate cloud-synced keywords
  const kw = (typeof getActiveEnergyKeywords === "function") ? getActiveEnergyKeywords() : { red: "", yellow: "", green: "" };
  const redEl = document.getElementById("cfgKwRed");
  const yelEl = document.getElementById("cfgKwYellow");
  const grnEl = document.getElementById("cfgKwGreen");
  if (redEl) redEl.value = kw.red || "";
  if (yelEl) yelEl.value = kw.yellow || "";
  if (grnEl) grnEl.value = kw.green || "";

  // Render dynamic board sources list
  renderCustomBoardsSettingsList();

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
  const enteredPass = document.getElementById("cfgPasscode").value;
  const passHash = enteredPass ? await hashString(enteredPass) : "";
  if (passHash) {
    localStorage.setItem("TACTICAL_HUD_PASS_HASH", passHash);
    sessionStorage.setItem("TACTICAL_HUD_SESSION_AUTH", "true");
  } else {
    localStorage.removeItem("TACTICAL_HUD_PASS_HASH");
    sessionStorage.removeItem("TACTICAL_HUD_SESSION_AUTH");
  }

  const cfg = {
    passcode: enteredPass,
    passcodeHash: passHash,
    apiKey: document.getElementById("cfgApiKey").value.trim(),
    token: document.getElementById("cfgToken").value.trim(),
    boards: {
      work: document.getElementById("cfgBoardWork").value.trim(),
      life: document.getElementById("cfgBoardLife").value.trim(),
      vi: document.getElementById("cfgBoardVi").value.trim(),
      lab: document.getElementById("cfgBoardLab").value.trim(),
      growth: document.getElementById("cfgBoardGrowth").value.trim()
    },
    calendarWebhook: document.getElementById("cfgCalendarWebhook") ? document.getElementById("cfgCalendarWebhook").value.trim() : ""
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));

  // Persist updated keywords across all devices via the Trello Score Ledger card
  const redEl = document.getElementById("cfgKwRed");
  const yelEl = document.getElementById("cfgKwYellow");
  const grnEl = document.getElementById("cfgKwGreen");
  if (redEl && yelEl && grnEl && typeof updateCloudEnergyKeywords === "function") {
    await updateCloudEnergyKeywords({
      red: redEl.value.trim(),
      yellow: yelEl.value.trim(),
      green: grnEl.value.trim()
    });
  }

  closeSettings();
  syncHud();
}

// --- DYNAMIC BOARD SOURCE UI ACTIONS ---
function renderCustomBoardsSettingsList() {
  const container = document.getElementById("customBoardsList");
  if (!container) return;

  const boards = typeof getCustomBoards === "function" ? getCustomBoards() : [];
  if (boards.length === 0) {
    container.innerHTML = `<div style="font-size:0.72rem; color:var(--muted); font-style:italic; padding:4px 0;">No custom board sources added yet.</div>`;
    return;
  }

  const ctxNames = { work: "💼 Work", personal: "🏠 Personal", mission: "🚀 Mission" };

  container.innerHTML = boards.map(b => `
    <div style="background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; font-size:0.75rem;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:1rem;">${b.icon || '🚀'}</span>
        <strong style="color:#fff;">${b.name}</strong>
        <span style="font-size:0.65rem; color:#38bdf8; background:#1e293b; padding:1px 6px; border-radius:4px;">${ctxNames[b.context] || b.context}</span>
        <span style="font-size:0.65rem; color:var(--muted); font-family:monospace;">(${b.id})</span>
      </div>
      <button type="button" class="btn" style="color:#f87171; border-color:#7f1d1d; padding:2px 6px; font-size:0.7rem;" onclick="removeCustomBoardAction('${b.key}')">✕ Remove</button>
    </div>
  `).join("");
}

async function addCustomBoardAction() {
  const nameInput = document.getElementById("newBoardName");
  const idInput = document.getElementById("newBoardId");
  const ctxInput = document.getElementById("newBoardContext");
  const iconInput = document.getElementById("newBoardIcon");

  const name = nameInput.value.trim();
  const rawId = idInput.value.trim();
  const context = ctxInput.value;
  const icon = iconInput.value.trim() || "🚀";

  if (!name || !rawId) return alert("Please provide both a Board Name and a Trello Board ID/URL.");

  try {
    await addCustomBoard(name, rawId, context, icon);
    nameInput.value = "";
    idInput.value = "";
    renderCustomBoardsSettingsList();
    if (typeof syncHud === "function") await syncHud();
    alert(`✓ "${name}" added to cloud and synced across all devices!`);
  } catch (e) {
    alert("Failed to add board: " + e.message);
  }
}

async function removeCustomBoardAction(boardKey) {
  if (!confirm("Are you sure you want to remove this board from your cloud sync?")) return;
  try {
    await removeCustomBoard(boardKey);
    renderCustomBoardsSettingsList();
    if (typeof syncHud === "function") await syncHud();
  } catch (e) {
    alert("Failed to remove board: " + e.message);
  }
}

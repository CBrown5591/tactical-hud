// --- js/pomo.js: Tactical Pomodoro Focus Engine & Chaos Control ---

let pomoState = {
  mode: "focus", // "focus", "short", "long"
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  timerId: null,
  isRunning: false,
  chaosControlActive: false,
  chaosSavedSeconds: null
};

function playPomoChime(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    
    if (type === "chaos") {
      // Sonic Chaos Control dual-tone C5 -> C6 warp sweep
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.25); // C6 warp
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (type === "complete") {
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.15); // A5
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      osc.frequency.setValueAtTime(440, now); // A4 tick
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }
  } catch (e) {}
}

function updatePomoDisplay() {
  const min = Math.floor(pomoState.remainingSeconds / 60);
  const sec = pomoState.remainingSeconds % 60;
  const displayEl = document.getElementById("pomoDisplay");
  const progressEl = document.getElementById("pomoProgressBar");
  if (displayEl) {
    if (pomoState.chaosControlActive) {
      displayEl.textContent = `⚡ ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    } else {
      displayEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    displayEl.classList.toggle("break-mode", pomoState.mode !== "focus" && !pomoState.chaosControlActive);
    displayEl.classList.toggle("chaos-mode", pomoState.chaosControlActive);
  }
  if (progressEl) {
    const elapsed = pomoState.totalSeconds - pomoState.remainingSeconds;
    progressEl.style.width = `${Math.min(100, Math.max(0, (elapsed / pomoState.totalSeconds) * 100))}%`;
    progressEl.classList.toggle("break-mode", pomoState.mode !== "focus" && !pomoState.chaosControlActive);
    progressEl.classList.toggle("chaos-mode", pomoState.chaosControlActive);
  }
}

function setPomoMode(mode, minutes) {
  if (pomoState.chaosControlActive) deactivateChaosControlUI();
  if (pomoState.timerId) clearInterval(pomoState.timerId);
  pomoState.isRunning = false;
  pomoState.mode = mode;
  pomoState.totalSeconds = minutes * 60;
  pomoState.remainingSeconds = minutes * 60;
  const toggleBtn = document.getElementById("pomoToggleBtn");
  if (toggleBtn) toggleBtn.textContent = "▶ Start";
  document.querySelectorAll("[id^='pomoMode']").forEach(btn => btn.classList.remove("active"));
  if (mode === "focus") document.getElementById("pomoModeFocus").classList.add("active");
  else if (mode === "short") document.getElementById("pomoModeShort").classList.add("active");
  else if (mode === "long") document.getElementById("pomoModeLong").classList.add("active");
  updatePomoDisplay();
}

function togglePomoTimer() {
  if (pomoState.chaosControlActive) {
    // Unfreeze Chaos Control
    deactivateChaosControlUI();
  }
  const toggleBtn = document.getElementById("pomoToggleBtn");
  if (pomoState.isRunning) {
    clearInterval(pomoState.timerId);
    pomoState.isRunning = false;
    if (toggleBtn) toggleBtn.textContent = "▶ Resume";
  } else {
    pomoState.isRunning = true;
    if (toggleBtn) toggleBtn.textContent = "⏸ Pause";
    playPomoChime("start");
    pomoState.timerId = setInterval(() => {
      if (pomoState.remainingSeconds > 0) {
        pomoState.remainingSeconds--;
        updatePomoDisplay();
      } else {
        clearInterval(pomoState.timerId);
        pomoState.isRunning = false;
        if (toggleBtn) toggleBtn.textContent = "▶ Start";
        playPomoChime("complete");
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 300]);
        if (pomoState.mode === "focus") {
          alert("🎯 Focus block complete! Take a breather.");
          setPomoMode("short", 5);
        } else {
          alert("☕ Break over! Time to refocus.");
          setPomoMode("focus", 25);
        }
      }
    }, 1000);
  }
}

function resetPomoTimer() {
  if (pomoState.chaosControlActive) deactivateChaosControlUI();
  if (pomoState.timerId) clearInterval(pomoState.timerId);
  pomoState.isRunning = false;
  pomoState.remainingSeconds = pomoState.totalSeconds;
  const toggleBtn = document.getElementById("pomoToggleBtn");
  if (toggleBtn) toggleBtn.textContent = "▶ Start";
  updatePomoDisplay();
}

// --- CHAOS CONTROL: TIME-STOP INTERRUPT ARMOR ---
function triggerChaosControl() {
  const card = (state && state.todayCards && state.todayCards.length > 0) ? state.todayCards[0] : null;

  if (pomoState.chaosControlActive) {
    // Toggle off
    deactivateChaosControlUI();
    return;
  }

  // 1. Freeze timer
  if (pomoState.timerId) clearInterval(pomoState.timerId);
  pomoState.isRunning = false;
  pomoState.chaosControlActive = true;
  playPomoChime("chaos");

  // 2. UI Overdrive state
  const pomoCard = document.querySelector(".pomodoro-card");
  if (pomoCard) pomoCard.classList.add("chaos-active");
  const chaosBtn = document.getElementById("chaosControlBtn");
  if (chaosBtn) chaosBtn.classList.add("active");
  const toggleBtn = document.getElementById("pomoToggleBtn");
  if (toggleBtn) toggleBtn.textContent = "⚡ Unfreeze";

  // 3. Interrupt Armor: Snapshot save state
  const saveInput = document.getElementById("saveStateInput");
  const activeTaskName = card ? card.name : "Active Sprint";
  if (saveInput) {
    saveInput.placeholder = `Temporal Anchor for: "${activeTaskName}"...`;
    saveInput.scrollIntoView({ behavior: "smooth", block: "center" });
    saveInput.focus();
  }

  // 4. Log in daily score ledger
  if (typeof recordChaosControlUsage === "function") {
    recordChaosControlUsage(activeTaskName);
  }

  updatePomoDisplay();
}

function deactivateChaosControlUI() {
  pomoState.chaosControlActive = false;
  const pomoCard = document.querySelector(".pomodoro-card");
  if (pomoCard) pomoCard.classList.remove("chaos-active");
  const chaosBtn = document.getElementById("chaosControlBtn");
  if (chaosBtn) chaosBtn.classList.remove("active");
  const toggleBtn = document.getElementById("pomoToggleBtn");
  if (toggleBtn) toggleBtn.textContent = "▶ Resume";
  updatePomoDisplay();
}

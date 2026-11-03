// --- js/score.js: Tactical Focus HUD Scoring, Emerald Mastery, Pure Cloud Ledger & Ring Economy ---

function getTodayScoreDateStr() {
  const now = new Date();
  return now.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

// In-memory runtime state for the score ledger.
// Hydrated strictly from Trello's context-scoped score ledger cards (Zero Local Storage).
let activeCloudLedger = {
  currentDate: getTodayScoreDateStr(),
  today: {
    date: getTodayScoreDateStr(),
    completed: { red: 0, yellow: 0, green: 0, none: 0 },
    completedCardIds: [],
    completedBoards: [],
    deadlineModifiers: { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 },
    deferralsExempt: 0,
    deferralsPenalized: 0,
    deferredCards: [],
    chaosControlCount: 0,
    dailyFreeWarpUsed: false
  },
  ringBank: 0,
  customBoards: [],
  inventory: {
    warpTokens: 0,
    roadblockShields: 0,
    deadlineExtenders: 0,
    decompBuffers: 0,
    spikePasses: 0
  },
  superState: {
    active: false,
    startedAt: null,
    lastDrainAt: null
  },
  history: {}
};

// Purge legacy local storage score caches across all devices to prevent zombie state
function purgeLegacyLocalScoreCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("TACTICAL_SCORE_LEDGER_") || key.startsWith("HUD_SCORE_"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}
purgeLegacyLocalScoreCache();

// --- AUTHORITATIVE CLOUD SCORE LOADER ---
function loadDailyScoreLedger(dateStr = getTodayScoreDateStr()) {
  const todayStr = getTodayScoreDateStr();
  if (dateStr === todayStr && activeCloudLedger && activeCloudLedger.today) {
    return activeCloudLedger.today;
  }
  if (activeCloudLedger && activeCloudLedger.history && activeCloudLedger.history[dateStr]) {
    return activeCloudLedger.history[dateStr];
  }
  return {
    date: dateStr,
    completed: { red: 0, yellow: 0, green: 0, none: 0 },
    completedCardIds: [],
    completedBoards: [],
    deadlineModifiers: { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 },
    deferralsExempt: 0,
    deferralsPenalized: 0,
    deferredCards: [],
    chaosControlCount: 0,
    dailyFreeWarpUsed: false
  };
}

// --- CONTEXT-AWARE CLOUD HYDRATION WITH UNIVERSAL ECONOMY ---
function hydrateCloudLedgerFromTrello(cardDesc) {
  if (!cardDesc || !cardDesc.trim()) return;
  try {
    const parsed = JSON.parse(cardDesc.trim());
    const todayStr = getTodayScoreDateStr();

    // Preserve universal economy across context switches
    const universalRings = Math.max(activeCloudLedger.ringBank || 0, parsed.ringBank || 0);
    const universalInventory = {
      warpTokens: Math.max(activeCloudLedger.inventory?.warpTokens || 0, parsed.inventory?.warpTokens || 0),
      roadblockShields: Math.max(activeCloudLedger.inventory?.roadblockShields || 0, parsed.inventory?.roadblockShields || 0),
      deadlineExtenders: Math.max(activeCloudLedger.inventory?.deadlineExtenders || 0, parsed.inventory?.deadlineExtenders || 0),
      decompBuffers: Math.max(activeCloudLedger.inventory?.decompBuffers || 0, parsed.inventory?.decompBuffers || 0),
      spikePasses: Math.max(activeCloudLedger.inventory?.spikePasses || 0, parsed.inventory?.spikePasses || 0)
    };

    if (parsed.today && parsed.currentDate) {
      activeCloudLedger = parsed;
      // Rollover check if it's a new calendar day
      if (activeCloudLedger.currentDate !== todayStr) {
        if (!activeCloudLedger.history) activeCloudLedger.history = {};
        activeCloudLedger.history[activeCloudLedger.currentDate] = activeCloudLedger.today;
        activeCloudLedger.currentDate = todayStr;
        activeCloudLedger.today = {
          date: todayStr,
          completed: { red: 0, yellow: 0, green: 0, none: 0 },
          completedCardIds: [],
          completedBoards: [],
          deadlineModifiers: { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 },
          deferralsExempt: 0,
          deferralsPenalized: 0,
          deferredCards: [],
          chaosControlCount: 0,
          dailyFreeWarpUsed: false
        };
      }
    } else if (parsed.date) {
      activeCloudLedger.currentDate = parsed.date;
      activeCloudLedger.today = parsed;
    }

    // Lock in universal Ring Bank and Inventory
    activeCloudLedger.ringBank = universalRings;
    activeCloudLedger.inventory = universalInventory;

    console.log(`[Score Sync] Hydrated ${state?.context?.toUpperCase() || "HUD"} score ledger from Trello:`, activeCloudLedger);
    updateRingDisplay();
  } catch (e) {
    console.warn("[Score Sync] Failed to parse Trello score ledger card description:", e);
  }
}

// --- CLOUD COMMIT (VIA JSON REQUEST BODY) ---
async function commitScoreLedgerToTrello(ledger = activeCloudLedger.today) {
  if (!state || !state.scoreLedgerCardId) {
    console.warn("[Score Sync] Cannot commit ledger: scoreLedgerCardId is null. Skipping sync.");
    return;
  }
  if (typeof trelloFetch !== "function") return;

  const todayStr = getTodayScoreDateStr();
  activeCloudLedger.currentDate = todayStr;
  activeCloudLedger.today = ledger;
  if (!activeCloudLedger.history) activeCloudLedger.history = {};
  activeCloudLedger.history[todayStr] = ledger;

  try {
    const payload = JSON.stringify(activeCloudLedger, null, 2);
    // Transmit desc in the JSON request body to prevent URL overflow
    await trelloFetch(`/cards/${state.scoreLedgerCardId}`, "PUT", "", { desc: payload });
    console.log("[Score Sync] Committed authoritative score ledger to Trello card:", activeCloudLedger);
  } catch (e) {
    console.error("[Score Sync] Failed to commit score ledger to Trello:", e);
  }
}

// --- TIER-SCALED DEADLINE MODIFIERS ---
function calculateDeadlineModifier(energy = "green", dueStr = "") {
  if (!dueStr) return { type: "none", pts: 0, label: "No Deadline" };

  const now = new Date();
  const dueDate = new Date(dueStr);
  const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  const tierConfig = {
    red:    { early: 50, ontime: 25, penaltyPerDay: 25, floor: 25 },
    yellow: { early: 25, ontime: 15, penaltyPerDay: 15, floor: 10 },
    green:  { early: 15, ontime: 10, penaltyPerDay: 10, floor: 5 },
    none:   { early: 10, ontime: 5,  penaltyPerDay: 5,  floor: 0 }
  };

  const cfg = tierConfig[energy] || tierConfig.green;

  if (diffHours >= 24) {
    return { type: "early", pts: cfg.early, label: `⚡ Early (+${cfg.early})` };
  } else if (diffHours >= -2) {
    return { type: "ontime", pts: cfg.ontime, label: `🎯 On-Target (+${cfg.ontime})` };
  } else {
    const daysLate = Math.min(3, Math.ceil(Math.abs(diffHours) / 24));
    const penalty = -(daysLate * cfg.penaltyPerDay);
    return { type: "overdue", pts: penalty, label: `⚠️ Overdue ${daysLate}d (${penalty})` };
  }
}

// --- TASK COMPLETION & RING ACCUMULATION ---
async function recordCardCompleted(card, isRetroactiveOnTime = false) {
  if (!card || !card.id) return;
  const ledger = loadDailyScoreLedger();
  if (ledger.completedCardIds && ledger.completedCardIds.includes(card.id)) return;

  if (!ledger.completedCardIds) ledger.completedCardIds = [];
  ledger.completedCardIds.push(card.id);

  if (!ledger.completedBoards) ledger.completedBoards = [];
  if (card.boardKey && !ledger.completedBoards.includes(card.boardKey)) {
    ledger.completedBoards.push(card.boardKey);
  }

  const energy = card.energy || "none";
  if (ledger.completed[energy] !== undefined) {
    ledger.completed[energy]++;
  } else {
    ledger.completed.none++;
  }

  if (!ledger.deadlineModifiers) {
    ledger.deadlineModifiers = { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 };
  }

  let mod = calculateDeadlineModifier(energy, card.due);
  if (isRetroactiveOnTime && mod.type === "overdue") {
    const tierConfig = { red: 25, yellow: 15, green: 10, none: 5 };
    const ontimePts = tierConfig[energy] || 10;
    mod = { type: "ontime", pts: ontimePts, label: `🎯 Verified On-Time (+${ontimePts})` };
  }

  if (mod.type === "early") {
    ledger.deadlineModifiers.earlyCount++;
    ledger.deadlineModifiers.earlyPts += mod.pts;
  } else if (mod.type === "ontime") {
    ledger.deadlineModifiers.ontimeCount++;
    ledger.deadlineModifiers.ontimePts += mod.pts;
  } else if (mod.type === "overdue") {
    ledger.deadlineModifiers.overdueCount++;
    ledger.deadlineModifiers.overduePts += mod.pts;
  }

  // 1:1 Base Ring Conversion
  const baseRingValues = { red: 100, yellow: 50, green: 25, none: 10 };
  const earnedRings = (baseRingValues[energy] || 10) + Math.max(0, mod.pts);
  activeCloudLedger.ringBank = (activeCloudLedger.ringBank || 0) + earnedRings;

  updateRingDisplay();
  await commitScoreLedgerToTrello(ledger);
}

async function recordCardDeferred(card, isExempt = false, reason = "") {
  if (!card || !card.id) return;
  const ledger = loadDailyScoreLedger();
  if (isExempt) {
    ledger.deferralsExempt = (ledger.deferralsExempt || 0) + 1;
  } else {
    ledger.deferralsPenalized = (ledger.deferralsPenalized || 0) + 1;
  }
  if (!ledger.deferredCards) ledger.deferredCards = [];
  ledger.deferredCards.push({
    id: card.id,
    name: card.name,
    isExempt,
    reason,
    time: new Date().toISOString()
  });
  await commitScoreLedgerToTrello(ledger);
}

async function recordChaosControlUsage(taskName = "") {
  const ledger = loadDailyScoreLedger();
  ledger.chaosControlCount = (ledger.chaosControlCount || 0) + 1;
  await commitScoreLedgerToTrello(ledger);
}

// --- TACTICAL YIELD ENGINE & NORMALIZATION ---
function calculateTacticalYield(ledger = loadDailyScoreLedger(), calTelemetry = (state && state.calendarTelemetry)) {
  const redPts = (ledger.completed?.red || 0) * 100;
  const yellowPts = (ledger.completed?.yellow || 0) * 50;
  const greenPts = (ledger.completed?.green || 0) * 25;
  const penaltyPts = (ledger.deferralsPenalized || 0) * 15;

  const dMods = ledger.deadlineModifiers || { earlyPts: 0, ontimePts: 0, overduePts: 0 };
  const deadlineNetPts = (dMods.earlyPts || 0) + (dMods.ontimePts || 0) + (dMods.overduePts || 0);

  const rawScore = Math.max(0, redPts + yellowPts + greenPts + deadlineNetPts - penaltyPts);

  const isWork = state && state.context === "work";
  const now = new Date();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6);
  const isOff = (calTelemetry && calTelemetry.isWorkOffDay) || isWeekend;

  let totalRunway = 9.0;
  let meetingHours = 0;
  let decompressionTax = 0;
  let netRunway = 9.0;

  if (isWork) {
    if (isOff) {
      totalRunway = 0;
      netRunway = 0;
    } else {
      meetingHours = (calTelemetry && calTelemetry.workBookedHours !== undefined)
        ? calTelemetry.workBookedHours
        : (calTelemetry && calTelemetry.bookedHours ? calTelemetry.bookedHours : 0);
      decompressionTax = +(meetingHours * 0.25).toFixed(2);
      netRunway = Math.max(0.5, +(totalRunway - (meetingHours * 1.25)).toFixed(2));
    }
  } else {
    totalRunway = 4.0;
    meetingHours = (calTelemetry && calTelemetry.bookedHours) ? Math.min(3.0, calTelemetry.bookedHours) : 0;
    decompressionTax = +(meetingHours * 0.25).toFixed(2);
    netRunway = Math.max(0.5, +(totalRunway - (meetingHours * 1.25)).toFixed(2));
  }

  const yieldRate = netRunway > 0 ? +(rawScore / netRunway).toFixed(1) : 0;

  let rank = "B";
  let title = "STEADY CRUISE";
  let rankColor = "#eab308";

  if (rawScore === 0 && (isOff || meetingHours >= 7.0)) {
    rank = "S";
    title = "CLEAN LOCKOUT";
    rankColor = "#38bdf8";
  } else if (yieldRate >= 42.0) {
    rank = "S";
    title = "SONIC MASTER";
    rankColor = "#38bdf8";
  } else if (yieldRate >= 32.0) {
    rank = "A";
    title = "OPERATIONAL ACE";
    rankColor = "#22c55e";
  } else if (yieldRate >= 22.0) {
    rank = "B";
    title = "STEADY CRUISE";
    rankColor = "#eab308";
  } else if (yieldRate >= 12.0) {
    rank = "C";
    title = "FRICTION DRAG";
    rankColor = "#f97316";
  } else {
    rank = "D";
    title = "CONTAINMENT";
    rankColor = "#ef4444";
  }

  return {
    rawScore,
    redPts,
    yellowPts,
    greenPts,
    deadlineNetPts,
    dMods,
    penaltyPts,
    totalRunway,
    meetingHours,
    decompressionTax,
    netRunway,
    yieldRate,
    rank,
    title,
    rankColor,
    isOff
  };
}

// --- CHAOS EMERALD MATRIX ---
function evaluateChaosEmeralds(weekStats) {
  const green = weekStats.totalGreen >= 6;
  const yellow = weekStats.totalYellow >= 4;
  const red = weekStats.totalRed >= 2;
  const blue = weekStats.highMeetingDefense || (weekStats.avgYield >= 32.0 && weekStats.totalMeetings >= 4.0);
  const purple = weekStats.totalExempt >= 1 && weekStats.totalPenalized === 0;
  const white = weekStats.distinctBoardsCount >= 3;
  const sky = weekStats.totalChaosControl >= 1;

  const emeralds = [
    { id: "green", name: "Green Emerald", domain: "Light Throughput", unlocked: green, icon: "🟢", criteria: "6+ Light tasks" },
    { id: "yellow", name: "Yellow Emerald", domain: "Cruise Stability", unlocked: yellow, icon: "🟡", criteria: "4+ Medium tasks" },
    { id: "red", name: "Red Emerald", domain: "High Voltage Power", unlocked: red, icon: "🔴", criteria: "2+ Heavy tasks" },
    { id: "blue", name: "Blue Emerald", domain: "Temporal Shield", unlocked: blue, icon: "🔵", criteria: "S/A Rank with 4h+ calls" },
    { id: "purple", name: "Purple Emerald", domain: "Friction Mastery", unlocked: purple, icon: "🟣", criteria: "100% Documented blockers" },
    { id: "white", name: "White Emerald", domain: "Multi-Ring Harmony", unlocked: white, icon: "⚪", criteria: "3+ Distinct boards active" },
    { id: "sky", name: "Sky Emerald", domain: "Chaos Control Warp", unlocked: sky, icon: "🩵", criteria: "Chaos Control deployed" }
  ];

  const collectedCount = emeralds.filter(e => e.unlocked).length;
  const isSuperState = collectedCount === 7;

  return { emeralds, collectedCount, isSuperState };
}

function getWeeklyRollingStats() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  monday.setDate(diff);

  let totalScore = 0;
  let totalNetRunway = 0;
  let daysActive = 0;
  let totalMeetings = 0;
  let totalRed = 0, totalYellow = 0, totalGreen = 0;
  let totalExempt = 0, totalPenalized = 0;
  let totalChaosControl = 0;
  let distinctBoardsSet = new Set();
  let highMeetingDefense = false;
  let weeklyEarly = 0, weeklyOntime = 0, weeklyOverdue = 0;

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = cur.toISOString().split("T")[0];
    
    const l = (activeCloudLedger.history && activeCloudLedger.history[dateStr]) || 
              (activeCloudLedger.currentDate === dateStr ? activeCloudLedger.today : null);

    if (l) {
      const dm = l.deadlineModifiers || { earlyPts: 0, ontimePts: 0, overduePts: 0 };
      weeklyEarly += (dm.earlyCount || 0);
      weeklyOntime += (dm.ontimeCount || 0);
      weeklyOverdue += (dm.overdueCount || 0);

      const dNet = (dm.earlyPts || 0) + (dm.ontimePts || 0) + (dm.overduePts || 0);
      const dayScore = ((l.completed?.red || 0) * 100) + ((l.completed?.yellow || 0) * 50) + ((l.completed?.green || 0) * 25) + dNet - ((l.deferralsPenalized || 0) * 15);

      if (dayScore > 0 || (l.completedCardIds && l.completedCardIds.length > 0) || l.chaosControlCount > 0) {
        daysActive++;
        totalScore += Math.max(0, dayScore);
        totalRed += (l.completed?.red || 0);
        totalYellow += (l.completed?.yellow || 0);
        totalGreen += (l.completed?.green || 0);
        totalExempt += (l.deferralsExempt || 0);
        totalPenalized += (l.deferralsPenalized || 0);
        totalChaosControl += (l.chaosControlCount || 0);
        (l.completedBoards || []).forEach(b => distinctBoardsSet.add(b));
        totalNetRunway += 6.0;
      }
    }
  }

  const avgYield = totalNetRunway > 0 ? +(totalScore / totalNetRunway).toFixed(1) : 0;
  let grade = "CLASS A OPERATIONAL";
  if (avgYield >= 42.0) grade = "CLASS S MASTER (SONIC TIER)";
  else if (avgYield >= 32.0) grade = "CLASS A OPERATIONAL";
  else if (avgYield >= 22.0) grade = "CLASS B CRUISE";
  else grade = "CLASS C STABILIZATION";

  const baseStats = {
    totalScore,
    daysActive,
    totalMeetings,
    totalRed,
    totalYellow,
    totalGreen,
    weeklyEarly,
    weeklyOntime,
    weeklyOverdue,
    totalExempt,
    totalPenalized,
    totalChaosControl,
    distinctBoardsCount: distinctBoardsSet.size,
    highMeetingDefense,
    avgYield,
    grade
  };

  const emeraldData = evaluateChaosEmeralds(baseStats);

  return {
    ...baseStats,
    ...emeraldData
  };
}

// --- SUPER SONIC & RING ECONOMY ENGINE ---
function isSuperSonicActive() {
  return !!(activeCloudLedger && activeCloudLedger.superState && activeCloudLedger.superState.active);
}

function canTransformSuperSonic() {
  const weekStats = typeof getWeeklyRollingStats === "function" ? getWeeklyRollingStats() : { isSuperState: false };
  const rings = (activeCloudLedger && activeCloudLedger.ringBank) || 0;
  return weekStats.isSuperState && rings >= 50;
}

function updateRingDisplay() {
  const ringCountEl = document.getElementById("ringCountDisplay");
  const vaultRingEl = document.getElementById("vaultRingDisplay");
  const superBtn = document.getElementById("superTransformBtn");
  const superPrompt = document.getElementById("vaultSuperPrompt");
  const isSuper = isSuperSonicActive();
  const rings = (activeCloudLedger && activeCloudLedger.ringBank) || 0;

  if (ringCountEl) ringCountEl.textContent = isSuper ? `⚡ SUPER: ${rings}` : `🪙 ${rings} RINGS`;
  if (vaultRingEl) vaultRingEl.textContent = `${rings} RINGS`;

  const eligibleForSuper = canTransformSuperSonic();
  if (superBtn) {
    if (isSuper) {
      superBtn.classList.remove("hidden");
      superBtn.textContent = "⚡ DEPOWER";
    } else if (eligibleForSuper) {
      superBtn.classList.remove("hidden");
      superBtn.textContent = "⭐ GO SUPER";
    } else {
      superBtn.classList.add("hidden");
    }
  }

  if (superPrompt) superPrompt.style.display = (isSuper || eligibleForSuper) ? "block" : "none";
  document.body.classList.toggle("super-sonic-active", isSuper);
}

function toggleSuperSonic() {
  if (!activeCloudLedger.superState) {
    activeCloudLedger.superState = { active: false, startedAt: null, lastDrainAt: null };
  }
  if (isSuperSonicActive()) {
    activeCloudLedger.superState.active = false;
    updateRingDisplay();
    commitScoreLedgerToTrello(activeCloudLedger.today);
  } else {
    if (!canTransformSuperSonic()) {
      alert("Super Sonic requires all 7 Chaos Emeralds unlocked AND at least 50 Rings in reserve!");
      return;
    }
    activeCloudLedger.superState.active = true;
    activeCloudLedger.superState.startedAt = Date.now();
    activeCloudLedger.superState.lastDrainAt = Date.now();
    updateRingDisplay();
    if (typeof playPomoChime === "function") playPomoChime("chaos");
    commitScoreLedgerToTrello(activeCloudLedger.today);
  }
}

function processSuperSonicDrain() {
  if (!isSuperSonicActive()) return;
  const now = Date.now();
  const lastDrain = activeCloudLedger.superState.lastDrainAt || now;
  const elapsedSec = (now - lastDrain) / 1000;

  // Drain 1 ring every 6 seconds (10 rings / min)
  const ringsToDrain = Math.floor(elapsedSec / 6);
  if (ringsToDrain >= 1) {
    activeCloudLedger.ringBank = Math.max(0, (activeCloudLedger.ringBank || 0) - ringsToDrain);
    activeCloudLedger.superState.lastDrainAt = now - ((elapsedSec % 6) * 1000);

    if (activeCloudLedger.ringBank <= 0) {
      activeCloudLedger.ringBank = 0;
      activeCloudLedger.superState.active = false;
      updateRingDisplay();
      if (typeof playPomoChime === "function") playPomoChime("complete");
      alert("⚡ Super Sonic energy depleted! Returned to normal state.");
      commitScoreLedgerToTrello(activeCloudLedger.today);
    } else {
      updateRingDisplay();
    }
  }
}
setInterval(processSuperSonicDrain, 1000);

// --- VAULT MODAL & INVENTORY ---
function openVaultModal() {
  renderVaultInventory();
  updateRingDisplay();
  const m = document.getElementById("vaultModal");
  if (m) m.classList.add("open");
}

function closeVaultModal() {
  const m = document.getElementById("vaultModal");
  if (m) m.classList.remove("open");
}

function renderVaultInventory() {
  if (!activeCloudLedger.inventory) {
    activeCloudLedger.inventory = { warpTokens: 0, roadblockShields: 0, deadlineExtenders: 0, decompBuffers: 0, spikePasses: 0 };
  }
  const inv = activeCloudLedger.inventory;
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt("vaultQtyWarp", inv.warpTokens || 0);
  setTxt("vaultQtyShield", inv.roadblockShields || 0);
  setTxt("vaultQtyExtender", inv.deadlineExtenders || 0);
  setTxt("vaultQtyDecomp", inv.decompBuffers || 0);
  setTxt("vaultQtySpike", inv.spikePasses || 0);
}

function buyVaultItem(itemKey, cost) {
  const currentRings = (activeCloudLedger && activeCloudLedger.ringBank) || 0;
  if (currentRings < cost) {
    alert(`Insufficient Rings! You need ${cost} rings (Current: ${currentRings}). Complete tasks to earn more!`);
    return;
  }
  activeCloudLedger.ringBank -= cost;
  if (!activeCloudLedger.inventory) activeCloudLedger.inventory = {};
  activeCloudLedger.inventory[itemKey] = (activeCloudLedger.inventory[itemKey] || 0) + 1;
  commitScoreLedgerToTrello(activeCloudLedger.today);
  updateRingDisplay();
  renderVaultInventory();
  if (typeof playPomoChime === "function") playPomoChime("chaos");
}

// --- DEBRIEF MODAL (SCORECARD DISPLAY) ---
function openDebriefModal() {
  const ledger = loadDailyScoreLedger();
  const cal = state.calendarTelemetry || {};
  const stats = calculateTacticalYield(ledger, cal);
  const weekStats = getWeeklyRollingStats();

  const modal = document.getElementById("debriefModal");
  if (!modal) return;

  const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  const rankBadge = document.getElementById("dbRankBadge");
  if (rankBadge) {
    rankBadge.textContent = stats.rank;
    rankBadge.style.borderColor = stats.rankColor;
    rankBadge.style.color = stats.rankColor;
  }

  const rankTitle = document.getElementById("dbRankTitle");
  if (rankTitle) {
    rankTitle.textContent = `CLASS ${stats.rank} // ${stats.title}`;
    rankTitle.style.color = stats.rankColor;
  }

  setEl("dbScoreDisplay", `${stats.rawScore} PTS`);
  setEl("dbYieldDisplay", `${stats.yieldRate} PTS / FOCUS HR`);

  setEl("dbRedCount", `${ledger.completed?.red || 0}`);
  setEl("dbRedPts", `+${stats.redPts}`);
  setEl("dbYellowCount", `${ledger.completed?.yellow || 0}`);
  setEl("dbYellowPts", `+${stats.yellowPts}`);
  setEl("dbGreenCount", `${ledger.completed?.green || 0}`);
  setEl("dbGreenPts", `+${stats.greenPts}`);

  const dMods = stats.dMods || { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 };
  setEl("dbEarlyCount", `${dMods.earlyCount || 0}`);
  setEl("dbEarlyPts", `+${dMods.earlyPts || 0}`);
  setEl("dbOntimeCount", `${dMods.ontimeCount || 0}`);
  setEl("dbOntimePts", `+${dMods.ontimePts || 0}`);
  setEl("dbOverdueCount", `${dMods.overdueCount || 0}`);
  setEl("dbOverduePts", dMods.overduePts < 0 ? `${dMods.overduePts}` : `0`);

  setEl("dbExemptCount", `${ledger.deferralsExempt || 0}`);
  setEl("dbPenalizedCount", `${ledger.deferralsPenalized || 0}`);
  setEl("dbPenaltyPts", stats.penaltyPts > 0 ? `-${stats.penaltyPts}` : `0`);

  setEl("dbRunwayBase", `${stats.totalRunway.toFixed(2)}h`);
  setEl("dbMeetingsBooked", `-${stats.meetingHours.toFixed(2)}h`);
  setEl("dbDecompTax", `-${stats.decompressionTax.toFixed(2)}h`);
  setEl("dbNetRunway", `${stats.netRunway.toFixed(2)}h`);

  const barPercent = Math.min(100, Math.round((stats.yieldRate / 50) * 100));
  const barEl = document.getElementById("dbYieldBar");
  if (barEl) {
    barEl.style.width = `${barPercent}%`;
    barEl.style.backgroundColor = stats.rankColor;
  }

  renderEmeraldStrip("dbEmeraldStrip", weekStats);
  modal.classList.add("open");
}

function closeDebriefModal() {
  const modal = document.getElementById("debriefModal");
  if (modal) modal.classList.remove("open");
}

function renderEmeraldStrip(containerId, weekStats) {
  const container = document.getElementById(containerId);
  if (!container || !weekStats || !weekStats.emeralds) return;

  container.innerHTML = weekStats.emeralds.map(em => {
    const opacity = em.unlocked ? "1" : "0.22";
    const filter = em.unlocked ? "drop-shadow(0 0 6px currentColor)" : "grayscale(100%)";
    return `
      <div style="display:flex; flex-direction:column; align-items:center; opacity:${opacity}; filter:${filter};" title="${em.name}: ${em.criteria} (${em.unlocked ? 'CLAIMED' : 'LOCKED'})">
        <span style="font-size:1.4rem;">${em.icon}</span>
        <span style="font-size:0.58rem; font-weight:700; margin-top:2px; color:#cbd5e1;">${em.unlocked ? '✓' : '—'}</span>
      </div>
    `;
  }).join("");

  const superBanner = document.getElementById("dbSuperStateBanner");
  if (superBanner) {
    superBanner.style.display = weekStats.isSuperState ? "block" : "none";
  }
}

// --- ROADBLOCK DEFERRAL ---
function promptRoadblockDeferral(cardId, boardKey) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  const cardTitle = card ? card.name : "this task";

  document.getElementById("deferralModalCardName").textContent = cardTitle;
  document.getElementById("deferralReasonInput").value = "";
  document.getElementById("deferralModal").dataset.cardId = cardId;
  document.getElementById("deferralModal").dataset.boardKey = boardKey;
  document.getElementById("deferralModal").classList.add("open");
  setTimeout(() => document.getElementById("deferralReasonInput").focus(), 100);
}

function closeDeferralModal() {
  document.getElementById("deferralModal").classList.remove("open");
}

async function confirmDeferral(isDocumented) {
  const modal = document.getElementById("deferralModal");
  const cardId = modal.dataset.cardId;
  const boardKey = modal.dataset.boardKey;
  let reason = document.getElementById("deferralReasonInput").value.trim();
  closeDeferralModal();

  const card = state.allLoadedCards.find(c => c.id === cardId);

  if (isDocumented) {
    if (!reason) reason = "Documented Roadblock";
    try {
      const commentText = `🛑 ROADBLOCK DEFERRED: ${reason}`;
      await trelloFetch(`/cards/${cardId}/actions/comments`, "POST", `&text=${encodeURIComponent(commentText)}`);
    } catch (e) {
      console.error("Could not post roadblock comment:", e);
    }
    await recordCardDeferred(card, true, reason);
  } else {
    await recordCardDeferred(card, false, "Undocumented");
  }

  await moveCard(cardId, boardKey, 'waiting');
}

// --- TELEMETRY NOTIFICATIONS ---
async function requestPushNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

function sendPushTelemetryNotification(title, body, tag = "hud-telemetry") {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const notif = new Notification(title, {
      body,
      icon: "icon-192.png",
      tag,
      badge: "icon-192.png",
      renotify: true
    });
    notif.onclick = () => {
      window.focus();
      if (tag === "hud-eow") openWeeklyReportModal();
      else openDebriefModal();
    };
  } catch (e) {
    console.error("Failed to display notification:", e);
  }
}

function checkAndSchedulePushNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours() + (now.getMinutes() / 60);
  const todayStr = getTodayScoreDateStr();

  if (day >= 1 && day <= 5 && hour >= 16.75 && hour < 18.0) {
    const key = "HUD_NOTIFIED_EOD_" + todayStr;
    if (!localStorage.getItem(key)) {
      const stats = calculateTacticalYield();
      sendPushTelemetryNotification(
        "⚡ Tactical Focus HUD: Shift Concluded",
        `Today's Yield: ${stats.yieldRate} pts/hr (${stats.rank} Rank). Tap to open EOD Debrief.`,
        "hud-eod"
      );
      localStorage.setItem(key, "true");
    }
  }

  if (day === 5 && hour >= 16.75 && hour < 18.0) {
    const key = "HUD_NOTIFIED_EOW_" + todayStr;
    if (!localStorage.getItem(key)) {
      const weekStats = getWeeklyRollingStats();
      sendPushTelemetryNotification(
        `⭐ Weekly Cycle Complete: ${weekStats.collectedCount}/7 Emeralds`,
        `Weekly Grade: ${weekStats.grade}. Tap to review your Weekly Executive Briefing.`,
        "hud-eow"
      );
      localStorage.setItem(key, "true");
    }
  }
}

setInterval(checkAndSchedulePushNotifications, 5 * 60 * 1000);

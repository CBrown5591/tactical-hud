// --- js/score.js: Pure Cloud Ledger, Ring Economy & Super Sonic Engine (O(1) Optimized) ---

function getTodayScoreDateStr() {
  const now = new Date();
  return now.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

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
  energyKeywords: {
    red: "architect, architecture, migration, migrate, deploy, deployment, outage, incident, sev-1, disaster, scada, infra, provision, rebuild, failover, security review",
    yellow: "configure, configuration, update, review, troubleshoot, investigate, test, testing, script, documentation, doc, prep, refactor, sync, analyze, analysis",
    green: "reply, email, ping, check, log, approve, approval, quick, clean, archive, submit, order, call, receipt, schedule, invoice"
  },
  history: {}
};

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

async function commitScoreLedgerToTrello(ledger = activeCloudLedger.today) {
  if (!state || !state.scoreLedgerCardId) return;
  if (typeof trelloFetch !== "function") return;

  const todayStr = getTodayScoreDateStr();
  activeCloudLedger.currentDate = todayStr;
  activeCloudLedger.today = ledger;
  if (!activeCloudLedger.history) activeCloudLedger.history = {};
  activeCloudLedger.history[todayStr] = ledger;

  try {
    const payload = JSON.stringify(activeCloudLedger, null, 2);
    await trelloFetch(`/cards/${state.scoreLedgerCardId}`, "PUT", `&desc=${encodeURIComponent(payload)}`);
  } catch (e) {
    console.error("[Portal Master] Failed to commit score ledger to Trello:", e);
  }
}

function hydrateCloudLedgerFromTrello(cardDesc) {
  if (!cardDesc || !cardDesc.trim()) return;
  try {
    const parsed = JSON.parse(cardDesc.trim());
    const todayStr = getTodayScoreDateStr();

    // Preserve universal bank if existing in memory is higher/newer
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
      // Rollover check if it's a new day
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

    // Apply universal economy
    activeCloudLedger.ringBank = universalRings;
    activeCloudLedger.inventory = universalInventory;

    console.log(`[Score Sync] Hydrated ${state.context.toUpperCase()} score ledger from Trello:`, activeCloudLedger);
    if (typeof updateRingDisplay === "function") updateRingDisplay();
  } catch (e) {
    console.warn("[Score Sync] Failed to parse Trello score ledger card description:", e);
  }
}
function getCustomBoards() {
  return (activeCloudLedger && Array.isArray(activeCloudLedger.customBoards)) ? activeCloudLedger.customBoards : [];
}

function getActiveBoardsForContext(ctx) {
  const defaults = {
    work: [
      { key: "work", name: "Work", icon: "💼" },
      { key: "growth", name: "Growth", icon: "🎓" }
    ],
    personal: [
      { key: "life", name: "King's Dominion", icon: "🎢" }
    ],
    mission: [
      { key: "vi", name: "By The VI", icon: "🏝️" },
      { key: "lab", name: "Hiiii-Power", icon: "⚡" },
      { key: "growth", name: "Growth", icon: "🎓" }
    ]
  };
  const base = defaults[ctx] || [];
  const customs = getCustomBoards().filter(b => b.context === ctx);
  return [...base, ...customs];
}

async function addCustomBoard(name, rawIdOrUrl, context = "mission", icon = "🚀") {
  if (!name || !rawIdOrUrl) throw new Error("Name and Trello Board ID are required.");
  let cleanId = rawIdOrUrl.trim();
  const urlMatch = cleanId.match(/trello\.com\/b\/([a-zA-Z0-9]+)/);
  if (urlMatch) cleanId = urlMatch[1];

  const key = `cb_${Date.now()}`;
  if (!activeCloudLedger.customBoards) activeCloudLedger.customBoards = [];
  activeCloudLedger.customBoards.push({ key, name: name.trim(), id: cleanId, context, icon: icon.trim() || "🚀" });
  await commitScoreLedgerToTrello(activeCloudLedger.today);
}

async function removeCustomBoard(boardKey) {
  if (!activeCloudLedger.customBoards) return;
  activeCloudLedger.customBoards = activeCloudLedger.customBoards.filter(b => b.key !== boardKey);
  await commitScoreLedgerToTrello(activeCloudLedger.today);
}

const DEFAULT_ENERGY_KEYWORDS = {
  red: "architect, architecture, migration, migrate, deploy, deployment, outage, incident, sev-1, disaster, scada, infra, provision, rebuild, failover, security review",
  yellow: "configure, configuration, update, review, troubleshoot, investigate, test, testing, script, documentation, doc, prep, refactor, sync, analyze, analysis",
  green: "reply, email, ping, check, log, approve, approval, quick, clean, archive, submit, order, call, receipt, schedule, invoice"
};

function getActiveEnergyKeywords() {
  if (activeCloudLedger && activeCloudLedger.energyKeywords) {
    return {
      red: activeCloudLedger.energyKeywords.red !== undefined ? activeCloudLedger.energyKeywords.red : DEFAULT_ENERGY_KEYWORDS.red,
      yellow: activeCloudLedger.energyKeywords.yellow !== undefined ? activeCloudLedger.energyKeywords.yellow : DEFAULT_ENERGY_KEYWORDS.yellow,
      green: activeCloudLedger.energyKeywords.green !== undefined ? activeCloudLedger.energyKeywords.green : DEFAULT_ENERGY_KEYWORDS.green
    };
  }
  return DEFAULT_ENERGY_KEYWORDS;
}

async function updateCloudEnergyKeywords(newKeywords) {
  if (!activeCloudLedger) activeCloudLedger = { currentDate: getTodayScoreDateStr(), today: loadDailyScoreLedger() };
  activeCloudLedger.energyKeywords = { red: newKeywords.red || "", yellow: newKeywords.yellow || "", green: newKeywords.green || "" };
  await commitScoreLedgerToTrello(activeCloudLedger.today);
}

function buildKeywordRegex(csvString) {
  if (!csvString || !csvString.trim()) return null;
  const terms = csvString.split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 0).map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
  if (terms.length === 0) return null;
  return new RegExp(`\\b(${terms.join("|")})\\b`, "i");
}

function inferEnergyFromTitle(title = "") {
  if (!title) return "none";
  const clean = title.trim();
  if (/^(!red|!high|\[h\])\s+/i.test(clean)) return "red";
  if (/^(!yel|!med|\[m\])\s+/i.test(clean)) return "yellow";
  if (/^(!grn|!low|\[l\])\s+/i.test(clean)) return "green";

  const kw = getActiveEnergyKeywords();
  const redRegex = buildKeywordRegex(kw.red);
  const yellowRegex = buildKeywordRegex(kw.yellow);
  const greenRegex = buildKeywordRegex(kw.green);

  if (redRegex && redRegex.test(clean)) return "red";
  if (yellowRegex && yellowRegex.test(clean)) return "yellow";
  if (greenRegex && greenRegex.test(clean)) return "green";
  return "none";
}

// --- FREEZE-PROOF O(1) BUSINESS HOURS ENGINE ---
function calculateBusinessHours(dStart, dEnd) {
  if (!(dStart instanceof Date) || isNaN(dStart.getTime()) || !(dEnd instanceof Date) || isNaN(dEnd.getTime())) return 0;
  if (dStart > dEnd) return -calculateBusinessHours(dEnd, dStart);

  const SHIFT_START = 8.0;
  const SHIFT_END = 17.0;
  const MAX_SPAN_MS = 5 * 24 * 60 * 60 * 1000; // Cap lookback window to prevent any heavy iterations
  
  let start = (dEnd.getTime() - dStart.getTime() > MAX_SPAN_MS) ? new Date(dEnd.getTime() - MAX_SPAN_MS) : new Date(dStart.getTime());
  let end = new Date(dEnd.getTime());

  let totalHours = 0;
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  while (cur <= endDay) {
    const dayOfWeek = cur.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      let dayStart = SHIFT_START;
      let dayEnd = SHIFT_END;

      if (cur.getTime() === (new Date(start.getFullYear(), start.getMonth(), start.getDate())).getTime()) {
        const startDec = start.getHours() + (start.getMinutes() / 60);
        dayStart = Math.max(SHIFT_START, Math.min(SHIFT_END, startDec));
      }
      if (cur.getTime() === endDay.getTime()) {
        const endDec = end.getHours() + (end.getMinutes() / 60);
        dayEnd = Math.max(SHIFT_START, Math.min(SHIFT_END, endDec));
      }
      if (dayEnd > dayStart) totalHours += (dayEnd - dayStart);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return +totalHours.toFixed(2);
}

function calculateDeadlineModifier(energy = "green", dueStr = "", isRetroactiveWaiver = false) {
  if (!dueStr) return { type: "none", pts: 0, label: "No Deadline", isOverdue: false };

  const tierConfig = {
    red:    { early: 50, ontime: 25, penaltyPerDay: 25, floor: 25 },
    yellow: { early: 25, ontime: 15, penaltyPerDay: 15, floor: 10 },
    green:  { early: 15, ontime: 10, penaltyPerDay: 10, floor: 5 },
    none:   { early: 10, ontime: 5,  penaltyPerDay: 5,  floor: 0 }
  };
  const cfg = tierConfig[energy] || tierConfig.green;

  if ((typeof isSuperSonicActive === "function" && isSuperSonicActive()) || isRetroactiveWaiver) {
    return { type: "ontime", pts: cfg.ontime, label: isRetroactiveWaiver ? `🎯 On-Time Waiver (+${cfg.ontime})` : `⚡ Super On-Target (+${cfg.ontime})`, isOverdue: false };
  }

  const now = new Date();
  const dueDate = new Date(dueStr);
  if (isNaN(dueDate.getTime())) return { type: "none", pts: 0, label: "No Deadline", isOverdue: false };

  const isWork = (state && state.context === "work");

  if (isWork) {
    if (now <= dueDate) {
      const remainingBusHours = calculateBusinessHours(now, dueDate);
      if (remainingBusHours >= 9.0) {
        return { type: "early", pts: cfg.early, label: `⚡ Early (+${cfg.early})`, isOverdue: false };
      } else {
        return { type: "ontime", pts: cfg.ontime, label: `🎯 On-Target (+${cfg.ontime})`, isOverdue: false };
      }
    } else {
      const overdueBusHours = calculateBusinessHours(dueDate, now);
      if (overdueBusHours <= 2.0) {
        return { type: "ontime", pts: cfg.ontime, label: `🎯 On-Target Grace (+${cfg.ontime})`, isOverdue: false };
      }
      const businessDaysLate = Math.min(3, Math.ceil(overdueBusHours / 9.0));
      const penalty = -(businessDaysLate * cfg.penaltyPerDay);
      return { type: "overdue", pts: penalty, label: `⚠️ Overdue ${businessDaysLate}d (${penalty})`, isOverdue: true };
    }
  } else {
    const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (diffHours >= 24) {
      return { type: "early", pts: cfg.early, label: `⚡ Early (+${cfg.early})`, isOverdue: false };
    } else if (diffHours >= -4) {
      return { type: "ontime", pts: cfg.ontime, label: `🎯 On-Target (+${cfg.ontime})`, isOverdue: false };
    } else {
      const daysLate = Math.min(3, Math.ceil(Math.abs(diffHours) / 24));
      const penalty = -(daysLate * cfg.penaltyPerDay);
      return { type: "overdue", pts: penalty, label: `⚠️ Overdue ${daysLate}d (${penalty})`, isOverdue: true };
    }
  }
}

async function recordCardCompleted(card, isRetroactiveWaiver = false) {
  if (!card || !card.id) return;
  const ledger = loadDailyScoreLedger();
  if (ledger.completedCardIds && ledger.completedCardIds.includes(card.id)) return;

  if (!ledger.completedCardIds) ledger.completedCardIds = [];
  ledger.completedCardIds.push(card.id);

  if (!ledger.completedBoards) ledger.completedBoards = [];
  if (card.boardKey && !ledger.completedBoards.includes(card.boardKey)) ledger.completedBoards.push(card.boardKey);

  const energy = card.energy || "none";
  let earnedBasePts = 0;
  if (ledger.completed[energy] !== undefined) ledger.completed[energy]++;
  else ledger.completed.none++;

  if (energy === "red") earnedBasePts = 100;
  else if (energy === "yellow") earnedBasePts = 50;
  else if (energy === "green") earnedBasePts = 25;

  if (!ledger.deadlineModifiers) {
    ledger.deadlineModifiers = { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 };
  }
  const mod = calculateDeadlineModifier(energy, card.due, isRetroactiveWaiver);
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

  const netCardPoints = Math.max(0, earnedBasePts + (mod.pts || 0));
  activeCloudLedger.ringBank = (activeCloudLedger.ringBank || 0) + netCardPoints;

  await commitScoreLedgerToTrello(ledger);
  updateRingDisplay();
}

async function recordCardDeferred(card, isExempt = false, reason = "") {
  if (!card || !card.id) return;
  const ledger = loadDailyScoreLedger();

  const isSuper = isSuperSonicActive();
  const hasShield = (activeCloudLedger.inventory && activeCloudLedger.inventory.roadblockShields > 0);

  if (isSuper || isExempt) ledger.deferralsExempt = (ledger.deferralsExempt || 0) + 1;
  else if (hasShield) {
    activeCloudLedger.inventory.roadblockShields--;
    ledger.deferralsExempt = (ledger.deferralsExempt || 0) + 1;
    reason = reason ? `${reason} (🛡️ Roadblock Shield Used)` : "🛡️ Roadblock Shield Used";
  } else ledger.deferralsPenalized = (ledger.deferralsPenalized || 0) + 1;

  if (!ledger.deferredCards) ledger.deferredCards = [];
  ledger.deferredCards.push({ id: card.id, name: card.name, isExempt: isSuper || isExempt || hasShield, reason, time: new Date().toISOString() });
  await commitScoreLedgerToTrello(ledger);
}

async function recordChaosControlUsage(taskName = "") {
  const ledger = loadDailyScoreLedger();
  ledger.chaosControlCount = (ledger.chaosControlCount || 0) + 1;
  await commitScoreLedgerToTrello(ledger);
}

function calculateTacticalYield(ledger = loadDailyScoreLedger(), calTelemetry = (state && state.calendarTelemetry)) {
  const redPts = (ledger.completed.red || 0) * 100;
  const yellowPts = (ledger.completed.yellow || 0) * 50;
  const greenPts = (ledger.completed.green || 0) * 25;
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

  const decompBufferApplied = (activeCloudLedger.inventory && activeCloudLedger.inventory.decompBuffers > 0) ? 0.5 : 0;
  const isMission = state && state.context === "mission";

  if (isWork) {
    if (isOff) {
      totalRunway = 0;
      netRunway = 0;
    } else {
      meetingHours = (calTelemetry && calTelemetry.workBookedHours !== undefined) ? calTelemetry.workBookedHours : (calTelemetry && calTelemetry.bookedHours ? calTelemetry.bookedHours : 0);
      decompressionTax = +(Math.max(0, (meetingHours * 0.25) - decompBufferApplied)).toFixed(2);
      netRunway = Math.max(0.5, +(totalRunway - (meetingHours + decompressionTax)).toFixed(2));
    }
  } else if (isMission) {
    totalRunway = 2.5;
    meetingHours = 0;
    decompressionTax = 0;
    netRunway = 2.5;
  } else {
    totalRunway = 4.0;
    meetingHours = (calTelemetry && calTelemetry.bookedHours) ? Math.min(3.0, calTelemetry.bookedHours) : 0;
    decompressionTax = +(Math.max(0, (meetingHours * 0.25) - decompBufferApplied)).toFixed(2);
    netRunway = Math.max(0.5, +(totalRunway - (meetingHours + decompressionTax)).toFixed(2));
  }

  const yieldRate = netRunway > 0 ? +(rawScore / netRunway).toFixed(1) : 0;

  let rank = "B", title = "STEADY CRUISE", rankColor = "#eab308";
  if (rawScore === 0 && (isOff || meetingHours >= 7.0)) { rank = "S"; title = "CLEAN LOCKOUT"; rankColor = "#38bdf8"; }
  else if (yieldRate >= 42.0) { rank = "S"; title = "SONIC MASTER"; rankColor = "#38bdf8"; }
  else if (yieldRate >= 32.0) { rank = "A"; title = "OPERATIONAL ACE"; rankColor = "#22c55e"; }
  else if (yieldRate >= 22.0) { rank = "B"; title = "STEADY CRUISE"; rankColor = "#eab308"; }
  else if (yieldRate >= 12.0) { rank = "C"; title = "FRICTION DRAG"; rankColor = "#f97316"; }
  else { rank = "D"; title = "CONTAINMENT"; rankColor = "#ef4444"; }

  return { rawScore, redPts, yellowPts, greenPts, deadlineNetPts, dMods, penaltyPts, totalRunway, meetingHours, decompressionTax, netRunway, yieldRate, rank, title, rankColor, isOff };
}

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
  return { emeralds, collectedCount, isSuperState: collectedCount === 7 };
}

function getWeeklyRollingStats() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));

  let totalScore = 0, totalNetRunway = 0, daysActive = 0, totalMeetings = 0;
  let totalRed = 0, totalYellow = 0, totalGreen = 0, totalExempt = 0, totalPenalized = 0, totalChaosControl = 0;
  let distinctBoardsSet = new Set(), weeklyEarly = 0, weeklyOntime = 0, weeklyOverdue = 0;

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = cur.toISOString().split("T")[0];
    const l = (activeCloudLedger.history && activeCloudLedger.history[dateStr]) || (activeCloudLedger.currentDate === dateStr ? activeCloudLedger.today : null);

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

  const baseStats = { totalScore, daysActive, totalMeetings, totalRed, totalYellow, totalGreen, weeklyEarly, weeklyOntime, weeklyOverdue, totalExempt, totalPenalized, totalChaosControl, distinctBoardsCount: distinctBoardsSet.size, highMeetingDefense: false, avgYield, grade };
  return { ...baseStats, ...evaluateChaosEmeralds(baseStats) };
}

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
    if (isSuper) { superBtn.classList.remove("hidden"); superBtn.textContent = "⚡ DEPOWER"; }
    else if (eligibleForSuper) { superBtn.classList.remove("hidden"); superBtn.textContent = "⭐ GO SUPER"; }
    else { superBtn.classList.add("hidden"); }
  }
  if (superPrompt) superPrompt.style.display = (isSuper || eligibleForSuper) ? "block" : "none";
  document.body.classList.toggle("super-sonic-active", isSuper);
}

function toggleSuperSonic() {
  if (!activeCloudLedger.superState) activeCloudLedger.superState = { active: false, startedAt: null, lastDrainAt: null };
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

function openVaultModal() { renderVaultInventory(); updateRingDisplay(); document.getElementById("vaultModal")?.classList.add("open"); }
function closeVaultModal() { document.getElementById("vaultModal")?.classList.remove("open"); }

function renderVaultInventory() {
  if (!activeCloudLedger.inventory) activeCloudLedger.inventory = { warpTokens: 0, roadblockShields: 0, deadlineExtenders: 0, decompBuffers: 0, spikePasses: 0 };
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
    alert(`Insufficient Rings! You need ${cost} rings (Current: ${currentRings}).`);
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

function openDebriefModal() {
  const ledger = loadDailyScoreLedger();
  const cal = state.calendarTelemetry || {};
  const stats = calculateTacticalYield(ledger, cal);
  const weekStats = getWeeklyRollingStats();
  const modal = document.getElementById("debriefModal");
  if (!modal) return;

  document.getElementById("dbRankBadge").textContent = stats.rank;
  document.getElementById("dbRankBadge").style.borderColor = stats.rankColor;
  document.getElementById("dbRankBadge").style.color = stats.rankColor;
  document.getElementById("dbRankTitle").textContent = `CLASS ${stats.rank} // ${stats.title}`;
  document.getElementById("dbRankTitle").style.color = stats.rankColor;
  document.getElementById("dbScoreDisplay").textContent = `${stats.rawScore} PTS`;
  document.getElementById("dbYieldDisplay").textContent = `${stats.yieldRate} PTS / FOCUS HR`;
  document.getElementById("dbRedCount").textContent = `${ledger.completed?.red || 0}`;
  document.getElementById("dbRedPts").textContent = `+${stats.redPts}`;
  document.getElementById("dbYellowCount").textContent = `${ledger.completed?.yellow || 0}`;
  document.getElementById("dbYellowPts").textContent = `+${stats.yellowPts}`;
  document.getElementById("dbGreenCount").textContent = `${ledger.completed?.green || 0}`;
  document.getElementById("dbGreenPts").textContent = `+${stats.greenPts}`;

  const dMods = stats.dMods || { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 };
  document.getElementById("dbEarlyCount").textContent = `${dMods.earlyCount || 0}`;
  document.getElementById("dbEarlyPts").textContent = `+${dMods.earlyPts || 0}`;
  document.getElementById("dbOntimeCount").textContent = `${dMods.ontimeCount || 0}`;
  document.getElementById("dbOntimePts").textContent = `+${dMods.ontimePts || 0}`;
  document.getElementById("dbOverdueCount").textContent = `${dMods.overdueCount || 0}`;
  document.getElementById("dbOverduePts").textContent = dMods.overduePts < 0 ? `${dMods.overduePts}` : `0`;

  document.getElementById("dbExemptCount").textContent = `${ledger.deferralsExempt || 0}`;
  document.getElementById("dbPenalizedCount").textContent = `${ledger.deferralsPenalized || 0}`;
  document.getElementById("dbPenaltyPts").textContent = stats.penaltyPts > 0 ? `-${stats.penaltyPts}` : `0`;
  document.getElementById("dbRunwayBase").textContent = `${stats.totalRunway.toFixed(2)}h`;
  document.getElementById("dbMeetingsBooked").textContent = `-${stats.meetingHours.toFixed(2)}h`;
  document.getElementById("dbDecompTax").textContent = `-${stats.decompressionTax.toFixed(2)}h`;
  document.getElementById("dbNetRunway").textContent = `${stats.netRunway.toFixed(2)}h`;

  const barEl = document.getElementById("dbYieldBar");
  if (barEl) {
    barEl.style.width = `${Math.min(100, Math.round((stats.yieldRate / 50) * 100))}%`;
    barEl.style.backgroundColor = stats.rankColor;
  }
  renderEmeraldStrip("dbEmeraldStrip", weekStats);
  modal.classList.add("open");
}

function closeDebriefModal() { document.getElementById("debriefModal")?.classList.remove("open"); }

function renderEmeraldStrip(containerId, weekStats) {
  const container = document.getElementById(containerId);
  if (!container || !weekStats || !weekStats.emeralds) return;
  container.innerHTML = weekStats.emeralds.map(em => `
    <div style="display:flex; flex-direction:column; align-items:center; opacity:${em.unlocked ? "1" : "0.22"}; filter:${em.unlocked ? "drop-shadow(0 0 6px currentColor)" : "grayscale(100%)"};">
      <span style="font-size:1.4rem;">${em.icon}</span>
      <span style="font-size:0.58rem; font-weight:700; margin-top:2px; color:#cbd5e1;">${em.unlocked ? '✓' : '—'}</span>
    </div>
  `).join("");
  const superBanner = document.getElementById("dbSuperStateBanner");
  if (superBanner) superBanner.style.display = weekStats.isSuperState ? "block" : "none";
}

function promptRoadblockDeferral(cardId, boardKey) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  document.getElementById("deferralModalCardName").textContent = card ? card.name : "this task";
  document.getElementById("deferralReasonInput").value = "";
  const modal = document.getElementById("deferralModal");
  modal.dataset.cardId = cardId;
  modal.dataset.boardKey = boardKey;
  modal.classList.add("open");
}

function closeDeferralModal() { document.getElementById("deferralModal")?.classList.remove("open"); }

async function confirmDeferral(isDocumented) {
  const modal = document.getElementById("deferralModal");
  const cardId = modal.dataset.cardId;
  const boardKey = modal.dataset.boardKey;
  let reason = document.getElementById("deferralReasonInput").value.trim();
  closeDeferralModal();

  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (isDocumented) {
    if (!reason) reason = "Documented Roadblock";
    try { await trelloFetch(`/cards/${cardId}/actions/comments`, "POST", `&text=${encodeURIComponent("🛑 ROADBLOCK DEFERRED: " + reason)}`); } catch (e) {}
    await recordCardDeferred(card, true, reason);
  } else {
    await recordCardDeferred(card, false, "Undocumented");
  }
  await moveCard(cardId, boardKey, 'waiting');
}

async function requestPushNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
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
      new Notification("⚡ Shift Concluded", { body: `Today's Yield: ${calculateTacticalYield().yieldRate} pts/hr.` });
      localStorage.setItem(key, "true");
    }
  }
}
setInterval(checkAndSchedulePushNotifications, 5 * 60 * 1000);

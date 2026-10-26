// --- js/score.js: Tactical Focus HUD Scoring, Emerald Mastery & Cloud Ledger Engine ---

const SCORE_STORAGE_KEY_PREFIX = "TACTICAL_SCORE_LEDGER_";

function getTodayScoreDateStr() {
  const now = new Date();
  return now.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

function loadDailyScoreLedger(dateStr = getTodayScoreDateStr()) {
  try {
    const raw = localStorage.getItem(SCORE_STORAGE_KEY_PREFIX + dateStr);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    date: dateStr,
    updatedAt: 0,
    completed: { red: 0, yellow: 0, green: 0, none: 0 },
    completedCardIds: [],
    completedBoards: [],
    deadlineModifiers: { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 },
    deferralsExempt: 0,
    deferralsPenalized: 0,
    deferredCards: [],
    chaosControlCount: 0
  };
}

let _scorePushTimeout = null;
function pushScoreLedgerToTrello(ledger = loadDailyScoreLedger()) {
  if (!state || !state.scoreLedgerCardId) return;
  if (typeof trelloFetch !== "function") return;

  if (_scorePushTimeout) clearTimeout(_scorePushTimeout);
  _scorePushTimeout = setTimeout(async () => {
    try {
      const payload = JSON.stringify(ledger);
      await trelloFetch(`/cards/${state.scoreLedgerCardId}`, "PUT", `&desc=${encodeURIComponent(payload)}`);
      console.log("[Score Cloud Sync] Pushed score ledger to Trello card:", ledger);
    } catch (e) {
      console.warn("[Score Cloud Sync] Failed to push ledger to Trello:", e);
    }
  }, 350);
}

function adoptRemoteScoreLedger(remoteLedger) {
  if (!remoteLedger || !remoteLedger.date) return;
  const todayStr = getTodayScoreDateStr();
  if (remoteLedger.date !== todayStr) return;

  const local = loadDailyScoreLedger(todayStr);

  const localTime = local.updatedAt || 0;
  const remoteTime = remoteLedger.updatedAt || 0;

  // Authoritative adoption: newer timestamp wins completely
  if (remoteTime >= localTime || !local.updatedAt) {
    const cleanLedger = {
      date: todayStr,
      updatedAt: remoteTime || Date.now(),
      completed: remoteLedger.completed || { red: 0, yellow: 0, green: 0, none: 0 },
      completedCardIds: remoteLedger.completedCardIds || [],
      completedBoards: remoteLedger.completedBoards || [],
      deadlineModifiers: remoteLedger.deadlineModifiers || {
        earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0
      },
      deferralsExempt: remoteLedger.deferralsExempt || 0,
      deferralsPenalized: remoteLedger.deferralsPenalized || 0,
      deferredCards: remoteLedger.deferredCards || [],
      chaosControlCount: remoteLedger.chaosControlCount || 0
    };
    saveDailyScoreLedger(cleanLedger, todayStr, false);
    console.log("[Score Cloud Sync] Authoritative remote ledger adopted:", cleanLedger);
  } else {
    pushScoreLedgerToTrello(local);
  }
}

function saveDailyScoreLedger(ledger, dateStr = getTodayScoreDateStr(), pushToCloud = true) {
  try {
    ledger.updatedAt = Date.now();
    localStorage.setItem(SCORE_STORAGE_KEY_PREFIX + dateStr, JSON.stringify(ledger));
    if (pushToCloud) {
      pushScoreLedgerToTrello(ledger);
    }
  } catch (e) {
    console.error("Failed to save score ledger:", e);
  }
}

// Tier-Scaled Deadline Modifier Calculation
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

function recordCardCompleted(card) {
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
  const mod = calculateDeadlineModifier(energy, card.due);
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

  saveDailyScoreLedger(ledger);
}

function recordCardDeferred(card, isExempt = false, reason = "") {
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
  saveDailyScoreLedger(ledger);
}

function recordChaosControlUsage(taskName = "") {
  const ledger = loadDailyScoreLedger();
  ledger.chaosControlCount = (ledger.chaosControlCount || 0) + 1;
  saveDailyScoreLedger(ledger);
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
    const raw = localStorage.getItem(SCORE_STORAGE_KEY_PREFIX + dateStr);
    if (raw) {
      try {
        const l = JSON.parse(raw);
        const dm = l.deadlineModifiers || { earlyPts: 0, ontimePts: 0, overduePts: 0 };
        weeklyEarly += (dm.earlyCount || 0);
        weeklyOntime += (dm.ontimeCount || 0);
        weeklyOverdue += (dm.overdueCount || 0);

        const dNet = (dm.earlyPts || 0) + (dm.ontimePts || 0) + (dm.overduePts || 0);
        const dayScore = ((l.completed.red || 0) * 100) + ((l.completed.yellow || 0) * 50) + ((l.completed.green || 0) * 25) + dNet - ((l.deferralsPenalized || 0) * 15);

        if (dayScore > 0 || (l.completedCardIds && l.completedCardIds.length > 0) || l.chaosControlCount > 0) {
          daysActive++;
          totalScore += Math.max(0, dayScore);
          totalRed += (l.completed.red || 0);
          totalYellow += (l.completed.yellow || 0);
          totalGreen += (l.completed.green || 0);
          totalExempt += (l.deferralsExempt || 0);
          totalPenalized += (l.deferralsPenalized || 0);
          totalChaosControl += (l.chaosControlCount || 0);
          (l.completedBoards || []).forEach(b => distinctBoardsSet.add(b));
          totalNetRunway += 6.0;
        }
      } catch (e) {}
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

  document.getElementById("dbRedCount").textContent = `${ledger.completed.red || 0}`;
  document.getElementById("dbRedPts").textContent = `+${stats.redPts}`;
  document.getElementById("dbYellowCount").textContent = `${ledger.completed.yellow || 0}`;
  document.getElementById("dbYellowPts").textContent = `+${stats.yellowPts}`;
  document.getElementById("dbGreenCount").textContent = `${ledger.completed.green || 0}`;
  document.getElementById("dbGreenPts").textContent = `+${stats.greenPts}`;

  const dMods = stats.dMods || { earlyCount: 0, earlyPts: 0, ontimeCount: 0, ontimePts: 0, overdueCount: 0, overduePts: 0 };
  const earlyEl = document.getElementById("dbEarlyCount");
  if (earlyEl) earlyEl.textContent = `${dMods.earlyCount || 0}`;
  const earlyPtsEl = document.getElementById("dbEarlyPts");
  if (earlyPtsEl) earlyPtsEl.textContent = `+${dMods.earlyPts || 0}`;

  const ontimeEl = document.getElementById("dbOntimeCount");
  if (ontimeEl) ontimeEl.textContent = `${dMods.ontimeCount || 0}`;
  const ontimePtsEl = document.getElementById("dbOntimePts");
  if (ontimePtsEl) ontimePtsEl.textContent = `+${dMods.ontimePts || 0}`;

  const overdueEl = document.getElementById("dbOverdueCount");
  if (overdueEl) overdueEl.textContent = `${dMods.overdueCount || 0}`;
  const overduePtsEl = document.getElementById("dbOverduePts");
  if (overduePtsEl) overduePtsEl.textContent = dMods.overduePts < 0 ? `${dMods.overduePts}` : `0`;

  document.getElementById("dbExemptCount").textContent = `${ledger.deferralsExempt || 0}`;
  document.getElementById("dbPenalizedCount").textContent = `${ledger.deferralsPenalized || 0}`;
  document.getElementById("dbPenaltyPts").textContent = stats.penaltyPts > 0 ? `-${stats.penaltyPts}` : `0`;

  document.getElementById("dbRunwayBase").textContent = `${stats.totalRunway.toFixed(2)}h`;
  document.getElementById("dbMeetingsBooked").textContent = `-${stats.meetingHours.toFixed(2)}h`;
  document.getElementById("dbDecompTax").textContent = `-${stats.decompressionTax.toFixed(2)}h`;
  document.getElementById("dbNetRunway").textContent = `${stats.netRunway.toFixed(2)}h`;

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
    recordCardDeferred(card, true, reason);
  } else {
    recordCardDeferred(card, false, "Undocumented");
  }

  await moveCard(cardId, boardKey, 'waiting');
}

async function requestPushNotificationPermission() {
  if (!("Notification" in window)) {
    alert("Push Notifications are not supported in this browser.");
    return false;
  }
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

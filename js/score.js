// --- js/score.js: Tactical Focus HUD Scoring, Emerald Mastery & Telemetry Engine ---

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
    completed: { red: 0, yellow: 0, green: 0, none: 0 },
    completedCardIds: [],
    completedBoards: [],
    deferralsExempt: 0,
    deferralsPenalized: 0,
    deferredCards: [],
    chaosControlCount: 0
  };
}

function saveDailyScoreLedger(ledger, dateStr = getTodayScoreDateStr()) {
  try {
    localStorage.setItem(SCORE_STORAGE_KEY_PREFIX + dateStr, JSON.stringify(ledger));
  } catch (e) {
    console.error("Failed to save score ledger:", e);
  }
}

function recordCardCompleted(card) {
  if (!card || !card.id) return;
  const ledger = loadDailyScoreLedger();
  if (ledger.completedCardIds && ledger.completedCardIds.includes(card.id)) return; // prevent double counting

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

  const rawScore = Math.max(0, redPts + yellowPts + greenPts - penaltyPts);

  // Runway normalization (8:30 AM - 5:00 PM = 8.5h window)
  const isWork = state && state.context === "work";
  const now = new Date();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6);
  const isOff = (calTelemetry && calTelemetry.isWorkOffDay) || isWeekend;

  let totalRunway = 8.5;
  let meetingHours = 0;
  let decompressionTax = 0;
  let netRunway = 8.5;

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

  // Evaluation Ranks: S (Sonic), A, B, C, D
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

// --- 7 CHAOS EMERALDS WEEKLY MILESTONES ---
function evaluateChaosEmeralds(weekStats) {
  // 1. Green: Light Volume Throughput (>= 6 Light tasks)
  const green = weekStats.totalGreen >= 6;
  // 2. Yellow: Medium Cruise Consistency (>= 4 Medium tasks)
  const yellow = weekStats.totalYellow >= 4;
  // 3. Red: High Voltage Breakthrough (>= 2 Heavy tasks)
  const red = weekStats.totalRed >= 2;
  // 4. Blue: Temporal Shield Defense (Survive high meeting load >= 3h with S or A grade)
  const blue = weekStats.highMeetingDefense || (weekStats.avgYield >= 32.0 && weekStats.totalMeetings >= 4.0);
  // 5. Purple: Roadblock Friction Mastery (100% documented, at least 1 documented deferral and 0 penalized)
  const purple = weekStats.totalExempt >= 1 && weekStats.totalPenalized === 0;
  // 6. White: Multi-Ring Balance (Tasks completed across >= 3 distinct boards)
  const white = weekStats.distinctBoardsCount >= 3;
  // 7. Sky: Chaos Control Mastery (Activated Chaos Control at least once)
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
  const dayOfWeek = now.getDay(); // 0 is Sunday
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

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = cur.toISOString().split("T")[0];
    const raw = localStorage.getItem(SCORE_STORAGE_KEY_PREFIX + dateStr);
    if (raw) {
      try {
        const l = JSON.parse(raw);
        const dayScore = ((l.completed.red || 0) * 100) + ((l.completed.yellow || 0) * 50) + ((l.completed.green || 0) * 25) - ((l.deferralsPenalized || 0) * 15);
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

  const distinctBoardsCount = distinctBoardsSet.size;

  const baseStats = {
    totalScore,
    daysActive,
    totalMeetings,
    totalRed,
    totalYellow,
    totalGreen,
    totalExempt,
    totalPenalized,
    totalChaosControl,
    distinctBoardsCount,
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

// --- MODALS & UI HANDLERS ---
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

  // Render Chaos Emerald Tracker Strip in Debrief
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
  const reason = document.getElementById("deferralReasonInput").value.trim();
  closeDeferralModal();

  const card = state.allLoadedCards.find(c => c.id === cardId);

  if (isDocumented && reason) {
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

// --- PUSH NOTIFICATION TELEMETRY ENGINE ---
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
  const day = now.getDay(); // 0 Sun, 5 Fri, 6 Sat
  const hour = now.getHours() + (now.getMinutes() / 60);
  const todayStr = getTodayScoreDateStr();

  // 1. End of Day (EOD) Debrief Push: ~4:45 PM on Mon-Fri
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

  // 2. End of Week (EOW) Scorecard Push: Friday ~4:45 PM
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

// Check notification triggers every 5 minutes
setInterval(checkAndSchedulePushNotifications, 5 * 60 * 1000);

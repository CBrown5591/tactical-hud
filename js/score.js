// --- js/score.js: Tactical Focus HUD Scoring & Telemetry Engine ---

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
    deferralsExempt: 0,
    deferralsPenalized: 0,
    deferredCards: []
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
    // Personal Mode: use available waking evening runway (~4 hours baseline)
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

function openDebriefModal() {
  const ledger = loadDailyScoreLedger();
  const cal = state.calendarTelemetry || {};
  const stats = calculateTacticalYield(ledger, cal);

  const modal = document.getElementById("debriefModal");
  if (!modal) return;

  // Inject Scorecard Details
  document.getElementById("dbRankBadge").textContent = stats.rank;
  document.getElementById("dbRankBadge").style.borderColor = stats.rankColor;
  document.getElementById("dbRankBadge").style.color = stats.rankColor;
  document.getElementById("dbRankTitle").textContent = `CLASS ${stats.rank} // ${stats.title}`;
  document.getElementById("dbRankTitle").style.color = stats.rankColor;

  document.getElementById("dbScoreDisplay").textContent = `${stats.rawScore} PTS`;
  document.getElementById("dbYieldDisplay").textContent = `${stats.yieldRate} PTS / FOCUS HR`;

  // Counts & Points
  document.getElementById("dbRedCount").textContent = `${ledger.completed.red || 0}`;
  document.getElementById("dbRedPts").textContent = `+${stats.redPts}`;
  document.getElementById("dbYellowCount").textContent = `${ledger.completed.yellow || 0}`;
  document.getElementById("dbYellowPts").textContent = `+${stats.yellowPts}`;
  document.getElementById("dbGreenCount").textContent = `${ledger.completed.green || 0}`;
  document.getElementById("dbGreenPts").textContent = `+${stats.greenPts}`;

  document.getElementById("dbExemptCount").textContent = `${ledger.deferralsExempt || 0}`;
  document.getElementById("dbPenalizedCount").textContent = `${ledger.deferralsPenalized || 0}`;
  document.getElementById("dbPenaltyPts").textContent = stats.penaltyPts > 0 ? `-${stats.penaltyPts}` : `0`;

  // Normalization details
  document.getElementById("dbRunwayBase").textContent = `${stats.totalRunway.toFixed(2)}h`;
  document.getElementById("dbMeetingsBooked").textContent = `-${stats.meetingHours.toFixed(2)}h`;
  document.getElementById("dbDecompTax").textContent = `-${stats.decompressionTax.toFixed(2)}h`;
  document.getElementById("dbNetRunway").textContent = `${stats.netRunway.toFixed(2)}h`;

  // Progress Bar (Normalized against 50 pts/hr as 100% cap)
  const barPercent = Math.min(100, Math.round((stats.yieldRate / 50) * 100));
  const barEl = document.getElementById("dbYieldBar");
  if (barEl) {
    barEl.style.width = `${barPercent}%`;
    barEl.style.backgroundColor = stats.rankColor;
  }

  modal.classList.add("open");
}

function closeDebriefModal() {
  const modal = document.getElementById("debriefModal");
  if (modal) modal.classList.remove("open");
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
    // Post comment to Trello to document roadblock
    try {
      const commentText = `🛑 ROADBLOCK DEFERRED: ${reason}`;
      await trelloFetch(`/cards/${cardId}/actions/comments`, "POST", `&text=${encodeURIComponent(commentText)}`);
    } catch (e) {
      console.error("Could not post roadblock comment:", e);
    }
    recordCardDeferred(card, true, reason);
  } else {
    // Undocumented deferral incurs 15 pt friction tax
    recordCardDeferred(card, false, "Undocumented");
  }

  // Move card to waiting list
  await moveCard(cardId, boardKey, 'waiting');
}

function getWeeklyRollingStats() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 is Sunday
  // Calculate start of current week (Monday)
  const monday = new Date(now);
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  monday.setDate(diff);

  let totalScore = 0;
  let totalNetRunway = 0;
  let daysActive = 0;
  let totalRed = 0, totalYellow = 0, totalGreen = 0;
  let totalExempt = 0, totalPenalized = 0;

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = cur.toISOString().split("T")[0];
    const raw = localStorage.getItem(SCORE_STORAGE_KEY_PREFIX + dateStr);
    if (raw) {
      try {
        const l = JSON.parse(raw);
        const dayScore = ((l.completed.red || 0) * 100) + ((l.completed.yellow || 0) * 50) + ((l.completed.green || 0) * 25) - ((l.deferralsPenalized || 0) * 15);
        if (dayScore > 0 || (l.completedCardIds && l.completedCardIds.length > 0)) {
          daysActive++;
          totalScore += Math.max(0, dayScore);
          totalRed += (l.completed.red || 0);
          totalYellow += (l.completed.yellow || 0);
          totalGreen += (l.completed.green || 0);
          totalExempt += (l.deferralsExempt || 0);
          totalPenalized += (l.deferralsPenalized || 0);
          totalNetRunway += 6.0; // average nominal focus window
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

  return {
    totalScore,
    daysActive,
    totalRed,
    totalYellow,
    totalGreen,
    totalExempt,
    totalPenalized,
    avgYield,
    grade
  };
}

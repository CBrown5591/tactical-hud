// --- In js/score.js: add customBoards to activeCloudLedger ---
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
  customBoards: [], // Dynamic boards stored directly on Trello
  energyKeywords: {
    red: "architect, architecture, migration, migrate, deploy, deployment, outage, incident, sev-1, disaster, scada, infra, provision, rebuild, failover, security review",
    yellow: "configure, configuration, update, review, troubleshoot, investigate, test, testing, script, documentation, doc, prep, refactor, sync, analyze, analysis",
    green: "reply, email, ping, check, log, approve, approval, quick, clean, archive, submit, order, call, receipt, schedule, invoice"
  },
  history: {}
};

// --- DYNAMIC BOARD SOURCE HELPERS ---
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
  
  // Extract ID if full URL pasted (e.g. https://trello.com/b/xyz123/name)
  let cleanId = rawIdOrUrl.trim();
  const urlMatch = cleanId.match(/trello\.com\/b\/([a-zA-Z0-9]+)/);
  if (urlMatch) cleanId = urlMatch[1];

  const key = `cb_${Date.now()}`;
  if (!activeCloudLedger.customBoards) activeCloudLedger.customBoards = [];

  const newBoard = {
    key,
    name: name.trim(),
    id: cleanId,
    context,
    icon: icon.trim() || "🚀"
  };

  activeCloudLedger.customBoards.push(newBoard);
  await commitScoreLedgerToTrello(activeCloudLedger.today);
  return newBoard;
}

async function removeCustomBoard(boardKey) {
  if (!activeCloudLedger.customBoards) return;
  activeCloudLedger.customBoards = activeCloudLedger.customBoards.filter(b => b.key !== boardKey);
  await commitScoreLedgerToTrello(activeCloudLedger.today);
}

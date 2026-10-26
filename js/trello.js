// --- js/trello.js: Trello API Wrapper & Communications ---

async function trelloFetch(path, method = "GET", queryParams = "") {
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey || !cfg.token) throw new Error("Missing credentials in ⚙️ Settings");
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.trello.com/1${path}${sep}key=${cfg.apiKey}&token=${cfg.token}${queryParams}`;
  const res = await fetch(url, { method });
  if (!res.ok) {
    let errBody = "";
    try { errBody = await res.text(); } catch (e) {}
    throw new Error(`HTTP ${res.status} on${path}${errBody ? ` (${errBody.trim()})` : ""}`); } return res.json(); }  async function fetchBoardData(boardKey, boardId) { const [lists, cards, labels] = await Promise.all([ trelloFetch(`/boards/${boardId}/lists`, "GET", "&fields=name,id"),
    trelloFetch(`/boards/${boardId}/cards`, "GET", "&fields=name,id,idList,labels,desc,due,pos,shortUrl,shortLink&actions=commentCard&actions_limit=5&pluginData=true&attachments=true"), trelloFetch(`/boards/${boardId}/labels`, "GET", "&fields=name,id,color")
  ]);
  const listMap = {};
  lists.forEach(l => {
    const name = (l.name || "").toLowerCase().trim();
    if (name.includes("inbox") || name.includes("triage") || name.includes("incoming") || name.includes("capture")) listMap.inbox = l.id;
    else if (name.includes("today") || name.includes("doing") || name.includes("active") || name.includes("in progress")) listMap.today = l.id;
    else if (name.includes("waiting") || name.includes("blocked") || name.includes("pending") || name.includes("hold")) listMap.waiting = l.id;
    else if (name.includes("queue") || name.includes("backlog") || name.includes("next")) listMap.queue = l.id;
    else if (name.includes("done") || name.includes("complete") || name.includes("archive")) listMap.done = l.id;
  });

  if (!listMap.inbox && lists.length > 0) listMap.inbox = lists[0].id;
  if (!listMap.today && lists.length > 1) listMap.today = lists[1].id;

  const labelMap = {};
  const recurLabelMap = {};
  labels.forEach(lb => {
    if (lb.color) labelMap[lb.color] = lb.id;
    const name = (lb.name || "").toLowerCase().trim();
    if (name.includes("twice daily") || name.includes("2x daily") || name.includes("twicedaily")) recurLabelMap.twicedaily = lb.id;
    else if (name.includes("daily")) recurLabelMap.daily = lb.id;
    else if (name.includes("bi-weekly") || name.includes("biweekly")) recurLabelMap.biweekly = lb.id;
    else if (name.includes("weekly")) recurLabelMap.weekly = lb.id;
    else if (name.includes("monthly")) recurLabelMap.monthly = lb.id;
  });
  state.boardCache[boardKey] = { boardId, listMap, labelMap, recurLabelMap, rawLabels: labels };
  return { boardKey, listMap, cards };
}

async function updateSaveState() {
  if (!state.saveStateCardId) return alert("Save State card not found on board.");
  const desc = document.getElementById("saveStateInput").value;
  const statusEl = document.getElementById("saveStateStatus");
  statusEl.textContent = "Saving...";
  await trelloFetch(`/cards/${state.saveStateCardId}`, "PUT", `&desc=${encodeURIComponent(desc)}`);
  statusEl.textContent = "Saved ✓";
}

async function moveCard(cardId, boardKey, targetListKey) {
  const cache = state.boardCache[boardKey];
  if (!cache || !cache.listMap[targetListKey]) return;
  await trelloFetch(`/cards/${cardId}`, "PUT", `&idList=${cache.listMap[targetListKey]}`);
  syncHud();
}

async function setCardEnergy(cardId, boardKey, energyColor) {
  const cache = state.boardCache[boardKey];
  if (!cache || !cache.labelMap || !cache.labelMap[energyColor]) return alert(`Could not find ${energyColor} energy label.`);
  const targetLabelId = cache.labelMap[energyColor];
  const card = state.allLoadedCards.find(c => c.id === cardId);
  const existingLabels = (card && card.labels) ? card.labels : [];
  
  const energyColors = ["red", "yellow", "green"];
  const otherLabelIds = existingLabels.filter(l => !energyColors.includes(l.color)).map(l => l.id);
  const newLabelIds = [...otherLabelIds, targetLabelId].join(",");

  try {
    await trelloFetch(`/cards/${cardId}`, "PUT", `&idLabels=${newLabelIds}`);
    if (card) {
      card.energy = energyColor;
      card.labels = [...existingLabels.filter(l => !energyColors.includes(l.color)), { id: targetLabelId, color: energyColor }];
    }
    syncHud();
  } catch (e) {
    console.error(e);
    alert("Failed to assign energy label to card.");
  }
}

async function saveCardNote() {
  if (!state.activeNoteCard) return;
  const { id } = state.activeNoteCard;
  const noteText = document.getElementById("cardNoteInput").value.trim();
  if (!noteText) return closeNoteModal();
  const saveBtn = document.getElementById("saveNoteBtn");
  saveBtn.textContent = "Posting...";
  try {
    const res = await trelloFetch(`/cards/${id}/actions/comments`, "POST", `&text=${encodeURIComponent(noteText)}`);
    const newComment = { id: res.id || Date.now().toString(), text: noteText, date: res.date || new Date().toISOString() };
    const target = state.allLoadedCards.find(c => c.id === id);
    if (target) {
      target.comments = [newComment, ...(target.comments || [])];
      target.notes = noteText;
    }
    closeNoteModal();
    renderCards();
  } catch (e) {
    console.error(e);
    alert("Failed to post comment to Trello: " + (e.message || "API error"));
  } finally {
    saveBtn.textContent = "+ Post Comment";
  }
}

// --- 1. AT-WILL WORK & GROWTH OPERATIONAL BRIEFING ---
async function openReportModal() {
  const cfg = loadConfig();
  const targetBoards = [
    { key: "work", name: "💼 Work", id: (cfg && cfg.boards && cfg.boards.work) },
    { key: "growth", name: "🎓 Growth", id: (cfg && cfg.boards && cfg.boards.growth) }
  ].filter(b => b.id);

  if (targetBoards.length === 0) return alert("Neither Work nor Growth board ID is configured.");

  const modal = document.getElementById("reportModal");
  const contentBox = document.getElementById("reportContent");
  contentBox.value = "Fetching active operational status and compiling briefing...";
  modal.classList.add("open");

  try {
    const boardResults = await Promise.all(targetBoards.map(async b => {
      const [lists, cards] = await Promise.all([
        trelloFetch(`/boards/${b.id}/lists`, "GET", "&fields=name,id"), trelloFetch(`/boards/${b.id}/cards`, "GET", "&fields=name,id,idList,desc,dateLastActivity,labels&actions=commentCard&actions_limit=3")
      ]);
      const doneListIds = lists.filter(l => l.name.toLowerCase().includes("done")).map(l => l.id);
      const waitingListIds = lists.filter(l => l.name.toLowerCase().includes("waiting")).map(l => l.id);
      const doneCards = cards.filter(c => doneListIds.includes(c.idList) && !c.name.startsWith("🎯"));
      const waitingCards = cards.filter(c => waitingListIds.includes(c.idList) && !c.name.startsWith("🎯"));
      return { boardName: b.name, doneCards, waitingCards };
    }));

    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const totalDone = boardResults.reduce((acc, b) => acc + b.doneCards.length, 0);
    const totalWaiting = boardResults.reduce((acc, b) => acc + b.waitingCards.length, 0);

    let report = `=========================================\n`;
    report += `💼 WORK & GROWTH OPERATIONAL BRIEFING\n`;
    report += `Generated: ${todayStr}\n`;
    report += `=========================================\n\n`;

    report += `✅ COMPLETED TASKS (${totalDone})\n`; report += `-----------------------------------------\n`; if (totalDone === 0) { report += `(No tasks currently marked Done)\n\n`; } else { boardResults.forEach(b => { if (b.doneCards.length > 0) { report += `[${b.boardName}]\n`;
          b.doneCards.forEach(c => {
            report += `• ${c.name}\n`; const latestComment = (c.actions && c.actions[0] && c.actions[0].data && c.actions[0].data.text) ? c.actions[0].data.text : (c.desc && c.desc.trim() ? c.desc.trim() : ""); if (latestComment) report += `  Notes: ${latestComment.replace(/\n/g, "\n  ")}\n`;
          });
          report += `\n`;
        }
      });
    }

    report += `⏳ WAITING / BLOCKED TASKS (${totalWaiting})\n`; report += `-----------------------------------------\n`; if (totalWaiting === 0) { report += `(No tasks currently in Waiting)\n\n`; } else { boardResults.forEach(b => { if (b.waitingCards.length > 0) { report += `[${b.boardName}]\n`;
          b.waitingCards.forEach(c => {
            report += `• ${c.name}\n`; const latestComment = (c.actions && c.actions[0] && c.actions[0].data && c.actions[0].data.text) ? c.actions[0].data.text : (c.desc && c.desc.trim() ? c.desc.trim() : ""); if (latestComment) report += `  Notes: ${latestComment.replace(/\n/g, "\n  ")}\n`;
          });
          report += `\n`;
        }
      });
    }

    report += `=========================================\nGenerated via Tactical Focus HUD\n`;
    contentBox.value = report;
  } catch (e) {
    console.error(e);
    contentBox.value = "Error generating briefing: " + (e.message || "Failed to communicate with Trello API.");
  }
}

function closeReportModal() { document.getElementById("reportModal").classList.remove("open"); }

function copyReportText() {
  navigator.clipboard.writeText(document.getElementById("reportContent").value)
    .then(() => alert("Operational briefing copied to clipboard!"))
    .catch(() => alert("Select and copy text manually."));
}

function emailReport() {
  const report = document.getElementById("reportContent").value;
  const recipient = (window.HUD_CONFIG && window.HUD_CONFIG.reportEmail) || "charlesabrown0505@gmail.com";
  const dateStr = new Date().toISOString().split("T")[0];
  window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(`Work & Growth Briefing - ${dateStr}`)}&body=${encodeURIComponent(report)}`;
}

// --- 2. END-OF-WEEK EXECUTIVE SCORECARD & EMERALD BRIEFING ---
function openWeeklyReportModal() {
  const weekStats = typeof getWeeklyRollingStats === "function" ? getWeeklyRollingStats() : null;
  const modal = document.getElementById("weeklyReportModal");
  const contentBox = document.getElementById("weeklyReportContent");
  if (!modal || !contentBox) return;

  const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  let report = `=========================================\n`;
  report += `🏆 END-OF-WEEK TACTICAL EXECUTIVE SCORECARD\n`;
  report += `Week Ending: ${todayStr}\n`;
  report += `=========================================\n\n`;

  if (weekStats) {
    const emeraldSymbols = (weekStats.emeralds || []).map(e => e.unlocked ? e.icon : "⚪").join(" ");
    report += `⭐ WEEKLY PERFORMANCE GRADE: ${weekStats.grade}\n`;
    report += `Chaos Emeralds Collected: [ ${emeraldSymbols} ] (${weekStats.collectedCount || 0}/7)\n`;
    if (weekStats.isSuperState) {
      report += `STATUS: ⭐ SUPER STATE OPERATIONAL UNLOCKED ⭐\n`;
    }
    report += `-----------------------------------------\n`;
    report += `Active Operational Days:  ${weekStats.daysActive} day(s)\n`;
    report += `Total Weekly Productivity: ${weekStats.totalScore} PTS\n`;
    report += `Average Yield Rate:        ${weekStats.avgYield} PTS / FOCUS HR\n\n`;

    report += `TASK BREAKDOWN ACROSS WEEK:\n`;
    report += `🔴 High Voltage (Heavy):   ${weekStats.totalRed}\n`;
    report += `🟡 Medium Cruise (Med):    ${weekStats.totalYellow}\n`;
    report += `🟢 Low Battery (Light):    ${weekStats.totalGreen}\n`;
    report += `⚡ Chaos Controls Used:    ${weekStats.totalChaosControl}\n`;
    report += `🛡️ Roadblock Exemptions:   ${weekStats.totalExempt} documented (0 pt tax)\n`;
    report += `⚠️ Undocumented Deferrals: ${weekStats.totalPenalized}\n`;
    report += `Distinct Boards Advanced:  ${weekStats.distinctBoardsCount}\n\n`;

    report += `CHAOS EMERALD AUDIT:\n`;
    (weekStats.emeralds || []).forEach(e => {
      report += `${e.icon}${e.name} (${e.domain}):${e.unlocked ? 'CLAIMED ✓' : 'LOCKED — ' + e.criteria}\n`;
    });
  }

  report += `\n=========================================\nTactical Focus HUD • Executive Telemetry\n`;
  contentBox.value = report;

  const emeraldContainer = document.getElementById("weeklyEmeraldDisplay");
  if (emeraldContainer && weekStats) {
    renderEmeraldStrip("weeklyEmeraldDisplay", weekStats);
  }

  modal.classList.add("open");
}

function closeWeeklyReportModal() {
  const modal = document.getElementById("weeklyReportModal");
  if (modal) modal.classList.remove("open");
}

function copyWeeklyReportText() {
  navigator.clipboard.writeText(document.getElementById("weeklyReportContent").value)
    .then(() => alert("Weekly Executive Scorecard copied to clipboard!"))
    .catch(() => alert("Select and copy text manually."));
}

function emailWeeklyReport() {
  const report = document.getElementById("weeklyReportContent").value;
  const recipient = (window.HUD_CONFIG && window.HUD_CONFIG.reportEmail) || "charlesabrown0505@gmail.com";
  const dateStr = new Date().toISOString().split("T")[0];
  window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(`Weekly Tactical Executive Scorecard - ${dateStr}`)}&body=${encodeURIComponent(report)}`;
}

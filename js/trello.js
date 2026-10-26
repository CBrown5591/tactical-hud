// --- js/trello.js: Trello API Wrapper & Communications ---

async function trelloFetch(path, method = "GET", queryParams = "") {
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey || !cfg.token) throw new Error("Missing credentials");
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.trello.com/1${path}${sep}key=${cfg.apiKey}&token=${cfg.token}${queryParams}`;
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

async function fetchBoardData(boardKey, boardId) {
  const [lists, cards, labels] = await Promise.all([
    trelloFetch(`/boards/${boardId}/lists`, "GET", "&fields=name,id"),
    trelloFetch(`/boards/${boardId}/cards`, "GET", "&fields=name,id,idList,labels,desc,due,pos,shortUrl,shortLink&actions=commentCard&actions_limit=5&pluginData=true&attachments=true"),
    trelloFetch(`/boards/${boardId}/labels`, "GET", "&fields=name,id,color")
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

async function runRelationsDiagnostic() {
  const cfg = loadConfig();
  const out = document.getElementById("diagOutputBox");
  out.style.display = "block";
  out.value = "Scanning boards for cards with Card Relations pluginData...\n";

  if (!cfg || !cfg.apiKey || !cfg.token || !cfg.boards) {
    out.value += "ERROR: Missing API credentials or boards in config.\n";
    return;
  }

  const boardEntries = Object.entries(cfg.boards).filter(([k, id]) => id && !id.startsWith("YOUR_"));
  if (boardEntries.length === 0) {
    out.value += "ERROR: No valid board IDs found in config.\n";
    return;
  }

  let foundAnyPlugin = false;

  for (const [key, boardId] of boardEntries) {
    out.value += `\n[Board: ${key}] Checking /boards/${boardId}/cards?pluginData=true...\n`;
    try {
      const cards = await trelloFetch(`/boards/${boardId}/cards`, "GET", "&fields=name,id,shortLink&pluginData=true");
      const cardsWithData = cards.filter(c => c.pluginData && c.pluginData.length > 0);

      if (cardsWithData.length === 0) {
        out.value += `-> No cards on board '${key}' currently have pluginData.\n`;
        continue;
      }

      foundAnyPlugin = true;
      out.value += `-> Found ${cardsWithData.length} card(s) with pluginData!\n`;

      for (const c of cardsWithData) {
        out.value += `\n-----------------------------------------\n`;
        out.value += `CARD: "${c.name}" (ID: ${c.id})\n`;
        
        for (const p of c.pluginData) {
          out.value += `  idPlugin: ${p.idPlugin}\n`;
          out.value += `  scope: ${p.scope}\n`;
          out.value += `  Raw Value: ${p.value}\n`;

          try {
            const parsed = JSON.parse(p.value);
            out.value += `  Parsed Schema: ${JSON.stringify(parsed, null, 2).replace(/\n/g, "\n  ")}\n`;
          } catch (e) {
            out.value += `  (Value is not raw JSON)\n`;
          }

          out.value += `\n  [Write Probe] Testing PUT /cards/${c.id}/pluginData/${p.idPlugin}...\n`;
          try {
            const testUrl = `https://api.trello.com/1/cards/${c.id}/pluginData/${p.idPlugin}?key=${cfg.apiKey}&token=${cfg.token}`;
            const res = await fetch(testUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value: p.value })
            });

            if (res.ok) {
              out.value += `  -> WRITE PROBE RESULT: SUCCESS (HTTP ${res.status})! Direct API writing to this Power-Up is PERMITTED!\n`;
            } else {
              const errText = await res.text();
              out.value += `  -> WRITE PROBE RESULT: RESTRICTED (HTTP ${res.status}): ${errText}\n`;
              out.value += `     (Trello blocks public API writing to third-party plugin scopes).\n`;
            }
          } catch (err) {
            out.value += `  -> WRITE PROBE ERROR: ${err.message}\n`;
          }
        }
      }
    } catch (err) {
      out.value += `-> Failed to fetch board '${key}': ${err.message}\n`;
    }
  }

  if (!foundAnyPlugin) {
    out.value += `\nSUMMARY:\nNo cards with Card Relations pluginData detected across scanned boards.\n`;
    out.value += `Tip: Open Trello, add a dependency relation to at least one card on your board using Card Relations, then tap this button again.\n`;
  } else {
    out.value += `\n-----------------------------------------\n`;
    out.value += `DIAGNOSTIC COMPLETE.\n`;
  }
}

async function openReportModal() {
  const cfg = loadConfig();
  const targetBoards = [
    { key: "work", name: "💼 Work", id: (cfg && cfg.boards && cfg.boards.work) },
    { key: "growth", name: "🎓 Growth", id: (cfg && cfg.boards && cfg.boards.growth) }
  ].filter(b => b.id);

  if (targetBoards.length === 0) return alert("Neither Work nor Growth board ID is configured.");

  const modal = document.getElementById("reportModal");
  const contentBox = document.getElementById("reportContent");
  contentBox.value = "Fetching Work & Growth board data and compiling report...";
  modal.classList.add("open");

  try {
    const boardResults = await Promise.all(targetBoards.map(async b => {
      const [lists, cards] = await Promise.all([
        trelloFetch(`/boards/${b.id}/lists`, "GET", "&fields=name,id"),
        trelloFetch(`/boards/${b.id}/cards`, "GET", "&fields=name,id,idList,desc,dateLastActivity,labels&actions=commentCard&actions_limit=3")
      ]);
      const doneListIds = lists.filter(l => l.name.toLowerCase().includes("done")).map(l => l.id);
      const waitingListIds = lists.filter(l => l.name.toLowerCase().includes("waiting")).map(l => l.id);
      const doneCards = cards.filter(c => doneListIds.includes(c.idList) && !c.name.startsWith("🎯"));
      const waitingCards = cards.filter(c => waitingListIds.includes(c.idList) && !c.name.startsWith("🎯"));
      return { boardName: b.name, doneCards, waitingCards };
    }));

    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    const totalDone = boardResults.reduce((acc, b) => acc + b.doneCards.length, 0);
    const totalWaiting = boardResults.reduce((acc, b) => acc + b.waitingCards.length, 0);

    const weekStats = typeof getWeeklyRollingStats === "function" ? getWeeklyRollingStats() : null;
    let report = `=========================================\n`;
    report += `💼 WORK & GROWTH STATUS REPORT\n`;
    report += `Date: ${todayStr}\n`;
    report += `=========================================\n\n`;

    if (weekStats && weekStats.daysActive > 0) {
      report += `🏆 TACTICAL EXECUTION SCORECARD\n`;
      report += `-----------------------------------------\n`;
      report += `Weekly Performance:   ${weekStats.grade}\n`;
      report += `Total Productivity:   ${weekStats.totalScore} PTS\n`;
      report += `Average Yield Rate:   ${weekStats.avgYield} PTS / FOCUS HR\n`;
      report += `Completed Breakdown:  ${weekStats.totalRed} Heavy | ${weekStats.totalYellow} Med | ${weekStats.totalGreen} Light\n`;
      report += `Roadblocks Logged:    ${weekStats.totalExempt} Exempt | ${weekStats.totalPenalized} Penalized\n\n`;
    }

    report += `✅ COMPLETED TASKS (${totalDone})\n`;
    report += `-----------------------------------------\n`;
    if (totalDone === 0) {
      report += `(No cards currently in Done)\n\n`;
    } else {
      boardResults.forEach(b => {
        if (b.doneCards.length > 0) {
          report += `[${b.boardName}]\n`;
          b.doneCards.forEach(c => {
            report += `• ${c.name}\n`;
            const latestComment = (c.actions && c.actions[0] && c.actions[0].data && c.actions[0].data.text)
              ? c.actions[0].data.text
              : (c.desc && c.desc.trim() ? c.desc.trim() : "");
            if (latestComment) report += `  Notes: ${latestComment.replace(/\n/g, "\n  ")}\n`;
          });
          report += `\n`;
        }
      });
    }

    report += `⏳ WAITING / BLOCKED TASKS (${totalWaiting})\n`;
    report += `-----------------------------------------\n`;
    if (totalWaiting === 0) {
      report += `(No cards currently in Waiting)\n\n`;
    } else {
      boardResults.forEach(b => {
        if (b.waitingCards.length > 0) {
          report += `[${b.boardName}]\n`;
          b.waitingCards.forEach(c => {
            report += `• ${c.name}\n`;
            const latestComment = (c.actions && c.actions[0] && c.actions[0].data && c.actions[0].data.text)
              ? c.actions[0].data.text
              : (c.desc && c.desc.trim() ? c.desc.trim() : "");
            if (latestComment) report += `  Notes: ${latestComment.replace(/\n/g, "\n  ")}\n`;
          });
          report += `\n`;
        }
      });
    }

    report += `=========================================\nGenerated via Tactical Focus HUD\n`;
    contentBox.value = report;
  } catch (e) {
    console.error(e);
    contentBox.value = "Error generating report: " + (e.message || "Failed to communicate with Trello API.");
  }
}

function closeReportModal() { document.getElementById("reportModal").classList.remove("open"); }

function copyReportText() {
  navigator.clipboard.writeText(document.getElementById("reportContent").value)
    .then(() => alert("Briefing copied to clipboard!"))
    .catch(() => alert("Select and copy text manually."));
}

function emailReport() {
  const report = document.getElementById("reportContent").value;
  const recipient = (window.HUD_CONFIG && window.HUD_CONFIG.reportEmail) || "charlesabrown0505@gmail.com";
  const dateStr = new Date().toISOString().split("T")[0];
  window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(`Work & Growth Status Report - ${dateStr}`)}&body=${encodeURIComponent(report)}`;
}

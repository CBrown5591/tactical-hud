// --- js/trello.js: Trello API Client & Card Lifecycle Operations ---

async function trelloFetch(path, method = "GET", queryParams = "", bodyPayload = null) {
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey || !cfg.token) {
    throw new Error("Trello credentials missing. Please configure them in Settings.");
  }
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.trello.com/1${path}${sep}key=${cfg.apiKey}&token=${cfg.token}${queryParams}`;

  const options = { method };
  if (bodyPayload) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(bodyPayload);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Trello API Error (${res.status}): ${txt}`);
  }
  return res.json();
}

async function fetchBoardData(boardKey, boardId) {
  const lists = await trelloFetch(`/boards/${boardId}/lists`, "GET", "&fields=name,id");
  const labels = await trelloFetch(`/boards/${boardId}/labels`, "GET", "&fields=name,color,id");
  const cards = await trelloFetch(`/boards/${boardId}/cards`, "GET", "&fields=name,id,idList,labels,desc,due,pos,shortUrl,shortLink&actions=commentCard&actions_limit=5&pluginData=true&attachments=true");

  const listMap = {};
  lists.forEach(l => {
    const name = (l.name || "").toLowerCase().trim();
    if (name.includes("inbox") || name.includes("triage") || name.includes("incoming") || name.includes("capture")) listMap.inbox = l.id;
    else if (name.includes("today") || name.includes("doing") || name.includes("active") || name.includes("in progress")) listMap.today = l.id;
    else if (name.includes("waiting") || name.includes("blocked") || name.includes("pending") || name.includes("hold")) listMap.waiting = l.id;
    else if (name.includes("queue") || name.includes("backlog") || name.includes("next")) listMap.queue = l.id;
    else if (name.includes("done") || name.includes("complete") || name.includes("archive")) listMap.done = l.id;
    else if (name.includes("tbd") || name.includes("parking") || name.includes("agenda") || name.includes("discuss")) listMap.tbd = l.id;
  });

  if (!listMap.inbox && lists.length > 0) listMap.inbox = lists[0].id;
  if (!listMap.today && lists.length > 1) listMap.today = lists[1].id;
  if (!listMap.queue && lists.length > 2) listMap.queue = lists[2].id;
  if (!listMap.done && lists.length > 3) listMap.done = lists[3].id;
  if (!listMap.waiting && lists.length > 4) listMap.waiting = lists[4].id;

  const labelMap = {};
  labels.forEach(lb => {
    if (lb.color === "red" && !labelMap.red) labelMap.red = lb.id;
    if (lb.color === "yellow" && !labelMap.yellow) labelMap.yellow = lb.id;
    if (lb.color === "green" && !labelMap.green) labelMap.green = lb.id;
  });

  const recurKeywords = {
    twicedaily: ["twice daily", "2x daily", "twicedaily"],
    daily: ["daily"],
    weekly: ["weekly"],
    biweekly: ["bi-weekly", "biweekly"],
    monthly: ["monthly"]
  };
  const recurLabelMap = {};
  labels.forEach(lb => {
    const name = (lb.name || "").toLowerCase();
    Object.keys(recurKeywords).forEach(cadence => {
      if (!recurLabelMap[cadence]) {
        if (recurKeywords[cadence].some(kw => name.includes(kw))) {
          recurLabelMap[cadence] = lb.id;
        }
      }
    });
  });

  state.boardCache[boardKey] = {
    boardId,
    listMap,
    labelMap,
    recurLabelMap,
    rawLabels: labels
  };

  return { boardKey, listMap, labelMap, recurLabelMap, cards };
}

async function moveCard(cardId, boardKey, targetListKey) {
  const cache = state.boardCache[boardKey];
  if (!cache || !cache.listMap[targetListKey]) return;
  await trelloFetch(`/cards/${cardId}`, "PUT", `&idList=${cache.listMap[targetListKey]}`);
  syncHud();
}

async function setCardEnergy(cardId, boardKey, color) {
  const cache = state.boardCache[boardKey];
  if (!cache) return;
  const targetLabelId = cache.labelMap[color];
  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (!card) return;

  const currentEnergyLabelIds = [cache.labelMap.red, cache.labelMap.yellow, cache.labelMap.green].filter(Boolean);
  const preservedLabelIds = (card.labels || [])
    .filter(l => !currentEnergyLabelIds.includes(l.id))
    .map(l => l.id);

  if (targetLabelId) preservedLabelIds.push(targetLabelId);

  await trelloFetch(`/cards/${cardId}`, "PUT", `&idLabels=${preservedLabelIds.join(",")}`);
  syncHud();
}

async function updateSaveState() {
  if (!state.saveStateCardId) return alert("Save State card not found on active board.");
  const desc = document.getElementById("saveStateInput").value;
  const statusEl = document.getElementById("saveStateStatus");
  statusEl.textContent = "Saving...";
  await trelloFetch(`/cards/${state.saveStateCardId}`, "PUT", "", { desc });
  statusEl.textContent = "Saved ✓";
}

async function saveCardNote() {
  if (!state.activeNoteCard) return;
  const { id } = state.activeNoteCard;
  const noteInput = document.getElementById("cardNoteInput");
  const text = noteInput.value.trim();
  if (!text) return;

  const saveBtn = document.getElementById("saveNoteBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Posting...";

  try {
    await trelloFetch(`/cards/${id}/actions/comments`, "POST", `&text=${encodeURIComponent(text)}`);
    noteInput.value = "";
    await syncHud();
    const updatedCard = state.allLoadedCards.find(c => c.id === id);
    if (updatedCard) {
      renderModalComments(updatedCard.comments || []);
    }
  } catch (err) {
    console.error("Failed to post note comment:", err);
    alert("Could not post comment: " + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "+ Post Comment";
  }
}

function promptWarpSwap(sourceCardId, boardKey) {
  const card = state.allLoadedCards.find(c => c.id === sourceCardId);
  if (!card) return;

  const energy = card.energy;
  if (!energy || energy === "none") {
    alert("Task must have an energy tier (🔴, 🟡, 🟢) to execute a 1:1 Warp Swap.");
    return;
  }

  const eligibleQueue = state.allLoadedCards.filter(c => {
    const cache = state.boardCache[c.boardKey];
    const isQueue = cache && cache.listMap && c.idList === cache.listMap.queue;
    return isQueue && c.energy === energy && c.id !== sourceCardId;
  });

  const modal = document.getElementById("warpModal");
  const select = document.getElementById("warpTargetSelect");
  const nameSpan = document.getElementById("warpSourceName");
  const allowanceEl = document.getElementById("warpAllowanceStatus");

  nameSpan.textContent = `[${card.boardName}] ${card.name} (${energy.toUpperCase()})`;
  select.innerHTML = "";

  if (eligibleQueue.length === 0) {
    select.innerHTML = `<option value="">No matching ${energy.toUpperCase()} tasks in Queue</option>`;
    document.getElementById("confirmWarpBtn").disabled = true;
  } else {
    document.getElementById("confirmWarpBtn").disabled = false;
    eligibleQueue.forEach(qCard => {
      const opt = document.createElement("option");
      opt.value = qCard.id;
      opt.dataset.boardKey = qCard.boardKey;
      opt.textContent = `[${qCard.boardName}] ${qCard.name}`;
      select.appendChild(opt);
    });
  }

  const ledger = typeof loadDailyScoreLedger === "function" ? loadDailyScoreLedger() : {};
  const freeUsed = !!ledger.dailyFreeWarpUsed;
  const warpTokens = (activeCloudLedger && activeCloudLedger.inventory && activeCloudLedger.inventory.warpTokens) || 0;

  if (!freeUsed) {
    allowanceEl.textContent = "⚡ Daily Free Warp available (Cost: 0 Tokens / 0 Ring Tax)";
    allowanceEl.style.color = "#38bdf8";
  } else if (warpTokens > 0) {
    allowanceEl.textContent = `🪙 Using Warp Token from Vault (Tokens Remaining: ${warpTokens})`;
    allowanceEl.style.color = "#22c55e";
  } else {
    allowanceEl.textContent = "⚠️ Free warp exhausted. Using Chaos Bypass (-15 Rings from Bank)";
    allowanceEl.style.color = "#f59e0b";
  }

  modal.dataset.sourceCardId = sourceCardId;
  modal.dataset.sourceBoardKey = boardKey;
  modal.classList.add("open");
}

function closeWarpModal() {
  const modal = document.getElementById("warpModal");
  if (modal) modal.classList.remove("open");
}

async function confirmWarpSwap() {
  const modal = document.getElementById("warpModal");
  const sourceCardId = modal.dataset.sourceCardId;
  const sourceBoardKey = modal.dataset.sourceBoardKey;
  const select = document.getElementById("warpTargetSelect");
  const targetCardId = select.value;
  if (!targetCardId) return;

  const targetOption = select.options[select.selectedIndex];
  const targetBoardKey = targetOption.dataset.boardKey;

  closeWarpModal();

  const ledger = typeof loadDailyScoreLedger === "function" ? loadDailyScoreLedger() : {};
  const freeUsed = !!ledger.dailyFreeWarpUsed;

  if (!freeUsed) {
    ledger.dailyFreeWarpUsed = true;
    if (typeof commitScoreLedgerToTrello === "function") {
      await commitScoreLedgerToTrello(ledger);
    }
  } else {
    if (activeCloudLedger && activeCloudLedger.inventory && activeCloudLedger.inventory.warpTokens > 0) {
      activeCloudLedger.inventory.warpTokens--;
      if (typeof commitScoreLedgerToTrello === "function") {
        await commitScoreLedgerToTrello(activeCloudLedger.today);
      }
    } else {
      activeCloudLedger.ringBank = Math.max(0, (activeCloudLedger.ringBank || 0) - 15);
      if (typeof commitScoreLedgerToTrello === "function") {
        await commitScoreLedgerToTrello(activeCloudLedger.today);
      }
    }
  }

  await moveCard(sourceCardId, sourceBoardKey, "queue");
  await moveCard(targetCardId, targetBoardKey, "today");
}

function initiateCardCompletion(cardId, boardKey) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (!card) return;

  if (card.due) {
    const dueDate = new Date(card.due);
    const now = new Date();
    const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diffHours < -2) {
      const modal = document.getElementById("retroactiveModal");
      document.getElementById("retroactiveCardTitle").textContent = card.name;
      modal.dataset.cardId = cardId;
      modal.dataset.boardKey = boardKey;
      modal.classList.add("open");
      return;
    }
  }

  executeCardDone(cardId, boardKey, false);
}

function closeRetroactiveModal() {
  const modal = document.getElementById("retroactiveModal");
  if (modal) modal.classList.remove("open");
}

async function confirmCompleteCard(isRetroactiveOnTime) {
  const modal = document.getElementById("retroactiveModal");
  const cardId = modal.dataset.cardId;
  const boardKey = modal.dataset.boardKey;
  closeRetroactiveModal();
  await executeCardDone(cardId, boardKey, isRetroactiveOnTime);
}

async function executeCardDone(cardId, boardKey, isRetroactiveOnTime = false) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (card && typeof recordCardCompleted === "function") {
    await recordCardCompleted(card, isRetroactiveOnTime);
  }
  await moveCard(cardId, boardKey, "done");
}

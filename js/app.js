// --- js/app.js: Application Core, State, Routing & UI Renderers ---

const STORAGE_KEY = "TACTICAL_HUD_CFG_V2";
const BOARD_LABELS = {
  work: "💼 Work",
  life: "🎢 King's Dominion",
  vi: "🏝️ By The VI",
  lab: "⚡ Hiiii-Power",
  growth: "🎓 Growth"
};

let state = {
  context: "work",
  manualOverride: false,
  energyFilter: "all",
  captureBoard: "work",
  captureEnergy: "none",
  captureDue: "",
  captureRecur: "none",
  saveStateCardId: null,
  activeNoteCard: null,
  boardCache: {},
  todayCards: [],
  inboxCards: [],
  allLoadedCards: []
};

function determineAutoContext(cfg) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("context") === "work" || params.get("context") === "personal") {
    state.manualOverride = true;
    return params.get("context");
  }
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours() + (now.getMinutes() / 60);
  return (day >= 1 && day <= 5 && hour >= 8.5 && hour < 17.0) ? "work" : "personal";
}

function applyTheme() {
  const isWork = state.context === "work";
  document.documentElement.style.setProperty("--accent", isWork ? "#38bdf8" : "#a855f7");
  const modeTitleEl = document.getElementById("modeTitle");
  if (modeTitleEl) modeTitleEl.textContent = isWork ? "💼 WORK HUD" : "🏠 PERSONAL MULTI-HUD";
  
  const workPills = document.getElementById("workBoardPills");
  const personalPills = document.getElementById("personalBoardPills");
  if (workPills) workPills.style.display = isWork ? "flex" : "none";
  if (personalPills) personalPills.style.display = isWork ? "none" : "flex";
  
  if (isWork && (state.captureBoard !== "work" && state.captureBoard !== "growth")) {
    state.captureBoard = "work";
  } else if (!isWork && (state.captureBoard === "work" || !BOARD_LABELS[state.captureBoard])) {
    state.captureBoard = "life";
  }

  const currentPillContainer = isWork ? "#workBoardPills" : "#personalBoardPills";
  document.querySelectorAll(`${currentPillContainer} .pill`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.board === state.captureBoard);
  });

  const targetLabelEl = document.getElementById("captureTargetLabel");
  if (targetLabelEl) {
    targetLabelEl.textContent = `Target: ${BOARD_LABELS[state.captureBoard] || "Inbox"} -> 📥 Inbox`;
  }
}

function toggleManualContext() {
  state.manualOverride = true;
  state.context = state.context === "work" ? "personal" : "work";
  applyTheme();
  syncHud();
}

function selectCaptureBoard(boardKey, label) {
  state.captureBoard = boardKey;
  const isWork = state.context === "work";
  const container = isWork ? "#workBoardPills" : "#personalBoardPills";
  document.querySelectorAll(`${container} .pill`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.board === boardKey);
  });
  document.getElementById("captureTargetLabel").textContent = `Target: ${label} -> 📥 Inbox`;
}

function selectCaptureEnergy(color) {
  state.captureEnergy = color;
  document.querySelectorAll("[data-cap-energy]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.capEnergy === color);
  });
}

function selectCaptureRecur(cadence) {
  state.captureRecur = cadence;
  document.querySelectorAll("[data-cap-recur]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.capRecur === cadence);
  });
}

function selectCaptureDue(preset) {
  const dateInput = document.getElementById("captureDueDateInput");
  if (preset === "none") {
    state.captureDue = "";
    if (dateInput) dateInput.value = "";
  } else if (preset === "today") {
    const now = new Date();
    state.captureDue = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0).toISOString();
    if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];
  } else if (preset === "tomorrow") {
    const now = new Date();
    const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 17, 0, 0);
    state.captureDue = tom.toISOString();
    if (dateInput) dateInput.value = tom.toISOString().split("T")[0];
  }
  document.querySelectorAll("[data-cap-due]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.capDue === preset);
  });
}

function selectCaptureCustomDue(val) {
  if (!val) return selectCaptureDue("none");
  const parts = val.split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 17, 0, 0);
  state.captureDue = d.toISOString();
  document.querySelectorAll("[data-cap-due]").forEach(btn => btn.classList.remove("active"));
}

function setEnergyFilter(energy) {
  state.energyFilter = energy;
  document.querySelectorAll(".energy-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.energy === energy);
  });
  renderCards();
}

async function autoPromoteCards(results) {
  let promotedAny = false;
  const allCardsMap = {};
  for (const { listMap, cards } of results) {
    for (const c of cards) {
      allCardsMap[c.id] = {
        id: c.id,
        name: c.name,
        shortLink: c.shortLink,
        idList: c.idList,
        isDone: (c.idList === listMap.done)
      };
    }
  }

  for (const { boardKey, listMap, cards } of results) {
    if (!listMap.today || !listMap.queue) continue;

    const todayCards = cards.filter(c => c.idList === listMap.today && !c.name.startsWith("🎯"));
    const queueCards = cards.filter(c => c.idList === listMap.queue);

    const counts = { red: 0, yellow: 0, green: 0 };
    todayCards.forEach(c => {
      const col = (c.labels && c.labels[0]) ? c.labels[0].color : "none";
      if (counts[col] !== undefined) counts[col]++;
    });

    const slots = {
      red: Math.max(0, 1 - counts.red),
      yellow: Math.max(0, 1 - counts.yellow),
      green: Math.max(0, 2 - counts.green)
    };

    let totalSlots = slots.red + slots.yellow + slots.green;
    if (totalSlots === 0 || queueCards.length === 0) continue;

    const sortedQueue = [...queueCards].sort((a, b) => {
      const dueA = a.due ? new Date(a.due).getTime() : Infinity;
      const dueB = b.due ? new Date(b.due).getTime() : Infinity;
      if (dueA !== dueB) return dueA - dueB;
      return parseInt(a.id.substring(0, 8), 16) - parseInt(b.id.substring(0, 8), 16);
    });

    for (const card of sortedQueue) {
      if (totalSlots === 0) break;
      const blockers = getUnresolvedBlockers(card, allCardsMap);
      if (blockers.length > 0) continue;

      const col = (card.labels && card.labels[0]) ? card.labels[0].color : "none";
      if (slots[col] && slots[col] > 0) {
        try {
          await trelloFetch(`/cards/${card.id}`, "PUT", `&idList=${listMap.today}`);
          card.idList = listMap.today;
          slots[col]--;
          totalSlots--;
          promotedAny = true;
        } catch (e) {
          console.error("Auto-promote failed for card:", card.id, e);
        }
      }
    }
  }
  return promotedAny;
}

async function syncHud() {
  if (!checkLockGate()) return;
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey || !cfg.token) return openSettings();
  if (!state.manualOverride) state.context = determineAutoContext(cfg);
  applyTheme();

  const activeKeys = state.context === "work" ? ["work", "growth"] : ["life", "vi", "lab", "growth"];
  const validTargets = activeKeys.filter(k => cfg.boards && cfg.boards[k]);

  try {
    const results = await Promise.all(validTargets.map(k => fetchBoardData(k, cfg.boards[k])));
    
    await manageCardDependencies(results);
    await autoPromoteCards(results);

    state.todayCards = [];
    state.inboxCards = [];
    state.allLoadedCards = [];
    state.saveStateCardId = null;

    const allCardsMap = {};
    for (const { listMap, cards } of results) {
      for (const c of cards) {
        allCardsMap[c.id] = {
          id: c.id,
          name: c.name,
          shortLink: c.shortLink,
          idList: c.idList,
          isDone: (c.idList === listMap.done)
        };
      }
    }

    results.forEach(({ boardKey, listMap, cards }) => {
      cards.forEach(card => {
        if (card.name.startsWith("🎯 SAVE STATE")) {
          if ((state.context === "work" && boardKey === "work") || (state.context === "personal" && boardKey === "life")) {
            state.saveStateCardId = card.id;
            document.getElementById("saveStateInput").value = card.desc || "";
          }
          return;
        }
        const energyColor = (card.labels && card.labels[0]) ? card.labels[0].color : "none";
        const commentsList = (card.actions && Array.isArray(card.actions))
          ? card.actions.filter(a => a.type === "commentCard" && a.data && a.data.text).map(a => ({
              id: a.id,
              text: a.data.text,
              date: a.date
            }))
          : [];
        const latestNote = commentsList.length > 0 ? commentsList[0].text : (card.desc || "");
        const rels = extractCardRelations(card, allCardsMap);
        const activeBlockers = [];
        if (rels.blockedBy && rels.blockedBy.length > 0) {
          for (const b of rels.blockedBy) {
            const blockerCard = allCardsMap[b.id] || Object.values(allCardsMap).find(c => c.shortLink === b.id);
            if (blockerCard && !blockerCard.isDone) {
              activeBlockers.push(b.name || blockerCard.name);
            }
          }
        }

        const item = {
          id: card.id,
          name: card.name,
          desc: card.desc || "",
          notes: latestNote,
          comments: commentsList,
          boardKey,
          boardName: BOARD_LABELS[boardKey],
          energy: energyColor,
          labels: card.labels || [],
          shortUrl: card.shortUrl || `https://trello.com/c/${card.id}`,
          relations: rels,
          blockers: activeBlockers,
          attachments: card.attachments || []
        };
        
        if (card.idList !== listMap.done) {
          state.allLoadedCards.push(item);
        }

        if (card.idList === listMap.today) state.todayCards.push(item);
        else if (card.idList === listMap.inbox) state.inboxCards.push(item);
      });
    });

    renderCards();
    updateQuickCaptureBlockerDropdown();
    fetchCalendarTelemetry();
  } catch (err) {
    console.error(err);
    document.getElementById("todayList").innerHTML = `<div class="empty-state">API Sync Error. Check ⚙️ Settings.</div>`;
  }
}

function renderCards() {
  const filterFn = c => state.energyFilter === "all" || c.energy === state.energyFilter;
  const todayFiltered = state.todayCards.filter(filterFn);
  const inboxFiltered = state.inboxCards.filter(filterFn);

  const wipEl = document.getElementById("todayCount");
  wipEl.textContent = `${state.todayCards.length} / 4`;
  wipEl.classList.toggle("over", state.todayCards.length > 4);
  document.getElementById("inboxCount").textContent = state.inboxCards.length;

  const todayContainer = document.getElementById("todayList");
  todayContainer.innerHTML = todayFiltered.length ? "" : `<div class="empty-state">No cards matching filter in ⚡ Today.</div>`;
  todayFiltered.forEach(c => {
    const el = document.createElement("div");
    el.className = `task-card energy-${c.energy}`;
    const noteSnippet = c.notes ? `<div class="task-notes-preview" title="View/Add Comments" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬 ${escapeHtml(c.notes)}</div>` : "";
    const blockerTag = (c.blockers && c.blockers.length > 0) ? `<span style="background:rgba(239,68,68,0.25); color:#fca5a5; border:1px solid var(--high); padding:1px 6px; border-radius:4px; font-size:0.68rem;" title="Blocked by incomplete tasks">🔒 Blocked by: ${escapeHtml(c.blockers.join(", "))}</span>` : "";

    const recurCadence = getCardRecurCadence(c);
    const recurTag = recurCadence !== "none"
      ? `<span style="background:rgba(56,189,248,0.2); color:var(--accent); border:1px solid var(--accent); padding:1px 6px; border-radius:4px; font-size:0.68rem;">🔁 ${recurCadence === "twicedaily" ? "TWICE DAILY" : recurCadence.toUpperCase()}</span>`
      : "";

    el.innerHTML = `
      <div class="task-info">
        <div class="task-title">${escapeHtml(c.name)}</div>
        <div class="task-meta">
          <span class="board-tag">${c.boardName}</span>
          ${recurTag}
          ${blockerTag}
        </div>
        ${noteSnippet}
      </div>
      <div class="task-actions">
        <button class="icon-btn" title="Comments & Blockers" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬</button>
        <button class="icon-btn" title="Move to Waiting" onclick="moveCard('${c.id}','${c.boardKey}','waiting')">⏳</button>
        <button class="icon-btn done" title="Complete Task" onclick="moveCard('${c.id}','${c.boardKey}','done')">✓</button>
      </div>
    `;
    todayContainer.appendChild(el);
  });

  const inboxContainer = document.getElementById("inboxList");
  inboxContainer.innerHTML = inboxFiltered.length ? "" : `<div class="empty-state">📥 Inbox clear!</div>`;
  inboxFiltered.forEach(c => {
    const el = document.createElement("div");
    el.className = `task-card energy-${c.energy}`;

    const inboxRecurCadence = getCardRecurCadence(c);
    const inboxRecurTag = inboxRecurCadence !== "none"
      ? `<span style="background:rgba(56,189,248,0.2); color:var(--accent); border:1px solid var(--accent); padding:1px 6px; border-radius:4px; font-size:0.68rem;">🔁 ${inboxRecurCadence === "twicedaily" ? "TWICE DAILY" : inboxRecurCadence.toUpperCase()}</span>`
      : "";

    el.innerHTML = `
      <div class="task-info">
        <div class="task-title">${escapeHtml(c.name)}</div>
        <div class="task-meta">
          <span class="board-tag">${c.boardName}</span>
          ${inboxRecurTag}
          <span class="energy-picker" title="Assign Energy Quota">
            <button class="mini-energy-btn ${c.energy === 'red' ? 'active' : ''}" title="🔴 High Voltage (Heavy)" onclick="setCardEnergy('${c.id}','${c.boardKey}','red')">🔴</button>
            <button class="mini-energy-btn ${c.energy === 'yellow' ? 'active' : ''}" title="🟡 Medium Cruise (Med)" onclick="setCardEnergy('${c.id}','${c.boardKey}','yellow')">🟡</button>
            <button class="mini-energy-btn ${c.energy === 'green' ? 'active' : ''}" title="🟢 Low Battery (Light)" onclick="setCardEnergy('${c.id}','${c.boardKey}','green')">🟢</button>
          </span>
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-btn" title="Comments & Blockers" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬</button>
        <button class="icon-btn" title="Promote to Today" onclick="moveCard('${c.id}','${c.boardKey}','today')">⚡</button>
        <button class="icon-btn" title="Stage in Queue" onclick="moveCard('${c.id}','${c.boardKey}','queue')">🗂️</button>
        <button class="icon-btn done" title="3-Min Kill (Done)" onclick="moveCard('${c.id}','${c.boardKey}','done')">✓</button>
      </div>
    `;
    inboxContainer.appendChild(el);
  });
}

function renderModalComments(comments) {
  const historyContainer = document.getElementById("cardCommentsHistory");
  if (!comments || comments.length === 0) {
    historyContainer.innerHTML = `<div class="empty-state" style="padding:8px 0;">No comments logged yet.</div>`;
    return;
  }
  historyContainer.innerHTML = comments.map(cm => {
    const dateStr = cm.date ? new Date(cm.date).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div style="background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:7px 10px; font-size:0.75rem;">
        <div style="color:#cbd5e1; white-space:pre-wrap; word-break:break-word;">${escapeHtml(cm.text)}</div>
        <div style="font-size:0.65rem; color:var(--muted); margin-top:3px; text-align:right;">${dateStr}</div>
      </div>
    `;
  }).join("");
}

function getCardRecurCadence(card) {
  if (!card || !card.labels) return "none";
  for (const lb of card.labels) {
    const name = (lb.name || "").toLowerCase();
    if (name.includes("twice daily") || name.includes("2x daily") || name.includes("twicedaily")) return "twicedaily";
    if (name.includes("daily")) return "daily";
    if (name.includes("bi-weekly") || name.includes("biweekly")) return "biweekly";
    if (name.includes("weekly")) return "weekly";
    if (name.includes("monthly")) return "monthly";
  }
  return "none";
}

function updateModalRecurPills(card) {
  const currentRecur = getCardRecurCadence(card);
  const map = {
    none: "modalRecurNone",
    twicedaily: "modalRecurTwiceDaily",
    daily: "modalRecurDaily",
    weekly: "modalRecurWeekly",
    biweekly: "modalRecurBiweekly",
    monthly: "modalRecurMonthly"
  };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle("active", k === currentRecur);
  });
}

async function setCardRecurCadence(newCadence) {
  if (!state.activeNoteCard) return;
  const { id, boardKey } = state.activeNoteCard;
  const cache = state.boardCache[boardKey];
  const card = state.allLoadedCards.find(c => c.id === id);
  if (!cache || !card) return;

  const recurKeywords = ["twice daily", "2x daily", "twicedaily", "daily", "weekly", "bi-weekly", "biweekly", "monthly"];
  const preservedLabelIds = (card.labels || [])
    .filter(l => !recurKeywords.some(kw => (l.name || "").toLowerCase().includes(kw)))
    .map(l => l.id);

  if (newCadence !== "none" && cache.recurLabelMap && cache.recurLabelMap[newCadence]) {
    preservedLabelIds.push(cache.recurLabelMap[newCadence]);
  }

  try {
    await trelloFetch(`/cards/${id}`, "PUT", `&idLabels=${preservedLabelIds.join(",")}`);
    await syncHud();
    const updated = state.allLoadedCards.find(c => c.id === id);
    if (updated) updateModalRecurPills(updated);
  } catch (e) {
    console.error("Failed to update card recurrence cadence:", e);
    alert("Failed to update recurrence setting.");
  }
}

function openNoteModal(cardId, boardKey) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (!card) return;
  state.activeNoteCard = { id: cardId, boardKey };
  document.getElementById("noteModalCardTitle").textContent = `💬 ${card.name}`;
  const trelloLinkBtn = document.getElementById("cardTrelloLinkBtn");
  if (trelloLinkBtn) trelloLinkBtn.href = card.shortUrl || `https://trello.com/c/${card.id}`;
  
  document.getElementById("cardNoteInput").value = "";
  renderModalComments(card.comments || []);
  renderModalBlockers(card);
  updateModalRecurPills(card);
  document.getElementById("cardNoteModal").classList.add("open");
}

function closeNoteModal() {
  document.getElementById("cardNoteModal").classList.remove("open");
  state.activeNoteCard = null;
}

async function submitQuickCapture() {
  const input = document.getElementById("quickCaptureInput");
  const name = input.value.trim();
  if (!name) return;
  const targetBoardKey = state.captureBoard;
  const cache = state.boardCache[targetBoardKey];
  if (!cache || !cache.listMap.inbox) return alert("Target Inbox list not loaded.");

  let labelIds = [];
  if (state.captureEnergy !== "none" && cache.labelMap[state.captureEnergy]) {
    labelIds.push(cache.labelMap[state.captureEnergy]);
  }
  if (state.captureRecur !== "none" && cache.recurLabelMap && cache.recurLabelMap[state.captureRecur]) {
    labelIds.push(cache.recurLabelMap[state.captureRecur]);
  }

  let labelParam = labelIds.length > 0 ? `&idLabels=${labelIds.join(",")}` : "";
  let dueParam = state.captureDue ? `&due=${encodeURIComponent(state.captureDue)}` : "";

  const blockerSelect = document.getElementById("quickCaptureBlockerSelect");
  const blockerId = blockerSelect ? blockerSelect.value : "";

  input.value = "";
  selectCaptureDue("none");
  selectCaptureRecur("none");
  if (blockerSelect) blockerSelect.value = "";

  try {
    const newCard = await trelloFetch(`/cards`, "POST", `&idList=${cache.listMap.inbox}&name=${encodeURIComponent(name)}&pos=bottom${labelParam}${dueParam}`);

    if (blockerId && newCard && newCard.id) {
      const targetCard = state.allLoadedCards.find(c => c.id === blockerId);
      if (targetCard) {
        const attName = `🔒 Blocked by: ${targetCard.name}`;
        await trelloFetch(`/cards/${newCard.id}/attachments`, "POST", `&url=${encodeURIComponent(targetCard.shortUrl)}&name=${encodeURIComponent(attName)}`);
      }
    }
  } catch (err) {
    console.error("Quick capture failed:", err);
    alert("Failed to create card: " + (err.message || "Trello API error"));
  }

  syncHud();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

async function fetchCalendarTelemetry() {
  const cfg = loadConfig();
  const card = document.getElementById("calendarTickerCard");
  const webhookUrl = (cfg && cfg.calendarWebhook) || (window.HUD_CONFIG && window.HUD_CONFIG.calendarWebhook) || "";

  if (!webhookUrl) {
    console.log("[Calendar Gateway] No calendarWebhook found in config.js or localStorage.");
    if (card) card.style.display = "none";
    return;
  }

  console.log("[Calendar Gateway] Fetching telemetry from:", webhookUrl);

  try {
    const res = await fetch(webhookUrl, { redirect: "follow" });
    if (!res.ok) {
      console.error("[Calendar Gateway] HTTP error:", res.status, res.statusText);
      return;
    }
    const data = await res.json();
    console.log("[Calendar Gateway] Telemetry payload received:", data);

    if (data.error) {
      console.error("[Calendar Gateway] Google Apps Script error:", data.message);
      return;
    }

    if (card) card.style.display = "block";
    const summary = document.getElementById("calSummaryText");
    const badge = document.getElementById("calNextBadge");

    if (summary) {
      summary.textContent = `${data.bookedHours} hrs scheduled (${data.eventCount} ${data.eventCount === 1 ? 'event' : 'events'})`;
    }

    if (badge) {
      if (data.nextEvent) {
        if (data.nextEvent.status === "IN PROGRESS") {
          badge.className = "cal-badge-busy";
          badge.textContent = `🔴 In Meeting: ${data.nextEvent.title} (ends in ${data.nextEvent.endsInMinutes}m)`;
        } else {
          badge.className = "cal-badge-upcoming";
          badge.textContent = `⏳ ${data.nextEvent.startsInMinutes}m until ${data.nextEvent.title} (${data.nextEvent.startTimeFormatted})`;
        }
      } else {
        badge.className = "";
        badge.textContent = "Schedule Clear";
      }
    }
  } catch (e) {
    console.error("[Calendar Gateway] Calendar telemetry fetch error:", e);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  syncHud();
  updatePomoDisplay();
});

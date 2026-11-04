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
  captureIsSpike: false,
  captureTargetTbd: false,
  saveStateCardId: null,
  activeNoteCard: null,
  boardCache: {},
  todayCards: [],
  inboxCards: [],
  tbdCards: [],
  allLoadedCards: []
};

function determineAutoContext(cfg) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("context") === "work" || params.get("context") === "personal" || params.get("context") === "mission") {
    state.manualOverride = true;
    return params.get("context");
  }
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours() + (now.getMinutes() / 60);
  return (day >= 1 && day <= 5 && hour >= 8.5 && hour < 17.0) ? "work" : "personal";
}

function applyTheme() {
  const ctx = state.context;
  const isWork = (ctx === "work");
  const isMission = (ctx === "mission");
  const isPersonal = (ctx === "personal");

  let accent = "#38bdf8";
  let title = "💼 WORK HUD";
  if (isMission) {
    accent = "#f8fafc";
    title = "🚀 MISSION CONTROL";
  } else if (isPersonal) {
    accent = "#a855f7";
    title = "🏠 PERSONAL HUD";
  }
  document.documentElement.style.setProperty("--accent", accent);

  const modeTitleEl = document.getElementById("modeTitle");
  if (modeTitleEl) modeTitleEl.textContent = title;

  renderQuickCaptureBoardPills();

  const targetLabelEl = document.getElementById("captureTargetLabel");
  if (targetLabelEl) {
    targetLabelEl.textContent = state.captureTargetTbd
      ? `Target: ${BOARD_LABELS[state.captureBoard] || "Active Board"} -> 💡 TBD`
      : `Target: ${BOARD_LABELS[state.captureBoard] || "Inbox"} -> 📥 Inbox`;
  }
}

function renderQuickCaptureBoardPills() {
  const container = document.getElementById("quickCaptureBoardPills");
  if (!container) return;

  const activeBoards = typeof getActiveBoardsForContext === "function" 
    ? getActiveBoardsForContext(state.context)
    : [];

  const keys = activeBoards.map(b => b.key);
  if (!keys.includes(state.captureBoard) && keys.length > 0) {
    state.captureBoard = keys[0];
  }

  container.innerHTML = activeBoards.map(b => `
    <button type="button" class="pill ${state.captureBoard === b.key ? 'active' : ''}" 
            data-board="${b.key}" 
            onclick="selectCaptureBoard('${b.key}', '${b.icon || '🚀'} ${b.name}')">
      ${b.icon || '🚀'} ${b.name}
    </button>
  `).join("");
}

function toggleManualContext() {
  state.manualOverride = true;
  if (state.context === "work") {
    state.context = "mission";
  } else if (state.context === "mission") {
    state.context = "personal";
  } else {
    state.context = "work";
  }
  applyTheme();
  syncHud();
}

function selectCaptureBoard(boardKey, label) {
  state.captureBoard = boardKey;
  renderQuickCaptureBoardPills();
  const targetLabelEl = document.getElementById("captureTargetLabel");
  if (targetLabelEl) {
    targetLabelEl.textContent = state.captureTargetTbd
      ? `Target: ${label} -> 💡 TBD`
      : `Target: ${label} -> 📥 Inbox`;
  }
}

function selectCaptureEnergy(color) {
  state.captureEnergy = color;
  document.querySelectorAll("[data-cap-energy]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.capEnergy === color);
  });
}

function toggleQuickCaptureSpikeMacro() {
  state.captureIsSpike = !state.captureIsSpike;
  const btn = document.getElementById("macroSpikeBtn");
  if (btn) btn.classList.toggle("active", state.captureIsSpike);

  const input = document.getElementById("quickCaptureInput");
  if (state.captureIsSpike) {
    selectCaptureEnergy("yellow");
    if (input && !input.value.startsWith("🔬 Spike: ")) {
      input.value = "🔬 Spike: " + input.value;
      input.focus();
    }
  } else {
    selectCaptureEnergy("none");
    if (input && input.value.startsWith("🔬 Spike: ")) {
      input.value = input.value.replace("🔬 Spike: ", "");
    }
  }
}

window.toggleCaptureTargetTbd = function() {
  state.captureTargetTbd = !state.captureTargetTbd;
  const btn = document.getElementById("capTargetTbdBtn");
  if (btn) btn.classList.toggle("active", state.captureTargetTbd);
  const targetLabelEl = document.getElementById("captureTargetLabel");
  if (targetLabelEl) {
    targetLabelEl.textContent = state.captureTargetTbd
      ? `Target: ${BOARD_LABELS[state.captureBoard] || "Active Board"} -> 💡 TBD`
      : `Target: ${BOARD_LABELS[state.captureBoard] || "Active Board"} -> 📥 Inbox`;
  }
};

window.toggleInboxDrawer = function() {
  const drawer = document.getElementById("inboxDrawer");
  const chevron = document.getElementById("inboxToggleChevron");
  if (!drawer) return;
  const isHidden = window.getComputedStyle(drawer).display === "none";
  drawer.style.display = isHidden ? "block" : "none";
  if (chevron) chevron.textContent = isHidden ? "▼" : "▶";
};

window.toggleTbdDrawer = function() {
  const drawer = document.getElementById("tbdDrawer");
  const chevron = document.getElementById("tbdToggleChevron");
  if (!drawer) return;
  const isHidden = window.getComputedStyle(drawer).display === "none";
  drawer.style.display = isHidden ? "block" : "none";
  if (chevron) chevron.textContent = isHidden ? "▼" : "▶";
};

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

function calculateEnergyQuotas(calData) {
  let isWorkOffDay = false;
  let bookedHours = 0;
  if (calData && typeof calData === "object") {
    isWorkOffDay = !!calData.isWorkOffDay;
    bookedHours = calData.bookedHours || 0;
  }
  const isWork = state.context === "work";
  const now = new Date();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6);

  if (isWork && (isWorkOffDay || isWeekend)) {
    return { red: 0, yellow: 0, green: 0, maxToday: 0, isOffDay: true };
  }
  if (!isWork) {
    return { red: 1, yellow: 1, green: 2, maxToday: 4, isOffDay: false };
  }
  if (bookedHours >= 5.5) {
    return { red: 0, yellow: 1, green: 2, maxToday: 3, isOffDay: false };
  } else if (bookedHours >= 3.5) {
    return { red: 1, yellow: 1, green: 2, maxToday: 4, isOffDay: false };
  } else {
    return { red: 1, yellow: 2, green: 2, maxToday: 5, isOffDay: false };
  }
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

  const activeBoards = typeof getActiveBoardsForContext === "function"
    ? getActiveBoardsForContext(state.context)
    : [];
  const boardPriority = activeBoards.map(b => b.key);

  const getBoardPriorityIdx = (bKey) => {
    const idx = boardPriority.indexOf(bKey);
    return idx === -1 ? 99 : idx;
  };

  const quotas = state.energyQuotas || calculateEnergyQuotas(0);
  const currentCounts = { red: 0, yellow: 0, green: 0 };
  let currentTotalToday = 0;

  for (const { listMap, cards } of results) {
    if (!listMap.today) continue;
    cards.forEach(c => {
      if (c.idList === listMap.today && !c.name.startsWith("🎯")) {
        const energy = getCardEnergyTier(c);
        if (currentCounts[energy] !== undefined) currentCounts[energy]++;
        currentTotalToday++;
      }
    });
  }

  const availableSlots = {
    red: Math.max(0, quotas.red - currentCounts.red),
    yellow: Math.max(0, quotas.yellow - currentCounts.yellow),
    green: Math.max(0, quotas.green - currentCounts.green)
  };
  let totalRemainingCapacity = Math.max(0, quotas.maxToday - currentTotalToday);

  if (totalRemainingCapacity <= 0) return false;

  const candidatePool = [];
  for (const { boardKey, listMap, cards } of results) {
    if (!listMap.queue) continue;
    for (const card of cards) {
      if (card.idList === listMap.queue) {
        candidatePool.push({ card, boardKey, listMap });
      }
    }
  }

  candidatePool.sort((a, b) => {
    const pA = getBoardPriorityIdx(a.boardKey);
    const pB = getBoardPriorityIdx(b.boardKey);
    if (pA !== pB) return pA - pB;

    const dueA = a.card.due ? new Date(a.card.due).getTime() : Infinity;
    const dueB = b.card.due ? new Date(b.card.due).getTime() : Infinity;
    if (dueA !== dueB) return dueA - dueB;

    return parseInt(a.card.id.substring(0, 8), 16) - parseInt(b.card.id.substring(0, 8), 16);
  });

  for (const candidate of candidatePool) {
    if (totalRemainingCapacity <= 0) break;
    const { card, listMap } = candidate;

    const blockers = typeof getUnresolvedBlockers === "function" 
      ? getUnresolvedBlockers(card, allCardsMap)
      : [];
    if (blockers.length > 0) continue;

    const energy = getCardEnergyTier(card);
    if (availableSlots[energy] && availableSlots[energy] > 0) {
      try {
        await trelloFetch(`/cards/${card.id}`, "PUT", `&idList=${listMap.today}`);
        candidate.card.idList = candidate.listMap.today;
        if (allCardsMap[candidate.card.id]) allCardsMap[candidate.card.id].idList = candidate.listMap.today;
        availableSlots[energy]--;
        totalRemainingCapacity--;
        promotedAny = true;
      } catch (e) {
        console.error("Auto-promote failed for card:", card.id, e);
      }
    }
  }
  return promotedAny;
}

function inferEnergyFromTitle(title = "") {
  if (!title) return "none";
  let kwRed = "architect, architecture, migration, migrate, deploy, deployment, outage, incident, sev-1, disaster, scada, infra, provision, rebuild, failover, security review";
  let kwYellow = "configure, configuration, update, review, troubleshoot, investigate, test, testing, script, documentation, doc, prep, refactor, sync, analyze, analysis";
  let kwGreen = "reply, email, ping, check, log, approve, approval, quick, clean, archive, submit, order, call, receipt, schedule, invoice";

  if (typeof activeCloudLedger !== "undefined" && activeCloudLedger.energyKeywords) {
    kwRed = activeCloudLedger.energyKeywords.red || kwRed;
    kwYellow = activeCloudLedger.energyKeywords.yellow || kwYellow;
    kwGreen = activeCloudLedger.energyKeywords.green || kwGreen;
  }

  const buildRegex = (kwStr) => {
    const tokens = kwStr.split(",").map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return null;
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return new RegExp(`\\b(${escaped})\\b`, "i");
  };

  const rxRed = buildRegex(kwRed);
  const rxYellow = buildRegex(kwYellow);
  const rxGreen = buildRegex(kwGreen);

  if (rxRed && rxRed.test(title)) return "red";
  if (rxYellow && rxYellow.test(title)) return "yellow";
  if (rxGreen && rxGreen.test(title)) return "green";

  return "none";
}

async function syncHud() {
  if (!checkLockGate()) return;
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey || !cfg.token) return openSettings();

  const calData = await fetchCalendarTelemetry();
  if (!state.manualOverride) state.context = determineAutoContext(cfg, calData);
  applyTheme();

  state.energyQuotas = calculateEnergyQuotas(calData);

  const customBoards = typeof getCustomBoards === "function" ? getCustomBoards() : [];
  customBoards.forEach(b => {
    cfg.boards[b.key] = b.id;
    BOARD_LABELS[b.key] = `${b.icon || '🚀'} ${b.name}`;
  });

  const activeBoards = typeof getActiveBoardsForContext === "function"
    ? getActiveBoardsForContext(state.context)
    : [];
  const activeKeys = activeBoards.map(b => b.key);
  const validTargets = activeKeys.filter(k => cfg.boards && cfg.boards[k]);

  try {
    const boardPromises = validTargets.map(async k => {
      try {
        return await fetchBoardData(k, cfg.boards[k]);
      } catch (err) {
        console.warn(`[HUD Sync Warning] Skipped board '${k}' (${cfg.boards[k]}):`, err.message);
        return { boardKey: k, listMap: {}, cards: [], error: err.message };
      }
    });
    const allBoardResults = await Promise.all(boardPromises);
    const results = allBoardResults.filter(b => !b.error && b.cards);

    results.forEach(({ cards }) => {
      const ledgerCard = cards.find(c => c.name.startsWith("📊 SCORE LEDGER") || c.name.startsWith("📊 TACTICAL SCORE"));
      if (ledgerCard) {
        state.scoreLedgerCardId = ledgerCard.id;
        if (typeof hydrateCloudLedgerFromTrello === "function") {
          hydrateCloudLedgerFromTrello(ledgerCard.desc);
        }
      }
    });

    if (typeof manageCardDependencies === "function") {
      await manageCardDependencies(results);
    }
    await autoPromoteCards(results);

    state.todayCards = [];
    state.inboxCards = [];
    state.tbdCards = [];
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

        if (card.name.startsWith("📊 SCORE LEDGER") || card.name.startsWith("📊 TACTICAL SCORE")) {
          return;
        }

        let energyColor = (card.labels && card.labels[0]) ? card.labels[0].color : "none";
        if (energyColor === "none" && typeof inferEnergyFromTitle === "function") {
          energyColor = inferEnergyFromTitle(card.name);
        }

        const commentsList = (card.actions && Array.isArray(card.actions))
          ? card.actions.filter(a => a.type === "commentCard" && a.data && a.data.text).map(a => ({
              id: a.id,
              text: a.data.text,
              date: a.date
            }))
          : [];
        const latestNote = commentsList.length > 0 ? commentsList[0].text : (card.desc || "");
        
        const rels = typeof extractCardRelations === "function" 
          ? extractCardRelations(card, allCardsMap)
          : { blockedBy: [], blocking: [] };

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
          boardName: BOARD_LABELS[boardKey] || boardKey,
          energy: energyColor,
          labels: card.labels || [],
          due: card.due || "",
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
        else if (card.idList === listMap.tbd) state.tbdCards.push(item);
      });
    });

    renderCards();
    updateQuickCaptureBlockerDropdown();
  } catch (err) {
    console.error(err);
    document.getElementById("todayList").innerHTML = `<div class="empty-state">API Sync Error. Check ⚙️ Settings.</div>`;
  }
}

function getCardEnergyTier(card) {
  if (card.energy && card.energy !== "none") return card.energy;
  if (!card.labels || !card.labels.length) return "none";
  for (const lb of card.labels) {
    const col = lb.color;
    if (col === "red" || col === "yellow" || col === "green") return col;
  }
  return "none";
}

function renderCards() {
  const filterFn = c => state.energyFilter === "all" || c.energy === state.energyFilter;
  const todayFiltered = state.todayCards.filter(filterFn);
  const inboxFiltered = state.inboxCards.filter(filterFn);

  const wipEl = document.getElementById("todayCount");
  const maxToday = (state.energyQuotas && state.energyQuotas.maxToday !== undefined) ? state.energyQuotas.maxToday : 4;
  wipEl.textContent = `${state.todayCards.length} / ${maxToday}`;
  wipEl.classList.toggle("over", state.todayCards.length > maxToday);

  const todayLabelEl = document.getElementById("todaySectionLabel");
  if (todayLabelEl && state.energyQuotas) {
    const q = state.energyQuotas;
    if (q.isOffDay) {
      todayLabelEl.textContent = `⚡ OFF-DAY PROTOCOL (0 SLOTS ALLOCATED)`;
    } else {
      todayLabelEl.textContent = `⚡ TODAY'S LOAD (${q.red} HEAVY / ${q.yellow} MED / ${q.green} LIGHT)`;
    }
  }

  document.getElementById("inboxCount").textContent = state.inboxCards.length;

  const todayContainer = document.getElementById("todayList");
  todayContainer.innerHTML = todayFiltered.length ? "" : `<div class="empty-state">No cards matching filter in ⚡ Today.</div>`;
  todayFiltered.forEach(c => {
    const el = document.createElement("div");
    el.className = `task-card energy-${c.energy}`;
    const noteSnippet = c.notes
      ? `<div class="task-notes-preview" title="View/Add Comments" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬 ${escapeHtml(c.notes)}</div>`
      : "";

    const blockerTag = (c.blockers && c.blockers.length > 0)
      ? `<span style="background:rgba(239,68,68,0.25); color:#fca5a5; border:1px solid var(--high); padding:1px 6px; border-radius:4px; font-size:0.68rem;" title="Blocked by incomplete tasks">🔒 Blocked by: ${escapeHtml(c.blockers.join(", "))}</span>`
      : "";

    const recurCadence = getCardRecurCadence(c);
    const recurTag = recurCadence !== "none"
      ? `<span style="background:rgba(56,189,248,0.2); color:var(--accent); border:1px solid var(--accent); padding:1px 6px; border-radius:4px; font-size:0.68rem;">🔁 ${recurCadence === "twicedaily" ? "TWICE DAILY" : recurCadence.toUpperCase()}</span>`
      : "";

    let dueTag = "";
    if (c.due) {
      const dueDate = new Date(c.due);
      const now = new Date();
      const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      let dueClass = "background:rgba(148,163,184,0.15); color:#94a3b8; border:1px solid #334155;";
      let dueText = dueDate.toLocaleDateString([], { month: "short", day: "numeric" });
      if (diffHours < 0) {
        dueClass = "background:rgba(244,63,94,0.2); color:#fda4af; border:1px solid #f43f5e;";
        dueText = `⚠️ OVERDUE (${dueText})`;
      } else if (diffHours <= 24) {
        dueClass = "background:rgba(234,179,8,0.2); color:#fde047; border:1px solid #eab308;";
        dueText = `⏳ DUE TODAY`;
      }
      dueTag = `<span style="${dueClass} padding:1px 6px; border-radius:4px; font-size:0.68rem; font-weight:700;">📅 ${dueText}</span>`;
    }

    el.innerHTML = `
      <div class="task-info">
        <div class="task-title">${escapeHtml(c.name)}</div>
        <div class="task-meta">
          <span class="board-tag">${c.boardName}</span>
          ${dueTag}
          ${recurTag}
          ${blockerTag}
        </div>
        ${noteSnippet}
      </div>
      <div class="task-actions">
        <button class="icon-btn" title="1:1 Warp Swap (Bypass Lane)" onclick="promptWarpSwap('${c.id}', '${c.boardKey}')" style="color:var(--accent);">⇄</button>
        <button class="icon-btn" title="Comments & Blockers" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬</button>
        <button class="icon-btn" title="Move to Waiting" onclick="promptRoadblockDeferral('${c.id}','${c.boardKey}')">⏳</button>
        <button class="icon-btn done" title="Complete Task" onclick="initiateCardCompletion('${c.id}','${c.boardKey}')">✓</button>
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
        <button class="icon-btn done" title="3-Min Kill (Done)" onclick="initiateCardCompletion('${c.id}','${c.boardKey}')">✓</button>
      </div>
    `;
    inboxContainer.appendChild(el);
  });

  renderTbdCards();
}

function renderTbdCards() {
  const listEl = document.getElementById("tbdList");
  const countEl = document.getElementById("tbdCount");
  if (!listEl) return;

  if (countEl) countEl.textContent = state.tbdCards.length;

  if (state.tbdCards.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No parked thoughts or discussion items.</div>`;
    return;
  }

  listEl.innerHTML = state.tbdCards.map(c => `
    <div class="task-card" style="border-left: 3px solid #64748b; background: rgba(15, 23, 42, 0.65);">
      <div class="task-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span class="board-badge" style="font-size:0.68rem; font-weight:700; color:#94a3b8;">${c.boardName}</span>
        <div class="task-actions" style="display:flex; gap:4px;">
          <button class="icon-btn" title="Move to Inbox for Action" onclick="moveCard('${c.id}', '${c.boardKey}', 'inbox')">📥</button>
          <button class="icon-btn" title="Card Details / Notes" onclick="openNoteModal('${c.id}', '${c.boardKey}')">💬</button>
        </div>
      </div>
      <div class="task-title" style="color: #cbd5e1; font-weight: 500;">${escapeHtml(c.name)}</div>
      ${c.notes ? `<div class="task-notes" style="font-size:0.75rem; color:#94a3b8; margin-top:4px;">${escapeHtml(c.notes)}</div>` : ''}
    </div>
  `).join("");
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

function updateModalEnergyPills(card) {
  const currentEnergy = getCardEnergyTier(card);
  const map = {
    red: "modalEnergyRed",
    yellow: "modalEnergyYellow",
    green: "modalEnergyGreen"
  };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle("active", k === currentEnergy);
  });
}

async function setModalCardEnergy(color) {
  if (!state.activeNoteCard) return;
  const { id, boardKey } = state.activeNoteCard;
  await setCardEnergy(id, boardKey, color);
  const updated = state.allLoadedCards.find(c => c.id === id);
  if (updated) updateModalEnergyPills(updated);
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
  if (typeof renderModalBlockers === "function") {
    renderModalBlockers(card);
  }
  updateModalRecurPills(card);
  updateModalEnergyPills(card);
  document.getElementById("cardNoteModal").classList.add("open");
}

function closeNoteModal() {
  document.getElementById("cardNoteModal").classList.remove("open");
  state.activeNoteCard = null;
}

function updateQuickCaptureBlockerDropdown() {
  const sel = document.getElementById("quickCaptureBlockerSelect");
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">None (Independent)</option>';
  
  state.allLoadedCards.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `[${c.boardName}] ${c.name}`;
    sel.appendChild(opt);
  });
  sel.value = currentVal;
}

async function submitQuickCapture() {
  const input = document.getElementById("quickCaptureInput");
  const name = input.value.trim();
  if (!name) return;
  const targetBoardKey = state.captureBoard;
  const cache = state.boardCache[targetBoardKey];
  if (!cache || !cache.listMap) return alert("Target board lists not loaded.");

  const targetListKey = state.captureTargetTbd ? 'tbd' : 'inbox';
  const targetListId = cache.listMap[targetListKey];
  if (!targetListId) return alert(`Target ${targetListKey.toUpperCase()} list not loaded.`);

  const isSpikeTask = state.captureIsSpike || name.startsWith("🔬 Spike:") || name.toLowerCase().startsWith("spike:");

  let labelIds = [];
  let resolvedEnergy = isSpikeTask ? "yellow" : state.captureEnergy;
  if (resolvedEnergy === "none" && typeof inferEnergyFromTitle === "function") {
    resolvedEnergy = inferEnergyFromTitle(name);
  }
  if (resolvedEnergy !== "none" && cache.labelMap[resolvedEnergy]) {
    labelIds.push(cache.labelMap[resolvedEnergy]);
  }
  if (state.captureRecur !== "none" && cache.recurLabelMap && cache.recurLabelMap[state.captureRecur]) {
    labelIds.push(cache.recurLabelMap[state.captureRecur]);
  }

  let labelParam = labelIds.length > 0 ? `&idLabels=${labelIds.join(",")}` : "";
  let dueParam = state.captureDue ? `&due=${encodeURIComponent(state.captureDue)}` : "";

  let descParam = "";
  if (isSpikeTask) {
    const spikeTemplate = `**Objective:** Answer technical unknown / determine physical path forward.\n**Deliverable:** Document recommendation & next actions in comments.\n**Time-Box:** Max 2 Pomodoros (50 min).`;
    descParam = `&desc=${encodeURIComponent(spikeTemplate)}`;
  }

  const blockerSelect = document.getElementById("quickCaptureBlockerSelect");
  const blockerId = blockerSelect ? blockerSelect.value : "";

  input.value = "";
  selectCaptureDue("none");
  selectCaptureRecur("none");
  state.captureIsSpike = false;
  const spikeBtn = document.getElementById("macroSpikeBtn");
  if (spikeBtn) spikeBtn.classList.remove("active");
  if (blockerSelect) blockerSelect.value = "";

  if (state.captureTargetTbd) {
    toggleCaptureTargetTbd();
  }

  try {
    const newCard = await trelloFetch(
      `/cards`, 
      "POST", 
      `&idList=${targetListId}&name=${encodeURIComponent(name)}&pos=bottom${labelParam}${dueParam}${descParam}`
    );

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

async function fetchCalendarTelemetry() {
  const cfg = loadConfig();
  const card = document.getElementById("calendarTickerCard");
  if (!cfg || !cfg.calendarWebhook) {
    if (card) card.style.display = "none";
    return null;
  }

  try {
    const res = await fetch(cfg.calendarWebhook);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;

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
    state.calendarTelemetry = data;
    return data;
  } catch (e) {
    console.error("Calendar telemetry fetch error:", e);
    return null;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

window.addEventListener("DOMContentLoaded", () => {
  syncHud();
  if (typeof updatePomoDisplay === "function") {
    updatePomoDisplay();
  }
});

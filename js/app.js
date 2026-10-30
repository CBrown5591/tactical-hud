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
  saveStateCardId: null,
  scoreLedgerCardId: null,
  activeNoteCard: null,
  boardCache: {},
  todayCards: [],
  inboxCards: [],
  allLoadedCards: [],
  calendarTelemetry: { bookedHours: 0, eventCount: 0, nextEvent: null },
  energyQuotas: { red: 1, yellow: 1, green: 2, total: 4, label: "1 HEAVY / 1 MED / 2 LIGHT" }
};

function calculateEnergyQuotas(calData = null) {
  const isWork = state.context === "work";
  const now = new Date();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6); // 0 = Sunday, 6 = Saturday
  const isOff = (calData && calData.isWorkOffDay) || isWeekend;

  const bookedHours = isWork
    ? (calData ? (calData.workBookedHours ?? calData.bookedHours ?? 0) : 0)
    : (calData ? (calData.bookedHours ?? 0) : 0);

  // Option A: If viewing Work HUD on a weekend or off-day (vacation, PTO, RDO), lock capacity to 0
  if (isWork && isOff) {
    let offLabel = "🌴 SCHEDULED OFF DAY (WORK LOCKED)";
    if (isWeekend) {
      offLabel = "🌴 WEEKEND (WORK LOCKED)";
    } else if (calData && calData.offDayReason) {
      offLabel = `🌴 ${calData.offDayReason.toUpperCase()} (WORK LOCKED)`;
    }
    return {
      red: 0, yellow: 0, green: 0, total: 0,
      label: offLabel
    };
  }

  let maxRed = 1;
  let maxYellow = 1;
  let maxGreen = 2;

  if (bookedHours > 6.0) {
    maxRed = 0; maxYellow = 0; maxGreen = 2; // Locked / high meeting load
  } else if (bookedHours > 4.0) {
    maxRed = 0; maxYellow = 1; maxGreen = 2; // Heavy meeting day (3 tasks max)
  } else if (bookedHours > 2.0) {
    maxRed = 0; maxYellow = 2; maxGreen = 2; // Moderate meeting load (convert Heavy to Medium)
  }

  const total = maxRed + maxYellow + maxGreen;
  const label = `${maxRed} HEAVY / ${maxYellow} MED / ${maxGreen} LIGHT`;
  return { red: maxRed, yellow: maxYellow, green: maxGreen, total, label };
}

function determineAutoContext(cfg, calTelemetry = null) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("context") === "work" || params.get("context") === "personal") {
    state.manualOverride = true;
    return params.get("context");
  }

  // If calendar marks today as an off-day (e.g. "Charles Off Day", Holiday, PTO), automatically route to Personal HUD
  if (calTelemetry && calTelemetry.isWorkOffDay) {
    return "personal";
  }

  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours() + (now.getMinutes() / 60);
  return (day >= 1 && day <= 5 && hour >= 8.0 && hour < 17.0) ? "work" : "personal";
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

function toggleQuickCaptureSpikeMacro() {
  state.captureIsSpike = !state.captureIsSpike;
  const btn = document.getElementById("macroSpikeBtn");
  const input = document.getElementById("quickCaptureInput");

  if (state.captureIsSpike) {
    selectCaptureEnergy("yellow");
    if (btn) btn.classList.add("active");
    if (input) {
      const cur = input.value.trim();
      if (!cur) {
        input.value = "🔬 Spike: ";
      } else if (!cur.startsWith("🔬 Spike:")) {
        input.value = "🔬 Spike: " + cur;
      }
      input.focus();
    }
  } else {
    if (btn) btn.classList.remove("active");
    if (input && input.value.startsWith("🔬 Spike: ")) {
      input.value = input.value.replace(/^🔬 Spike:\s*/, "");
    }
  }
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
  let changedAny = false;
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

  const isWork = state.context === "work";
  const boardPriority = isWork ? ["work", "growth"] : ["life", "vi", "lab", "growth"];
  const getBoardPriorityIdx = (bKey) => {
    const idx = boardPriority.indexOf(bKey);
    return idx === -1 ? 99 : idx;
  };

  const quotas = state.energyQuotas || calculateEnergyQuotas(0);

  // --- PHASE 1: COLLECT ALL CURRENT TODAY CARDS ACROSS BOARDS ---
  const todayEntries = [];
  results.forEach(({ boardKey, listMap, cards }) => {
    if (!listMap.today) return;
    cards.forEach(card => {
      if (card.idList === listMap.today && !card.name.startsWith("🎯")) {
        const col = (card.labels && card.labels[0]) ? card.labels[0].color : "none";
        todayEntries.push({ card, boardKey, listMap, energy: col });
      }
    });
  });

  // --- PHASE 2: OVERFLOW REBALANCING (DEMOTE EXCESS BASED ON PRIORITY) ---
  // If Today already has more cards of a tier than quota permits (e.g. 2 Reds):
  // Work retains the slot; lower-priority board (Growth) is demoted back to its Queue.
  for (const energy of ["red", "yellow", "green"]) {
    const matching = todayEntries.filter(e => e.energy === energy);
    const maxAllowed = quotas[energy] || 0;

    if (matching.length > maxAllowed) {
      // Sort matching today cards: lowest priority board gets demoted first
      matching.sort((a, b) => {
        const prioA = getBoardPriorityIdx(a.boardKey);
        const prioB = getBoardPriorityIdx(b.boardKey);
        if (prioA !== prioB) return prioA - prioB; // lower index = higher priority to keep
        // If same board, earlier due date kept first
        const dueA = a.card.due ? new Date(a.card.due).getTime() : Infinity;
        const dueB = b.card.due ? new Date(b.card.due).getTime() : Infinity;
        return dueA - dueB;
      });

      // Cards beyond maxAllowed are demoted back to Queue
      const toDemote = matching.slice(maxAllowed);
      for (const entry of toDemote) {
        if (entry.listMap.queue) {
          try {
            await trelloFetch(`/cards/${entry.card.id}`, "PUT", `&idList=${entry.listMap.queue}&pos=top`);
            entry.card.idList = entry.listMap.queue;
            if (allCardsMap[entry.card.id]) allCardsMap[entry.card.id].idList = entry.listMap.queue;
            // Remove from todayEntries list
            const idx = todayEntries.findIndex(e => e.card.id === entry.card.id);
            if (idx !== -1) todayEntries.splice(idx, 1);
            changedAny = true;
            console.log(`[Quota Enforcer] Demoted overflow ${entry.energy} task "${entry.card.name}" from ${entry.boardKey} back to Queue.`);
          } catch (e) {
            console.error("Failed to demote overflow card:", entry.card.id, e);
          }
        }
      }
    }
  }

  // --- PHASE 3: CALCULATE REMAINING GLOBAL SLOTS ---
  const currentCounts = { red: 0, yellow: 0, green: 0 };
  todayEntries.forEach(e => {
    if (currentCounts[e.energy] !== undefined) currentCounts[e.energy]++;
  });

  const slots = {
    red: Math.max(0, quotas.red - currentCounts.red),
    yellow: Math.max(0, quotas.yellow - currentCounts.yellow),
    green: Math.max(0, quotas.green - currentCounts.green)
  };

  let totalSlots = slots.red + slots.yellow + slots.green;
  if (totalSlots === 0) return changedAny;

  // --- PHASE 4: UNIFIED MULTI-BOARD PROMOTION ---
  // Collect all eligible unblocked queue cards from all active boards
  const queueCandidates = [];
  results.forEach(({ boardKey, listMap, cards }) => {
    if (!listMap.queue || !listMap.today) return;
    cards.forEach(card => {
      if (card.idList === listMap.queue) {
        const blockers = getUnresolvedBlockers(card, allCardsMap);
        if (blockers.length === 0) {
          const col = (card.labels && card.labels[0]) ? card.labels[0].color : "none";
          queueCandidates.push({ card, boardKey, listMap, energy: col });
        }
      }
    });
  });

  // Sort unified candidates:
  // 1. Board Priority (Work > Growth in Work mode; Life > VI > Lab > Growth in Personal mode)
  // 2. Due Date (Earliest deadline first)
  // 3. Pos / ID
  queueCandidates.sort((a, b) => {
    const prioA = getBoardPriorityIdx(a.boardKey);
    const prioB = getBoardPriorityIdx(b.boardKey);
    if (prioA !== prioB) return prioA - prioB;

    const dueA = a.card.due ? new Date(a.card.due).getTime() : Infinity;
    const dueB = b.card.due ? new Date(b.card.due).getTime() : Infinity;
    if (dueA !== dueB) return dueA - dueB;

    return parseInt(a.card.id.substring(0, 8), 16) - parseInt(b.card.id.substring(0, 8), 16);
  });

  // Promote in strict priority order against open global slots
  for (const candidate of queueCandidates) {
    if (totalSlots === 0) break;
    const col = candidate.energy;
    if (slots[col] && slots[col] > 0) {
      try {
        await trelloFetch(`/cards/${candidate.card.id}`, "PUT", `&idList=${candidate.listMap.today}`);
        candidate.card.idList = candidate.listMap.today;
        if (allCardsMap[candidate.card.id]) allCardsMap[candidate.card.id].idList = candidate.listMap.today;
        slots[col]--;
        totalSlots--;
        changedAny = true;
        console.log(`[Unified Auto-Promote] Promoted ${col} task "${candidate.card.name}" from [${candidate.boardKey}] to Today.`);
      } catch (e) {
        console.error("Auto-promote failed for card:", candidate.card.id, e);
      }
    }
  }

  return changedAny;
}

async function syncHud() {
  if (!checkLockGate()) return;
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey || !cfg.token) return openSettings();

  // 1. Fetch calendar telemetry first to detect off-days ("Charles Off Day") and work-hour meeting load
  const calData = await fetchCalendarTelemetry();
  if (!state.manualOverride) state.context = determineAutoContext(cfg, calData);
  applyTheme();

  // Re-calculate energy quotas for the resolved context
  state.energyQuotas = calculateEnergyQuotas(calData);

  const activeKeys = state.context === "work" ? ["work", "growth"] : ["life", "vi", "lab", "growth"];
  const validTargets = activeKeys.filter(k => cfg.boards && cfg.boards[k]);

  try {
    // Resilient board fetching: If one board fails (e.g. 404 or access revoked), don't crash the other boards
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

    if (results.length === 0 && allBoardResults.some(b => b.error)) {
      const firstErr = allBoardResults.find(b => b.error);
      throw new Error(`Board '${firstErr.boardKey}' failed: ${firstErr.error}`);
    }

    await manageCardDependencies(results);
    await autoPromoteCards(results);

    state.todayCards = [];
    state.inboxCards = [];
    state.allLoadedCards = [];
    state.saveStateCardId = null;
    state.scoreLedgerCardId = null;

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
        if (card.name.startsWith("📊 SCORE LEDGER") || card.name.startsWith("⚡ SCORE LEDGER")) {
          if ((state.context === "work" && boardKey === "work") || (state.context === "personal" && boardKey === "life")) {
            state.scoreLedgerCardId = card.id;
            if (typeof hydrateCloudLedgerFromTrello === "function") {
              hydrateCloudLedgerFromTrello(card.desc || "");
            }
          }
          return;
        }
        let energyColor = "none";
        const matchedEnergyLabel = (card.labels || []).find(l => ["red", "yellow", "green"].includes(l.color));
        if (matchedEnergyLabel) {
          energyColor = matchedEnergyLabel.color;
        } else if (typeof inferEnergyFromTitle === "function") {
          const autoInferred = inferEnergyFromTitle(card.name);
          if (autoInferred !== "none") {
            energyColor = autoInferred;
            // Asynchronously tag the card on Trello in the background
            if (cache && cache.labelMap && cache.labelMap[autoInferred]) {
              setCardEnergy(card.id, boardKey, autoInferred).catch(e => console.warn("Auto-label failed:", e));
            }
          }
        }
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
          due: card.due || "",
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

    // Auto-create 📊 SCORE LEDGER card on primary board if it doesn't exist yet
    if (!state.scoreLedgerCardId) {
      const primaryRes = results.find(r => (state.context === "work" && r.boardKey === "work") || (state.context === "personal" && r.boardKey === "life"));
      if (primaryRes && primaryRes.listMap) {
        const targetList = primaryRes.listMap.inbox || primaryRes.listMap.today;
        if (targetList) {
          try {
            const initialPayload = JSON.stringify(activeCloudLedger, null, 2);
            const newLedgerCard = await trelloFetch('/cards', 'POST', `&idList=${targetList}&name=${encodeURIComponent("📊 SCORE LEDGER")}&desc=${encodeURIComponent(initialPayload)}&pos=bottom`);
            state.scoreLedgerCardId = newLedgerCard.id;
            console.log("[Portal Master] Auto-created authoritative 📊 SCORE LEDGER card on Trello:", newLedgerCard.id);
          } catch (e) {
            console.warn("[Portal Master] Could not auto-create 📊 SCORE LEDGER card:", e);
          }
        }
      }
    }

    renderCards();
    updateQuickCaptureBlockerDropdown();
    if (typeof updateRingDisplay === "function") updateRingDisplay();
  } catch (err) {
    console.error(err);
    document.getElementById("todayList").innerHTML = `<div class="empty-state">API Sync Error. Check ⚙️ Settings.</div>`;
  }
}

function renderCards() {
  const filterFn = c => state.energyFilter === "all" || c.energy === state.energyFilter;
  const todayFiltered = state.todayCards.filter(filterFn);
  const inboxFiltered = state.inboxCards.filter(filterFn);

  const quotas = state.energyQuotas || { red: 1, yellow: 1, green: 2, total: 4, label: "1 HEAVY / 1 MED / 2 LIGHT" };
  const todayLabel = document.getElementById("todaySectionLabel");
  if (todayLabel) todayLabel.textContent = `⚡ TODAY'S LOAD (${quotas.label})`;

  const wipEl = document.getElementById("todayCount");
  wipEl.textContent = `${state.todayCards.length} / ${quotas.total}`;
  wipEl.classList.toggle("over", state.todayCards.length > quotas.total);
  document.getElementById("inboxCount").textContent = state.inboxCards.length;

  const todayContainer = document.getElementById("todayList");
  todayContainer.innerHTML = todayFiltered.length ? "" : `<div class="empty-state">No cards matching filter in ⚡ Today.</div>`;
  todayFiltered.forEach(c => {
    const el = document.createElement("div");
    el.className = `task-card energy-${c.energy}`;
    const noteSnippet = c.notes ? `<div class="task-notes-preview" title="View/Add Comments" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬 ${escapeHtml(c.notes)}</div>` : "";
    const blockerTag = (c.blockers && c.blockers.length > 0) ? `<span style="background:rgba(239,68,68,0.25); color:#fca5a5; border:1px solid var(--high); padding:1px 6px; border-radius:4px; font-size:0.68rem;" title="Blocked by incomplete tasks">🔒 Blocked by: ${escapeHtml(c.blockers.join(", "))}</span>` : "";

    let dueTag = "";
    if (c.due && typeof calculateDeadlineModifier === "function") {
      const mod = calculateDeadlineModifier(c.energy, c.due);
      const modColor = mod.type === "early" ? "#38bdf8" : (mod.type === "ontime" ? "#22c55e" : "#f43f5e");
      dueTag = `<span style="background:#090d16; border:1px solid ${modColor}; color:${modColor}; padding:1px 6px; border-radius:4px; font-size:0.68rem; font-weight:700;">📅 ${mod.label}</span>`;
    }

    el.innerHTML = `
      <div class="task-info">
        <div class="task-title">${escapeHtml(c.name)}</div>
        <div class="task-meta">
          <span class="board-tag">${c.boardName}</span>
          <span class="energy-picker" title="Adjust Energy Quota">
            <button class="mini-energy-btn ${c.energy === 'red' ? 'active' : ''}" title="🔴 High Voltage (Heavy)" onclick="setCardEnergy('${c.id}','${c.boardKey}','red')">🔴</button>
            <button class="mini-energy-btn ${c.energy === 'yellow' ? 'active' : ''}" title="🟡 Medium Cruise (Med)" onclick="setCardEnergy('${c.id}','${c.boardKey}','yellow')">🟡</button>
            <button class="mini-energy-btn ${c.energy === 'green' ? 'active' : ''}" title="🟢 Low Battery (Light)" onclick="setCardEnergy('${c.id}','${c.boardKey}','green')">🟢</button>
          </span>
          ${dueTag}
          ${blockerTag}
        </div>
        ${noteSnippet}
      </div>
      <div class="task-actions">
        <button class="icon-btn" title="1:1 Warp Swap (Bypass)" onclick="promptWarpSwap('${c.id}','${c.boardKey}','${c.energy}')">⇄</button>
        <button class="icon-btn" title="Comments & Blockers" onclick="openNoteModal('${c.id}','${c.boardKey}')">💬</button>
        <button class="icon-btn" title="Move to Waiting" onclick="promptRoadblockDeferral('${c.id}','${c.boardKey}')">⏳</button>
        <button class="icon-btn done" title="Complete Task" onclick="completeCard('${c.id}','${c.boardKey}')">✓</button>
      </div>
    `;
    todayContainer.appendChild(el);
  });

  const inboxContainer = document.getElementById("inboxList");
  inboxContainer.innerHTML = inboxFiltered.length ? "" : `<div class="empty-state">📥 Inbox clear!</div>`;
  inboxFiltered.forEach(c => {
    const el = document.createElement("div");
    el.className = `task-card energy-${c.energy}`;
    el.innerHTML = `
      <div class="task-info">
        <div class="task-title">${escapeHtml(c.name)}</div>
        <div class="task-meta">
          <span class="board-tag">${c.boardName}</span>
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
        <button class="icon-btn done" title="3-Min Kill (Done)" onclick="completeCard('${c.id}','${c.boardKey}')">✓</button>
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

function updateModalEnergyPills(card) {
  const energy = card ? card.energy : "none";
  const map = {
    red: "modalEnergyRed",
    yellow: "modalEnergyYellow",
    green: "modalEnergyGreen"
  };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle("active", k === energy);
  });
}

async function setModalCardEnergy(newEnergy) {
  if (!state.activeNoteCard) return;
  const { id, boardKey } = state.activeNoteCard;
  if (typeof setCardEnergy === "function") {
    await setCardEnergy(id, boardKey, newEnergy);
    const updated = state.allLoadedCards.find(c => c.id === id);
    if (updated) updateModalEnergyPills(updated);
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
  updateModalEnergyPills(card);
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

  try {
    const newCard = await trelloFetch(`/cards`, "POST", `&idList=${cache.listMap.inbox}&name=${encodeURIComponent(name)}&pos=bottom${labelParam}${dueParam}${descParam}`);

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

// --- 1:1 WARP SWAP (BYPASS LANE) ENGINE ---
let _activeWarp = { sourceId: null, boardKey: null, energy: null };

function promptWarpSwap(cardId, boardKey, energy) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (!card) return;
  _activeWarp = { sourceId: cardId, boardKey, energy };

  document.getElementById("warpSourceName").textContent = `[${card.boardName}] ${card.name}`;
  const select = document.getElementById("warpTargetSelect");
  const allowanceEl = document.getElementById("warpAllowanceStatus");
  const confirmBtn = document.getElementById("confirmWarpBtn");

  // Filter queue cards across active boards that share the exact same energy tier
  const eligibleQueue = state.allLoadedCards.filter(c => {
    const cache = state.boardCache[c.boardKey];
    const isQueue = cache && cache.listMap && c.idList === cache.listMap.queue;
    return isQueue && c.energy === energy && c.id !== cardId;
  });

  if (eligibleQueue.length === 0) {
    select.innerHTML = `<option value="">-- No matching ${energy.toUpperCase()} tasks in Queue --</option>`;
    confirmBtn.disabled = true;
  } else {
    select.innerHTML = eligibleQueue.map(c => `<option value="${c.id}">[${c.boardName}] ${escapeHtml(c.name)}</option>`).join("");
    confirmBtn.disabled = false;
  }

  const isSuper = typeof isSuperSonicActive === "function" && isSuperSonicActive();
  const freeAvailable = !(activeCloudLedger.today && activeCloudLedger.today.dailyFreeWarpUsed);
  const tokenCount = (activeCloudLedger.inventory && activeCloudLedger.inventory.warpTokens) || 0;

  if (isSuper) {
    allowanceEl.textContent = "⚡ SUPER SONIC ACTIVE: Unlimited Free 1:1 Warps Available!";
    if (eligibleQueue.length > 0) confirmBtn.disabled = false;
  } else if (freeAvailable) {
    allowanceEl.textContent = "Daily Free Warp Available (1/1 Remaining). Zero ring cost.";
    if (eligibleQueue.length > 0) confirmBtn.disabled = false;
  } else if (tokenCount > 0) {
    allowanceEl.textContent = `Using Inventory Warp Token (${tokenCount} remaining). Zero ring cost.`;
    if (eligibleQueue.length > 0) confirmBtn.disabled = false;
  } else {
    allowanceEl.textContent = "⚠️ No Warp allowances remaining today. Visit the Vault to purchase a Warp Token for 175 Rings.";
    confirmBtn.disabled = true;
  }

  document.getElementById("warpModal").classList.add("open");
}

function closeWarpModal() {
  document.getElementById("warpModal").classList.remove("open");
}

async function confirmWarpSwap() {
  const targetCardId = document.getElementById("warpTargetSelect").value;
  if (!targetCardId || !_activeWarp.sourceId) return;

  const sourceCard = state.allLoadedCards.find(c => c.id === _activeWarp.sourceId);
  const targetCard = state.allLoadedCards.find(c => c.id === targetCardId);
  if (!sourceCard || !targetCard) return;

  const sourceCache = state.boardCache[sourceCard.boardKey];
  const targetCache = state.boardCache[targetCard.boardKey];
  if (!sourceCache || !targetCache) return;

  closeWarpModal();

  try {
    // 1. Move source card from Today back to top of Queue
    await trelloFetch(`/cards/${sourceCard.id}`, "PUT", `&idList=${sourceCache.listMap.queue}&pos=top`);
    // 2. Move target card from Queue into Today
    await trelloFetch(`/cards/${targetCard.id}`, "PUT", `&idList=${targetCache.listMap.today}&pos=top`);

    // Consume allowance if not Super Sonic
    const isSuper = typeof isSuperSonicActive === "function" && isSuperSonicActive();
    if (!isSuper) {
      if (!activeCloudLedger.today.dailyFreeWarpUsed) {
        activeCloudLedger.today.dailyFreeWarpUsed = true;
      } else if (activeCloudLedger.inventory && activeCloudLedger.inventory.warpTokens > 0) {
        activeCloudLedger.inventory.warpTokens--;
      }
      commitScoreLedgerToTrello(activeCloudLedger.today);
    }

    if (typeof playPomoChime === "function") playPomoChime("chaos");
    await syncHud();
  } catch (e) {
    console.error("Warp swap failed:", e);
    alert("Failed to execute 1:1 Warp Swap: " + e.message);
  }
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
    state.energyQuotas = calculateEnergyQuotas(null);
    return null;
  }

  console.log("[Calendar Gateway] Fetching telemetry from:", webhookUrl);

  try {
    const res = await fetch(webhookUrl, { redirect: "follow" });
    if (!res.ok) {
      console.error("[Calendar Gateway] HTTP error:", res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    console.log("[Calendar Gateway] Telemetry payload received:", data);

    if (data.error) {
      console.error("[Calendar Gateway] Google Apps Script error:", data.message);
      return null;
    }

    // Update global state and dynamic quotas based on booked meeting hours & off-day flag
    state.calendarTelemetry = data;
    state.energyQuotas = calculateEnergyQuotas(data);

    if (card) card.style.display = "block";
    const summary = document.getElementById("calSummaryText");
    const badge = document.getElementById("calNextBadge");

    if (summary) {
      if (data.isWorkOffDay) {
        summary.textContent = `🌴 Scheduled Off Day: ${data.offDayReason || "Charles Off Day"}`;
      } else if (state.context === "work") {
        summary.textContent = `${data.workBookedHours ?? data.bookedHours} hrs work meetings (8:00a - 5:00p)`;
      } else {
        summary.textContent = `${data.bookedHours} hrs scheduled (${data.eventCount} ${data.eventCount === 1 ? 'event' : 'events'})`;
      }
    }

    if (badge) {
      const now = new Date();
      const isWeekend = (now.getDay() === 0 || now.getDay() === 6);
      if ((data.isWorkOffDay || isWeekend) && state.context === "work") {
        badge.className = "cal-badge-busy";
        if (isWeekend) {
          badge.textContent = "🌴 Work Locked (Weekend)";
        } else {
          badge.textContent = `🌴 Work Locked (${data.offDayReason || "Off Day"})`;
        }
      } else if (data.nextEvent) {
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
    return data;
  } catch (e) {
    console.error("[Calendar Gateway] Calendar telemetry fetch error:", e);
    state.energyQuotas = calculateEnergyQuotas(null);
    return null;
  }
}

async function completeCard(cardId, boardKey) {
  const card = state.allLoadedCards.find(c => c.id === cardId);
  if (card && typeof recordCardCompleted === "function") {
    recordCardCompleted(card);
  }
  await moveCard(cardId, boardKey, 'done');
}

// --- BACKGROUND AUTO-REFRESH & DEVICE SYNC ENGINE ---
let _autoSyncTimer = null;
const AUTO_SYNC_INTERVAL_MS = 60 * 1000; // 60 seconds

function isUserInputActive() {
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
    return true;
  }
  const openModals = document.querySelectorAll(".modal-backdrop.open");
  return openModals.length > 0;
}

function scheduleNextAutoSync() {
  if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(async () => {
    // Only auto-sync if document is visible and user is not actively typing/modal open
    if (document.visibilityState === "visible" && !isUserInputActive()) {
      try {
        await syncHud();
      } catch (e) {
        console.warn("[Auto-Refresh] Background sync skipped:", e);
      }
    }
    scheduleNextAutoSync();
  }, AUTO_SYNC_INTERVAL_MS);
}

// Instant re-sync when switching back to the HUD tab or unlocking device
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !isUserInputActive()) {
    syncHud();
  }
});

window.addEventListener("focus", () => {
  if (!isUserInputActive()) {
    syncHud();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  syncHud();
  updatePomoDisplay();
  scheduleNextAutoSync();
});

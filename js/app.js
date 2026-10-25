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
    const noteSnippet

// --- js/dependencies.js: Dependency Parser & Lifecycle Engine ---

function extractCardRelations(card, allCardsMap = {}) {
  const blockedBy = [];
  const blocks = [];

  // 1. Read Card Relations Power-Up pluginData
  if (card.pluginData && Array.isArray(card.pluginData)) {
    for (const p of card.pluginData) {
      if (p.value) {
        try {
          const parsed = JSON.parse(p.value);
          if (parsed && parsed["card-relations"]) {
            const cr = parsed["card-relations"];
            if (Array.isArray(cr.blockedBy)) {
              cr.blockedBy.forEach(b => {
                if (b && b.id && !blockedBy.some(x => x.id === b.id)) {
                  blockedBy.push({ id: b.id, name: b.name || "Prerequisite Task", isAttachment: false });
                }
              });
            }
            if (Array.isArray(cr.blocks)) blocks.push(...cr.blocks);
          }
        } catch (e) {}
      }
    }
  }

  // 2. Read Native Card Attachments
  if (card.attachments && Array.isArray(card.attachments)) {
    for (const att of card.attachments) {
      const url = att.url || "";
      const name = att.name || "";
      if (url.includes("trello.com/c/")) {
        const m = url.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
        if (m) {
          const shortLinkOrId = m[1];
          const target = allCardsMap[shortLinkOrId] || Object.values(allCardsMap).find(c => c.shortLink === shortLinkOrId || c.id === shortLinkOrId);
          const targetId = target ? target.id : shortLinkOrId;
          const targetName = target ? target.name : name.replace(/^🔒?\s*Blocked by:\s*/i, "");

          if (!blockedBy.some(x => x.id === targetId)) {
            blockedBy.push({
              id: targetId,
              name: targetName,
              attachmentId: att.id,
              isAttachment: true
            });
          }
        }
      }
    }
  }

  return { blockedBy, blocks };
}

function getUnresolvedBlockers(card, allCardsMap) {
  const rels = extractCardRelations(card, allCardsMap);
  if (!rels.blockedBy || rels.blockedBy.length === 0) return [];
  
  const activeBlockers = [];
  for (const b of rels.blockedBy) {
    const blockerCard = allCardsMap[b.id] || Object.values(allCardsMap).find(c => c.shortLink === b.id);
    if (blockerCard && !blockerCard.isDone) {
      activeBlockers.push(b.name || blockerCard.name);
    }
  }
  return activeBlockers;
}

async function manageCardDependencies(results) {
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

  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours() + (now.getMinutes() / 60);
  const isMidShift = (day >= 1 && day <= 5 && hour >= 8.0 && hour < 17.0);

  for (const { boardKey, listMap, cards } of results) {
    if (!listMap.queue || !listMap.waiting) continue;

    // Phase A: Move newly blocked cards from Queue -> Waiting
    const queueCards = cards.filter(c => c.idList === listMap.queue);
    for (const card of queueCards) {
      const blockers = getUnresolvedBlockers(card, allCardsMap);
      if (blockers.length > 0) {
        try {
          await trelloFetch(`/cards/${card.id}`, "PUT", `&idList=${listMap.waiting}`);
          card.idList = listMap.waiting;
          if (allCardsMap[card.id]) allCardsMap[card.id].idList = listMap.waiting;
          console.log(`[Dependency Engine] Moved "${card.name}" to Waiting (Blocked by: ${blockers.join(", ")})`);
        } catch (e) {
          console.error("Failed to move blocked card to Waiting:", card.id, e);
        }
      }
    }

    // Phase B: Differentiated Unblock & Release Logic
    const waitingCards = cards.filter(c => c.idList === listMap.waiting);
    for (const card of waitingCards) {
      const rels = extractCardRelations(card, allCardsMap);
      const hasFormalPrereqs = rels.blockedBy && rels.blockedBy.length > 0;

      if (hasFormalPrereqs) {
        // CASE 1: Formal task dependency (card attachment link)
        // When prerequisite card is completed, UNBLOCK IMMEDIATELY even mid-shift!
        const blockers = getUnresolvedBlockers(card, allCardsMap);
        if (blockers.length === 0) {
          try {
            await trelloFetch(`/cards/${card.id}`, "PUT", `&idList=${listMap.queue}&pos=bottom`);
            card.idList = listMap.queue;
            if (allCardsMap[card.id]) allCardsMap[card.id].idList = listMap.queue;
            console.log(`[Dependency Engine] Prerequisite resolved for "${card.name}". Unblocked immediately to Queue.`);
          } catch (e) {
            console.error("Failed to return unblocked card to Queue:", card.id, e);
          }
        }
      } else {
        // CASE 2: Manual Roadblock Deferral (no formal task links)
        // Keep locked in Waiting during active business hours (8 AM - 5 PM).
        // Only return to Queue at EOD (>= 5:00 PM) or the start of the next morning (< 8:00 AM).
        if (!isMidShift) {
          try {
            await trelloFetch(`/cards/${card.id}`, "PUT", `&idList=${listMap.queue}&pos=bottom`);
            card.idList = listMap.queue;
            if (allCardsMap[card.id]) allCardsMap[card.id].idList = listMap.queue;
            console.log(`[Dependency Engine] EOD / Morning Stage: Returned manual roadblock "${card.name}" to Queue.`);
          } catch (e) {
            console.error("Failed to return manual roadblock card to Queue:", card.id, e);
          }
        }
      }
    }
  }
}

function updateQuickCaptureBlockerDropdown() {
  const sel = document.getElementById("quickCaptureBlockerSelect");
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">None (Independent)</option>' +
    state.allLoadedCards.map(c => `<option value="${c.id}">${escapeHtml(c.boardName)}: ${escapeHtml(c.name)}</option>`).join("");
  sel.value = currentVal;
}

function renderModalBlockers(card) {
  const container = document.getElementById("modalActiveBlockers");
  const select = document.getElementById("modalBlockerSelect");
  if (!container || !select) return;

  const rels = card.relations || { blockedBy: [] };
  if (!rels.blockedBy || rels.blockedBy.length === 0) {
    container.innerHTML = `<div style="font-size:0.72rem; color:var(--muted);">No active blockers. This card is actionable.</div>`;
  } else {
    container.innerHTML = rels.blockedBy.map(b => {
      const removeBtn = b.isAttachment
        ? `<button class="btn" style="padding:1px 6px; font-size:0.65rem; color:var(--high);" onclick="removeAttachmentBlocker('${card.id}', '${b.attachmentId}')">✖</button>`
        : `<span style="font-size:0.62rem; color:var(--muted);">(Power-Up)</span>`;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:4px 8px; border-radius:4px; font-size:0.72rem;">
          <span>🔒 ${escapeHtml(b.name)}</span>
          ${removeBtn}
        </div>
      `;
    }).join("");
  }

  const availableCards = state.allLoadedCards.filter(c => c.id !== card.id);
  select.innerHTML = `<option value="">-- Select Prerequisite Task --</option>` +
    availableCards.map(c => `<option value="${c.id}">${escapeHtml(c.boardName)}: ${escapeHtml(c.name)}</option>`).join("");
}

async function addCardBlocker() {
  if (!state.activeNoteCard) return;
  const cardId = state.activeNoteCard.id;
  const select = document.getElementById("modalBlockerSelect");
  const targetCardId = select.value;
  if (!targetCardId) return alert("Please select a prerequisite task.");

  const targetCard = state.allLoadedCards.find(c => c.id === targetCardId);
  if (!targetCard) return alert("Target card not found.");

  const btn = document.getElementById("addBlockerBtn");
  btn.textContent = "Setting...";
  try {
    const attName = `🔒 Blocked by: ${targetCard.name}`;
    await trelloFetch(`/cards/${cardId}/attachments`, "POST", `&url=${encodeURIComponent(targetCard.shortUrl)}&name=${encodeURIComponent(attName)}`);
    closeNoteModal();
    await syncHud();
  } catch (e) {
    console.error(e);
    alert("Failed to attach blocker to card.");
  } finally {
    btn.textContent = "+ Set Blocker";
  }
}

async function removeAttachmentBlocker(cardId, attachmentId) {
  if (!confirm("Remove this dependency lock?")) return;
  try {
    await trelloFetch(`/cards/${cardId}/attachments/${attachmentId}`, "DELETE");
    closeNoteModal();
    await syncHud();
  } catch (e) {
    console.error(e);
    alert("Failed to remove dependency attachment.");
  }
}

// data/campaignProgress.js

const K = {
  PROG_PREFIX: 'reachpoint.progress.',           // per-campaign object
  SURVEY_PREFIX: 'reachpoint.survey.',           // { [contactId]: {answer, at} }
  SURVEY_CSV: 'reachpoint.surveyCsv.',           // (derived on export)
  OUTCOME_CSV: 'reachpoint.outcomeCsv.',         // (derived on export)
};

/*
  Progress shape:
  {
    campaignId,
    totals: { total, made, answered, missed },
    contacts: {
      [contactId]: {
        attempts,
        outcome,            // 'answered' | 'no_answer' | undefined
        lastCalledAt,       // ms epoch
        surveyAnswer,       // string | undefined
        surveyLogs: [ { answer, at } ],
        notes,              // string (NEW)
        notesLogs: [ { text, at } ] // optional short history (NEW)
      }
    }
  }
*/

// ---- internal helpers ----
function defaultContact() {
  return {
    attempts: 0,
    outcome: undefined,
    lastCalledAt: 0,
    surveyAnswer: undefined,
    surveyLogs: [],
    notes: '',            // NEW
    notesLogs: []         // NEW
  };
}

function saveProgress(p) {
  localStorage.setItem(K.PROG_PREFIX + p.campaignId, JSON.stringify(p));
}

// ---- core API ----
export async function loadOrInitProgress(campaignId, queueIds = []) {
  const raw = localStorage.getItem(K.PROG_PREFIX + campaignId);
  if (raw) return JSON.parse(raw);

  const init = {
    campaignId,
    totals: { total: queueIds.length || 0, made: 0, answered: 0, missed: 0 },
    contacts: {}, // lazily filled
  };
  saveProgress(init);
  return init;
}

export async function recordOutcome(campaignId, contactId, outcome /* 'answered' | 'no_answer' */) {
  const p = await loadOrInitProgress(campaignId, []);
  const c = p.contacts[contactId] || defaultContact();

  c.attempts += 1;
  c.lastCalledAt = Date.now();
  c.outcome = (outcome === 'answered') ? 'answered' : 'no_answer';
  p.contacts[contactId] = c;

  // recompute totals
  const seenIds = Object.keys(p.contacts);
  const made = seenIds.length ? seenIds.reduce((acc, id) => acc + (p.contacts[id].attempts > 0 ? 1 : 0), 0) : 0;
  const answered = seenIds.reduce((acc, id) => acc + (p.contacts[id].outcome === 'answered' ? 1 : 0), 0);
  const missed = seenIds.reduce((acc, id) => acc + (p.contacts[id].outcome === 'no_answer' ? 1 : 0), 0);
  p.totals.made = made; p.totals.answered = answered; p.totals.missed = missed;

  saveProgress(p);
  return p;
}

export async function recordSurveyResponse(campaignId, contactId, answer) {
  const p = await loadOrInitProgress(campaignId, []);
  const c = p.contacts[contactId] || defaultContact();

  c.surveyAnswer = answer;
  c.surveyLogs = c.surveyLogs || [];
  c.surveyLogs.push({ answer, at: Date.now() });

  p.contacts[contactId] = c;
  saveProgress(p);

  // marker (kept from your original code)
  localStorage.setItem(K.SURVEY_PREFIX + campaignId, '1');
  return p;
}

export async function getSurveyResponse(campaignId, contactId) {
  const p = await loadOrInitProgress(campaignId, []);
  return p.contacts?.[contactId]?.surveyAnswer ?? null;
}

export async function getSummary(campaignId) {
  const p = await loadOrInitProgress(campaignId, []);
  return p.totals || { total: 0, made: 0, answered: 0, missed: 0 };
}

// ---- Notes API (NEW) ----
export async function recordNote(campaignId, contactId, text) {
  const p = await loadOrInitProgress(campaignId, []);
  const c = p.contacts[contactId] || defaultContact();

  c.notes = String(text || '');
  c.notesLogs = c.notesLogs || [];
  c.notesLogs.push({ text: c.notes, at: Date.now() });
  if (c.notesLogs.length > 10) c.notesLogs = c.notesLogs.slice(-10); // trim small history

  p.contacts[contactId] = c;
  saveProgress(p);
  return c.notes;
}

export async function getNote(campaignId, contactId) {
  const p = await loadOrInitProgress(campaignId, []);
  return p.contacts?.[contactId]?.notes ?? '';
}

// ---- CSV exports (existing) ----
export async function exportSurveyCSV(campaignId) {
  const p = await loadOrInitProgress(campaignId, []);
  const rows = [['contactId','answer','timestamp']];
  for (const [id, c] of Object.entries(p.contacts)) {
    if (Array.isArray(c.surveyLogs)) {
      for (const log of c.surveyLogs) {
        rows.push([id, String(log.answer ?? ''), new Date(log.at||0).toISOString()]);
      }
    } else if (c.surveyAnswer) {
      rows.push([id, String(c.surveyAnswer), new Date(c.lastCalledAt||0).toISOString()]);
    }
  }
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

export async function exportCallOutcomesCSV(campaignId) {
  const p = await loadOrInitProgress(campaignId, []);
  const rows = [['contactId','outcome','timestamp']];
  for (const [id, c] of Object.entries(p.contacts)) {
    rows.push([id, String(c.outcome ?? ''), new Date(c.lastCalledAt||0).toISOString()]);
  }
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

// (Optional) CSV: notes export
export async function exportNotesCSV(campaignId) {
  const p = await loadOrInitProgress(campaignId, []);
  const rows = [['contactId','notes','lastUpdated']];
  for (const [id, c] of Object.entries(p.contacts)) {
    const last = (c.notesLogs && c.notesLogs[c.notesLogs.length - 1]) || null;
    const at = last?.at || 0;
    rows.push([id, String(c.notes ?? ''), new Date(at).toISOString()]);
  }
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- Dashboard maintenance ----
export async function removeProgress(campaignId) {
  localStorage.removeItem(K.PROG_PREFIX + campaignId);
}

// ---- "Not Called" helpers (NEW) ----

/**
 * Returns IDs from queueIds that have NOT been attempted (attempts == 0 or missing).
 * Keeps queue order so exports can match campaign order if desired.
 */
export async function getNotCalledIds(campaignId, queueIds = []) {
  const p = await loadOrInitProgress(campaignId, queueIds);
  const notCalled = [];
  for (const id of queueIds) {
    const c = p.contacts[id];
    if (!c || !c.attempts) notCalled.push(id);
  }
  return notCalled;
}

/**
 * Build a "Not Called" list with full_name.
 * `resolver` can be:
 *   • function: (id) => studentObj | stringName
 *   • object/map: { [id]: studentObj or nameString }
 * For student objects, we try: full_name, fullName, "Full Name*", or first_name + last_name.
 */
export async function getNotCalled(campaignId, queueIds = [], resolver) {
  const ids = await getNotCalledIds(campaignId, queueIds);
  const rows = ids.map(id => ({ contactId: id, full_name: resolveName(resolver, id) }));
  // Sort by name for nicer display; comment out to preserve queue order.
  rows.sort((a,b) => a.full_name.localeCompare(b.full_name));
  return rows;
}

/**
 * CSV export for Not Called list: "contactId,full_name"
 */
export async function exportNotCalledCSV(campaignId, queueIds = [], resolver) {
  const rows = await getNotCalled(campaignId, queueIds, resolver);
  const csvRows = [['contactId','full_name'], ...rows.map(r => [r.contactId, r.full_name])];
  return csvRows.map(r => r.map(csvEscape).join(',')).join('\n');
}

// ---- local helpers for name resolution ----
function resolveName(resolver, id) {
  if (!resolver) return '';
  if (typeof resolver === 'function') {
    const v = resolver(id);
    return pickName(v);
  }
  if (typeof resolver === 'object') {
    const v = (resolver.get && resolver.get(id)) || resolver[id];
    return pickName(v);
  }
  return '';
}

function pickName(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    const f =
      val.full_name ??
      val.fullName ??
      val['Full Name*'] ??
      joinNames(val.first_name, val.last_name);
    return String(f || '').trim();
  }
  return String(val || '').trim();
}

function joinNames(first, last) {
  const a = String(first || '').trim();
  const b = String(last || '').trim();
  return (a + ' ' + b).trim();
}

const K = {
  PROG_PREFIX: 'reachpoint.progress.',           // per-campaign object
  SURVEY_PREFIX: 'reachpoint.survey.',           // { [contactId]: {answer, at} }
  SURVEY_CSV: 'reachpoint.surveyCsv.',           // (derived on export)
  OUTCOME_CSV: 'reachpoint.outcomeCsv.',         // (derived on export)
};

// progress shape: { campaignId, totals:{total,made,answered, missed}, contacts:{ [id]: { attempts, outcome, lastCalledAt, surveyAnswer, surveyLogs:[] } } }
export async function loadOrInitProgress(campaignId, queueIds) {
  const raw = localStorage.getItem(K.PROG_PREFIX + campaignId);
  if (raw) return JSON.parse(raw);
  const init = {
    campaignId,
    totals: { total: queueIds.length, made: 0, answered: 0, missed: 0 },
    contacts: {}, // lazily filled
  };
  localStorage.setItem(K.PROG_PREFIX + campaignId, JSON.stringify(init));
  return init;
}

function saveProgress(p) {
  localStorage.setItem(K.PROG_PREFIX + p.campaignId, JSON.stringify(p));
}

export async function recordOutcome(campaignId, contactId, outcome /* 'answered' | 'no_answer' */) {
  const p = await loadOrInitProgress(campaignId, []);
  const c = p.contacts[contactId] || { attempts: 0, outcome: undefined, lastCalledAt: 0, surveyAnswer: undefined, surveyLogs: [] };
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
  const c = p.contacts[contactId] || { attempts: 0, outcome: undefined, lastCalledAt: 0, surveyAnswer: undefined, surveyLogs: [] };
  c.surveyAnswer = answer;
  c.surveyLogs = c.surveyLogs || [];
  c.surveyLogs.push({ answer, at: Date.now() });
  p.contacts[contactId] = c;
  saveProgress(p);
  localStorage.setItem(K.SURVEY_PREFIX + campaignId, '1'); // marker
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

/* ---------------- CSV exports ---------------- */
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

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* Utilities for Dashboard delete */
export async function removeProgress(campaignId) {
  localStorage.removeItem(K.PROG_PREFIX + campaignId);
}

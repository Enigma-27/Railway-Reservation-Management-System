/**
 * RRMS passenger area: booking step 3, "Who is travelling?"
 *
 * Self-explanatory passenger step:
 *   - saved passengers with full name, age, gender, berth preference and a concession label
 *   - a visible "Add new passenger" form (concession list and rules come from GET /api/booking-rules)
 *   - the real rules, in plain words, for the chosen quota
 *   - problems the booking would run into, and a per-passenger fare line, from POST /api/bookings/fare-preview
 *     (the numbers are the server's, nothing is calculated here)
 * app.js creates it with createPassengerStep({...}) and calls init() when step 3 opens.
 */

const PROOF_LABELS = {
  RAILWAY_DIVYANGJAN_ID: 'Railway Divyangjan ID',
  UDID: 'UDID card',
  CONCESSION_CERTIFICATE: 'Concession certificate',
  AADHAAR: 'Aadhaar card',
  PAN: 'PAN card',
  PASSPORT: 'Passport',
  VOTER_ID: 'Voter ID',
  DRIVING_LICENSE: 'Driving licence',
  GOVT_ID: 'Government ID',
  SYNTHETIC_TEST_ID: 'Test ID (demo)'
};
// ID types a saved passenger can keep (table SAVED_PASSENGER)
const SAVED_ID_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE', 'GOVT_ID', 'SYNTHETIC_TEST_ID'];
const BERTHS = [
  ['NO_BERTH', 'No preference'], ['LOWER', 'Lower'], ['MIDDLE', 'Middle'], ['UPPER', 'Upper'],
  ['SIDE_LOWER', 'Side lower'], ['SIDE_UPPER', 'Side upper'], ['WINDOW', 'Window'], ['AISLE', 'Aisle']
];
const berthLabel = (v) => (BERTHS.find((b) => b[0] === v) || [v, v || 'No preference'])[1];
const STATUS_WORDS = { CONFIRMED: 'Confirmed', RAC: 'RAC', WAITING_LIST: 'Waiting list', 'NOT AVAILABLE': 'Not available' };

export function createPassengerStep(ctx) {
  const { State, Service, showToast, escapeHtml, formatMoney } = ctx;
  let rules = null;
  let rulesError = null;
  let previewTimer = null;
  let previewSeq = 0;
  let preview = null;
  let previewError = null;
  let keySeq = 0;

  const flow = () => State.bookingFlow;
  const quota = () => (flow().searchParams && flow().searchParams.quota) || 'GENERAL';
  const list = () => flow().selectedPassengers;
  const locked = () => !!flow().pnr;
  const $ = (id) => document.getElementById(id);

  // ───────────────────────────── rules
  async function loadRules() {
    if (rules) return rules;
    try {
      rules = await Service.getBookingRules();
      rulesError = null;
    } catch (err) {
      rulesError = err.message || 'The booking rules could not be loaded.';
    }
    return rules;
  }

  function maxPassengers() {
    if (!rules) return quota() === 'TATKAL' ? 4 : 6;
    return quota() === 'TATKAL' ? rules.limits.maxPassengersTatkal : rules.limits.maxPassengers;
  }

  function seniorAge(gender) {
    if (!rules) return gender === 'FEMALE' ? 45 : 60;
    return gender === 'FEMALE' ? rules.seniorCitizen.minAgeFemale : rules.seniorCitizen.minAgeMale;
  }

  const concessionInfo = (type) => (rules && rules.concessions.find((c) => c.type === type)) || { type, label: type, description: '', proofTypes: [], needsProof: type !== 'NONE' };

  /** The rules in plain words for this booking: always the same ones the API enforces. */
  function renderRules() {
    const box = $('pax-rules');
    if (!box) return;
    if (!rules) {
      box.innerHTML = `<p class="pax-note">${escapeHtml(rulesError || 'Loading the booking rules...')}</p>`;
      return;
    }
    const q = quota();
    const l = rules.limits;
    const items = [
      `<li><strong>Passengers per PNR:</strong> up to <strong>${l.maxPassengers}</strong>${q === 'TATKAL' ? '' : ` (Tatkal: up to ${l.maxPassengersTatkal})`}.${q === 'TATKAL' ? ` <strong>This is a Tatkal booking: up to ${l.maxPassengersTatkal}.</strong>` : ''}</li>`,
      `<li><strong>At least one adult:</strong> every PNR needs a traveller aged ${l.minAdultAge} or more.</li>`,
      `<li><strong>Children:</strong> ${escapeHtml(rules.children.note)}</li>`,
      `<li><strong>Senior citizen:</strong> women aged ${rules.seniorCitizen.minAgeFemale}+ and men aged ${rules.seniorCitizen.minAgeMale}+. ${rules.seniorCitizen.concessionEnabled ? 'The senior concession is on.' : 'The senior concession is switched off at the moment, so seniors pay the full fare.'}</li>`
    ];
    const quotaRule = rules.quotas.find((x) => x.quota === q);
    if (q === 'TATKAL') {
      items.push(`<li><strong>Tatkal rules:</strong><ul>${rules.tatkal.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul></li>`);
    } else if (quotaRule && q !== 'GENERAL') {
      items.push(`<li><strong>${escapeHtml(quotaRule.label)} quota:</strong> ${escapeHtml(quotaRule.rule)}</li>`);
    }
    box.innerHTML = `<ul class="pax-rule-list">${items.join('')}</ul>`;
  }

  // ───────────────────────────── saved passengers
  function savedLabel(p) {
    if (p.disabilityType && p.disabilityType !== 'NONE') return `Divyaang concession possible (${String(p.disabilityType).toLowerCase()})`;
    if (Number(p.age) >= seniorAge(p.gender)) return rules && rules.seniorCitizen.concessionEnabled ? 'Senior citizen concession possible' : 'Senior citizen (concession is off)';
    return 'No concession';
  }

  function renderSaved() {
    const box = $('saved-pax-list');
    if (!box) return;
    if (locked()) { box.innerHTML = ''; return; }
    if (!State.savedPassengers || State.savedPassengers.length === 0) {
      box.innerHTML = '<p class="pax-note">You have no saved passengers yet. Use the form below, and tick "Save for next time" to keep a traveller.</p>';
      return;
    }
    box.innerHTML = State.savedPassengers.map((p) => {
      const checked = list().some((s) => s.passengerId === p.passengerId);
      return `
        <label class="pax-saved-row">
          <input type="checkbox" data-saved-id="${Number(p.passengerId)}" ${checked ? 'checked' : ''} aria-label="Add ${escapeHtml(p.name)}">
          <span class="pax-saved-text">
            <strong class="pax-fullname">${escapeHtml(p.name)}</strong>
            <span class="pax-meta">${escapeHtml(p.age)} years, ${escapeHtml(String(p.gender).toLowerCase())} · Berth: ${escapeHtml(berthLabel(p.berthPreference))}</span>
            <span class="pax-meta pax-conc">${escapeHtml(savedLabel(p))}</span>
          </span>
        </label>`;
    }).join('');
  }

  // ───────────────────────────── add a traveller
  function addTraveller(t) {
    if (list().length >= maxPassengers()) {
      showToast(`At most ${maxPassengers()} passengers on one PNR${quota() === 'TATKAL' ? ' (Tatkal)' : ''}.`, 'warning');
      return false;
    }
    list().push({ key: `t${++keySeq}`, passengerId: null, berthPreference: 'NO_BERTH', concessionType: 'NONE', idProofType: '', idProofReference: '', disabilityType: 'NONE', ...t });
    return true;
  }

  function toggleSaved(id, checked) {
    if (locked()) return;
    if (checked) {
      const p = State.savedPassengers.find((s) => s.passengerId === id);
      if (!p || list().some((s) => s.passengerId === id)) return;
      const divy = p.disabilityType && p.disabilityType !== 'NONE';
      const ok = addTraveller({
        passengerId: p.passengerId, name: p.name, age: Number(p.age), gender: p.gender,
        berthPreference: p.berthPreference || 'NO_BERTH',
        concessionType: divy ? 'DIVYAANG' : 'NONE', disabilityType: p.disabilityType || 'NONE'
      });
      if (!ok) renderSaved();
    } else {
      flow().selectedPassengers = list().filter((s) => s.passengerId !== id);
    }
    refresh();
  }

  function readNewForm() {
    const v = (id) => ($(id) ? $(id).value : '');
    return {
      name: v('np-name').trim(), age: v('np-age').trim(), gender: v('np-gender'), berthPreference: v('np-berth'),
      concessionType: v('np-concession'), idProofType: v('np-id-type'), idProofReference: v('np-id-ref').trim(),
      disabilityType: v('np-disability'), save: $('np-save') && $('np-save').checked,
      saveIdType: v('np-save-id-type'), saveIdRef: v('np-save-id-ref').trim()
    };
  }

  /** Fields of the add form that depend on other fields: concession proof, disability, the ID kept when saving. */
  function syncNewForm() {
    const f = readNewForm();
    const info = concessionInfo(f.concessionType);
    const proofRow = $('np-proof-row');
    if (proofRow) {
      proofRow.hidden = f.concessionType === 'NONE';
      const sel = $('np-id-type');
      if (sel && f.concessionType !== 'NONE') {
        const current = sel.value;
        sel.innerHTML = info.proofTypes.map((p) => `<option value="${p}">${escapeHtml(PROOF_LABELS[p] || p)}</option>`).join('');
        if (info.proofTypes.includes(current)) sel.value = current;
      }
    }
    const desc = $('np-conc-desc');
    if (desc) desc.textContent = info.description || '';
    const dis = $('np-disability-row');
    if (dis) dis.hidden = f.concessionType !== 'DIVYAANG';
    // Saving needs a general ID. When the concession proof is not a general ID (a disability proof), ask for one more.
    const saveRow = $('np-save-id-row');
    if (saveRow) {
      const needs = f.save && !(f.concessionType !== 'NONE' && SAVED_ID_TYPES.includes(f.idProofType) && f.idProofReference);
      saveRow.hidden = !needs;
    }
  }

  async function submitNewForm() {
    if (locked()) return;
    const f = readNewForm();
    const age = parseInt(f.age, 10);
    const errs = [];
    if (f.name.length < 2) errs.push('Enter the full name of the traveller.');
    if (!Number.isInteger(age) || age < 0 || age > 125) errs.push('Enter an age between 0 and 125.');
    if (f.concessionType !== 'NONE' && (!f.idProofType || !f.idProofReference)) errs.push('A concession needs an ID proof type and number.');
    const needSavedId = f.save && !(f.concessionType !== 'NONE' && SAVED_ID_TYPES.includes(f.idProofType) && f.idProofReference);
    if (needSavedId && (!f.saveIdType || !f.saveIdRef)) errs.push('To save this traveller, enter an ID proof type and number.');
    const errBox = $('np-errors');
    if (errs.length) {
      if (errBox) { errBox.innerHTML = errs.map((e) => `<li>${escapeHtml(e)}</li>`).join(''); errBox.hidden = false; }
      return;
    }
    if (errBox) errBox.hidden = true;

    let savedId = null;
    if (f.save) {
      const idType = needSavedId ? f.saveIdType : f.idProofType;
      const idRef = needSavedId ? f.saveIdRef : f.idProofReference;
      try {
        const saved = await Service.savePassenger({
          name: f.name, age, gender: f.gender, idProofType: idType, idProofReference: idRef,
          disabilityType: f.concessionType === 'DIVYAANG' ? (f.disabilityType || 'ORTHOPEDIC') : 'NONE',
          berthPreference: f.berthPreference
        });
        savedId = saved.passengerId;
        State.savedPassengers = [...State.savedPassengers, saved];
        showToast(`${f.name} was saved for next time.`, 'success');
      } catch (err) {
        showToast(`${f.name} could not be saved: ${err.message}. The traveller is still added to this booking.`, 'warning');
      }
    }
    const ok = addTraveller({
      passengerId: savedId, name: f.name, age, gender: f.gender, berthPreference: f.berthPreference,
      concessionType: f.concessionType, idProofType: f.concessionType !== 'NONE' ? f.idProofType : '',
      idProofReference: f.concessionType !== 'NONE' ? f.idProofReference : '', disabilityType: f.disabilityType
    });
    if (!ok) return;
    $('np-form').reset();
    syncNewForm();
    refresh();
  }

  // ───────────────────────────── travellers in this booking
  function renderTravellers() {
    const box = $('selected-pax-list');
    const title = $('selected-pax-title');
    if (title) title.textContent = `Travellers on this booking (${list().length} of ${maxPassengers()})`;
    if (!box) return;
    if (!list().length) {
      box.innerHTML = '<p class="pax-note">Nobody added yet. Tick a saved passenger or fill in the form above.</p>';
      return;
    }
    const lines = (preview && preview.passengers) || [];
    box.innerHTML = list().map((t, i) => {
      const info = concessionInfo(t.concessionType);
      const line = lines.find((l) => l.index === i);
      const concOptions = (rules ? rules.concessions : [{ type: 'NONE', label: 'No concession' }])
        .map((c) => `<option value="${c.type}" ${c.type === t.concessionType ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
      const proofOptions = (info.proofTypes || []).map((p) => `<option value="${p}" ${p === t.idProofType ? 'selected' : ''}>${escapeHtml(PROOF_LABELS[p] || p)}</option>`).join('');
      return `
        <div class="pax-row" data-key="${t.key}">
          <div class="pax-row-head">
            <div>
              <strong class="pax-fullname">${i + 1}. ${escapeHtml(t.name)}</strong>
              <span class="pax-meta">${escapeHtml(t.age)} years, ${escapeHtml(String(t.gender).toLowerCase())} · Berth: ${escapeHtml(berthLabel(t.berthPreference))}</span>
            </div>
            ${locked() ? '' : `<button type="button" class="btn-secondary-sm pax-remove" data-remove="${t.key}" aria-label="Remove ${escapeHtml(t.name)}">Remove</button>`}
          </div>
          <div class="pax-row-grid">
            <label class="pax-field">Concession
              <select class="form-select" data-conc="${t.key}" ${locked() ? 'disabled' : ''}>${concOptions}</select>
            </label>
            ${t.concessionType !== 'NONE' ? `
              <label class="pax-field">Proof type
                <select class="form-select" data-proof-type="${t.key}" ${locked() ? 'disabled' : ''}><option value="">Choose</option>${proofOptions}</select>
              </label>
              <label class="pax-field">Proof number
                <input type="text" class="form-input" maxlength="64" data-proof-ref="${t.key}" value="${escapeHtml(t.idProofReference)}" ${locked() ? 'disabled' : ''}>
              </label>` : ''}
          </div>
          <p class="pax-meta">${escapeHtml(info.description || '')}</p>
          ${line ? `<p class="pax-fareline">Fare for ${escapeHtml(t.name)}: <strong>${formatMoney(line.totalFare)}</strong> · Likely status: <strong>${escapeHtml(STATUS_WORDS[line.projectedStatus] || line.projectedStatus)}</strong></p>` : ''}
        </div>`;
    }).join('');
  }

  // ───────────────────────────── problems (the same checks the API makes)
  function localProblems() {
    const out = [];
    const l = list();
    const q = quota();
    if (l.length === 0) return out;
    if (l.length > maxPassengers()) out.push(`Too many travellers: at most ${maxPassengers()} on one PNR${q === 'TATKAL' ? ' (Tatkal)' : ''}. Remove ${l.length - maxPassengers()}.`);
    if (!l.some((t) => Number(t.age) >= 18)) out.push('Add at least one traveller aged 18 or more.');
    l.forEach((t) => {
      if (t.concessionType !== 'NONE' && (!t.idProofType || !t.idProofReference)) out.push(`${t.name}: a concession needs a proof type and a proof number.`);
      if (q === 'LADIES' && Number(t.age) >= 12 && t.gender !== 'FEMALE') out.push(`${t.name}: the Ladies quota is for women. Only children under 12 may be of any gender.`);
      if (q === 'SENIOR_CITIZEN' && Number(t.age) < seniorAge(t.gender)) out.push(`${t.name}: the Senior citizen quota needs age ${seniorAge('FEMALE')}+ for women and ${seniorAge('MALE')}+ for men.`);
      if (q === 'DIVYAANG' && (!t.idProofType || !t.idProofReference)) out.push(`${t.name}: the Divyaang quota needs a disability proof (type and number).`);
    });
    return out;
  }

  function currentProblems() {
    const problems = localProblems();
    if (preview && preview.errors) {
      for (const e of preview.errors) {
        const msg = e.message;
        if (!problems.some((p) => p.toLowerCase().includes(msg.toLowerCase().slice(0, 25)))) problems.push(msg);
      }
    }
    return problems;
  }

  function renderProblems() {
    const box = $('pax-problems');
    if (!box) return;
    const problems = locked() ? [] : currentProblems();
    const warnings = (preview && preview.warnings) || [];
    if (!problems.length && !warnings.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML =
      (problems.length ? `<div class="pax-problems-box" role="alert"><strong>Fix this before you continue:</strong><ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>` : '') +
      (warnings.length ? `<div class="pax-warnings-box"><strong>Good to know:</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul></div>` : '');
  }

  // ───────────────────────────── fare preview (server numbers)
  function previewPayload() {
    const f = flow();
    return {
      trainId: f.selectedTrain.trainId, journeyDate: f.searchParams.date,
      boardingStationId: f.searchParams.fromId, destinationStationId: f.searchParams.toId,
      classType: f.selectedClass, quota: quota(),
      passengers: list().map((t) => ({ name: t.name, age: Number(t.age), gender: t.gender, concessionType: t.concessionType, idProofType: t.idProofType, idProofReference: t.idProofReference }))
    };
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    if (locked() || !flow().selectedTrain || !list().length) { preview = null; renderPreview(); return; }
    previewTimer = setTimeout(async () => {
      const seq = ++previewSeq;
      try {
        const res = await Service.farePreview(previewPayload());
        if (seq !== previewSeq) return;
        preview = res; previewError = null;
      } catch (err) {
        if (seq !== previewSeq) return;
        preview = null; previewError = err.message || 'The fare could not be shown.';
      }
      renderPreview();
      renderTravellers();
      renderProblems();
      updateProceed();
    }, 300);
  }

  function renderPreview() {
    const box = $('fare-preview-box');
    if (!box) return;
    if (locked()) { box.innerHTML = '<p class="pax-note">Seats are on hold. The final fare is on the next step.</p>'; return; }
    if (!list().length) { box.innerHTML = '<p class="pax-note">Add a traveller to see the fare.</p>'; return; }
    if (previewError) { box.innerHTML = `<p class="pax-note">${escapeHtml(previewError)}</p>`; return; }
    if (!preview) { box.innerHTML = '<p class="pax-note">Calculating the fare...</p>'; return; }
    const rows = preview.passengers.map((p) => {
      const parts = [
        ['Base fare', p.baseFare], ['Concession discount', -p.concessionDiscount, p.concessionDiscount === 0],
        ['Reservation charge', p.reservationCharge], ['Superfast charge', p.superfastCharge, p.superfastCharge === 0],
        ['Tatkal charge', p.tatkalCharge, p.tatkalCharge === 0], ['Dynamic surcharge', p.dynamicSurcharge, p.dynamicSurcharge === 0],
        ['GST', p.gst], ['Travel insurance', p.insurance]
      ].filter((x) => !x[2]);
      return `
        <div class="fare-pax">
          <div class="fare-pax-head"><strong>${escapeHtml(p.name || `Traveller ${p.index + 1}`)}</strong><span>${formatMoney(p.totalFare)}</span></div>
          ${parts.map((x) => `<div class="fare-row"><span class="fare-label">${x[0]}</span><span class="fare-amount ${x[1] < 0 ? 'fare-discount' : ''}">${x[1] < 0 ? '-' : ''}${formatMoney(Math.abs(x[1]))}</span></div>`).join('')}
        </div>`;
    }).join('');
    box.innerHTML = `${rows}<div class="fare-total"><span>Total (preview)</span><span class="fare-total-amount">${formatMoney(preview.totalFare)}</span></div><p class="pax-note">${escapeHtml(preview.note)}</p>`;
  }

  function updateProceed() {
    const btn = $('pax-proceed-btn');
    if (!btn) return;
    const problems = currentProblems();
    const blocked = !locked() && (list().length === 0 || problems.length > 0);
    btn.disabled = blocked;
    btn.title = blocked ? (list().length === 0 ? 'Add at least one traveller first.' : 'Fix the problems above first.') : '';
    const hint = $('pax-proceed-hint');
    if (hint) hint.textContent = blocked ? (list().length === 0 ? 'Add at least one traveller to continue.' : 'Fix the problems above to continue.') : '';
  }

  function refresh() {
    renderSaved();
    renderTravellers();
    renderProblems();
    renderPreview();
    updateProceed();
    schedulePreview();
  }

  // ───────────────────────────── wiring (event delegation, set up once)
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const step = $('booking-step-3');
    step.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('input[data-saved-id]')) return toggleSaved(Number(t.dataset.savedId), t.checked);
      if (t.matches('select[data-conc]')) {
        const row = list().find((x) => x.key === t.dataset.conc);
        if (row) { row.concessionType = t.value; row.idProofType = ''; row.idProofReference = ''; refresh(); }
        return;
      }
      if (t.matches('select[data-proof-type]')) {
        const row = list().find((x) => x.key === t.dataset.proofType);
        if (row) { row.idProofType = t.value; refresh(); }
        return;
      }
      if (t.closest('#np-form')) syncNewForm();
    });
    step.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('input[data-proof-ref]')) {
        const row = list().find((x) => x.key === t.dataset.proofRef);
        if (row) { row.idProofReference = t.value.trim(); renderProblems(); updateProceed(); schedulePreview(); }
      } else if (t.closest('#np-form')) syncNewForm();
    });
    step.addEventListener('click', (e) => {
      const rm = e.target.closest('button[data-remove]');
      if (rm && !locked()) {
        const row = list().find((x) => x.key === rm.dataset.remove);
        flow().selectedPassengers = list().filter((x) => x.key !== rm.dataset.remove);
        if (row && row.passengerId) { const chk = step.querySelector(`input[data-saved-id="${row.passengerId}"]`); if (chk) chk.checked = false; }
        refresh();
      }
    });
    $('np-form').addEventListener('submit', (e) => { e.preventDefault(); submitNewForm(); });
  }

  async function init() {
    wire();
    const user = State.user || {};
    $('pax-booking-as').innerHTML = `You are booking as <strong>${escapeHtml(user.name || 'your account')}</strong>. Add one row per traveller.`;
    const lockedNow = locked();
    $('np-card').hidden = lockedNow;
    $('saved-card').hidden = lockedNow;
    await loadRules();
    // Ask for the quota's limit in the note under the form and fill the berth list
    $('np-berth').innerHTML = BERTHS.map((b) => `<option value="${b[0]}">${b[1]}</option>`).join('');
    const concList = rules ? rules.concessions : [{ type: 'NONE', label: 'No concession' }];
    $('np-concession').innerHTML = concList.map((c) => `<option value="${c.type}">${escapeHtml(c.label)}</option>`).join('');
    $('np-save-id-type').innerHTML = SAVED_ID_TYPES.map((p) => `<option value="${p}">${escapeHtml(PROOF_LABELS[p])}</option>`).join('');
    syncNewForm();
    renderRules();
    refresh();
  }

  return {
    init,
    canProceed: () => locked() || (list().length > 0 && currentProblems().length === 0),
    problems: currentProblems,
    refresh
  };
}

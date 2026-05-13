import { CONFIG } from './config.js';
import { rgbToHex, hexToRgb } from './lineage.js';
import { setModalOpen } from './tools.js';

function showBackdrop(modalId) {
  document.getElementById('modal-backdrop').classList.remove('hidden');
  for (const m of document.querySelectorAll('#modal-backdrop .modal')) {
    m.classList.toggle('hidden', m.id !== modalId);
  }
  setModalOpen(true);
}

function hideBackdrop() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  setModalOpen(false);
}

// Switches a modal between "create" and "edit" labels and hides any
// .create-only rows when editing. Inputs use data-h2-* and data-hint-*
// attributes to swap heading + hint text.
function setModalMode(modalEl, mode, primaryBtnText) {
  modalEl.classList.toggle('mode-edit', mode === 'edit');
  const h2 = modalEl.querySelector('h2');
  if (h2) {
    const t = mode === 'edit' ? h2.dataset.h2Edit : h2.dataset.h2Create;
    if (t) h2.textContent = t;
  }
  const hint = modalEl.querySelector('.modal-hint');
  if (hint) {
    const t = mode === 'edit' ? hint.dataset.hintEdit : hint.dataset.hintCreate;
    if (t) hint.textContent = t;
  }
  const primary = modalEl.querySelector('.btn-primary');
  if (primary && primaryBtnText) primary.textContent = primaryBtnText;
}

// Opens the new-house modal pre-filled with suggested defaults. On confirm,
// invokes onConfirm with the parsed form data (including [r,g,b] color and
// the Set of extra-allowed lineage ids). On cancel, invokes onCancel.
//
// `existingLineages` is an iterable of Lineage objects already in the world.
// One checkbox per existing lineage is rendered in the "access" section.
// The lineage being created is always implicitly allowed by the caller.
export function showHouseModal(suggested, existingLineages, onConfirm, onCancel, editing = null) {
  const modalEl = document.getElementById('house-modal');
  const form = document.getElementById('house-form');
  const d = CONFIG.houseDefaults;
  const mode = editing ? 'edit' : 'create';
  setModalMode(modalEl, mode, editing ? 'save' : 'create');

  // Edit mode lists every lineage EXCEPT the home one (which is always
  // allowed by construction). Pre-tick the lineages already in the set.
  const homeLin = editing ? existingLineages.find((l) => l.id === editing.lineageId) : null;
  const accessLineages = editing
    ? [...existingLineages].filter((l) => l.id !== editing.lineageId)
    : [...existingLineages];
  renderAccessList('access-list', accessLineages, editing ? editing.allowedLineages : null);

  if (editing) {
    form.elements['name'].value = homeLin ? homeLin.name : '';
    form.elements['color'].value = rgbToHex(homeLin ? homeLin.color : [127, 169, 255]);
    form.elements['founders'].value = d.founders; // unused in edit
    form.elements['foodDensity'].value = editing.zone.foodDensity;
    form.elements['foodEnergy'].value = editing.zone.foodEnergy;
    form.elements['decayMult'].value = editing.zone.decayMultiplier;
    form.elements['predatorsAllowed'].checked = !!editing.zone.predatorsAllowed;
    form.elements['gradualReduction'].checked = !!editing.zone.gradualReduction;
    form.elements['reductionIntervalDays'].value = editing.zone.reductionIntervalDays ?? d.reductionIntervalDays;
    form.elements['foodDensityFloor'].value = editing.zone.foodDensityFloor ?? d.foodDensityFloor;
    form.elements['persistence'].checked = !!editing.zone.persistence;
    form.elements['transFromInside'].checked = !!editing.barrier.transparentFromInside;
    form.elements['transFromOutside'].checked = !!editing.barrier.transparentFromOutside;
  } else {
    form.elements['name'].value = suggested.name || '';
    form.elements['color'].value = rgbToHex(suggested.color || [127, 169, 255]);
    form.elements['founders'].value = d.founders;
    form.elements['foodDensity'].value = d.foodDensity;
    form.elements['foodEnergy'].value = d.foodEnergy;
    form.elements['decayMult'].value = d.decayMultiplier;
    form.elements['predatorsAllowed'].checked = d.predatorsAllowed;
    form.elements['gradualReduction'].checked = d.gradualReduction;
    form.elements['reductionIntervalDays'].value = d.reductionIntervalDays;
    form.elements['foodDensityFloor'].value = d.foodDensityFloor;
    form.elements['persistence'].checked = d.persistence;
    form.elements['transFromInside'].checked = d.transparentFromInside;
    form.elements['transFromOutside'].checked = d.transparentFromOutside;
  }

  showBackdrop('house-modal');
  if (!editing) {
    requestAnimationFrame(() => form.elements['name'].focus());
  }

  const submit = (e) => {
    e.preventDefault();
    const allowedLineages = new Set();
    document.querySelectorAll('#access-list input[type="checkbox"]:checked')
      .forEach((cb) => allowedLineages.add(parseInt(cb.dataset.lineageId, 10)));
    const data = {
      name: form.elements['name'].value.trim() || suggested.name || 'unnamed',
      color: hexToRgb(form.elements['color'].value),
      founders: clampInt(form.elements['founders'].value, 1, 100, d.founders),
      foodDensity: clampNum(form.elements['foodDensity'].value, 0, 50, d.foodDensity),
      foodEnergy: clampNum(form.elements['foodEnergy'].value, 1, 200, d.foodEnergy),
      decayMultiplier: clampNum(form.elements['decayMult'].value, 0, 5, d.decayMultiplier),
      predatorsAllowed: form.elements['predatorsAllowed'].checked,
      gradualReduction: form.elements['gradualReduction'].checked,
      reductionIntervalDays: clampInt(form.elements['reductionIntervalDays'].value, 1, 365, d.reductionIntervalDays),
      foodDensityFloor: clampNum(form.elements['foodDensityFloor'].value, 0, 50, d.foodDensityFloor),
      persistence: form.elements['persistence'].checked,
      transparentFromInside: form.elements['transFromInside'].checked,
      transparentFromOutside: form.elements['transFromOutside'].checked,
      allowedLineages,
    };
    cleanup();
    onConfirm(data);
  };

  const cancel = () => {
    cleanup();
    if (onCancel) onCancel();
  };

  const cancelBtn = document.getElementById('btn-modal-cancel');

  function cleanup() {
    hideBackdrop();
    form.removeEventListener('submit', submit);
    cancelBtn.removeEventListener('click', cancel);
  }

  form.addEventListener('submit', submit);
  cancelBtn.addEventListener('click', cancel);
}

// Opens the new-barrier modal. Allowed lineages start unticked: by default
// a barrier blocks every lineage.
export function showBarrierModal(existingLineages, onConfirm, onCancel, editing = null) {
  const modalEl = document.getElementById('barrier-modal');
  const form = document.getElementById('barrier-form');
  const d = CONFIG.barrierDefaults;
  setModalMode(modalEl, editing ? 'edit' : 'create', editing ? 'save' : 'create');

  renderAccessList('barrier-access-list', [...existingLineages], editing ? editing.allowedLineages : null);

  if (editing) {
    form.elements['color'].value = rgbToHex(editing.color);
    form.elements['thickness'].value = editing.thickness;
    form.elements['transFromSideA'].checked = !!editing.transparentFromSideA;
    form.elements['transFromSideB'].checked = !!editing.transparentFromSideB;
  } else {
    form.elements['color'].value = rgbToHex(d.color);
    form.elements['thickness'].value = d.thickness;
    form.elements['transFromSideA'].checked = d.transparentFromSideA;
    form.elements['transFromSideB'].checked = d.transparentFromSideB;
  }

  showBackdrop('barrier-modal');

  const submit = (e) => {
    e.preventDefault();
    const allowedLineages = new Set();
    document.querySelectorAll('#barrier-access-list input[type="checkbox"]:checked')
      .forEach((cb) => allowedLineages.add(parseInt(cb.dataset.lineageId, 10)));
    const data = {
      color: hexToRgb(form.elements['color'].value),
      thickness: clampInt(form.elements['thickness'].value, 1, 20, d.thickness),
      transparentFromSideA: form.elements['transFromSideA'].checked,
      transparentFromSideB: form.elements['transFromSideB'].checked,
      allowedLineages,
    };
    cleanup();
    onConfirm(data);
  };

  const cancel = () => {
    cleanup();
    if (onCancel) onCancel();
  };

  const cancelBtn = document.getElementById('btn-barrier-cancel');

  function cleanup() {
    hideBackdrop();
    form.removeEventListener('submit', submit);
    cancelBtn.removeEventListener('click', cancel);
  }

  form.addEventListener('submit', submit);
  cancelBtn.addEventListener('click', cancel);
}

// Opens the new-zone modal. Zones have no name/colour-coded lineage; if no
// access checkboxes are ticked, the zone is open to everyone.
export function showZoneModal(existingLineages, onConfirm, onCancel, editing = null) {
  const modalEl = document.getElementById('zone-modal');
  const form = document.getElementById('zone-form');
  const d = CONFIG.zoneDefaults;
  setModalMode(modalEl, editing ? 'edit' : 'create', editing ? 'save' : 'create');

  renderAccessList('zone-access-list', [...existingLineages], editing ? editing.allowedLineages : null);

  if (editing) {
    form.elements['color'].value = rgbToHex(editing.color);
    form.elements['foodDensity'].value = editing.zone.foodDensity;
    form.elements['foodEnergy'].value = editing.zone.foodEnergy;
    form.elements['decayMult'].value = editing.zone.decayMultiplier;
    form.elements['predatorsAllowed'].checked = !!editing.zone.predatorsAllowed;
  } else {
    form.elements['color'].value = rgbToHex(d.color);
    form.elements['foodDensity'].value = d.foodDensity;
    form.elements['foodEnergy'].value = d.foodEnergy;
    form.elements['decayMult'].value = d.decayMultiplier;
    form.elements['predatorsAllowed'].checked = d.predatorsAllowed;
  }

  showBackdrop('zone-modal');

  const submit = (e) => {
    e.preventDefault();
    const allowedLineages = new Set();
    document.querySelectorAll('#zone-access-list input[type="checkbox"]:checked')
      .forEach((cb) => allowedLineages.add(parseInt(cb.dataset.lineageId, 10)));
    const data = {
      color: hexToRgb(form.elements['color'].value),
      foodDensity: clampNum(form.elements['foodDensity'].value, 0, 50, d.foodDensity),
      foodEnergy: clampNum(form.elements['foodEnergy'].value, 1, 200, d.foodEnergy),
      decayMultiplier: clampNum(form.elements['decayMult'].value, 0, 5, d.decayMultiplier),
      predatorsAllowed: form.elements['predatorsAllowed'].checked,
      allowedLineages,
    };
    cleanup();
    onConfirm(data);
  };

  const cancel = () => {
    cleanup();
    if (onCancel) onCancel();
  };

  const cancelBtn = document.getElementById('btn-zone-cancel');

  function cleanup() {
    hideBackdrop();
    form.removeEventListener('submit', submit);
    cancelBtn.removeEventListener('click', cancel);
  }

  form.addEventListener('submit', submit);
  cancelBtn.addEventListener('click', cancel);
}

function renderAccessList(hostId, lineages, preChecked = null) {
  const host = document.getElementById(hostId);
  host.innerHTML = '';
  if (lineages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'access-empty';
    empty.textContent = 'no other lineages yet.';
    host.appendChild(empty);
    return;
  }
  for (const lin of lineages) {
    const row = document.createElement('label');
    row.className = 'access-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.lineageId = String(lin.id);
    if (preChecked && preChecked.has(lin.id)) cb.checked = true;
    const swatch = document.createElement('span');
    swatch.className = 'access-swatch';
    swatch.style.background = `rgb(${lin.color[0]}, ${lin.color[1]}, ${lin.color[2]})`;
    const name = document.createElement('span');
    name.textContent = lin.name;
    row.appendChild(cb);
    row.appendChild(swatch);
    row.appendChild(name);
    host.appendChild(row);
  }
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function clampNum(v, lo, hi, fallback) {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

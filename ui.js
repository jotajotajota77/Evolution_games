import { CONFIG } from './config.js';
import { rgbToHex, hexToRgb } from './lineage.js';
import { setModalOpen } from './tools.js';

// Opens the new-house modal pre-filled with suggested defaults. On confirm,
// invokes onConfirm with the parsed form data (including [r,g,b] color).
// On cancel, invokes onCancel.
export function showHouseModal(suggested, onConfirm, onCancel) {
  const backdrop = document.getElementById('modal-backdrop');
  const form = document.getElementById('house-form');
  const d = CONFIG.houseDefaults;

  form.elements['name'].value = suggested.name || '';
  form.elements['color'].value = rgbToHex(suggested.color || [127, 169, 255]);
  form.elements['founders'].value = d.founders;
  form.elements['foodDensity'].value = d.foodDensity;
  form.elements['foodEnergy'].value = d.foodEnergy;
  form.elements['decayMult'].value = d.decayMultiplier;
  form.elements['predatorsAllowed'].checked = d.predatorsAllowed;
  form.elements['transFromInside'].checked = d.transparentFromInside;
  form.elements['transFromOutside'].checked = d.transparentFromOutside;

  backdrop.classList.remove('hidden');
  setModalOpen(true);
  // Defer focus so the modal is laid out first (avoids jumpy autoscroll).
  requestAnimationFrame(() => form.elements['name'].focus());

  const submit = (e) => {
    e.preventDefault();
    const data = {
      name: form.elements['name'].value.trim() || suggested.name || 'unnamed',
      color: hexToRgb(form.elements['color'].value),
      founders: clampInt(form.elements['founders'].value, 1, 100, d.founders),
      foodDensity: clampNum(form.elements['foodDensity'].value, 0, 50, d.foodDensity),
      foodEnergy: clampNum(form.elements['foodEnergy'].value, 1, 200, d.foodEnergy),
      decayMultiplier: clampNum(form.elements['decayMult'].value, 0, 5, d.decayMultiplier),
      predatorsAllowed: form.elements['predatorsAllowed'].checked,
      transparentFromInside: form.elements['transFromInside'].checked,
      transparentFromOutside: form.elements['transFromOutside'].checked,
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
    backdrop.classList.add('hidden');
    setModalOpen(false);
    form.removeEventListener('submit', submit);
    cancelBtn.removeEventListener('click', cancel);
  }

  form.addEventListener('submit', submit);
  cancelBtn.addEventListener('click', cancel);
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

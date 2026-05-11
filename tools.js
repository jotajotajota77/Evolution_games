import { CONFIG } from './config.js';

// Tool / mouse state shared between the p5 sketch (which receives the events)
// and main.js (which wires creation callbacks).
const state = {
  current: 'select',
  modalOpen: false,
  drag: null,      // { startX, startY, currentX, currentY } while placing
};

const listeners = {
  onPlaceHouse: null, // (x, y, radius) => void
  onToolChange: null, // (toolName) => void
};

export function setTool(name) {
  if (state.current === name) return;
  state.current = name;
  state.drag = null;
  if (listeners.onToolChange) listeners.onToolChange(name);
}

export function getTool() {
  return state.current;
}

export function setModalOpen(open) {
  state.modalOpen = open;
  if (open) state.drag = null;
}

export function isModalOpen() {
  return state.modalOpen;
}

export function onPlaceHouse(cb) {
  listeners.onPlaceHouse = cb;
}

export function onToolChange(cb) {
  listeners.onToolChange = cb;
}

// --- Mouse handlers wired by main.js into the p5 sketch ---
export function onMouseDown(x, y) {
  if (state.modalOpen) return;
  if (state.current === 'house') {
    state.drag = { startX: x, startY: y, currentX: x, currentY: y };
  }
}

export function onMouseMove(x, y) {
  if (state.drag) {
    state.drag.currentX = x;
    state.drag.currentY = y;
  }
}

export function onMouseUp() {
  if (state.drag && state.current === 'house') {
    const dx = state.drag.currentX - state.drag.startX;
    const dy = state.drag.currentY - state.drag.startY;
    const raw = Math.hypot(dx, dy);
    const radius = Math.max(CONFIG.houseMinRadius, Math.min(CONFIG.houseMaxRadius, raw));
    if (raw >= CONFIG.houseMinRadius / 2 && listeners.onPlaceHouse) {
      listeners.onPlaceHouse(state.drag.startX, state.drag.startY, radius);
    }
    state.drag = null;
  }
}

export function getDrag() {
  return state.drag;
}

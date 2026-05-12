import { CONFIG } from './config.js';

// Tool / mouse state shared between the p5 sketch (which receives the events)
// and main.js (which wires creation callbacks).
const state = {
  current: 'select',
  modalOpen: false,
  drag: null,      // { startX, startY, currentX, currentY } while placing
};

const listeners = {
  onPlaceHouse:   null, // (x, y, radius) => void
  onPlaceZone:    null, // (x, y, radius) => void
  onPlaceBarrier: null, // (x1, y1, x2, y2) => void
  onErase:        null, // (x, y) => void
  onEdit:         null, // (x, y) => void
  onToolChange:   null, // (toolName) => void
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

export function onPlaceZone(cb) {
  listeners.onPlaceZone = cb;
}

export function onPlaceBarrier(cb) {
  listeners.onPlaceBarrier = cb;
}

export function onErase(cb) {
  listeners.onErase = cb;
}

export function onEdit(cb) {
  listeners.onEdit = cb;
}

export function onToolChange(cb) {
  listeners.onToolChange = cb;
}

// --- Mouse handlers wired by main.js into the p5 sketch ---
export function onMouseDown(x, y) {
  if (state.modalOpen) return;
  if (state.current === 'house' || state.current === 'zone' || state.current === 'barrier') {
    // Snapshot the active tool on the drag so a quick mid-drag tool switch
    // doesn't reroute the placement.
    state.drag = { startX: x, startY: y, currentX: x, currentY: y, tool: state.current };
  } else if (state.current === 'erase') {
    if (listeners.onErase) listeners.onErase(x, y);
  } else if (state.current === 'edit') {
    if (listeners.onEdit) listeners.onEdit(x, y);
  }
}

export function onMouseMove(x, y) {
  if (state.drag) {
    state.drag.currentX = x;
    state.drag.currentY = y;
  }
}

export function onMouseUp() {
  if (!state.drag) return;
  const d = state.drag;
  const raw = Math.hypot(d.currentX - d.startX, d.currentY - d.startY);
  if (d.tool === 'house') {
    const radius = Math.max(CONFIG.houseMinRadius, Math.min(CONFIG.houseMaxRadius, raw));
    if (raw >= CONFIG.houseMinRadius / 2 && listeners.onPlaceHouse) {
      listeners.onPlaceHouse(d.startX, d.startY, radius);
    }
  } else if (d.tool === 'zone') {
    const radius = Math.max(CONFIG.zoneMinRadius, Math.min(CONFIG.zoneMaxRadius, raw));
    if (raw >= CONFIG.zoneMinRadius / 2 && listeners.onPlaceZone) {
      listeners.onPlaceZone(d.startX, d.startY, radius);
    }
  } else if (d.tool === 'barrier') {
    if (raw >= CONFIG.barrierMinLength && listeners.onPlaceBarrier) {
      listeners.onPlaceBarrier(d.startX, d.startY, d.currentX, d.currentY);
    }
  }
  state.drag = null;
}

export function getDrag() {
  return state.drag;
}

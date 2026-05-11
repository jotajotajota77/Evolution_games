// A small, draggable, closable "mini-window" overlay. Designed for chart
// hosts: opaque title bar + content area. Uses pointer events so it works
// with both mouse and touch.
export class FloatingWindow {
  constructor({ id, title, x, y, width = 380, height = 220, onOpen, onClose }) {
    this.id = id;
    this.title = title;
    this.x = clampX(x ?? 80, width);
    this.y = clampY(y ?? 80, height);
    this.width = width;
    this.height = height;
    this.onOpen = onOpen;
    this.onClose = onClose;

    this.el = null;
    this.contentEl = null;
    this._dragListeners = null;
  }

  isOpen() { return this.el != null; }

  open() {
    if (this.el) return;
    this._build();
    document.body.appendChild(this.el);
    this._setupDrag();
    if (this.onOpen) this.onOpen(this.contentEl, this);
  }

  close() {
    if (!this.el) return;
    if (this.onClose) this.onClose(this.contentEl, this);
    this._teardownDrag();
    this.el.remove();
    this.el = null;
    this.contentEl = null;
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'fw';
    root.style.left = `${this.x}px`;
    root.style.top = `${this.y}px`;
    root.style.width = `${this.width}px`;
    root.style.height = `${this.height}px`;

    const header = document.createElement('div');
    header.className = 'fw-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'fw-title';
    titleEl.textContent = this.title;
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'fw-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'fw-content';

    root.appendChild(header);
    root.appendChild(content);

    this.el = root;
    this.headerEl = header;
    this.contentEl = content;
  }

  // Pointer-event based drag: works for mouse + touch + pen uniformly.
  // We capture the pointer to keep receiving move events when the user drags
  // outside the header.
  _setupDrag() {
    const header = this.headerEl;
    let dragStartX = 0, dragStartY = 0;
    let origX = 0, origY = 0;
    let activeId = null;

    const onDown = (e) => {
      if (e.target.closest('.fw-close')) return;
      activeId = e.pointerId;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      origX = this.x;
      origY = this.y;
      header.setPointerCapture(e.pointerId);
      this.el.classList.add('fw-dragging');
      e.preventDefault();
    };
    const onMove = (e) => {
      if (e.pointerId !== activeId) return;
      const nx = clampX(origX + (e.clientX - dragStartX), this.width);
      const ny = clampY(origY + (e.clientY - dragStartY), this.height);
      this.x = nx;
      this.y = ny;
      this.el.style.left = `${nx}px`;
      this.el.style.top = `${ny}px`;
    };
    const onUp = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      try { header.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.el.classList.remove('fw-dragging');
    };

    header.addEventListener('pointerdown', onDown);
    header.addEventListener('pointermove', onMove);
    header.addEventListener('pointerup', onUp);
    header.addEventListener('pointercancel', onUp);
    this._dragListeners = { header, onDown, onMove, onUp };
  }

  _teardownDrag() {
    if (!this._dragListeners) return;
    const { header, onDown, onMove, onUp } = this._dragListeners;
    header.removeEventListener('pointerdown', onDown);
    header.removeEventListener('pointermove', onMove);
    header.removeEventListener('pointerup', onUp);
    header.removeEventListener('pointercancel', onUp);
    this._dragListeners = null;
  }
}

function clampX(x, w) {
  return Math.max(0, Math.min(window.innerWidth - Math.min(w, window.innerWidth), x));
}
function clampY(y, h) {
  // Leave a bit of space at the bottom so the window isn't tucked behind the
  // bottom bar. 60 px is roughly the bar height.
  return Math.max(0, Math.min(window.innerHeight - Math.min(h, window.innerHeight) - 60, y));
}

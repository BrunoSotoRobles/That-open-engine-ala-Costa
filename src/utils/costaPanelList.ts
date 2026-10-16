/**
 * Shared bim-panel list chrome for Costa viewer tools (Groups, Search, …).
 * Compact single-line rows (table-like height) + icon bim-buttons like the 3D toolbar.
 */

export type CostaPanelRowActionVariant = "default" | "danger";

export interface CostaPanelRowAction {
  /** Accessible name + tooltip (toolbar style: icon-only button). */
  label: string;
  /** That Open / Iconify icon id (same set as bim-toolbar). */
  icon: string;
  variant?: CostaPanelRowActionVariant;
  onClick: () => void;
}

export interface CostaPanelRowOptions {
  title: string;
  meta?: string;
  /** Highlights preview / active row (e.g. Search A2 ligero). */
  active?: boolean;
  /** Orange preview row (Element Search inspect). */
  preview?: boolean;
  /** Checkbox selection (Element Search accumulate). */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Whole-row activate (Search preview). Action buttons stopPropagation. */
  onActivate?: () => void;
  actions?: CostaPanelRowAction[];
}

function createBimButton(action: CostaPanelRowAction): HTMLElement {
  const btn = document.createElement("bim-button");
  // Toolbar pattern: icon + tooltip-title, no label text (compact).
  btn.setAttribute("icon", action.icon);
  btn.setAttribute("tooltip-title", action.label);
  btn.setAttribute("aria-label", action.label);
  btn.classList.add("costa-panel-row-action");
  if (action.variant === "danger") {
    btn.classList.add("costa-panel-row-action--danger");
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    action.onClick();
  });
  return btn;
}

/** Single-line list row: title · meta + icon actions (toolbar-style bim-button). */
export function renderPanelRow(options: CostaPanelRowOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "costa-panel-row";
  if (options.active) row.classList.add("costa-panel-row--active");
  if (options.preview) row.classList.add("costa-panel-row--preview");
  if (options.checked) row.classList.add("costa-panel-row--checked");

  if (options.onCheckedChange !== undefined) {
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "costa-panel-row-check";
    check.checked = options.checked ?? false;
    check.setAttribute("aria-label", `Select ${options.title}`);
    check.addEventListener("click", (e) => e.stopPropagation());
    check.addEventListener("change", () => options.onCheckedChange?.(check.checked));
    row.appendChild(check);
  }

  if (options.onActivate) {
    row.classList.add("costa-panel-row--interactive");
    row.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest(".costa-panel-row-check, bim-button, .costa-panel-row-action")) return;
      options.onActivate?.();
    });
  }

  const body = document.createElement("div");
  body.className = "costa-panel-row-body";

  const title = document.createElement("span");
  title.className = "costa-panel-row-title";
  title.textContent = options.title;
  body.appendChild(title);

  if (options.meta) {
    const sep = document.createElement("span");
    sep.className = "costa-panel-row-sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "·";
    body.appendChild(sep);

    const meta = document.createElement("span");
    meta.className = "costa-panel-row-meta";
    meta.textContent = options.meta;
    body.appendChild(meta);
  }

  row.appendChild(body);

  if (options.actions && options.actions.length > 0) {
    const actions = document.createElement("div");
    actions.className = "costa-panel-row-actions";
    for (const action of options.actions) {
      actions.appendChild(createBimButton(action));
    }
    row.appendChild(actions);
  }

  return row;
}

/** Empty / status line inside a costa-panel-list. */
export function renderPanelEmpty(message: string, kind: "empty" | "error" = "empty"): HTMLElement {
  const el = document.createElement("div");
  el.className =
    kind === "error" ? "costa-panel-empty costa-panel-empty--error" : "costa-panel-empty";
  el.textContent = message;
  return el;
}

/** Summary line above a list (e.g. search hit count). */
export function renderPanelSummary(message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "costa-panel-summary";
  el.textContent = message;
  return el;
}

/** Ensure host is a costa-panel-list container. */
export function ensurePanelList(host: HTMLElement): void {
  host.classList.add("costa-panel-list");
}

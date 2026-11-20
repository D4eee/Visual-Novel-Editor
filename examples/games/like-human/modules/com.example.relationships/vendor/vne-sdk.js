// sdk/src/index.ts
var SDK_VERSION = "1.0.0";
function defineRuntime(activate) {
  return activate;
}
function defineEditor(activate) {
  return activate;
}
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === void 0 || v === null || v === false) continue;
    if (k === "class" || k === "className") el.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === void 0 || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
var ui = {
  button(label, onClick, opts = {}) {
    return h("button", { type: "button", class: `btn ${opts.primary ? "btn-primary" : ""} ${opts.small ? "btn-sm" : ""}`, onclick: onClick }, label);
  },
  field(label, control, hint) {
    return h("div", { class: "field" }, h("div", { class: "field-label" }, label), h("div", { class: "field-control" }, control), hint ? h("div", { class: "field-hint" }, hint) : null);
  },
  text(value, onChange, opts = {}) {
    const el = opts.multiline ? h("textarea", { class: "input", rows: 3, placeholder: opts.placeholder || "" }) : h("input", { class: "input", type: "text", placeholder: opts.placeholder || "" });
    el.value = value;
    el.addEventListener("change", () => onChange(el.value));
    el.addEventListener("keydown", (e) => e.stopPropagation());
    return el;
  },
  number(value, onChange, opts = {}) {
    const el = h("input", { class: "input", type: "number", min: opts.min, max: opts.max, step: opts.step ?? 1 });
    el.value = String(value);
    el.addEventListener("change", () => onChange(Number(el.value) || 0));
    el.addEventListener("keydown", (e) => e.stopPropagation());
    return el;
  },
  slider(value, onChange, opts = {}) {
    const el = h("input", { type: "range", min: opts.min ?? 0, max: opts.max ?? 100, step: opts.step ?? 1, style: { accentColor: "var(--accent)", width: "100%" } });
    el.value = String(value);
    el.addEventListener("change", () => onChange(Number(el.value)));
    return el;
  },
  select(value, options, onChange) {
    const el = h("select", { class: "input" }, ...options.map((o) => h("option", { value: o.value }, o.label)));
    el.value = value;
    el.addEventListener("change", () => onChange(el.value));
    return el;
  },
  checkbox(value, onChange, label = "") {
    const input = h("input", { type: "checkbox" });
    input.checked = value;
    input.addEventListener("change", () => onChange(input.checked));
    return h("label", { class: "checkbox" }, input, h("span", null, label));
  },
  color(value, onChange) {
    const el = h("input", { type: "color", style: { width: "40px", height: "28px", border: "0", background: "transparent" } });
    el.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
    el.addEventListener("change", () => onChange(el.value));
    return el;
  }
};
export {
  SDK_VERSION,
  defineEditor,
  defineRuntime,
  h,
  ui
};

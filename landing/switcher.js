/*
 * Review switcher for the Sara landing explorations.
 * Injected into every landing/vN/<skill>/index.html. Renders inside a shadow
 * root so it never inherits or leaks page styles. Pages work without it.
 *
 * Keys: [ previous direction · ] next direction · \ swap Impeccable/Taste
 */
(() => {
  const match = location.pathname.match(/\/v([1-5])\/(impeccable|taste)\/?(?:index\.html)?$/);
  if (!match) return;

  const current = { v: Number(match[1]), skill: match[2] };
  const DIRECTIONS = {
    1: "Clean Minimal SaaS",
    2: "Halftone Print-Tech",
    3: "Warm Green Nature-Finance",
    4: "Photoreal Landscape",
    5: "Monochrome Documentary",
  };
  const SKILLS = { impeccable: "Impeccable", taste: "Taste v2" };
  const href = (v, skill) => `../../v${v}/${skill}/index.html`;
  const wrap = (v) => ((v + 4) % 5) + 1;

  const read = () => {
    try { return localStorage.getItem("sara-switcher") === "closed"; } catch { return false; }
  };
  const write = (closed) => {
    try { localStorage.setItem("sara-switcher", closed ? "closed" : "open"); } catch { /* storage blocked */ }
  };

  const host = document.createElement("div");
  host.setAttribute("data-review-switcher", "");
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .bar, .fab {
        position: fixed; left: 12px; bottom: 12px; z-index: 2147483000;
        font: 500 12px/1.2 ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
        color: #f4f4f5; background: rgb(24 24 27 / .92);
        -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
        border: 1px solid rgb(255 255 255 / .12); border-radius: 999px;
        box-shadow: 0 8px 28px rgb(0 0 0 / .28);
      }
      .bar { display: flex; align-items: center; gap: 2px; padding: 4px; max-width: calc(100vw - 24px); }
      a, button {
        all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        height: 30px; min-width: 30px; padding: 0 10px; border-radius: 999px; box-sizing: border-box;
        color: inherit; white-space: nowrap;
      }
      a:hover, button:hover { background: rgb(255 255 255 / .1); }
      a:focus-visible, button:focus-visible { outline: 2px solid #fafafa; outline-offset: 1px; }
      .label { padding: 0 8px; color: #d4d4d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label b { color: #fafafa; font-weight: 600; }
      .seg { display: inline-flex; background: rgb(255 255 255 / .08); border-radius: 999px; padding: 2px; margin: 0 2px; }
      .seg a { height: 26px; padding: 0 10px; color: #a1a1aa; }
      .seg a[aria-current="page"] { background: #fafafa; color: #18181b; }
      .fab { height: 38px; min-width: 38px; padding: 0 12px; font-weight: 600; }
      .name { display: none; }
      @media (min-width: 720px) { .name { display: inline; } }
      [hidden] { display: none !important; }
    </style>
    <nav class="bar" aria-label="Landing versions">
      <a href="../../index.html" title="All versions">All</a>
      <a href="${href(wrap(current.v - 1), current.skill)}" title="Previous direction ([)" aria-label="Previous direction">&#8249;</a>
      <span class="label"><b>v${current.v}</b><span class="name"> ${DIRECTIONS[current.v]}</span></span>
      <a href="${href(wrap(current.v + 1), current.skill)}" title="Next direction (])" aria-label="Next direction">&#8250;</a>
      <span class="seg">
        ${Object.entries(SKILLS).map(([key, name]) =>
          `<a href="${href(current.v, key)}"${key === current.skill ? ' aria-current="page"' : ""}>${name}</a>`).join("")}
      </span>
      <button type="button" class="close" aria-label="Hide switcher" title="Hide">&#215;</button>
    </nav>
    <button type="button" class="fab" aria-label="Show version switcher" hidden>v${current.v}</button>
  `;

  const bar = root.querySelector(".bar");
  const fab = root.querySelector(".fab");
  const setClosed = (closed) => { bar.hidden = closed; fab.hidden = !closed; write(closed); };
  root.querySelector(".close").addEventListener("click", () => setClosed(true));
  fab.addEventListener("click", () => setClosed(false));
  setClosed(read());

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "[") location.href = href(wrap(current.v - 1), current.skill);
    if (e.key === "]") location.href = href(wrap(current.v + 1), current.skill);
    if (e.key === "\\") location.href = href(current.v, current.skill === "taste" ? "impeccable" : "taste");
  });

  document.body.appendChild(host);
})();

document.documentElement.classList.add("js");

const toggle = document.querySelector("[data-toggle]");
const sheet = document.getElementById("sheet");
toggle?.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!open));
  sheet.hidden = open;
});
sheet?.addEventListener("click", (e) => { if (e.target.closest("a")) { sheet.hidden = true; toggle.setAttribute("aria-expanded", "false"); } });

// Tabs (roving tabindex, arrow keys)
const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => select(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    select(next); next.focus();
  });
});

// Reveal
const rv = document.querySelectorAll(".rv");
rv.forEach((el) => {
  const sib = [...el.parentElement.children].filter((c) => c.classList.contains("rv"));
  el.style.setProperty("--d", `${sib.indexOf(el) * 80}ms`);
});
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("on"); io.unobserve(e.target); } }), { threshold: 0.15 });
rv.forEach((el) => io.observe(el));

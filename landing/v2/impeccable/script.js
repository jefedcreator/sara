// Mobile menu
const burger = document.querySelector("[data-burger]");
const mNav = document.getElementById("m-nav");
burger?.addEventListener("click", () => {
  const open = burger.getAttribute("aria-expanded") === "true";
  burger.setAttribute("aria-expanded", String(!open));
  burger.textContent = open ? "MENU" : "CLOSE";
  mNav.hidden = open;
});
mNav?.addEventListener("click", (e) => {
  if (e.target.closest("a")) { mNav.hidden = true; burger.setAttribute("aria-expanded", "false"); burger.textContent = "MENU"; }
});

// Deterministic console: 1-6 answer, 0 returns to the menu. Same key, same reply.
const screen = document.querySelector("[data-screen]");
const tabs = [...document.querySelectorAll("[data-key]")];
const clock = document.querySelector("[data-clock]");

function show(key, fromKeyboard) {
  const tpl = document.getElementById(`r${key}`);
  if (!tpl || !screen) return;
  screen.replaceChildren(tpl.content.cloneNode(true));
  [...screen.children].forEach((p, i) => p.style.setProperty("--i", i));
  tabs.forEach((t) => {
    const on = t.dataset.key === String(key);
    t.setAttribute("aria-selected", String(on));
    if (on && fromKeyboard) { t.classList.remove("pressed"); void t.offsetWidth; t.classList.add("pressed"); }
  });
  const now = new Date();
  clock.textContent = now.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" });
}

tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.key)));
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target;
  if (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if (/^[0-6]$/.test(e.key)) show(e.key, true);
});
show(1);

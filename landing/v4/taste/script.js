document.documentElement.classList.add("js");

const btn = document.querySelector("[data-menu]");
const menu = document.getElementById("menu");
btn?.addEventListener("click", () => {
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  menu.hidden = open;
});
menu?.addEventListener("click", (e) => { if (e.target.closest("a")) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });

const els = document.querySelectorAll(".fade");
els.forEach((el) => {
  const sib = [...el.parentElement.children].filter((c) => c.classList.contains("fade"));
  el.style.setProperty("--d", `${sib.indexOf(el) * 70}ms`);
});
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); }
}), { threshold: 0.15 });
els.forEach((el) => io.observe(el));

// Booking page demo: selectable slots
const slots = document.querySelectorAll(".bu-slots button:not(:disabled)");
slots.forEach((b) => b.addEventListener("click", () => {
  slots.forEach((s) => { s.classList.remove("picked"); s.setAttribute("aria-pressed", "false"); });
  b.classList.add("picked"); b.setAttribute("aria-pressed", "true");
}));

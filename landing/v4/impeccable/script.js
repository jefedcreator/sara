document.documentElement.classList.add("js");

const btn = document.querySelector("[data-menu]");
const m = document.getElementById("m");
btn?.addEventListener("click", () => {
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  btn.textContent = open ? "Menu" : "Close";
  m.hidden = open;
});
m?.addEventListener("click", (e) => { if (e.target.closest("a")) { m.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.textContent = "Menu"; } });

// Each hour of the day arrives as you reach it.
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("on-screen"); io.unobserve(e.target); }
}), { threshold: 0.2 });
document.querySelectorAll(".hour-body, .pl-grid div").forEach((el) => io.observe(el));

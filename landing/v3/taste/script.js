document.documentElement.classList.add("js");

const btn = document.querySelector("[data-menu]");
const panel = document.getElementById("panel");
btn?.addEventListener("click", () => {
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  panel.hidden = open;
});
panel?.addEventListener("click", (e) => { if (e.target.closest("a")) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); } });

const items = document.querySelectorAll(".up");
items.forEach((el) => {
  const sib = [...el.parentElement.children].filter((c) => c.classList.contains("up"));
  el.style.setProperty("--d", `${sib.indexOf(el) * 90}ms`);
});
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("shown"); io.unobserve(e.target); }
}), { threshold: 0.12 });
items.forEach((el) => io.observe(el));

document.documentElement.classList.add("js");

const bar = document.querySelector("[data-bar]");
const btn = document.querySelector("[data-menu]");
const sheet = document.getElementById("sheet");
btn?.addEventListener("click", () => {
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  sheet.hidden = open;
});
sheet?.addEventListener("click", (e) => { if (e.target.closest("a")) { sheet.hidden = true; btn.setAttribute("aria-expanded", "false"); } });

// Transparent over the photo, solid after it.
new IntersectionObserver(([e]) => bar.classList.toggle("solid", !e.isIntersecting), { rootMargin: "-68px 0px 0px 0px" })
  .observe(document.querySelector(".hero"));

const els = document.querySelectorAll(".in");
els.forEach((el) => {
  const sib = [...el.parentElement.children].filter((c) => c.classList.contains("in"));
  el.style.setProperty("--d", `${sib.indexOf(el) * 80}ms`);
});
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("vis"); io.unobserve(e.target); }
}), { threshold: 0.15 });
els.forEach((el) => io.observe(el));

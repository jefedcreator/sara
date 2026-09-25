document.documentElement.classList.add("js");

const burger = document.querySelector("[data-burger]");
const drawer = document.getElementById("drawer");
burger?.addEventListener("click", () => {
  const open = burger.getAttribute("aria-expanded") === "true";
  burger.setAttribute("aria-expanded", String(!open));
  drawer.hidden = open;
});
drawer?.addEventListener("click", (e) => {
  if (e.target.closest("a")) { drawer.hidden = true; burger.setAttribute("aria-expanded", "false"); }
});

// Staggered reveal: siblings inside the same parent enter in sequence.
const reveals = document.querySelectorAll(".reveal");
reveals.forEach((el) => {
  const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
  el.style.setProperty("--d", `${siblings.indexOf(el) * 70}ms`);
});
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } });
}, { threshold: 0.15 });
reveals.forEach((el) => io.observe(el));

// Booking page demo: days and slots are selectable.
const pick = (selector) => {
  const group = document.querySelectorAll(selector);
  group.forEach((btn) => btn.addEventListener("click", () => {
    group.forEach((b) => { b.classList.remove("is-picked"); b.setAttribute("aria-pressed", "false"); });
    btn.classList.add("is-picked"); btn.setAttribute("aria-pressed", "true");
  }));
};
pick(".bk-day"); pick(".bk-slot");

// Copy booking link with visible feedback.
const copyBtn = document.querySelector("[data-copy]");
const label = document.querySelector("[data-copy-label]");
copyBtn?.addEventListener("click", async () => {
  const url = "https://" + document.querySelector("[data-url]").textContent.trim();
  try { await navigator.clipboard.writeText(url); label.textContent = "Copied"; }
  catch { label.textContent = "Copy failed"; }
  setTimeout(() => { label.textContent = "Copy link"; }, 2000);
});

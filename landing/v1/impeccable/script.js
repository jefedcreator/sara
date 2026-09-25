document.documentElement.classList.add("js");

// Mobile menu
const menuBtn = document.querySelector("[data-menu-btn]");
const menu = document.getElementById("mobile-menu");
menuBtn?.addEventListener("click", () => {
  const open = menuBtn.getAttribute("aria-expanded") === "true";
  menuBtn.setAttribute("aria-expanded", String(!open));
  menu.hidden = open;
});
menu?.addEventListener("click", (e) => {
  if (e.target.closest("a")) { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
});

// Nav hairline once the page moves
const nav = document.querySelector("[data-nav]");
const sentinel = document.createElement("div");
sentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px";
document.body.prepend(sentinel);
new IntersectionObserver(([e]) => nav.classList.toggle("is-scrolled", !e.isIntersecting)).observe(sentinel);

// Messages arrive in order when their thread enters the viewport
document.querySelectorAll("[data-arrive]").forEach((group) => {
  group.querySelectorAll(".msg").forEach((m, i) => m.style.setProperty("--i", i));
});
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
}, { threshold: 0.25, rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll("[data-arrive]").forEach((el) => io.observe(el));

// Copy booking link
const copyBtn = document.querySelector("[data-copy]");
copyBtn?.addEventListener("click", async () => {
  const text = "https://" + document.querySelector("[data-link]").textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied";
  } catch {
    copyBtn.textContent = "Press and hold to copy";
  }
  copyBtn.classList.add("is-done");
  setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("is-done"); }, 2200);
});

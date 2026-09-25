document.documentElement.classList.add("js");

const nav = document.querySelector("[data-nav]");
const btn = document.querySelector("[data-menu]");
const drawer = document.getElementById("drawer");
btn?.addEventListener("click", () => {
  const open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!open));
  btn.textContent = open ? "Menu" : "Close";
  drawer.hidden = open;
});
drawer?.addEventListener("click", (e) => { if (e.target.closest("a")) { drawer.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.textContent = "Menu"; } });

// Nav sits on the photo, then turns solid once the photo has scrolled away.
const hero = document.querySelector(".hero");
new IntersectionObserver(([e]) => nav.classList.toggle("solid", !e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" }).observe(hero);

// Steps and transcript lines are read in order.
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  const i = [...e.target.parentElement.children].indexOf(e.target);
  e.target.style.transitionDelay = `${(i % 6) * 70}ms`;
  e.target.classList.add("shown");
  io.unobserve(e.target);
}), { threshold: 0.3 });
document.querySelectorAll(".steps li, .log li").forEach((el) => io.observe(el));

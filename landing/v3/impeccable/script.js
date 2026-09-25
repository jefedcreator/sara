document.documentElement.classList.add("js");

const toggle = document.querySelector("[data-toggle]");
const drawer = document.getElementById("drawer");
toggle?.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!open));
  drawer.hidden = open;
});
drawer?.addEventListener("click", (e) => { if (e.target.closest("a")) { drawer.hidden = true; toggle.setAttribute("aria-expanded", "false"); } });

// One calm entrance per block as it scrolls in.
const blocks = document.querySelectorAll(".menu-lead, .mini, .flow li, .card, .invoice, .ob li, .end-card");
blocks.forEach((el, i) => el.classList.add("rise"));
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const sibs = [...e.target.parentElement.children];
    e.target.style.transitionDelay = `${Math.max(0, sibs.indexOf(e.target)) * 90}ms`;
    e.target.classList.add("on");
    io.unobserve(e.target);
  });
}, { threshold: 0.15 });
blocks.forEach((el) => io.observe(el));

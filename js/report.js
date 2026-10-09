const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

const readLine = document.createElement("div");
readLine.className = "read-line";
readLine.setAttribute("aria-hidden", "true");
document.body.append(readLine);

const linear = document.querySelector(".report-linear");
const sections = linear ? [...linear.querySelectorAll(".report-section")] : [];
let rail = null;
let dot = null;
let buttons = [];
let active = -1;

if (sections.length) {
  rail = document.createElement("nav");
  rail.className = "section-rail";
  rail.setAttribute("aria-label", "報告段落");
  buttons = sections.map((section) => {
    const heading = section.querySelector("h2");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = heading ? heading.lastChild.textContent.trim() : "";
    button.addEventListener("click", () => {
      section.classList.remove("is-landing");
      void section.offsetWidth;
      section.classList.add("is-landing");
      section.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
    });
    rail.append(button);
    return button;
  });
  dot = document.createElement("span");
  dot.className = "section-rail-dot";
  dot.setAttribute("aria-hidden", "true");
  rail.append(dot);
  linear.prepend(rail);
}

function setActive(index) {
  if (index === active || !rail) return;
  active = index;
  buttons.forEach((button, i) => button.classList.toggle("is-on", i === index));
  const button = buttons[index];
  if (!button) return;
  dot.style.transform = `translateX(${button.offsetLeft + button.offsetWidth / 2}px)`;
  const left = button.offsetLeft - rail.clientWidth / 2 + button.offsetWidth / 2;
  rail.scrollTo({ left, behavior: reduced.matches ? "auto" : "smooth" });
}

let queued = false;
function update() {
  queued = false;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  readLine.style.setProperty("--read", max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : "0");
  if (!rail || !rail.offsetParent) return;
  const line = rail.getBoundingClientRect().bottom + 24;
  let index = 0;
  sections.forEach((section, i) => {
    if (section.getBoundingClientRect().top <= line) index = i;
  });
  setActive(index);
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

window.addEventListener("scroll", queue, { passive: true });
window.addEventListener("resize", () => {
  active = -1;
  queue();
});
update();

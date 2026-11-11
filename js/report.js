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

const evidenceRows = [...document.querySelectorAll(".evidence tbody tr")];
evidenceRows.forEach((row) => {
  row.addEventListener("click", () => {
    const on = !row.classList.contains("is-on");
    evidenceRows.forEach((item) => item.classList.toggle("is-on", on && item === row));
  });
});

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

// Photo viewer: tap a figure image to open it full screen; drag to pan, pinch / wheel / double-tap to zoom.
const figureImages = [...document.querySelectorAll(".figure-pair img")];
if (figureImages.length) {
  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  const TAP_SCALE = 2.5;
  const viewer = document.createElement("div");
  viewer.className = "viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.hidden = true;
  viewer.innerHTML =
    '<div class="viewer-bar"><span class="viewer-caption meta"></span>' +
    '<div class="viewer-zoom" role="toolbar" aria-label="縮放">' +
    '<button class="btn" type="button" data-zoom="out" aria-label="縮小">−</button>' +
    '<button class="btn" type="button" data-zoom="in" aria-label="放大">+</button>' +
    '<button class="btn" type="button" data-zoom="reset">重設</button>' +
    '<button class="btn viewer-close" type="button" aria-label="關閉">×</button></div></div>' +
    '<div class="viewer-stage"><img class="viewer-img" alt="" draggable="false" /></div>' +
    '<p class="viewer-hint meta" aria-hidden="true">單指：拖動　雙指 / 雙擊：縮放</p>';
  document.body.append(viewer);

  const stage = viewer.querySelector(".viewer-stage");
  const img = viewer.querySelector(".viewer-img");
  const caption = viewer.querySelector(".viewer-caption");
  const closeButton = viewer.querySelector(".viewer-close");
  const view = { scale: 1, x: 0, y: 0 };
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let opener = null;

  const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  function clampPan() {
    const maxX = Math.max(0, (img.offsetWidth * view.scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * view.scale - stage.clientHeight) / 2);
    view.x = Math.min(maxX, Math.max(-maxX, view.x));
    view.y = Math.min(maxY, Math.max(-maxY, view.y));
  }

  function render(animate) {
    clampPan();
    stage.classList.toggle("is-animating", !!animate);
    stage.classList.toggle("is-zoomed", view.scale > MIN_SCALE);
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  // Points are relative to the stage centre, which is where the untransformed image is centred.
  function toStage(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  function zoomAt(point, nextScale, animate) {
    const scale = clampScale(nextScale);
    const ratio = scale / view.scale;
    view.x = point.x - (point.x - view.x) * ratio;
    view.y = point.y - (point.y - view.y) * ratio;
    view.scale = scale;
    render(animate);
  }

  function reset(animate) {
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    render(animate);
  }

  function open(source) {
    opener = source;
    img.src = source.currentSrc || source.src;
    img.alt = source.alt;
    const figcaption = source.closest("figure")?.querySelector("figcaption");
    caption.textContent = figcaption ? figcaption.textContent : source.alt;
    viewer.setAttribute("aria-label", source.alt);
    viewer.hidden = false;
    setBackgroundInert(true);
    document.documentElement.classList.add("is-viewing");
    reset(false);
    void viewer.offsetWidth;
    viewer.classList.add("is-on");
    closeButton.focus({ preventScroll: true });
  }

  function close() {
    if (viewer.hidden) return;
    viewer.classList.remove("is-on");
    document.documentElement.classList.remove("is-viewing");
    pointers.clear();
    gesture = null;
    viewer.hidden = true;
    setBackgroundInert(false);
    if (opener) opener.focus({ preventScroll: true });
  }

  function setBackgroundInert(on) {
    [...document.body.children].forEach((el) => {
      if (el !== viewer && !el.classList.contains("cursor") && !el.classList.contains("idle")) el.inert = on;
    });
  }

  figureImages.forEach((source) => {
    source.tabIndex = 0;
    source.setAttribute("role", "button");
    source.setAttribute("aria-label", `放大睇：${source.alt}`);
    source.addEventListener("click", () => open(source));
    source.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open(source);
    });
  });

  closeButton.addEventListener("click", close);
  viewer.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.zoom;
      if (mode === "reset") reset(true);
      else zoomAt({ x: 0, y: 0 }, view.scale * (mode === "in" ? 1.5 : 1 / 1.5), true);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (viewer.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "+" || e.key === "=") zoomAt({ x: 0, y: 0 }, view.scale * 1.5, true);
    else if (e.key === "-") zoomAt({ x: 0, y: 0 }, view.scale / 1.5, true);
    else if (e.key === "0") reset(true);
    else if (e.key === "Tab") {
      const items = [...viewer.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
      e.preventDefault();
      items[next].focus();
    }
  });

  function startGesture() {
    const points = [...pointers.values()];
    if (points.length >= 2) {
      const [a, b] = points;
      gesture = {
        type: "pinch",
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        scale: view.scale,
        x: view.x,
        y: view.y,
      };
    } else if (points.length === 1) {
      gesture = { type: "pan", start: points[0], x: view.x, y: view.y, moved: false };
    } else {
      gesture = null;
    }
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.set(e.pointerId, toStage(e.clientX, e.clientY));
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
    startGesture();
    stage.classList.add("is-dragging");
    render(false);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, toStage(e.clientX, e.clientY));
    const points = [...pointers.values()];
    if (gesture.type === "pinch" && points.length >= 2) {
      const [a, b] = points;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clampScale((gesture.scale * distance) / gesture.distance);
      const ratio = scale / gesture.scale;
      view.scale = scale;
      view.x = mid.x - (gesture.mid.x - gesture.x) * ratio;
      view.y = mid.y - (gesture.mid.y - gesture.y) * ratio;
      render(false);
    } else if (gesture.type === "pan") {
      const p = points[0];
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 6) gesture.moved = true;
      view.x = gesture.x + dx;
      view.y = gesture.y + dy;
      render(false);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const point = pointers.get(e.pointerId);
    const wasTap = gesture?.type === "pan" && !gesture.moved && e.type === "pointerup";
    pointers.delete(e.pointerId);
    startGesture();
    if (!pointers.size) stage.classList.remove("is-dragging");
    if (!wasTap) {
      lastTap = null;
      return;
    }
    const now = performance.now();
    if (lastTap && now - lastTap.time < 320 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
      lastTap = null;
      if (view.scale > MIN_SCALE) reset(true);
      else zoomAt(point, TAP_SCALE, true);
    } else {
      lastTap = { time: now, x: point.x, y: point.y };
    }
  }
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(toStage(e.clientX, e.clientY), view.scale * Math.exp(-e.deltaY * 0.0015), false);
    },
    { passive: false }
  );

  window.addEventListener("resize", () => {
    if (!viewer.hidden) render(false);
  });
  document.addEventListener("idle-start", close);
}

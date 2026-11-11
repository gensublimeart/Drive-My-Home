(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const started = performance.now();
  const minMs = reduced ? 0 : 780;
  const maxMs = reduced ? 400 : 2800;
  root.classList.add("is-booting");
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") root.classList.add("is-kiosk");
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // Touch taps leave :hover stuck in Chromium, so hover styles follow the last input used.
  root.classList.toggle("can-hover", window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  const syncPointer = (e) => root.classList.toggle("can-hover", e.pointerType === "mouse");
  window.addEventListener("pointerdown", syncPointer, true);
  window.addEventListener("pointermove", syncPointer, { capture: true, passive: true });

  const icon = document.querySelector('link[rel="icon"]');
  const boot = document.createElement("div");
  boot.className = "boot";
  boot.setAttribute("role", "status");
  boot.setAttribute("aria-live", "polite");
  boot.setAttribute("aria-label", "載入中");
  boot.innerHTML =
    '<div class="boot-mark"><span class="boot-ring" aria-hidden="true"></span><img class="boot-logo" alt="" width="64" height="64" /></div><p class="boot-caption">屋企在途中</p>';
  const logo = boot.querySelector(".boot-logo");
  if (icon) logo.src = icon.getAttribute("href");

  let mounted = false;
  let finishing = false;

  function mount() {
    if (mounted || !document.body) return;
    mounted = true;
    document.body.prepend(boot);
  }

  function pageReady() {
    if (!document.body) return false;
    if (document.body.classList.contains("index-body")) return document.body.classList.contains("flow-ready");
    return document.readyState === "complete";
  }

  function finish() {
    if (finishing) return;
    finishing = true;
    const wait = Math.max(0, minMs - (performance.now() - started));
    setTimeout(() => {
      root.classList.add("is-booted");
      boot.classList.add("is-out");
      const done = () => {
        if (!boot.isConnected) return;
        root.classList.remove("is-booting");
        boot.remove();
      };
      if (reduced) done();
      else {
        boot.addEventListener("transitionend", done, { once: true });
        setTimeout(done, 700);
      }
    }, wait);
  }

  function poll() {
    mount();
    if (performance.now() - started >= maxMs || pageReady()) finish();
    else requestAnimationFrame(poll);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
  window.addEventListener("load", () => {
    if (!document.body || !document.body.classList.contains("index-body")) finish();
  });
  requestAnimationFrame(poll);

  // Custom cursor: a dot + ring marking where the screen is touched (or the mouse is pressed).
  // Hidden whenever nothing is pressed.
  const CURSOR_LINKS = 'a[href], button:not(:disabled), [role="button"], select, label, summary, .tv-obj, .evidence tbody tr, .figure-pair img';
  const cursor = document.createElement("div");
  cursor.className = "cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = '<div class="cursor-ring"></div><div class="cursor-dot"></div>';
  const ring = cursor.firstChild;
  const dot = cursor.lastChild;
  const pos = { x: 0, y: 0 };
  let cursorTarget = null;
  let cursorMode = "";
  let cursorFrame = 0;

  // coverflow / graph keep driving their own native cursor values; mirror them here.
  function modeFor(el) {
    if (!el || !el.closest) return "";
    const hit = el.closest(CURSOR_LINKS);
    if (hit && hit.getAttribute("aria-disabled") !== "true") return "link";
    const stage = el.closest(".flow-stage");
    if (stage) {
      if (stage.classList.contains("is-dragging")) return "grabbing";
      return stage.classList.contains("is-pointing") ? "link" : "grab";
    }
    const viewerStage = el.closest(".viewer-stage");
    if (viewerStage) return viewerStage.classList.contains("is-dragging") ? "grabbing" : "grab";
    if (el.id === "graph-canvas") {
      if (el.style.cursor === "pointer") return "link";
      return el.style.cursor === "grabbing" ? "grabbing" : "grab";
    }
    return "";
  }

  function cursorTick() {
    cursorFrame = 0;
    // `translate` (not `transform`) so the ring's `scale` shrinks it in place rather than toward 0,0.
    dot.style.translate = ring.style.translate = `${pos.x}px ${pos.y}px`;
    const next = modeFor(cursorTarget);
    if (next !== cursorMode) {
      if (cursorMode) cursor.classList.remove(`is-${cursorMode}`);
      if (next) cursor.classList.add(`is-${next}`);
      cursorMode = next;
    }
  }

  function wakeCursor() {
    if (!cursorFrame) cursorFrame = requestAnimationFrame(cursorTick);
  }

  const cursorOn = () => cursor.classList.contains("is-on");

  function placeCursor(x, y, target) {
    pos.x = x;
    pos.y = y;
    if (target) cursorTarget = target;
    wakeCursor();
  }

  function showCursor(e) {
    if (!e.isPrimary) return;
    placeCursor(e.clientX, e.clientY, e.target);
    // Place it before fading in so it never flashes at the previous touch point.
    cancelAnimationFrame(cursorFrame);
    cursorTick();
    cursor.classList.add("is-on", "is-down");
  }

  function hideCursor() {
    cursor.classList.remove("is-on", "is-down");
  }

  window.addEventListener("pointerdown", showCursor, true);
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.isPrimary && cursorOn()) placeCursor(e.clientX, e.clientY, e.target);
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      if (e.isPrimary) hideCursor();
    },
    true
  );
  window.addEventListener(
    "pointercancel",
    (e) => {
      if (e.isPrimary && e.pointerType !== "touch") hideCursor();
    },
    true
  );
  // A touch that turns into a scroll cancels its pointer events; keep following the finger until it lifts.
  window.addEventListener(
    "touchmove",
    (e) => {
      const touch = e.touches[0];
      if (touch && cursorOn()) placeCursor(touch.clientX, touch.clientY);
    },
    { capture: true, passive: true }
  );
  ["touchend", "touchcancel"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        if (!e.touches.length) hideCursor();
      },
      { capture: true, passive: true }
    )
  );
  window.addEventListener(
    "scroll",
    () => {
      if (!cursorOn()) return;
      cursorTarget = document.elementFromPoint(pos.x, pos.y);
      wakeCursor();
    },
    { capture: true, passive: true }
  );
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) hideCursor();
  });
  window.addEventListener("blur", hideCursor);

  function mountCursor() {
    document.body.append(cursor);
    root.classList.add("has-cursor");
  }
  if (document.body) mountCursor();
  else document.addEventListener("DOMContentLoaded", mountCursor);

  // Idle: after IDLE_MS without input, return to the index and show the attract screen.
  const IDLE_MS = 5 * 60 * 1000;
  const IDLE_FLAG = "idle";
  let idleTimer = 0;
  let idle = false;
  let idleLayer = null;

  const isHome = () => !!document.body && document.body.classList.contains("index-body");

  function homeUrl() {
    const link = document.querySelector(".site-logo a");
    const url = new URL(link ? link.href : "index.html", location.href);
    url.search = `?${IDLE_FLAG}`;
    url.hash = "";
    return url.href;
  }

  function buildIdleLayer() {
    const layer = document.createElement("div");
    layer.className = "idle";
    layer.setAttribute("role", "button");
    layer.setAttribute("aria-label", "待機中，輕觸螢幕開始");
    layer.innerHTML =
      '<div class="idle-card"><div class="idle-mark"><span class="idle-ring" aria-hidden="true"></span><img class="idle-logo" alt="" width="44" height="44" /></div><p class="idle-title">輕觸螢幕開始探索</p><p class="idle-hint">TOUCH TO BEGIN</p></div>';
    if (icon) layer.querySelector(".idle-logo").src = icon.getAttribute("href");
    return layer;
  }

  function enterIdle() {
    if (idle || !document.body) return;
    idle = true;
    clearTimeout(idleTimer);
    if (!idleLayer) idleLayer = buildIdleLayer();
    if (!idleLayer.isConnected) document.body.append(idleLayer);
    root.classList.add("is-idle");
    void idleLayer.offsetWidth;
    idleLayer.classList.add("is-on");
    document.dispatchEvent(new CustomEvent("idle-start"));
  }

  function exitIdle() {
    if (!idle) return;
    idle = false;
    root.classList.remove("is-idle");
    idleLayer.classList.remove("is-on");
    document.dispatchEvent(new CustomEvent("idle-end"));
    resetIdle();
  }

  function goIdle() {
    if (isHome()) enterIdle();
    else location.replace(homeUrl());
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, IDLE_MS);
  }

  // While idle, the first touch/key/wheel only wakes the screen and is not passed on.
  const wakeEvents = ["pointerdown", "keydown", "wheel"];
  function onActivity(e) {
    if (!idle) {
      resetIdle();
      return;
    }
    if (!wakeEvents.includes(e.type)) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    exitIdle();
  }
  ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].forEach((type) =>
    window.addEventListener(type, onActivity, { capture: true, passive: type !== "keydown" && type !== "wheel" })
  );

  function startIdleWatch() {
    const params = new URLSearchParams(location.search);
    if (isHome() && params.has(IDLE_FLAG)) {
      history.replaceState(null, "", location.pathname + location.hash);
      enterIdle();
    } else {
      resetIdle();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startIdleWatch);
  else startIdleWatch();
})();

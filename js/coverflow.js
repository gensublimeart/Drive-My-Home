import * as THREE from "./vendor/three.module.min.js";

const CARD_W = 1;
const CARD_H = 4 / 3;
const FOV = 32;
const MAX_PIXEL_RATIO = 1.5;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

const photos = JSON.parse(document.getElementById("photo-data").textContent);
const stage = document.getElementById("flow-stage");
const label = document.getElementById("flow-label");
const labelTitle = label.querySelector(".flow-label-title");
const labelIndex = label.querySelector(".flow-index");
const prevBtn = document.getElementById("flow-prev");
const nextBtn = document.getElementById("flow-next");
const progressBar = document.querySelector(".flow-progress-bar");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function roundedRectAlpha(size = 256, radius = 14) {
  const w = size;
  const h = Math.round(size * (CARD_H / CARD_W));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, radius);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 32, 2, 64, 32, 62);
  g.addColorStop(0, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  return new THREE.CanvasTexture(canvas);
}

function readHashIndex() {
  const m = /photo-(\d+)/.exec(location.hash);
  if (!m) return 0;
  const i = photos.findIndex((p) => p.id === m[1].padStart(2, "0"));
  return i < 0 ? 0 : i;
}

function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

  const loader = new THREE.TextureLoader();
  const alphaMap = roundedRectAlpha();
  const shadowMap = shadowTexture();
  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const shadowGeo = new THREE.PlaneGeometry(CARD_W * 1.25, CARD_W * 0.32);
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  let needsRender = true;

  const cards = photos.map((photo, index) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xf5f5f5,
      alphaMap,
      transparent: true,
      side: THREE.DoubleSide,
    });
    loader.load(photo.cover, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      material.map = tex;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      needsRender = true;
    });

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(cardGeo, material);
    mesh.userData.index = index;
    group.add(mesh);

    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -CARD_H / 2 - 0.02;
    group.add(shadow);

    scene.add(group);
    return { group, mesh, material, shadowMat, hover: 0, press: 0 };
  });

  const ringPoints = [];
  for (let i = 0; i <= 160; i += 1) {
    const a = (i / 160) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.cos(a) * 0.98, Math.sin(a) * 0.98, 0));
  }
  const nestRing = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPoints),
    new THREE.LineDashedMaterial({
      color: 0x222222,
      dashSize: 0.035,
      gapSize: 0.055,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    })
  );
  nestRing.computeLineDistances();
  nestRing.position.z = -0.7;
  nestRing.renderOrder = -1000;
  scene.add(nestRing);

  const shutter = document.createElement("div");
  shutter.className = "flow-shutter";
  shutter.setAttribute("aria-hidden", "true");
  document.body.append(shutter);

  const layout = { spacing: 0.3, gap: 0.8, rot: 1.45, depth: 0.5, visible: 11, vertical: false };

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    const narrow = w < 720;
    Object.assign(
      layout,
      narrow
        ? { spacing: 0.22, gap: 0.98, rot: 0.78, depth: 0.32, visible: 5, vertical: true }
        : { spacing: 0.3, gap: 0.8, rot: 1.45, depth: 0.5, visible: 11, vertical: false }
    );

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const byHeight = CARD_H / (narrow ? 0.731 : 0.74) / (2 * tanHalf);
    const byWidth = CARD_W / (narrow ? 0.867 : 0.3) / (2 * tanHalf * camera.aspect);
    const z = Math.max(byHeight, byWidth);
    camera.position.set(0, narrow ? 0 : 0.04, z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    placeTicks();
    placeProgress(state.shownIndex);
    needsRender = true;
  }

  const state = {
    position: readHashIndex(),
    target: readHashIndex(),
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartPos: 0,
    dragMoved: false,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    velocity: 0,
    hoverIndex: -1,
    pressIndex: -1,
    shownIndex: -1,
    settleAt: 0,
    settleIndex: -1,
    leavingAt: 0,
  };

  const SETTLE_MS = 220;
  const LEAVE_MS = 140;

  const total = photos.length;
  const ticks = photos.map(() => {
    const tick = document.createElement("i");
    tick.className = "flow-tick";
    progressBar.before(tick);
    return tick;
  });

  function placeTicks() {
    ticks.forEach((tick, i) => {
      const along = `${(i / Math.max(1, total - 1)) * 100}%`;
      tick.style.left = layout.vertical ? "" : along;
      tick.style.top = layout.vertical ? along : "";
    });
  }
  const narrowQuery = window.matchMedia("(max-width: 720px)");
  const useVertical = () => narrowQuery.matches;
  const pxPerCard = () => {
    const span = useVertical() ? stage.clientHeight : stage.clientWidth;
    return Math.max(70, span * (useVertical() ? 0.28 : 0.09));
  };

  function nudge(button) {
    button.classList.remove("is-bump");
    void button.offsetWidth;
    button.classList.add("is-bump");
  }

  function setTarget(i) {
    const next = clamp(Math.round(i), 0, total - 1);
    if (next === Math.round(state.target) && (i < 0 || i > total - 1)) nudge(i < 0 ? prevBtn : nextBtn);
    state.target = next;
    needsRender = true;
  }

  function updateLabel(index) {
    if (index === state.shownIndex) return;
    const first = state.shownIndex < 0;
    const forward = index > state.shownIndex;
    state.shownIndex = index;
    const photo = photos[index];
    labelTitle.textContent = photo.label;
    label.href = photo.href;
    label.setAttribute("aria-label", `開啟${photo.label}報告`);
    if (labelIndex) labelIndex.textContent = `${String(index + 1).padStart(2, "0")} / ${total}`;
    ticks.forEach((tick, i) => tick.classList.toggle("is-on", i === index));
    label.classList.remove("is-changing", "is-forward", "is-back");
    if (!first) {
      void label.offsetWidth;
      label.classList.add("is-changing", forward ? "is-forward" : "is-back");
    }
    prevBtn.setAttribute("aria-disabled", String(index === 0));
    nextBtn.setAttribute("aria-disabled", String(index === total - 1));
    placeProgress(index);
    history.replaceState(null, "", `#photo-${photo.id}`);
  }

  function placeProgress(index) {
    if (index < 0) return;
    const along = `${(index / (total - 1)) * 100}%`;
    if (layout.vertical) {
      progressBar.style.left = "-1px";
      progressBar.style.top = along;
    } else {
      progressBar.style.top = "-1px";
      progressBar.style.left = along;
    }
  }

  function pulse(start, duration, now) {
    if (!start) return 0;
    const t = (now - start) / duration;
    return t >= 1 ? 0 : Math.sin(Math.PI * Math.max(0, t));
  }

  function placeCards() {
    const { spacing, gap, rot, depth, visible, vertical } = layout;
    const now = performance.now();
    const settle = pulse(state.settleAt, SETTLE_MS, now);
    const leave = state.leavingAt ? clamp((now - state.leavingAt) / LEAVE_MS, 0, 1) : 0;
    const front = Math.round(state.target);
    nestRing.rotation.z = -state.position * 0.35;
    cards.forEach((card, i) => {
      const d = i - state.position;
      const a = Math.abs(d);
      const s = Math.sign(d);
      const near = Math.min(a, 1);
      const lift = card.hover * (a < 0.5 ? 0.08 : 0.12);
      let pressScale = 1 - card.press * 0.04;
      if (i === state.settleIndex) pressScale *= 1 + settle * 0.015;
      if (i === front) pressScale *= 1 + leave * 0.04;
      const along = d * spacing + s * near * gap;
      const z = -near * depth - a * 0.015 + lift;
      const turn = s * near * rot * (1 - card.hover * 0.12);

      if (vertical) {
        card.group.position.set(0, -along, z);
        card.mesh.rotation.set(turn, 0, 0);
      } else {
        card.group.position.set(along, 0, z);
        card.mesh.rotation.set(0, -turn, 0);
      }
      card.group.rotation.set(0, 0, 0);
      card.group.scale.setScalar(pressScale);

      const fade = clamp(visible + 1 - a, 0, 1);
      card.material.opacity = fade;
      card.shadowMat.opacity = Math.min(1, fade * (1 - near * 0.6) * (1 + card.hover * 0.35));
      card.group.visible = fade > 0.001;
      card.group.renderOrder = -Math.round(a * 10);
    });
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickIndex(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(
      cards.filter((c) => c.group.visible).map((c) => c.mesh),
      false
    );
    return hits.length ? hits[0].object.userData.index : -1;
  }

  function openReport(index) {
    const href = photos[index].href;
    if (reducedMotion.matches) {
      location.href = href;
      return;
    }
    if (state.leavingAt) return;
    state.leavingAt = performance.now();
    document.body.classList.add("is-leaving");
    needsRender = true;
    setTimeout(() => (location.href = href), LEAVE_MS);
  }

  window.addEventListener("pageshow", () => {
    state.leavingAt = 0;
    document.body.classList.remove("is-leaving");
    needsRender = true;
  });

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    state.dragging = true;
    state.dragMoved = false;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.dragStartPos = state.position;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    state.lastT = performance.now();
    state.velocity = 0;
    state.pressIndex = pickIndex(e.clientX, e.clientY);
    stage.setPointerCapture(e.pointerId);
    needsRender = true;
  });

  stage.addEventListener("pointermove", (e) => {
    if (state.dragging) {
      const dx = e.clientX - state.dragStartX;
      const dy = e.clientY - state.dragStartY;
      const vertical = useVertical();
      const along = vertical ? dy : dx;
      if (!state.dragMoved && Math.hypot(dx, dy) > 8) {
        state.dragMoved = true;
        state.pressIndex = -1;
        stage.classList.add("is-dragging");
      }
      if (state.dragMoved) {
        const now = performance.now();
        const dt = Math.max(1, now - state.lastT);
        const cursor = vertical ? e.clientY : e.clientX;
        const last = vertical ? state.lastY : state.lastX;
        state.velocity = ((cursor - last) / dt) * 0.8 + state.velocity * 0.2;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        state.lastT = now;
        let pos = state.dragStartPos - along / pxPerCard();
        if (pos < 0) pos *= 0.28;
        else if (pos > total - 1) pos = total - 1 + (pos - (total - 1)) * 0.28;
        state.position = pos;
        state.target = pos;
        needsRender = true;
      }
      return;
    }
    if (e.pointerType === "mouse") {
      const i = pickIndex(e.clientX, e.clientY);
      state.hoverIndex = i;
      stage.classList.toggle("is-pointing", i >= 0);
      needsRender = true;
    }
  });

  function endDrag(e, cancelled) {
    if (!state.dragging) return;
    state.dragging = false;
    stage.classList.remove("is-dragging");
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);

    if (state.dragMoved) {
      const fling = (-state.velocity * 180) / pxPerCard();
      setTarget(state.position + clamp(fling, -4, 4));
    } else if (!cancelled) {
      const i = pickIndex(e.clientX, e.clientY);
      const front = Math.round(state.target);
      if (i >= 0 && i === front) openReport(i);
      else if (i >= 0) setTarget(i);
    }
    state.pressIndex = -1;
    needsRender = true;
  }

  stage.addEventListener("pointerup", (e) => endDrag(e, false));
  stage.addEventListener("pointercancel", (e) => endDrag(e, true));
  stage.addEventListener("pointerleave", () => {
    if (state.dragging) return;
    state.hoverIndex = -1;
    stage.classList.remove("is-pointing");
    needsRender = true;
  });

  let wheelAcc = 0;
  let wheelTimer = 0;
  stage.addEventListener(
    "wheel",
    (e) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      wheelAcc += delta;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => (wheelAcc = 0), 180);
      if (Math.abs(wheelAcc) >= 45) {
        setTarget(state.target + Math.sign(wheelAcc));
        wheelAcc = 0;
      }
    },
    { passive: false }
  );

  stage.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") setTarget(state.target + 1);
    else if (e.key === "ArrowLeft") setTarget(state.target - 1);
    else if (e.key === "Home") setTarget(0);
    else if (e.key === "End") setTarget(total - 1);
    else if (e.key === "Enter" || e.key === " ") openReport(Math.round(state.target));
    else return;
    e.preventDefault();
  });

  prevBtn.addEventListener("click", () => setTarget(state.target - 1));
  nextBtn.addEventListener("click", () => setTarget(state.target + 1));

  new ResizeObserver(resize).observe(stage);
  resize();

  let last = performance.now();
  let running = true;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const instant = reducedMotion.matches;

    let moving = false;
    if (!state.dragging) {
      const wasMoving = state.position !== state.target;
      const next = instant ? state.target : damp(state.position, state.target, 9, dt);
      if (Math.abs(next - state.target) < 0.0005) state.position = state.target;
      else state.position = next;
      moving = state.position !== state.target;
      if (wasMoving && !moving && !instant) {
        state.settleAt = now;
        state.settleIndex = Math.round(state.target);
      }
    }
    if (pulse(state.settleAt, SETTLE_MS, now) > 0) moving = true;
    else if (state.settleAt) {
      state.settleAt = 0;
      needsRender = true;
    }
    if (state.leavingAt) moving = true;

    cards.forEach((card, i) => {
      const hoverT = !instant && i === state.hoverIndex && !state.dragging ? 1 : 0;
      const pressT = i === state.pressIndex && state.dragging ? 1 : 0;
      const h = instant ? hoverT : damp(card.hover, hoverT, 16, dt);
      const p = instant ? pressT : damp(card.press, pressT, pressT > card.press ? 22 : 12, dt);
      card.hover = Math.abs(h - hoverT) < 0.001 ? hoverT : h;
      card.press = Math.abs(p - pressT) < 0.001 ? pressT : p;
      if (card.hover !== hoverT || card.press !== pressT) moving = true;
    });

    updateLabel(clamp(Math.round(state.position), 0, total - 1));

    if (needsRender || moving || state.dragging) {
      placeCards();
      renderer.render(scene, camera);
      needsRender = false;
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      running = false;
    } else if (!running) {
      running = true;
      last = performance.now();
      needsRender = true;
      requestAnimationFrame(frame);
    }
  });

  window.addEventListener("hashchange", () => setTarget(readHashIndex()));

  document.body.classList.add("flow-ready");
  resize();
  placeCards();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

if (webglAvailable()) {
  try {
    init();
  } catch (err) {
    console.error("[coverflow] falling back to list", err);
    document.body.classList.remove("flow-ready");
  }
}

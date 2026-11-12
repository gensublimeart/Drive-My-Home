const reportNode = document.getElementById("report-data");
const host = document.getElementById("graph-root");
if (reportNode && host) {
  const scene = JSON.parse(reportNode.textContent);
  const desktop = window.matchMedia("(min-width: 960px)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const nodes = [];
  const links = [];
  const byId = new Map();

  function addNode(node) {
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  }
  function link(a, b) {
    if (a && b && a !== b && !links.some((item) => item.a === a && item.b === b)) links.push({ a, b });
  }
  function cjk(text) {
    return (text || "").replace(/[^\u4e00-\u9fff]/g, "");
  }
  function shares(a, b) {
    const left = cjk(a);
    const right = cjk(b);
    if (left.length < 2 || right.length < 2) return false;
    for (let i = 0; i < left.length - 1; i += 1) {
      if (right.includes(left.slice(i, i + 2))) return true;
    }
    return false;
  }

  // "common" nodes appear in every report: the home itself, the five themes, layout and confidence.
  const hub = addNode({ id: "hub", label: scene.label, kind: "中心", text: scene.disclaimer || "", color: "#222222", group: "common" });
  const sectionNodes = (scene.sections || []).map((section) =>
    addNode({ id: section.id, label: section.zh, kind: section.en, text: section.text, color: "#333333", group: "common" })
  );
  const layoutNode = addNode({
    id: "layout",
    label: "巢嘅頂視圖",
    kind: "LAYOUT",
    text: scene.layout || "",
    color: "#5C4033",
    group: "common",
  });
  const confidence = addNode({
    id: "confidence",
    label: "信心同限制",
    kind: "CONFIDENCE",
    text: scene.confidence || "",
    color: "#666666",
    group: "common",
  });
  const evidenceNodes = (scene.evidence || []).map((item, index) =>
    addNode({ id: `ev-${index}`, label: item.object, kind: "證據", text: item.inference, color: "#444444", group: "evidence" })
  );
  const objectNodes = (scene.topview.objects || [])
    .filter((obj) => obj.label)
    .map((obj, index) =>
      addNode({ id: `obj-${index}`, label: obj.label, kind: "物件", text: obj.notes || obj.label, color: obj.fill || "#6B7280", group: "object" })
    );

  sectionNodes.forEach((node) => link("hub", node.id));
  link("hub", "layout");
  link("hub", "confidence");
  evidenceNodes.forEach((node) => {
    link("hub", node.id);
    sectionNodes.forEach((section) => {
      if (shares(node.label, section.text) || (section.text || "").includes(node.label)) link(section.id, node.id);
    });
  });
  objectNodes.forEach((node) => {
    link("layout", node.id);
    evidenceNodes.forEach((item) => {
      if (shares(node.label, item.label)) link(node.id, item.id);
    });
    sectionNodes.forEach((section) => {
      if (shares(node.label, section.text)) link(node.id, section.id);
    });
  });

  const canvas = document.getElementById("graph-canvas");
  const note = document.getElementById("graph-note");
  const groupButtons = [...host.querySelectorAll("[data-group]")];
  const zoomButtons = [...host.querySelectorAll("[data-zoom]")];
  const ctx = canvas.getContext("2d");
  const FONT = "'Segoe UI', 'Microsoft JhengHei', sans-serif";
  const MIN_K = 0.6;
  const MAX_K = 2.6;
  let width = 1;
  let height = 1;
  let ratio = 1;
  let selected = null;
  let hover = null;
  let drag = null;
  let moved = false;
  let running = false;
  let group = "all";
  let lastTime = 0;
  let lastFocus = null;
  let dashAt = 0;
  let closeTimer = 0;
  let pressed = null;
  let gesture = null;
  let pinch = null;
  let panFrom = null;
  let viewGoal = null;
  let slop = 6;
  const view = { x: 0, y: 0, k: 1 };
  const down = { x: 0, y: 0 };
  const touches = new Map();
  const ease = (current, target, dt, ms) => current + (target - current) * (1 - Math.exp(-dt / ms));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function place() {
    const cx = width / 2;
    const cy = height / 2;
    hub.x = cx;
    hub.y = cy;
    const ring = (list, radius) => {
      list.forEach((node, index) => {
        const a = (index / list.length) * Math.PI * 2 - Math.PI / 2;
        node.x = cx + Math.cos(a) * radius;
        node.y = cy + Math.sin(a) * radius * 0.72;
      });
    };
    ring(sectionNodes.concat([layoutNode, confidence]), Math.min(width, height) * 0.28);
    ring(evidenceNodes, Math.min(width, height) * 0.4);
    objectNodes.forEach((node, index) => {
      const a = (index / Math.max(objectNodes.length, 1)) * Math.PI * 2;
      node.x = (layoutNode.x || cx) + Math.cos(a) * 90;
      node.y = (layoutNode.y || cy) + Math.sin(a) * 70;
    });
    nodes.forEach((node) => {
      node.vx = 0;
      node.vy = 0;
      node.pin = false;
      node.placed = false;
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    if (nodes[0].x == null) place();
  }

  function neighbors(id) {
    const set = new Set([id]);
    links.forEach((item) => {
      if (item.a === id) set.add(item.b);
      if (item.b === id) set.add(item.a);
    });
    return set;
  }

  function matches(node) {
    return group === "all" || node.group === group;
  }

  function step() {
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const force = 2200 / (dist * dist);
        dx /= dist;
        dy /= dist;
        if (!nodes[i].pin) {
          nodes[i].vx -= dx * force;
          nodes[i].vy -= dy * force;
        }
        if (!nodes[j].pin) {
          nodes[j].vx += dx * force;
          nodes[j].vy += dy * force;
        }
      }
    }
    links.forEach((item) => {
      const a = byId.get(item.a);
      const b = byId.get(item.b);
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const delta = (dist - 150) * 0.012;
      dx = (dx / dist) * delta;
      dy = (dy / dist) * delta;
      if (!a.pin) {
        a.vx += dx;
        a.vy += dy;
      }
      if (!b.pin) {
        b.vx -= dx;
        b.vy -= dy;
      }
    });
    nodes.forEach((node) => {
      if (node.pin) return;
      node.vx += (cx - node.x) * 0.004;
      node.vy += (cy - node.y) * 0.004;
      node.vx *= 0.78;
      node.vy *= 0.78;
      node.x = clamp(node.x + node.vx, 24, width - 24);
      node.y = clamp(node.y + node.vy, 18, height - 18);
    });
  }

  function moveView(dt) {
    if (!viewGoal) return;
    if (reduced.matches) {
      Object.assign(view, viewGoal);
      viewGoal = null;
      return;
    }
    view.x = ease(view.x, viewGoal.x, dt, 90);
    view.y = ease(view.y, viewGoal.y, dt, 90);
    view.k = ease(view.k, viewGoal.k, dt, 90);
    if (Math.abs(view.k - viewGoal.k) < 0.001 && Math.hypot(view.x - viewGoal.x, view.y - viewGoal.y) < 0.3) {
      Object.assign(view, viewGoal);
      viewGoal = null;
    }
  }

  function draw(time) {
    const dt = lastTime ? Math.min(50, time - lastTime) : 16;
    lastTime = time;
    const instant = reduced.matches;
    moveView(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio * view.k, 0, 0, ratio * view.k, ratio * view.x, ratio * view.y);
    const focus = hover || selected;
    const keep = focus ? neighbors(focus.id) : null;
    if (focus !== lastFocus) {
      lastFocus = focus;
      dashAt = focus && !instant ? time : 0;
    }
    const dashT = dashAt ? (time - dashAt) / 500 : 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#222222";
    links.forEach((item) => {
      const a = byId.get(item.a);
      const b = byId.get(item.b);
      const hot = keep && keep.has(a.id) && keep.has(b.id);
      const faded = (keep && !hot) || !matches(a) || !matches(b);
      const target = faded ? 0.05 : hot ? 0.85 : 0.28;
      item.alpha = instant || item.alpha == null ? target : ease(item.alpha, target, dt, 120);
      ctx.globalAlpha = item.alpha;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (hot && dashT < 1 && (a === focus || b === focus)) {
        const from = a === focus ? a : b;
        const to = a === focus ? b : a;
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const head = Math.min(len, len * dashT + 6);
        const tail = Math.max(0, head - 12);
        const ux = (to.x - from.x) / len;
        const uy = (to.y - from.y) / len;
        ctx.globalAlpha = 1 - dashT * 0.6;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(from.x + ux * tail, from.y + uy * tail);
        ctx.lineTo(from.x + ux * head, from.y + uy * head);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.lineCap = "butt";
      }
    });
    if (dashT >= 1) dashAt = 0;

    nodes.forEach((node, index) => {
      const common = node.group === "common";
      const faded = (keep && !keep.has(node.id)) || !matches(node);
      const lifted = node === drag && moved;
      const bob = node !== drag && !instant ? Math.sin(time / 900 + index) * 1.4 : 0;
      const hotTarget = node === selected || node === hover ? 1 : 0;
      const squishTarget = node === pressed ? 1 : 0;
      const alphaTarget = faded ? 0.12 : 1;
      node.hot = instant || node.hot == null ? hotTarget : ease(node.hot, hotTarget, dt, 120);
      node.squish = instant || node.squish == null ? squishTarget : ease(node.squish, squishTarget, dt, 70);
      node.alpha = instant || node.alpha == null ? alphaTarget : ease(node.alpha, alphaTarget, dt, 150);
      const base = node.id === "hub" ? 8 : common ? 6.5 : 4.5;
      node.r = (base + node.hot * 2) * (1 - node.squish * 0.22);
      node.drawY = node.y + bob;
      ctx.globalAlpha = node.alpha;
      if (lifted) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(node.x + 2, node.drawY + 4, node.r + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (common) {
        ctx.save();
        ctx.globalAlpha = node.alpha * 0.16;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.drawY, node.r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.fillStyle = node.color;
      ctx.arc(node.x, node.drawY, node.r, 0, Math.PI * 2);
      ctx.fill();
      if (node.hot > 0.01) {
        ctx.save();
        ctx.globalAlpha = node.alpha * node.hot;
        ctx.strokeStyle = "#222222";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.globalAlpha = node.alpha * node.hot * 0.35;
        ctx.arc(node.x, node.drawY, node.r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    nodes.forEach((node) => {
      const common = node.group === "common";
      ctx.font = `${common ? 500 : 300} 19.5px ${FONT}`;
      if (node.textW == null) node.textW = ctx.measureText(node.label).width;
      const box = { x: node.x + node.r + 6, y: node.drawY - 16.5, w: node.textW + 20, h: 33 };
      node.box = box;
      ctx.globalAlpha = node.alpha;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, 4);
      ctx.fillStyle = common ? "#222222" : "rgba(255, 255, 255, 0.92)";
      ctx.fill();
      if (!common || node.hot > 0.01) {
        ctx.lineWidth = common ? 2 : 1;
        ctx.strokeStyle = common ? `rgba(34, 34, 34, ${0.35 * node.hot})` : node.hot > 0.5 ? "#222222" : "rgba(0, 0, 0, 0.14)";
        ctx.stroke();
      }
      ctx.fillStyle = common ? "#ffffff" : "#222222";
      ctx.fillText(node.label, box.x + 10, node.drawY + 0.5);
    });
    ctx.globalAlpha = 1;
  }

  function toWorld(p) {
    return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k };
  }

  function hit(p, pointerType) {
    const w = toWorld(p);
    let found = null;
    let best = (pointerType === "mouse" ? 22 : 36) / view.k;
    nodes.forEach((node) => {
      const dist = Math.hypot(node.x - w.x, node.y - w.y);
      if (dist < best) {
        best = dist;
        found = node;
      }
    });
    if (found) return found;
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const box = nodes[i].box;
      if (box && w.x >= box.x && w.x <= box.x + box.w && w.y >= box.y && w.y <= box.y + box.h) return nodes[i];
    }
    return null;
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function closeNote() {
    selected = null;
    clearTimeout(closeTimer);
    if (note.hidden) return;
    if (reduced.matches) {
      note.hidden = true;
      return;
    }
    note.classList.add("is-closing");
    closeTimer = setTimeout(() => {
      note.hidden = true;
      note.classList.remove("is-closing");
    }, 120);
  }

  function openNote(node) {
    selected = node;
    clearTimeout(closeTimer);
    note.classList.remove("is-closing");
    note.hidden = false;
    note.style.animation = "none";
    void note.offsetWidth;
    note.style.animation = "";
    const related = [...neighbors(node.id)]
      .filter((id) => id !== node.id)
      .map((id) => byId.get(id));
    note.innerHTML = "";
    const head = document.createElement("div");
    head.className = "graph-note-head";
    head.innerHTML = `<div class="meta">${node.kind}</div><h2></h2><button class="btn" type="button" aria-label="關閉">×</button>`;
    head.querySelector("h2").textContent = node.label;
    head.querySelector("button").addEventListener("click", closeNote);
    const body = document.createElement("p");
    body.textContent = node.text || "（未有文字）";
    const back = document.createElement("div");
    back.className = "graph-backlinks";
    const caption = document.createElement("div");
    caption.className = "meta";
    caption.textContent = "連結";
    back.append(caption);
    related.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.style.setProperty("--i", index);
      button.textContent = item.label;
      button.addEventListener("click", () => openNote(item));
      back.append(button);
    });
    note.append(head, body, back);
    document.dispatchEvent(new CustomEvent("report-focus", { detail: { label: node.label, source: "graph" } }));
  }

  function startPan(p) {
    gesture = "pan";
    panFrom = { px: p.x, py: p.y, vx: view.x, vy: view.y };
  }

  function startPinch() {
    const [a, b] = [...touches.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    gesture = "pinch";
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k, wx: (mx - view.x) / view.k, wy: (my - view.y) / view.k };
  }

  function releaseNode() {
    if (drag) {
      drag.placed = drag.placed || moved;
      drag.pin = drag.placed;
    }
    drag = null;
    pressed = null;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const p = point(event);
    // A pointer whose pointerup never arrived would otherwise turn every later tap into a pinch.
    if (event.isPrimary) touches.clear();
    touches.set(event.pointerId, p);
    viewGoal = null;
    if (touches.size === 1) {
      moved = false;
      // Fingers wobble while tapping; a tight slop turns taps into tiny drags that never open the note.
      slop = event.pointerType === "mouse" ? 6 : 16;
      Object.assign(down, p);
      const node = hit(p, event.pointerType);
      if (node) {
        gesture = "node";
        drag = node;
        pressed = node;
        node.pin = true;
      } else {
        startPan(p);
        canvas.style.cursor = "grabbing";
      }
    } else if (touches.size === 2) {
      releaseNode();
      moved = true;
      startPinch();
    }
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const p = point(event);
    if (!touches.has(event.pointerId)) {
      if (event.pointerType !== "mouse") return;
      const node = hit(p, event.pointerType);
      if (node !== hover) hover = node;
      canvas.style.cursor = node ? "pointer" : "grab";
      return;
    }
    touches.set(event.pointerId, p);
    if (gesture === "pinch") {
      const [a, b] = [...touches.values()];
      const k = clamp((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, MIN_K, MAX_K);
      view.k = k;
      view.x = (a.x + b.x) / 2 - pinch.wx * k;
      view.y = (a.y + b.y) / 2 - pinch.wy * k;
      return;
    }
    if (!moved && Math.hypot(p.x - down.x, p.y - down.y) < slop) return;
    moved = true;
    if (gesture === "node" && drag) {
      const w = toWorld(p);
      drag.x = clamp(w.x, 24, width - 24);
      drag.y = clamp(w.y, 18, height - 18);
      drag.vx = 0;
      drag.vy = 0;
    } else if (gesture === "pan") {
      view.x = panFrom.vx + p.x - panFrom.px;
      view.y = panFrom.vy + p.y - panFrom.py;
    }
  });

  function lift(event, cancelled) {
    if (!touches.has(event.pointerId)) return;
    touches.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (gesture === "pinch") {
      if (touches.size === 1) startPan([...touches.values()][0]);
      else if (touches.size === 2) startPinch();
      return;
    }
    if (touches.size) return;
    if (!cancelled && !moved) {
      if (drag) openNote(drag);
      else closeNote();
    }
    releaseNode();
    gesture = null;
    canvas.style.cursor = "grab";
  }

  canvas.addEventListener("pointerup", (event) => lift(event, false));
  canvas.addEventListener("pointercancel", (event) => lift(event, true));
  canvas.addEventListener("lostpointercapture", (event) => lift(event, true));
  canvas.addEventListener("pointerleave", () => {
    if (!touches.size) hover = null;
  });

  function zoomTo(k) {
    const from = viewGoal || view;
    const next = clamp(k, MIN_K, MAX_K);
    const wx = (width / 2 - from.x) / from.k;
    const wy = (height / 2 - from.y) / from.k;
    viewGoal = { k: next, x: width / 2 - wx * next, y: height / 2 - wy * next };
  }

  zoomButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.zoom;
      if (action === "in") zoomTo((viewGoal || view).k * 1.3);
      else if (action === "out") zoomTo((viewGoal || view).k / 1.3);
      else {
        place();
        closeNote();
        setGroup("all");
        viewGoal = { x: 0, y: 0, k: 1 };
      }
    });
  });

  function setGroup(next) {
    group = next;
    groupButtons.forEach((button) => button.classList.toggle("is-on", button.dataset.group === next));
  }

  groupButtons.forEach((button) => {
    button.addEventListener("click", () => setGroup(button.dataset.group === group ? "all" : button.dataset.group));
  });

  document.addEventListener("report-focus", (event) => {
    if (event.detail?.source === "graph" || !event.detail?.label) return;
    const node = nodes.find((item) => shares(item.label, event.detail.label) || item.label.includes(event.detail.label));
    if (node) openNote(node);
  });

  function frame(time) {
    if (!running) return;
    if (!reduced.matches) step();
    draw(time);
    requestAnimationFrame(frame);
  }

  function start() {
    if (!desktop.matches) {
      running = false;
      document.body.classList.remove("has-graph");
      return;
    }
    document.body.classList.add("has-graph");
    resize();
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  new ResizeObserver(resize).observe(canvas);
  desktop.addEventListener("change", start);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) running = false;
    else start();
  });
  start();
}

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

  const hub = addNode({ id: "hub", label: scene.label, kind: "中心", text: scene.disclaimer || "", color: "#222222" });
  const sectionNodes = (scene.sections || []).map((section) =>
    addNode({ id: section.id, label: section.zh, kind: section.en, text: section.text, color: "#333333" })
  );
  const layoutNode = addNode({ id: "layout", label: "巢嘅頂視圖", kind: "LAYOUT", text: scene.layout || "", color: "#5C4033" });
  const confidence = addNode({
    id: "confidence",
    label: "信心同限制",
    kind: "CONFIDENCE",
    text: scene.confidence || "",
    color: "#666666",
  });
  const evidenceNodes = (scene.evidence || []).map((item, index) =>
    addNode({ id: `ev-${index}`, label: item.object, kind: "證據", text: item.inference, color: "#444444" })
  );
  const objectNodes = (scene.topview.objects || [])
    .filter((obj) => obj.label)
    .map((obj, index) => addNode({ id: `obj-${index}`, label: obj.label, kind: "物件", text: obj.notes || obj.label, color: obj.fill || "#6B7280" }));

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
  const filter = document.getElementById("graph-filter");
  const ctx = canvas.getContext("2d");
  let width = 1;
  let height = 1;
  let selected = null;
  let hover = null;
  let drag = null;
  let moved = false;
  let running = false;
  let query = "";
  let lastTime = 0;
  let lastFocus = null;
  let dashAt = 0;
  let pulseNode = null;
  let pulseAt = 0;
  let lastSingle = null;
  let closeTimer = 0;
  let pressed = null;
  const dragVel = { x: 0, y: 0, t: 0, px: 0, py: 0 };
  const ease = (current, target, dt, ms) => current + (target - current) * (1 - Math.exp(-dt / ms));

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
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
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
    if (!query) return true;
    return `${node.label} ${node.text}`.toLowerCase().includes(query);
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
      node.x = Math.min(width - 24, Math.max(24, node.x + node.vx));
      node.y = Math.min(height - 18, Math.max(18, node.y + node.vy));
    });
  }

  function draw(time) {
    const dt = lastTime ? Math.min(50, time - lastTime) : 16;
    lastTime = time;
    const instant = reduced.matches;
    ctx.clearRect(0, 0, width, height);
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
      const faded = (keep && !hot) || (query && (!matches(a) || !matches(b)));
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
    const pulse = pulseNode && !instant ? Math.max(0, 1 - (time - pulseAt) / 360) : 0;
    if (!pulse) pulseNode = null;
    nodes.forEach((node, index) => {
      const faded = (keep && !keep.has(node.id)) || (query && !matches(node));
      const lifted = node === drag && moved;
      const bob = !node.pin && !instant ? Math.sin(time / 900 + index) * 1.4 : 0;
      const hotTarget = node === selected || node === hover ? 1 : 0;
      const squishTarget = node === pressed ? 1 : 0;
      const alphaTarget = faded ? 0.12 : 1;
      node.hot = instant || node.hot == null ? hotTarget : ease(node.hot, hotTarget, dt, 120);
      node.squish = instant || node.squish == null ? squishTarget : ease(node.squish, squishTarget, dt, 70);
      node.alpha = instant || node.alpha == null ? alphaTarget : ease(node.alpha, alphaTarget, dt, 150);
      const base = node.id === "hub" ? 7 : 4.5;
      const radius =
        (base + node.hot * 2 + (node === pulseNode ? Math.sin(Math.PI * (1 - pulse)) * 4 : 0)) *
        (1 - node.squish * 0.22);
      const y = node.y + bob;
      ctx.globalAlpha = node.alpha;
      if (lifted) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(node.x + 2, y + 4, radius + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.fillStyle = node.color;
      ctx.arc(node.x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (node.hot > 0.01) {
        ctx.save();
        ctx.globalAlpha = node.alpha * node.hot;
        ctx.strokeStyle = "#222222";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.globalAlpha = node.alpha * node.hot * 0.35;
        ctx.arc(node.x, y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "#222222";
      ctx.font = "300 13px 'Segoe UI', 'Microsoft JhengHei', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(node.label, node.x + 10, node.y + bob);
    });
    ctx.globalAlpha = 1;
  }

  function hit(x, y) {
    let found = null;
    let best = 22;
    nodes.forEach((node) => {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist < best) {
        best = dist;
        found = node;
      }
    });
    return found;
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

  canvas.addEventListener("pointerdown", (event) => {
    const p = point(event);
    const node = hit(p.x, p.y);
    drag = node;
    moved = false;
    pressed = node;
    if (node) {
      node.pin = true;
      Object.assign(dragVel, { x: 0, y: 0, t: performance.now(), px: p.x, py: p.y });
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const p = point(event);
    if (drag) {
      moved = true;
      const now = performance.now();
      const dt = Math.max(1, now - dragVel.t);
      dragVel.x = ((p.x - dragVel.px) / dt) * 0.7 + dragVel.x * 0.3;
      dragVel.y = ((p.y - dragVel.py) / dt) * 0.7 + dragVel.y * 0.3;
      Object.assign(dragVel, { t: now, px: p.x, py: p.y });
      drag.x = p.x;
      drag.y = p.y;
      drag.vx = 0;
      drag.vy = 0;
      return;
    }
    const node = hit(p.x, p.y);
    if (node !== hover) hover = node;
    canvas.style.cursor = node ? "pointer" : "grab";
  });
  canvas.addEventListener("pointerup", (event) => {
    if (drag && !moved) openNote(drag);
    else if (!drag) closeNote();
    if (drag) {
      drag.pin = false;
      if (moved && performance.now() - dragVel.t < 80) {
        drag.vx = Math.max(-14, Math.min(14, dragVel.x * 8));
        drag.vy = Math.max(-14, Math.min(14, dragVel.y * 8));
      }
    }
    drag = null;
    pressed = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerleave", () => {
    if (!drag) hover = null;
  });
  filter.addEventListener("input", () => {
    query = filter.value.trim().toLowerCase();
    const found = query ? nodes.filter(matches) : [];
    const single = found.length === 1 ? found[0] : null;
    if (single && single !== lastSingle) {
      pulseNode = single;
      pulseAt = performance.now();
    }
    lastSingle = single;
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

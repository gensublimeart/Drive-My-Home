const NS = "http://www.w3.org/2000/svg";

function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function drawTopview(root, scene) {
  const objects = scene.topview.objects || [];
  const svg = el("svg", {
    class: "topview-svg",
    viewBox: "-1.9 -1.85 3.8 3.7",
    role: "img",
    "aria-label": `${scene.label} 頂視圖`,
  });
  svg.append(
    el("circle", { cx: "0", cy: "0", r: "1.06", fill: "none", stroke: "#8B6914", "stroke-width": "0.012", opacity: "0.55" }),
    el("circle", { class: "nest", cx: "0", cy: "0", r: "1", fill: "#E8DFD0", stroke: "#5C4033", "stroke-width": "0.045" })
  );

  const labelNodes = [];
  objects.forEach((obj, index) => {
    const rot = Number(obj.rot) || 0;
    const group = el("g", {
      class: "tv-obj",
      tabindex: "0",
      role: "button",
      "aria-label": obj.label || "物件",
      "data-label": obj.label || "",
    });
    group.append(
      el("rect", {
        x: String(-obj.w / 2),
        y: String(-obj.h / 2),
        width: String(obj.w),
        height: String(obj.h),
        rx: String(Math.min(0.03, obj.w, obj.h) * 0.18),
        fill: obj.fill || "#6B7280",
        stroke: "#222222",
        "stroke-width": "0.012",
        transform: `translate(${obj.x} ${-obj.y}) rotate(${-rot})`,
      }),
      el("circle", {
        class: "tv-ring",
        cx: String(obj.x),
        cy: String(-obj.y),
        r: String(Math.hypot(obj.w, obj.h) / 2 + 0.05),
        pathLength: "1",
      })
    );
    svg.append(group);

    if (!obj.label) return;
    const rad = (rot * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    let top = -Infinity;
    let midX = 0;
    for (const [lx, ly] of [
      [obj.w / 2, obj.h / 2],
      [obj.w / 2, -obj.h / 2],
      [-obj.w / 2, obj.h / 2],
      [-obj.w / 2, -obj.h / 2],
    ]) {
      const x = obj.x + lx * c - ly * s;
      const y = obj.y + lx * s + ly * c;
      midX += x;
      top = Math.max(top, y);
    }
    midX /= 4;
    const size = obj.label.length > 12 ? 0.046 : obj.label.length > 8 ? 0.055 : 0.064;
    const text = el("text", {
      class: "tv-label",
      x: String(midX),
      y: String(-(top + 0.03)),
      "text-anchor": "middle",
      "font-size": String(size),
    });
    text.textContent = obj.label;
    labelNodes.push({ text, x: midX, y: -(top + 0.03), size, index });
    svg.append(text);
    group.addEventListener("pointerenter", () => text.classList.add("is-hot"));
    group.addEventListener("pointerleave", () => text.classList.remove("is-hot"));
  });

  // Nudge labels that land on the same spot.
  labelNodes.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labelNodes.length; i += 1) {
    const prev = labelNodes[i - 1];
    const cur = labelNodes[i];
    if (Math.abs(cur.x - prev.x) < 0.45 && Math.abs(cur.y - prev.y) < cur.size) {
      cur.y = prev.y + cur.size * 1.15;
      cur.text.setAttribute("y", String(cur.y));
    }
  }

  root.replaceChildren(svg);

  function focusLabel(label) {
    svg.querySelectorAll(".tv-obj").forEach((node) => {
      const name = node.getAttribute("data-label") || "";
      node.classList.toggle("is-linked", Boolean(label) && name && (name.includes(label) || label.includes(name)));
    });
  }

  svg.addEventListener("click", (event) => {
    const obj = event.target.closest(".tv-obj");
    if (!obj) return;
    const label = obj.getAttribute("data-label") || "";
    svg.querySelectorAll(".tv-obj").forEach((node) => node.classList.toggle("is-on", node === obj));
    document.dispatchEvent(new CustomEvent("report-focus", { detail: { label, source: "topview" } }));
  });
  svg.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const obj = event.target.closest(".tv-obj");
    if (!obj) return;
    event.preventDefault();
    obj.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  document.addEventListener("report-focus", (event) => {
    if (event.detail?.source === "topview") return;
    focusLabel(event.detail?.label || "");
  });
}

const dataNode = document.getElementById("report-data");
const topviewRoot = document.getElementById("topview-root");
if (dataNode && topviewRoot) {
  drawTopview(topviewRoot, JSON.parse(dataNode.textContent));
}

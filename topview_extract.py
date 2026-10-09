"""Turn a corrected top-view PNG into nest-space shapes the site redraws as SVG."""

from __future__ import annotations

import re

import numpy as np
from PIL import Image

CATEGORY_COLORS = {
    "furniture": "#4A90A4",
    "appliance": "#E07A3D",
    "faith": "#7B6B9A",
    "media": "#3D7A5A",
    "storage": "#C4A35A",
    "other": "#6B7280",
}


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _hex(color: np.ndarray) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(int(c) for c in color))


def _components(mask: np.ndarray) -> list[np.ndarray]:
    """4-connected components. Returns a list of (N, 2) row/col index arrays."""
    h, w = mask.shape
    seen = np.zeros(mask.shape, dtype=bool)
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        cells = []
        while stack:
            y, x = stack.pop()
            cells.append((y, x))
            if y > 0 and mask[y - 1, x] and not seen[y - 1, x]:
                seen[y - 1, x] = True
                stack.append((y - 1, x))
            if y + 1 < h and mask[y + 1, x] and not seen[y + 1, x]:
                seen[y + 1, x] = True
                stack.append((y + 1, x))
            if x > 0 and mask[y, x - 1] and not seen[y, x - 1]:
                seen[y, x - 1] = True
                stack.append((y, x - 1))
            if x + 1 < w and mask[y, x + 1] and not seen[y, x + 1]:
                seen[y, x + 1] = True
                stack.append((y, x + 1))
        out.append(np.array(cells, dtype=np.int32))
    return out


def _oriented_box(points: np.ndarray) -> tuple[float, float, float, float, float]:
    """points are (row, col). Returns cx, cy, w, h, rotation degrees (image space, y down)."""
    cols = points[:, 1].astype(np.float64)
    rows = points[:, 0].astype(np.float64)
    if len(points) < 8:
        return float(cols.mean()), float(rows.mean()), float(cols.max() - cols.min() + 1), float(rows.max() - rows.min() + 1), 0.0
    pts = np.stack([cols, rows], axis=1)
    center = pts.mean(axis=0)
    cov = np.cov((pts - center).T)
    if not np.isfinite(cov).all():
        return float(center[0]), float(center[1]), 1.0, 1.0, 0.0
    vals, vecs = np.linalg.eigh(cov)
    order = np.argsort(vals)[::-1]
    major = vecs[:, order[0]]
    angle = np.degrees(np.arctan2(major[1], major[0]))
    theta = np.radians(angle)
    rot = np.array([[np.cos(theta), np.sin(theta)], [-np.sin(theta), np.cos(theta)]])
    local = (pts - center) @ rot.T
    span = local.max(axis=0) - local.min(axis=0)
    return float(center[0]), float(center[1]), float(max(span[0] + 2, 1)), float(max(span[1] + 2, 1)), float(angle)


def extract_shapes(path) -> dict:
    im = np.array(Image.open(path).convert("RGB"))
    h, w, _ = im.shape
    rch = im[:, :, 0].astype(np.int16)
    gch = im[:, :, 1].astype(np.int16)
    bch = im[:, :, 2].astype(np.int16)
    lum = im.mean(axis=2)

    ring = (rch > 70) & (rch < 160) & (gch > 35) & (gch < 120) & (bch < 90) & (rch > gch + 15) & (gch > bch + 8)
    ys, xs = np.nonzero(ring)
    if len(xs) < 50:
        raise ValueError(f"no nest ring in {path}")
    # Least-squares circle on a subsample of the ring.
    step = max(1, len(xs) // 4000)
    x = xs[::step].astype(np.float64)
    y = ys[::step].astype(np.float64)
    a = np.stack([2 * x, 2 * y, np.ones_like(x)], axis=1)
    b = x * x + y * y
    cx, cy, c = np.linalg.lstsq(a, b, rcond=None)[0]
    radius = float(np.sqrt(max(c + cx * cx + cy * cy, 1)))
    cx, cy = float(cx), float(cy)

    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot(xx - cx, yy - cy)
    interior = dist < radius * 0.93
    annulus = (dist > radius * 0.9) & (dist < radius * 1.12)

    peak = im.max(axis=2)
    chroma = peak - im.min(axis=2)
    beige = (chroma < 28) & (lum > 190) & (lum < 248)
    white_obj = (chroma < 18) & (lum >= 248)
    # Labels are near-black and dull. Saturated navy, green and red stay objects.
    text = (peak < 60) & (chroma < 40)
    colorful = chroma >= 26
    objects = interior & ~annulus & (colorful | white_obj) & ~text

    # Close small holes left by labels sitting on a fill, without merging neighbours.
    closed = objects.copy()
    for _ in range(2):
        pad = np.pad(closed, 1, constant_values=False)
        closed = (
            pad[1:-1, 1:-1]
            | pad[:-2, 1:-1]
            | pad[2:, 1:-1]
            | pad[1:-1, :-2]
            | pad[1:-1, 2:]
        ) & interior & ~annulus

    # Give label pixels the colour of the fill they sit on, so a word is not its own shape.
    quant = (im // 24).astype(np.int16)
    key = quant[:, :, 0] * 289 + quant[:, :, 1] * 17 + quant[:, :, 2]
    ink = closed & text
    for _ in range(12):
        if not ink.any():
            break
        src = closed & ~ink
        pad_k = np.pad(key, 1, constant_values=-1)
        pad_s = np.pad(src, 1, constant_values=False)
        neigh = (
            np.where(pad_s[:-2, 1:-1], pad_k[:-2, 1:-1], -1),
            np.where(pad_s[2:, 1:-1], pad_k[2:, 1:-1], -1),
            np.where(pad_s[1:-1, :-2], pad_k[1:-1, :-2], -1),
            np.where(pad_s[1:-1, 2:], pad_k[1:-1, 2:], -1),
        )
        picked = neigh[0]
        for n in neigh[1:]:
            picked = np.where(picked >= 0, picked, n)
        take = ink & (picked >= 0)
        key = np.where(take, picked, key)
        ink = ink & ~take
    shapes = []
    for code in np.unique(key[closed]):
        comp_mask = closed & (key == code)
        if int(comp_mask.sum()) < 80:
            continue
        for cells in _components(comp_mask):
            if len(cells) < 80:
                continue
            px, py, bw, bh, ang = _oriented_box(cells)
            fill = np.median(im[cells[:, 0], cells[:, 1]], axis=0)
            if float(fill.mean()) < 45:
                continue
            if (bw * bh) / (radius * radius) < 0.008:
                continue
            if min(bw, bh) / radius < 0.035:
                continue
            shapes.append(
                {
                    "fill": _hex(fill),
                    "x": (px - cx) / radius,
                    "y": (cy - py) / radius,
                    "w": bw / radius,
                    "h": bh / radius,
                    "rot": -ang,
                    "label": "",
                    "_px": px,
                    "_py": py,
                    "_bw": bw,
                    "_bh": bh,
                }
            )

    shapes.sort(key=lambda s: s["w"] * s["h"], reverse=True)
    # Drop fragments that sit inside a much larger shape of nearly the same colour.
    kept = []
    for shape in shapes:
        swallow = False
        for parent in kept:
            if abs(shape["x"] - parent["x"]) < parent["w"] * 0.45 and abs(shape["y"] - parent["y"]) < parent["h"] * 0.45:
                if shape["w"] * shape["h"] < parent["w"] * parent["h"] * 0.15:
                    same = sum(abs(a - b) for a, b in zip(_rgb(shape["fill"]), _rgb(parent["fill"]))) < 50
                    if same:
                        swallow = True
                        break
        if not swallow:
            kept.append(shape)

    # Keep the lettering, drop the rounded-rectangle strokes (they confuse OCR).
    core = np.pad(closed, 1, constant_values=False)
    inner = (
        core[:-2, 1:-1]
        & core[2:, 1:-1]
        & core[1:-1, :-2]
        & core[1:-1, 2:]
        & core[1:-1, 1:-1]
    )
    stroke = np.pad(closed & ~inner, 2, constant_values=False)
    stroke = (
        stroke[2:-2, 2:-2]
        | stroke[:-4, 2:-2]
        | stroke[4:, 2:-2]
        | stroke[2:-2, :-4]
        | stroke[2:-2, 4:]
    )
    plate = np.full((h, w), 255, dtype=np.uint8)
    plate[text & ~stroke] = 0
    return {
        "radius": 1.0,
        "cx": cx,
        "cy": cy,
        "r": radius,
        "width": w,
        "height": h,
        "objects": kept,
        "plate": plate,
    }


def upright_crop(rgb: np.ndarray, shape: dict, cx: float, cy: float, radius: float):
    """Return the shape's lettering rotated horizontal, or None."""
    px = cx + shape["x"] * radius
    py = cy - shape["y"] * radius
    ang = -shape["rot"]
    while ang > 90:
        ang -= 180
    while ang <= -90:
        ang += 180
    theta = np.radians(ang)
    c, s = np.cos(theta), np.sin(theta)
    hw = shape["w"] * radius / 2 + 8
    hh = shape["h"] * radius / 2 + 8
    corners = []
    for sx in (-hw, hw):
        for sy in (-hh, hh):
            corners.append((px + sx * c - sy * s, py + sx * s + sy * c))
    xs, ys = zip(*corners)
    h, w, _ = rgb.shape
    x0, x1 = max(0, int(min(xs)) - 6), min(w, int(max(xs)) + 7)
    y0, y1 = max(0, int(min(ys)) - 6), min(h, int(max(ys)) + 7)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    crop = Image.fromarray(rgb[y0:y1, x0:x1])
    crop = crop.rotate(ang, expand=True, fillcolor=(255, 255, 255), resample=Image.Resampling.BICUBIC)
    arr = np.array(crop)
    lum = arr.mean(axis=2)
    plate = np.full(arr.shape[:2], 255, dtype=np.uint8)
    plate[lum < 80] = 0
    if int(plate.size - plate.sum() / 255) < 30:
        return None
    return Image.fromarray(plate).resize((plate.shape[1] * 2, plate.shape[0] * 2), Image.Resampling.NEAREST)


def _tighten(text: str) -> str:
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"(?<=[\u4e00-\u9fff()])\s+(?=[\u4e00-\u9fff()])", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _cjk_count(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fff]", text))


def _point_gap(px: float, py: float, shape: dict) -> tuple[float, bool]:
    dx = px - shape["x"]
    dy = py - shape["y"]
    th = np.radians(shape["rot"])
    c, s = np.cos(th), np.sin(th)
    lx = dx * c + dy * s
    ly = -dx * s + dy * c
    ox = max(abs(lx) - shape["w"] / 2, 0)
    oy = max(abs(ly) - shape["h"] / 2, 0)
    inside = ox == 0 and oy == 0
    return (0.0 if inside else float(np.hypot(ox, oy)), inside)


def _fill_kind(fill: str) -> str:
    r, g, b = _rgb(fill)
    chroma = max(r, g, b) - min(r, g, b)
    if min(r, g, b) > 225 and chroma < 35:
        return "white"
    if r > 190 and g > 170 and b < 90:
        return "yellow"
    if r > 170 and g < 90 and b < 90:
        return "red"
    if r > 170 and b > 140 and g > 110 and r >= g:
        return "pink"
    if r > 130 and g > 80 and b < 90 and r > b + 40:
        return "gold"
    if g > r + 15 and g > b + 15:
        return "green"
    if b > r + 15 and b >= g - 10:
        return "blue"
    if r > 70 and b > 70 and g < r - 10 and g < b:
        return "purple"
    if chroma < 30:
        return "gray"
    return "other"


def _hue_bias(text: str, fill: str) -> float:
    wants = []
    if "粉" in text:
        wants.append("pink")
    elif "紅" in text:
        wants.append("red")
    if "黃" in text:
        wants.append("yellow")
    if "藍" in text or "青" in text:
        wants.append("blue")
    if "綠" in text:
        wants.append("green")
    if "紫" in text:
        wants.append("purple")
    if "金" in text or "啡" in text or "棕" in text:
        wants.append("gold")
    if "白" in text:
        wants.append("white")
    if "灰" in text or "黑" in text:
        wants.append("gray")
    if not wants:
        return 0.0
    return -0.4 if _fill_kind(fill) in wants else 0.3


def assign_labels(extracted: dict, lines: list[dict], notes: str) -> dict:
    w = extracted["width"]
    h = extracted["height"]
    cx, cy, radius = extracted["cx"], extracted["cy"], extracted["r"]
    objects = []
    for shape in extracted["objects"]:
        objects.append({k: v for k, v in shape.items() if not k.startswith("_")})

    captions = []
    for line in lines:
        words = line.get("words") or []
        if isinstance(words, dict):
            words = [words]
        text = _tighten(line.get("text") or "")
        if _cjk_count(text) < 2:
            continue
        if "頂視" in text or text.lower() in {"furniture", "other", "storage", "media"}:
            continue
        xs = [float(word["x"]) + float(word["w"]) / 2 for word in words]
        ys = [float(word["y"]) + float(word["h"]) / 2 for word in words]
        if not xs:
            continue
        if min(ys) > h * 0.9:
            continue
        if min(xs) > w * 0.72 and min(ys) > h * 0.72:
            continue
        nx = (sum(xs) / len(xs) - cx) / radius
        ny = (cy - sum(ys) / len(ys)) / radius
        captions.append((text, nx, ny))

    buckets: dict[int, list[tuple[float, str]]] = {i: [] for i in range(len(objects))}
    for text, nx, ny in captions:
        best_i = None
        best_key = None
        for i, shape in enumerate(objects):
            gap, inside = _point_gap(nx, ny, shape)
            score = gap + _hue_bias(text, shape["fill"])
            if inside:
                score -= 0.15
            if score > 0.42:
                continue
            key = (score, shape["w"] * shape["h"] if inside else score)
            if best_key is None or key < best_key:
                best_key = key
                best_i = i
        if best_i is not None:
            buckets[best_i].append((ny, text))

    for i, shape in enumerate(objects):
        ordered = [text for _, text in sorted(buckets[i], key=lambda item: -item[0])]
        seen = []
        for text in ordered:
            if text not in seen:
                seen.append(text)
        shape["label"] = " ".join(seen)
        shape["notes"] = ""

    return {"radius": 1.0, "notes": notes, "source": "topview-fix", "objects": objects}


def layout_fallback(layout: dict) -> dict:
    return {
        "radius": float(layout.get("nest_radius") or 1),
        "notes": layout.get("notes") or "",
        "source": "layout",
        "objects": [
            {
                "label": obj.get("label_zh") or "",
                "fill": CATEGORY_COLORS.get(obj.get("category") or "", CATEGORY_COLORS["other"]),
                "x": float(obj.get("x") or 0),
                "y": float(obj.get("y") or 0),
                "w": float(obj.get("size") or 0.2),
                "h": float(obj.get("size") or 0.2),
                "rot": 0,
                "notes": obj.get("notes") or "",
            }
            for obj in layout.get("objects") or []
        ],
    }

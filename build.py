"""Generate the static resident prediction website from resident_predictive_system/output."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from html import escape
from pathlib import Path

import numpy as np
from PIL import Image

from topview_extract import assign_labels, extract_shapes, layout_fallback, upright_crop

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "resident_predictive_system" / "output"
LOGO_SRC = (
    ROOT.parents[1] / "0. Document" / "Workshop_PPT_20MAR2026" / "assets" / "auction_game_html" / "logo"
)

TITLE_ZH = "屋企在途中 · 居民預測報告"
TITLE_EN = "Drive My Home"
DISCLAIMER = "本網站為藝術科技項目之詮釋性預測（築巢 Weaving Home 藝術詮釋），並非心理／臨床診斷。"

SECTIONS = [
    ("household", "屋企嘅人", "HOUSEHOLD"),
    ("personality", "性格", "PERSONALITY"),
    ("motivation", "動機", "MOTIVATION"),
    ("needs", "需求", "NEEDS"),
    ("experiences", "經歷", "EXPERIENCES"),
]

REPORT_FIELDS = {
    "巢嘅頂視圖": "layout_notes",
    "屋企嘅人": "household",
    "性格": "personality",
    "動機": "motivation",
    "需求": "needs",
    "經歷": "experiences",
}


def parse_report_md(text: str) -> dict:
    """Read narrative fields from a Marp report.md. analysis.json is the previous draft."""
    lines = text.replace("\r\n", "\n").split("\n")
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                lines = lines[index + 1 :]
                break

    blocks: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        heading = re.match(r"^#\s+(.+?)\s*$", line)
        if heading:
            title = heading.group(1).strip()
            current = REPORT_FIELDS.get(title)
            if title.startswith("證據摘要"):
                current = "evidence_block"
            if current is not None:
                blocks.setdefault(current, [])
            continue
        if current:
            blocks[current].append(line)

    def prose(raw: str) -> str:
        kept = []
        for line in raw.split("\n"):
            stripped = line.strip()
            if not stripped:
                kept.append("")
                continue
            if stripped.startswith("![") or stripped == "---" or stripped.startswith("<!--"):
                continue
            if stripped.startswith("*《"):
                continue
            kept.append(line.rstrip())
        return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()

    evidence_body = "\n".join(blocks.get("evidence_block", []))
    confidence = ""
    split = re.search(r"^###\s*信心同限制\s*$", evidence_body, flags=re.M)
    if split:
        table_body = evidence_body[: split.start()]
        confidence = evidence_body[split.end() :]
    else:
        split = re.search(r"^\*\*信心同限制[：:]\*\*\s*", evidence_body, flags=re.M)
        if split:
            table_body = evidence_body[: split.start()]
            confidence = evidence_body[split.end() :]
        else:
            table_body = evidence_body

    evidence = []
    for line in table_body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 2 or re.fullmatch(r":?-{3,}:?", cells[0]):
            continue
        if cells[0] in {"物件", "可見項目", "可見證據"}:
            continue
        evidence.append({"object": cells[0], "inference": cells[1]})

    parsed = {key: prose("\n".join(blocks.get(key, []))) for key in REPORT_FIELDS.values()}
    parsed["evidence"] = evidence
    parsed["confidence_notes"] = prose(confidence)
    missing = [key for key in (*REPORT_FIELDS.values(), "confidence_notes") if not parsed.get(key)]
    if missing or not evidence:
        raise ValueError(f"incomplete report.md ({', '.join(missing) or 'evidence'})")
    return parsed


KEYWORD_COUNT_SCRIPT = """  <script>
    (() => {
      const node = document.querySelector(".keyword-count");
      if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const total = Number(node.dataset.count) || 0;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 600);
        node.textContent = String(Math.round(total * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })();
  </script>"""


def load_photos() -> list[dict]:
    photos = []
    for folder in sorted(SOURCE.glob("photo_*")):
        report_path = folder / "report.md"
        analysis_path = folder / "analysis.json"
        if report_path.exists():
            try:
                analysis = parse_report_md(report_path.read_text(encoding="utf-8"))
            except ValueError as exc:
                raise SystemExit(f"{folder.name}: {exc}") from exc
        elif analysis_path.exists():
            analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        else:
            continue
        photo_id = folder.name.split("_", 1)[1]
        photos.append(
            {
                "id": photo_id,
                "label": f"屋企 {photo_id}",
                "folder": folder,
                "analysis": analysis,
            }
        )
    return photos


def copy_media(photos: list[dict]) -> None:
    for photo in photos:
        dest = ROOT / "media" / f"photo_{photo['id']}"
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(photo["folder"] / "cover.jpg", dest / "cover.jpg")
        fix = photo["folder"] / "topview fix.png"
        plain = photo["folder"] / "topview.png"
        src = fix if fix.exists() else plain
        if src.exists():
            shutil.copy2(src, dest / "topview.png")


def copy_logos() -> None:
    dest = ROOT / "assets" / "logo"
    dest.mkdir(parents=True, exist_ok=True)
    targets = {"logo.png": 144, "program_name_nextbylogo.png": 88}
    try:
        from PIL import Image
    except ImportError:
        for name in targets:
            shutil.copy2(LOGO_SRC / name, dest / name)
        return
    for name, height in targets.items():
        with Image.open(LOGO_SRC / name) as im:
            width = round(im.width * height / im.height)
            im.resize((width, height), Image.LANCZOS).save(dest / name, optimize=True)


def asset_version() -> str:
    files = [
        ROOT / "js" / "boot.js",
        ROOT / "js" / "coverflow.js",
        ROOT / "js" / "topview.js",
        ROOT / "js" / "graph.js",
        ROOT / "js" / "report.js",
        ROOT / "css" / "style.css",
    ]
    return str(max(int(f.stat().st_mtime) for f in files if f.exists()))


def head(title: str, prefix: str) -> str:
    return f"""<!doctype html>
<html lang="zh-Hant-HK">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#ffffff" />
  <title>{escape(title)}</title>
  <link rel="icon" href="{prefix}assets/logo/logo.png" />
  <link rel="stylesheet" href="{prefix}css/style.css?v={asset_version()}" />
  <script src="{prefix}js/boot.js?v={asset_version()}"></script>
</head>"""


def header(prefix: str, nav: str) -> str:
    return f"""  <div class="site-header-bg" aria-hidden="true"></div>
  <header class="site-logo">
    <a href="{prefix}index.html" aria-label="返回目錄">
      <img src="{prefix}assets/logo/logo.png" alt="" class="logo-icon" width="36" height="36" />
      <img src="{prefix}assets/logo/program_name_nextbylogo.png" alt="屋企在途中 Drive My Home" class="logo-text" />
    </a>
  </header>
{f'''  <nav class="site-nav" aria-label="網站">
{nav}
  </nav>''' if nav.strip() else ""}"""


def footer() -> str:
    return f'  <footer class="site-footer">《{TITLE_EN}》· ELCHK · 藝術詮釋／非診斷</footer>'


def build_index(photos: list[dict]) -> None:
    data = [
        {
            "id": p["id"],
            "label": p["label"],
            "cover": f"media/photo_{p['id']}/cover.jpg",
            "href": f"photos/photo-{p['id']}.html",
        }
        for p in photos
    ]
    fallback = "\n".join(
        f"""      <li><a href="{d['href']}"><img src="{d['cover']}" alt="{d['label']} 巢" loading="lazy" width="675" height="900" /><span class="meta">{d['label']}</span></a></li>"""
        for d in data
    )
    nav = ""
    first = data[0]
    html = f"""{head(f"{TITLE_EN} | {TITLE_ZH}", "")}
<body class="index-body">
{header("", nav)}
  <main class="flow" id="main">
    <section class="shell index-intro">
      <h1 class="brand-title reveal">{TITLE_EN} · {TITLE_ZH}</h1>
      <p class="brand-subtitle reveal" style="--i:1">{len(photos)} 個巢 · 拖曳或滑動瀏覽，手機上下滑動換屋企，點擊正中屋企睇報告</p>
      <p class="disclaimer reveal" style="--i:2">{DISCLAIMER}</p>
    </section>
    <div class="flow-stage" id="flow-stage" tabindex="0" role="listbox" aria-label="屋企目錄，用左右鍵瀏覽，Enter 開啟">
      <ol class="flow-fallback">
{fallback}
      </ol>
    </div>
    <div class="flow-progress" aria-hidden="true"><div class="flow-progress-bar"></div></div>
    <div class="flow-controls">
      <button class="btn" id="flow-prev" type="button" aria-label="上一張">←</button>
      <a class="flow-label" id="flow-label" href="{first['href']}">
        <span class="flow-index meta">01 / {len(data)}</span>
        <span class="flow-label-title">{first['label']}</span>
        <span class="flow-label-hint">開啟報告 →</span>
      </a>
      <button class="btn" id="flow-next" type="button" aria-label="下一張">→</button>
    </div>
  </main>
  <script type="application/json" id="photo-data">{json.dumps(data, ensure_ascii=False)}</script>
  <script type="module" src="js/coverflow.js?v={asset_version()}"></script>
</body>
</html>
"""
    (ROOT / "index.html").write_text(html, encoding="utf-8")


def _ocr(folder: Path, outfile: Path) -> dict:
    if not any(folder.glob("*.png")):
        return {}
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-File",
            str(ROOT / "ocr_plates.ps1"),
            "-Dir",
            str(folder),
            "-OutFile",
            str(outfile),
        ],
        check=True,
    )
    return json.loads(outfile.read_text(encoding="utf-8-sig"))


def _crop_label(lines: list) -> str:
    texts = []
    for line in lines or []:
        text = re.sub(r"(?<=[\u4e00-\u9fff()])\s+(?=[\u4e00-\u9fff()])", "", line.get("text") or "")
        text = re.sub(r"\s+", "", text)
        if len(re.findall(r"[\u4e00-\u9fff]", text)) >= 2:
            texts.append(text)
    return " ".join(dict.fromkeys(texts))


def _round_scene(scene: dict) -> dict:
    for obj in scene.get("objects", []):
        for key in ("x", "y", "w", "h", "rot"):
            if key in obj:
                obj[key] = round(float(obj[key]), 4)
    return scene


def prepare_scenes(photos: list[dict]) -> dict[str, dict]:
    work = ROOT / "_build"
    plates = work / "plates"
    crops = work / "crops"
    if work.exists():
        shutil.rmtree(work)
    plates.mkdir(parents=True)
    crops.mkdir(parents=True)

    extracted: dict[str, tuple[dict, str]] = {}
    scenes: dict[str, dict] = {}
    for photo in photos:
        layout_path = photo["folder"] / "layout.json"
        layout = json.loads(layout_path.read_text(encoding="utf-8")) if layout_path.exists() else {}
        notes = layout.get("notes") or photo["analysis"].get("layout_notes") or ""
        fix = photo["folder"] / "topview fix.png"
        if not fix.exists():
            scenes[photo["id"]] = _round_scene(layout_fallback(layout))
            continue
        rgb = np.array(Image.open(fix).convert("RGB"))
        data = extract_shapes(fix)
        Image.fromarray(data["plate"]).save(plates / f"photo_{photo['id']}.png")
        for index, obj in enumerate(data["objects"]):
            crop = upright_crop(rgb, obj, data["cx"], data["cy"], data["r"])
            if crop is not None:
                crop.save(crops / f"photo_{photo['id']}__{index}.png")
        extracted[photo["id"]] = (data, notes)

    plate_ocr = _ocr(plates, work / "plates.json")
    crop_ocr = _ocr(crops, work / "crops.json")
    for photo_id, (data, notes) in extracted.items():
        scene = assign_labels(data, plate_ocr.get(f"photo_{photo_id}") or [], notes)
        for index, obj in enumerate(scene["objects"]):
            interior = _crop_label(crop_ocr.get(f"photo_{photo_id}__{index}") or [])
            if interior:
                obj["label"] = interior
        scenes[photo_id] = _round_scene(scene)
    shutil.rmtree(work, ignore_errors=True)
    return scenes


def paragraph(text: str, class_name: str = "") -> str:
    attr = f' class="{class_name}"' if class_name else ""
    return "\n".join(f"<p{attr}>{escape(line)}</p>" for line in text.split("\n") if line.strip())


def load_existing_scenes(photos: list[dict]) -> dict[str, dict]:
    """Keep the already extracted top-view objects; only the report prose is being refreshed."""
    scenes: dict[str, dict] = {}
    for photo in photos:
        path = ROOT / "photos" / f"photo-{photo['id']}.html"
        text = path.read_text(encoding="utf-8")
        match = re.search(
            r'<script type="application/json" id="report-data">(.*?)</script>',
            text,
            flags=re.S,
        )
        if not match:
            raise SystemExit(f"photo-{photo['id']}.html has no report-data to reuse")
        data = json.loads(match.group(1))
        scenes[photo["id"]] = data.get("topview") or {"notes": "", "objects": []}
    return scenes


def build_report(photos: list[dict], index: int, scenes: dict[str, dict]) -> None:
    p = photos[index]
    a = p["analysis"]
    pid = p["id"]
    prev_p = photos[index - 1] if index > 0 else None
    next_p = photos[index + 1] if index < len(photos) - 1 else None

    def pager_link(target: dict | None, text: str, rel: str) -> str:
        if not target:
            return f'<span class="btn" aria-disabled="true">{text}</span>'
        return f'<a class="btn" rel="{rel}" href="photo-{target["id"]}.html">{text}</a>'

    pager = f"""<div class="report-pager">
        {pager_link(prev_p, "← 上一張", "prev")}
        {pager_link(next_p, "下一張 →", "next")}
      </div>"""

    sections = []
    section_data = []
    for n, (key, title_zh, title_en) in enumerate(SECTIONS):
        text = a.get(key, "")
        section_data.append({"id": key, "zh": title_zh, "en": title_en, "text": text})
        sections.append(
            f"""    <section class="report-section reveal" style="--i:{n + 3}">
      <h2><span class="meta">{title_en}</span>{title_zh}</h2>
      <div>{paragraph(text)}</div>
    </section>"""
        )

    rows = "\n".join(
        f"          <tr><td>{escape(e.get('object', ''))}</td><td>{escape(e.get('inference', ''))}</td></tr>"
        for e in a.get("evidence", [])
    )
    scene = scenes[pid]
    report_data = {
        "id": pid,
        "label": p["label"],
        "disclaimer": DISCLAIMER,
        "topview": {"notes": scene.get("notes") or "", "objects": scene.get("objects") or []},
        "sections": section_data,
        "evidence": a.get("evidence") or [],
        "layout": a.get("layout_notes") or "",
        "confidence": a.get("confidence_notes") or "",
    }
    payload = json.dumps(report_data, ensure_ascii=False).replace("<", "\\u003c")

    nav = f'    <a class="btn" href="../index.html#photo-{pid}">← <span class="btn-label">全部屋企</span></a>'
    html = f"""{head(f"{p['label']} | {TITLE_EN} · {TITLE_ZH}", "../")}
<body>
{header("../", nav)}
  <main class="shell">
    <div class="report-head reveal">
      <div>
        <div class="meta">{TITLE_EN.upper()} · 居民預測報告</div>
        <h1 class="brand-title">{p['label']}</h1>
      </div>
      {pager}
    </div>
    <p class="disclaimer reveal" style="--i:1">{DISCLAIMER}</p>

    <div class="figure-pair reveal" style="--i:2">
      <figure>
        <img src="../media/photo_{pid}/cover.jpg" alt="{p['label']} 巢" width="675" height="900" />
        <figcaption>COVER · 巢</figcaption>
      </figure>
      <figure>
        <img class="topview" src="../media/photo_{pid}/topview.png?v={int((ROOT / 'media' / f'photo_{pid}' / 'topview.png').stat().st_mtime)}" alt="{p['label']} 巢嘅頂視圖" />
        <figcaption>TOP VIEW · 巢嘅頂視圖</figcaption>
        {paragraph(a.get("layout_notes") or scene.get("notes") or "", "topview-note")}
      </figure>
    </div>

    <div class="report-linear">
    <section class="report-section reveal" style="--i:3">
      <h2><span class="meta">LAYOUT</span>巢嘅頂視圖</h2>
      <div>{paragraph(a.get("layout_notes", ""))}</div>
    </section>
{chr(10).join(sections)}
    <section class="report-section reveal">
      <h2><span class="meta">EVIDENCE</span>證據摘要</h2>
      <table class="evidence">
        <thead><tr><th>物件</th><th>推論</th></tr></thead>
        <tbody>
{rows}
        </tbody>
      </table>
    </section>
    <section class="report-section is-note reveal">
      <h2><span class="meta">CONFIDENCE</span>信心同限制</h2>
      <div>{paragraph(a.get("confidence_notes", ""))}</div>
    </section>
    </div>

    <section class="graph-stage" id="graph-root" aria-label="報告關係圖">
      <div class="graph-tools">
        <input id="graph-filter" type="search" placeholder="篩選筆記" aria-label="篩選筆記" />
      </div>
      <canvas id="graph-canvas"></canvas>
      <aside class="graph-note" id="graph-note" hidden></aside>
    </section>
    <script type="application/json" id="report-data">{payload}</script>
    <script src="../js/graph.js?v={asset_version()}"></script>
    <script src="../js/report.js?v={asset_version()}"></script>

    <div class="report-foot">
      <a class="btn" href="../index.html#photo-{pid}">← 返回目錄</a>
      {pager}
    </div>
  </main>
{footer()}
</body>
</html>
"""
    out = ROOT / "photos" / f"photo-{pid}.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")


def build_keywords() -> None:
    src = SOURCE / "spirit_keywords.md"
    text = src.read_text(encoding="utf-8")
    words = re.findall(r"^\s*(\d+)\.\s+(.+?)\s*$", text, flags=re.M)
    intro_lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.startswith("#") and not re.match(r"^\s*\d+\.", line)
    ]
    intro = re.sub(r"`[^`]*`\s*入面", "", intro_lines[0]) if intro_lines else ""
    items = "\n".join(
        f'      <li><div class="meta">{int(n):03d}</div><div class="keyword-word">{escape(w)}</div></li>'
        for n, w in words
    )
    nav = '    <a class="btn" href="index.html">← <span class="btn-label">全部屋企</span></a>'
    html = f"""{head(f"精神關鍵詞 | {TITLE_EN} · {TITLE_ZH}", "")}
<body>
{header("", nav)}
  <main class="shell">
    <h1 class="brand-title reveal">{TITLE_EN} · 精神關鍵詞<span class="meta keyword-count" data-count="{len(words)}">{len(words)}</span></h1>
    <p class="brand-subtitle reveal" style="--i:1">{escape(intro)}</p>
    <ol class="keyword-grid reveal" style="--i:2">
{items}
    </ol>
  </main>
{KEYWORD_COUNT_SCRIPT}
{footer()}
</body>
</html>
"""
    (ROOT / "keywords.html").write_text(html, encoding="utf-8")


def main() -> None:
    photos = load_photos()
    if not photos:
        raise SystemExit(f"No photo_* folders with report.md found in {SOURCE}")
    copy_logos()
    copy_media(photos)
    if "--reuse-scenes" in sys.argv:
        print("Reusing top-view objects already on the site…")
        scenes = load_existing_scenes(photos)
    else:
        print("Reading corrected top views…")
        scenes = prepare_scenes(photos)
    build_index(photos)
    for i in range(len(photos)):
        build_report(photos, i, scenes)
    build_keywords()
    print(f"Built {len(photos)} reports + index + keywords in {ROOT}")


if __name__ == "__main__":
    main()

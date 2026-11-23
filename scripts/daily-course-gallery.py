"""Render three exact V6/V7 daily-course pairs per phone-friendly PDF page.

Usage: python3 scripts/daily-course-gallery.py INPUT.json OUTPUT.pdf
Requires reportlab, pypdf and pymupdf. It also renders every page for visual QA.
"""
import datetime as dt
import json
import math
from pathlib import Path
import re
import sys

import pymupdf as fitz
from pypdf import PdfReader
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas

data = json.loads(Path(sys.argv[1]).read_text())
output = Path(sys.argv[2])
output.parent.mkdir(parents=True, exist_ok=True)
render_dir = output.parent.parent.parent / "tmp" / "pdfs" / "daily-lap-gallery"
render_dir.mkdir(parents=True, exist_ok=True)
pairs = data["pairs"]
assert len(pairs) == len({p["day"] for p in pairs}) == 30
assert pairs[0]["day"] == "2026-11-24" and pairs[-1]["day"] == "2026-12-23"
assert all((dt.date.fromisoformat(b["day"]) - dt.date.fromisoformat(a["day"])).days == 1 for a, b in zip(pairs, pairs[1:]))

W, H = A5
M, GAP = 18, 12
PW = (W - 2 * M - GAP) / 2
ROW = 153
TOP = H - 99
INK = HexColor("#18382f")
MUTED = HexColor("#52665f")
OLD = HexColor("#5e7889")
NEW = HexColor("#d6502d")
JUMP = HexColor("#167d87")
BRIDGE = HexColor("#7652a2")
PAPER = HexColor("#fffdf6")

def align(track, point):
    start = track["samples"][0]
    dx, dz = point["x"] - start["x"], point["z"] - start["z"]
    # Translation and rotation only: GO faces right. Never mirror a course.
    return dx * start["tx"] + dz * start["tz"], -dx * start["tz"] + dz * start["tx"]

def sample(track, s):
    s %= track["totalLength"]
    samples = track["samples"]
    for i, a in enumerate(samples):
        b = samples[(i + 1) % len(samples)]
        end = b["s"] if i + 1 < len(samples) else track["totalLength"]
        if a["s"] <= s < end:
            t = (s - a["s"]) / (end - a["s"])
            return {"x": a["x"] + t * (b["x"] - a["x"]), "z": a["z"] + t * (b["z"] - a["z"])}
    raise ValueError("Missing canonical sample")

def text(c, x, y, value, size=9, color=INK, bold=False):
    c.setFillColor(color)
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.drawString(x, y, value)

def marker(c, x, y, label, color):
    c.setLineWidth(0.8)
    c.setStrokeColor(color)
    c.setFillColor(white)
    c.roundRect(x - 5, y - 5, 10, 10, 2, fill=1, stroke=1)
    text(c, x - 2.4, y - 2.6, label, 7, color, True)

def map_pair(c, pair, row_top):
    tracks = [pair["old"]["track"], pair["new"]["track"]]
    points = [align(t, p) for t in tracks for p in t["samples"]]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    lo_x, hi_x, lo_y, hi_y = min(xs), max(xs), min(ys), max(ys)
    plot_h = 97
    pad = 14
    scale = min((PW - 2 * pad) / (hi_x - lo_x), (plot_h - 2 * pad) / (hi_y - lo_y))
    # A common bounding box, scale and origin are used for both panels.
    offset_x = (PW - (hi_x - lo_x) * scale) / 2 - lo_x * scale
    offset_y = (plot_h - (hi_y - lo_y) * scale) / 2 - lo_y * scale
    for col, key in enumerate(["old", "new"]):
        left = M + col * (PW + GAP)
        bottom = row_top - 132
        entry, track, color = pair[key], tracks[col], [OLD, NEW][col]
        text(c, left, row_top - 26, "OLD V6" if col == 0 else "NEW V7 - PREVIEW", 8.6, color, True)
        def xy(point):
            x, y = align(track, point)
            return left + offset_x + x * scale, bottom + offset_y + y * scale
        samples = track["samples"]
        path = c.beginPath()
        path.moveTo(*xy(samples[0]))
        for i, a in enumerate(samples):
            b = samples[(i + 1) % len(samples)]
            next_s = samples[i + 1]["s"] if i + 1 < len(samples) else track["totalLength"]
            in_gap = any(j["takeoff"] <= (a["s"] + next_s) / 2 < j["landing"] for j in track.get("jumps", []))
            if in_gap:
                path.moveTo(*xy(b))
            else:
                path.lineTo(*xy(b))
        width = max(1.6, min(3.6, 7 * scale))
        c.setLineJoin(1)
        c.setLineCap(1)
        c.setStrokeColor(HexColor("#e5e8df"))
        c.setLineWidth(width + 1.2)
        c.drawPath(path)
        c.setStrokeColor(color)
        c.setLineWidth(width)
        c.drawPath(path)
        for crossing in entry["crossings"]:
            # The upper deck is visibly drawn over the lower road.
            upper = c.beginPath()
            for i, s in enumerate(range(-7, 8)):
                point = xy(sample(track, crossing["upperS"] + s))
                if i == 0:
                    upper.moveTo(*point)
                else:
                    upper.lineTo(*point)
            c.setStrokeColor(PAPER)
            c.setLineWidth(width + 2.6)
            c.drawPath(upper)
            c.setStrokeColor(color)
            c.setLineWidth(width)
            c.drawPath(upper)
            x, y = xy(crossing)
            marker(c, x + 6, y + 6, "B", BRIDGE)
        for jump in track.get("jumps", []):
            a, b = xy(sample(track, jump["takeoff"])), xy(sample(track, jump["landing"]))
            c.setStrokeColor(JUMP)
            c.setLineWidth(0.8)
            c.setDash(1.5, 1.5)
            c.line(*a, *b)
            c.setDash()
            x, y = xy(sample(track, (jump["takeoff"] + jump["landing"]) / 2))
            marker(c, x + 6, y + 4, "J", JUMP)
        # Same GO location in the paired coordinate system, with forward arrow.
        x, y = xy(samples[0])
        c.setStrokeColor(PAPER)
        c.setFillColor(INK)
        c.setLineWidth(1)
        c.circle(x, y, 3.2, fill=1, stroke=1)
        c.setStrokeColor(INK)
        c.setLineWidth(0.8)
        c.line(x + 3.5, y, x + 9, y)
        arrow = c.beginPath()
        arrow.moveTo(x + 11, y)
        arrow.lineTo(x + 7.5, y - 2.2)
        arrow.lineTo(x + 7.5, y + 2.2)
        arrow.close()
        c.drawPath(arrow, fill=1, stroke=0)
        text(c, min(left + PW - 15, max(left + 1, x + 4)), max(bottom, y - 8), "GO", 6.3, INK, True)
        peak = max(p.get("y", 0) for p in samples)
        caption = f'{track["totalLength"]:.0f}m | J{len(track.get("jumps", []))} B{len(entry["crossings"])} | max {peak:.1f}m'
        text(c, left, row_top - 141, caption, 7.4, MUTED)
    return {"day": pair["day"], "scalePointsPerMetre": scale, "sharedPairScale": True, "goAlignedRight": True, "mirrored": False, "oldSamples": len(tracks[0]["samples"]), "newSamples": len(tracks[1]["samples"])}

c = canvas.Canvas(str(output), pagesize=A5, pageCompression=1)
c.setTitle("The Daily Lap - 30 V6 and V7 daily course pairs")
c.setAuthor("The Daily Lap")
c.setSubject("Exact deterministic geometry previews for 24 November to 23 December 2026")
audit = []
for page_no in range(10):
    c.setFillColor(PAPER)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    text(c, M, H - 27, "30 days of courses", 18, INK, True)
    text(c, M, H - 43, "24 NOV - 23 DEC 2026 | OLD V6 / NEW V7", 9, MUTED)
    text(c, M, H - 57, "OFFLINE PREVIEWS - not confirmed live", 9, NEW, True)
    text(c, M, H - 71, "Shared scale per pair. GO faces right. No mirroring.", 8, MUTED)
    text(c, M, H - 83, "GO = start/finish   J = jump gap   B = overpass   max = road elevation", 7.4, MUTED)
    for row, pair in enumerate(pairs[page_no * 3 : page_no * 3 + 3]):
        top = TOP - row * ROW
        c.setStrokeColor(HexColor("#d9e0d6"))
        c.setLineWidth(0.5)
        c.line(M, top + 9, W - M, top + 9)
        text(c, M, top - 6, pair["day"], 11.5, INK, True)
        text(c, M + 82, top - 6, pair["family"], 9, MUTED)
        if pair["unchangedGeometry"]:
            text(c, W - M - 105, top - 6, "UNCHANGED GEOMETRY", 8, OLD, True)
        audit.append(map_pair(c, pair, top))
    text(c, M, 20, "Existing stored races stay intact; these dates are previews.", 7.2, MUTED)
    text(c, M, 9, f'Exact canonical samples | source V7 b7d0f86 | {page_no + 1}/10', 6.8, MUTED)
    c.showPage()
c.save()

reader = PdfReader(output)
assert len(reader.pages) == 10
all_text = "\n".join(page.extract_text() for page in reader.pages)
dates = re.findall(r"\b2026-\d{2}-\d{2}\b", all_text)
assert len(dates) == len(set(dates)) == 30
assert dates == [p["day"] for p in pairs]
assert all_text.splitlines().count("OLD V6") == all_text.splitlines().count("NEW V7 - PREVIEW") == 30
assert all_text.count("UNCHANGED GEOMETRY") == data["unchangedCount"]
document = fitz.open(output)
for i, page in enumerate(document):
    assert len(re.findall(r"\b2026-\d{2}-\d{2}\b", page.get_text())) == 3
    assert len(page.get_drawings()) > 15
    page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(render_dir / f"page-{i + 1:02d}.png")
verification = {"pages": 10, "dates": 30, "visibleMapPanels": 60, "unchangedPairs": data["unchangedCount"], "allOriginalCampaignHashesMatch": data["verifiedAgainstOriginalThirtyDayCampaign"], "firstDay": pairs[0]["day"], "lastDay": pairs[-1]["day"], "status": "offline-preview", "pairAudit": audit}
output.with_suffix(".verification.json").write_text(json.dumps(verification, indent=2) + "\n")
print(json.dumps({"pdf": str(output), "renderedPages": str(render_dir), **{k: v for k, v in verification.items() if k != "pairAudit"}}))

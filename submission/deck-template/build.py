"""Fill the prescribed AI Builder Cup submission template with Aide content.

Usage: python build.py  (needs python-pptx and Pillow). Reads the untouched template beside
`submission/`, writes `submission/Aide-AI-Builder-Cup.pptx` (ignored by Git: it carries the
private product URL). Export the PDF with Keynote afterwards.
Images in img/ are original art or offline synthetic captures (see img/README.md).
"""
import copy
import json
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_TICK_LABEL_POSITION, XL_TICK_MARK
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "Submission Template _ AI Builder Cup.pptx"
VIDEO_URL = "https://youtu.be/oi7qsd9OR8o"
OUT = HERE.parent / "Aide-AI-Builder-Cup.pptx"
IMG = HERE / "img"
# The deployed URL and repository owner are private identifiers here, so they stay in the ignored link sheet.
_LINKS = json.loads((HERE.parents[1] / ".data/releases/submission-links-private.json").read_text())
PRODUCT_URL, REPO_URL = _LINKS["product_url"], _LINKS["public_baseline_repo_url"]

FONT = "Arial"
NAVY, BLUE, SKY = RGBColor(0x00, 0x2C, 0x5F), RGBColor(0x21, 0x5F, 0xA6), RGBColor(0x00, 0x8C, 0xB0)
INK, MUTED = RGBColor(0x1B, 0x1B, 0x1F), RGBColor(0x55, 0x5B, 0x63)
CARD, LINE, WHITE = RGBColor(0xEE, 0xF3, 0xFA), RGBColor(0xC5, 0xD0, 0xDE), RGBColor(0xFF, 0xFF, 0xFF)
WARN_BG, WARN = RGBColor(0xFF, 0xF4, 0xDC), RGBColor(0x6B, 0x45, 0x00)
OK_BG, OK = RGBColor(0xE3, 0xF4, 0xEA), RGBColor(0x0B, 0x5A, 0x2E)

prs = Presentation(TEMPLATE)
slides = list(prs.slides)


def run(p, text, size, bold=False, color=INK, italic=False, link=None):
    r = p.add_run()
    r.text = text
    f = r.font
    f.name, f.size, f.bold, f.italic, f.color.rgb = FONT, Pt(size), bold, italic, color
    if link:
        r.hyperlink.address = link
    return r


def text(slide, x, y, w, h, paras, anchor=MSO_ANCHOR.TOP, margin=0.05, name=None):
    """paras: list of (runs, opts); runs = str or [(text, size, bold, color)], opts dict."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        box.name = name
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, side, Inches(margin))
    fill(tf, paras)
    return box


def fill(tf, paras):
    first = True
    for item in paras:
        spec, opts = (item if isinstance(item, tuple) and isinstance(item[-1], dict) else (item, {}))
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = opts.get("align", PP_ALIGN.LEFT)
        if "after" in opts:
            p.space_after = Pt(opts["after"])
        if "before" in opts:
            p.space_before = Pt(opts["before"])
        if opts.get("bullet"):
            bullet(p, opts.get("indent", 0.16))
        for r in spec:
            run(p, *r)


def bullet(p, indent):
    pPr = p._p.get_or_add_pPr()
    pPr.set("marL", str(int(Inches(indent))))
    pPr.set("indent", str(-int(Inches(indent))))
    for tag in ("a:buNone", "a:buChar", "a:buAutoNum"):
        for el in pPr.findall(qn(tag)):
            pPr.remove(el)
    bu = pPr.makeelement(qn("a:buChar"), {"char": "•"})
    font = pPr.makeelement(qn("a:buFont"), {"typeface": FONT})
    pPr.append(font)
    pPr.append(bu)


def box(slide, x, y, w, h, fill_rgb=CARD, line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08, name=None):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        s.name = name
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = radius
    s.fill.solid()
    s.fill.fore_color.rgb = fill_rgb
    if line:
        s.line.color.rgb = line
        s.line.width = Pt(1)
    else:
        s.line.fill.background()
    s.shadow.inherit = False
    s.text_frame.text = ""
    return s


def card(slide, x, y, w, h, title, body, fill_rgb=CARD, title_color=NAVY, size=11, title_size=12.5, bullets=True, name=None):
    box(slide, x, y, w, h, fill_rgb, name=name)
    paras = [([(title, title_size, True, title_color)], {"after": 4})]
    for line in body:
        paras.append(([(line, size, False, INK)], {"bullet": bullets, "after": 3}))
    text(slide, x + 0.1, y + 0.08, w - 0.2, h - 0.16, paras, margin=0.04)


def arrow(slide, x1, y1, x2, y2, color=BLUE, width=1.75):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)
    ln = c.line._get_or_add_ln()
    ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle", "w": "med", "len": "med"}))
    return c


def picture(slide, path, x, y, w=None, h=None, crop_top=0.0, crop_bottom=0.0, name=None):
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w) if w else None, Inches(h) if h else None)
    if name:
        pic.name = name
    if crop_top or crop_bottom:
        # Crop by fraction while keeping the requested on-slide size.
        pic.crop_top, pic.crop_bottom = crop_top, crop_bottom
    pic.line.color.rgb = LINE
    pic.line.width = Pt(0.75)
    return pic


def fitted(path, max_w, max_h, crop_top=0.0, crop_bottom=0.0):
    with Image.open(path) as im:
        w, h = im.width, im.height * (1 - crop_top - crop_bottom)
    scale = min(max_w / w, max_h / h)
    return w * scale, h * scale


def caption(slide, x, y, w, words, size=10, color=MUTED, align=PP_ALIGN.LEFT, h=0.3):
    return text(slide, x, y, w, h, [([(words, size, False, color)], {"align": align})], margin=0.02)


def footnote(slide, words):
    caption(slide, 0.4, 5.12, 9.2, words, size=9.5, h=0.38)


def heading_box(slide):
    for sh in slide.shapes:
        if sh.has_text_frame and sh.name.startswith("Google Shape") and sh.top < Inches(0.8) and sh.top > Inches(0.6):
            return sh
    return None


def set_heading(slide, words):
    """Keep the template's heading box and style, replace only the run text."""
    sh = heading_box(slide)
    paras = sh.text_frame.paragraphs
    runs = paras[0].runs
    runs[0].text = words
    for extra in runs[1:]:
        extra._r.getparent().remove(extra._r)
    for p in paras[1:]:
        p._p.getparent().remove(p._p)
    return sh


# ---- 1. Team details ------------------------------------------------------------------------
s = slides[0]
tf = next(sh for sh in s.shapes if sh.has_text_frame and "Team Details" in sh.text_frame.text).text_frame
values = {
    "Team name: ": "Team Aide",
    "Team leader name: ": "Byung Min Choi",
    "Problem Statement: ": "Future of Work & Enterprise Productivity. Interruptions on the move (a call, a vehicle warning, a failing release) steal attention from drivers and responders.",
}
added = None
for p in list(tf.paragraphs):
    key = p.text
    if key in values and p.runs:
        r = copy.deepcopy(p.runs[-1]._r)
        p._p.append(r)
        p.runs[-1].text = values[key]
        p.runs[-1].font.size = Pt(14 if key.startswith("Problem") else 18)
        p.runs[-1].font.bold = False
        if key.startswith("Team leader"):
            member = copy.deepcopy(p._p)
            p._p.addnext(member)
            added = member
for p in tf.paragraphs:
    if p._p is added:
        runs = p.runs
        runs[0].text = "Team member: "
        runs[1].text = "Jae Hyuk Choi"

# ---- 3. Brief ----------------------------------------------------------------------------------
s = slides[2]
set_heading(s, "Brief about the idea")
text(s, 0.4, 1.3, 5.55, 3.8, [
    ([("Aide: ask your own Aide", 20, True, NAVY)], {"after": 4}),
    ([("A Gemini-powered aide that finishes the task for drivers, and an accountable agent crew for cloud responders.", 13, False, INK)], {"after": 8}),
    ([("Ask", 12.5, True, NAVY), (" in your own words: Gemini proposes typed vehicle actions; nothing runs until you tap.", 12.5, False, INK)], {"bullet": True, "after": 4}),
    ([("Go", 12.5, True, NAVY), (": real Google Maps places with photos and attribution; you choose the destination.", 12.5, False, INK)], {"bullet": True, "after": 4}),
    ([("Call", 12.5, True, NAVY), (": My Aide takes a call while you drive, then hands you a summary and follow-up drafts.", 12.5, False, INK)], {"bullet": True, "after": 4}),
    ([("Care", 12.5, True, NAVY), (": known, authorised problems get one bounded fix and a read-back; unfamiliar ones go to a person.", 12.5, False, INK)], {"bullet": True, "after": 4}),
    ([("Cloud", 12.5, True, NAVY), (": an ADK/A2A crew investigates registered Cloud Run services; a change needs Guardian and a human tap.", 12.5, False, INK)], {"bullet": True}),
])
w, h = fitted(IMG / "aide-ev.png", 3.5, 2.4)
s.shapes.add_picture(str(IMG / "aide-ev.png"), Inches(6.1 + (3.5 - w) / 2), Inches(1.65), Inches(w), Inches(h)).name = "Aide EV concept art"
caption(s, 6.1, 1.65 + h + 0.05, 3.5, "Original Aide EV concept art", align=PP_ALIGN.CENTER)
footnote(s, "Working prototype on Cloud Run (web + Android). Vehicle, driving, callers and follow-up actions are simulated; Gemini, Google Maps, Firebase and Firestore are real.")

# ---- 4. Opportunities --------------------------------------------------------------------------
s = slides[3]
set_heading(s, "Opportunities")
cols = [
    ("How is it different?", [
        "Most assistants answer; Aide finishes the task and shows its evidence.",
        "Autonomy has an edge: typed tools, current-state checks and policies. The model never holds credentials or writes execution code.",
        "Unknown outcomes are reported, never silently retried.",
    ]),
    ("How does it solve the problem?", [
        "Turns an interruption (call, warning, failed release) into a reviewed next step.",
        "Grounds answers in real Google Maps places and registered Cloud Run telemetry.",
        "Handles the call, summary and drafts; sending or scheduling still needs one tap.",
    ]),
    ("USP", [
        "One assistant across the car and the cloud, with separate authority for each.",
        "Known + authorised: act once, then read back. Unfamiliar: report and work with a person.",
        "Learns verified cases, but a learned case gains authority only after a person promotes it.",
    ]),
]
for i, (title, body) in enumerate(cols):
    card(s, 0.4 + i * 3.1, 1.35, 2.95, 3.65, title, body, size=12.5, title_size=14)
footnote(s, "Design premise, not measured user impact: no timed human comparison has been completed yet.")

# ---- 5. Features -------------------------------------------------------------------------------
s = slides[4]
set_heading(s, "List of features offered by the solution")
features = [
    ("Ask your own Aide", "Requests become named proposals (climate, lock, charge limit, lights, horn). The server validates each tap against the current vehicle state."),
    ("Grounded places", "Gemini with the Google Maps MCP server finds chargers, dinner or places with photos, ratings and attribution. The driver chooses; a Favorite helps next time."),
    ("My Aide takes the call", "Answers a fictional caller with context, says only what it knows, then hands over a summary plus message and calendar drafts."),
    ("Vehicle diagnosis", "A cluster view pinpoints the warning, such as low tire pressure, and Gemini explains it. Unfamiliar symptoms get guidance, not an invented repair."),
    ("Bounded auto-recovery", "A verified charging case under an active 24-hour policy allows one simulated reconnection, followed by a read-back report."),
    ("Cloud responder crew", "Chief, Ops, Diagnosis and Guardian (ADK over A2A) investigate registered Cloud Run services. A rollback needs Guardian, exact reviewed state and a human tap."),
]
for i, (title, body) in enumerate(features):
    x, y = 0.4 + (i % 3) * 3.1, 1.35 + (i // 3) * 1.85
    card(s, x, y, 2.95, 1.72, title, [body], size=11.5, title_size=13, bullets=False)
footnote(s, "Korean and English UI on web and Android · Google sign-in · Stop stays available while a model reply is pending.")

# ---- 6. Process flow ---------------------------------------------------------------------------
s = slides[5]
set_heading(s, "Process flow diagram")
steps = [
    ("1  Interruption", "A request, call, vehicle warning or cloud incident"),
    ("2  Gemini plans", "Interprets intent, picks typed tools, proposes"),
    ("3  Server checks", "Verified identity, ownership, current state, version"),
    ("4  Policy + Guardian", "Is this known, authorised and safe right now?"),
]
for i, (title, body) in enumerate(steps):
    x = 0.4 + i * 2.35
    card(s, x, 1.4, 2.05, 1.05, title, [body], size=10.5, bullets=False, fill_rgb=CARD)
    if i < 3:
        arrow(s, x + 2.07, 1.92, x + 2.33, 1.92)
card(s, 4.2, 2.95, 2.5, 1.0, "Known + authorised", ["Act once with a typed tool, then read back the result"], fill_rgb=OK_BG, title_color=OK, size=10.5, bullets=False)
card(s, 7.1, 2.95, 2.5, 1.0, "Unfamiliar, risky or a cloud change", ["Report and ask: a person decides on the phone"], fill_rgb=WARN_BG, title_color=WARN, size=10.5, bullets=False)
arrow(s, 8.0, 2.47, 5.45, 2.93)
arrow(s, 8.35, 2.47, 8.35, 2.93)
card(s, 4.2, 4.2, 5.4, 0.85, "5  Verified outcome", ["Result and evidence reported; an unknown outcome is never resent; a resolved case can be promoted by a person"], size=10.5, bullets=False)
arrow(s, 5.45, 3.97, 5.45, 4.18)
arrow(s, 8.35, 3.97, 8.35, 4.18)
text(s, 0.4, 2.95, 3.5, 2.1, [
    ([("Rules on every path", 12, True, NAVY)], {"after": 4}),
    ([("Reads may run autonomously within bounded scopes.", 10.5, False, INK)], {"bullet": True, "after": 3}),
    ([("Any change needs a Guardian verdict; risky ones need a human decision.", 10.5, False, INK)], {"bullet": True, "after": 3}),
    ([("Refresh, replay or review never starts execution.", 10.5, False, INK)], {"bullet": True}),
])

# ---- 7. Wireframes -----------------------------------------------------------------------------
s = slides[6]
set_heading(s, "Wireframes / mock diagrams of the solution")
shots = [
    ("native-ask.jpg", 0.0, 0.0, "Ask: proposals wait for a tap"),
    ("native-journey.jpg", 0.0, 0.42, "Choose a destination"),
    ("native-call.jpg", 0.27, 0.0, "My Aide on the call"),
    ("native-summary.jpg", 0.27, 0.0, "Summary and drafts"),
]
sizes = [fitted(IMG / n, 2.1, 3.3, t, b) for n, t, b, _ in shots]
for i, ((name, top, bottom, label), (w, h)) in enumerate(zip(shots, sizes)):
    x = 0.45 + i * 2.32 + (2.1 - w) / 2
    picture(s, IMG / name, x, 1.4, w, h, top, bottom, name=label)
    caption(s, 0.45 + i * 2.32, 1.45 + max(hh for _, hh in sizes), 2.1, label, size=11, color=INK, align=PP_ALIGN.CENTER)
footnote(s, "Android app (Jetpack Compose, Material 3): offline synthetic captures from instrumented tests on build 22fa44c; fictional caller and places.")

# ---- 8. Architecture ---------------------------------------------------------------------------
s = slides[7]
set_heading(s, "Architecture diagram of the proposed solution")


def node(x, y, w, h, title, sub, fill_rgb=CARD, title_color=NAVY):
    box(s, x, y, w, h, fill_rgb, line=LINE)
    text(s, x + 0.06, y + 0.03, w - 0.12, h - 0.06, [([(title, 11.5, True, title_color)], {"align": PP_ALIGN.CENTER}),
                                                     ([(sub, 9.5, False, INK)], {"align": PP_ALIGN.CENTER})], anchor=MSO_ANCHOR.MIDDLE, margin=0.02)


node(1.3, 1.3, 3.3, 0.62, "Android app", "Kotlin · Jetpack Compose · Material 3")
node(5.4, 1.3, 3.3, 0.62, "Web console", "React · TypeScript · Material Web")
caption(s, 3.1, 1.94, 3.8, "Firebase Authentication (Google sign-in) · identity, owner and workspace verified on the server", size=9, color=BLUE, align=PP_ALIGN.CENTER, h=0.4)
arrow(s, 2.95, 1.93, 2.95, 2.33)
arrow(s, 7.05, 1.93, 7.05, 2.33)
node(1.3, 2.35, 4.9, 0.72, "Aide gateway + web on Cloud Run", "Typed requests · policy checks · hourly AI/Maps ceilings · signed approvals")
node(6.5, 2.35, 2.2, 0.72, "Cloud Firestore", "Vehicle twin · calls · tasks · grants · audit")
arrow(s, 6.22, 2.71, 6.48, 2.71)
node(0.4, 3.5, 2.95, 0.78, "Gemini on Vertex AI", "Proposals · call turns · summaries · diagnosis")
node(3.5, 3.5, 2.95, 0.78, "Google Maps", "MCP grounding · Places photos · Maps JS / Android SDK")
node(6.6, 3.5, 3.0, 0.78, "Agent crew (ADK, A2A)", "Private Cloud Run: Chief · Ops · Diagnosis · Guardian")
for x in (1.9, 5.0):
    arrow(s, x if x < 3 else 3.75, 3.08, x, 3.48)
arrow(s, 5.9, 3.08, 8.1, 3.48)
node(6.6, 4.45, 3.0, 0.6, "Human decision on the phone", "Approves one reviewed change", fill_rgb=WARN_BG, title_color=WARN)
arrow(s, 8.1, 4.29, 8.1, 4.43)
node(3.5, 4.45, 2.95, 0.6, "Registered Cloud Run service", "Fixed UID · read evidence · one conditional rollback")
arrow(s, 6.6, 4.75, 6.47, 4.75)
text(s, 0.4, 4.45, 2.95, 0.6, [([("Agents never receive credentials, generate execution code or change IAM.", 9.5, False, MUTED)], {})], anchor=MSO_ANCHOR.MIDDLE, margin=0.02)

# ---- 9. Technologies ---------------------------------------------------------------------------
s = slides[8]
set_heading(s, "Technologies used in the solution")
rows = [
    ("AI and agents", "Gemini (Flash models) on Vertex AI with structured JSON output · Google Agent Development Kit (ADK) · Agent2Agent (A2A) protocol"),
    ("Maps and grounding", "Google Maps MCP server · Places photos and attribution · Maps JavaScript API · Maps SDK for Android"),
    ("Identity and data", "Firebase Authentication (Google sign-in) · Cloud Firestore (actor-private vehicle twin, calls, tasks, approvals, audit)"),
    ("Compute and operations", "Cloud Run (gateway + four private agent services) · Cloud Build · Artifact Registry · Secret Manager · Cloud Monitoring and Logging (read-only evidence)"),
    ("Clients", "Android: Kotlin, Jetpack Compose, Material 3, MVVM · Web: React, TypeScript, Vite, Material Web (Material 3)"),
    ("Engineering", "Shared TypeScript contracts · Python crew · Node.js 24 · offline browser, axe accessibility, Android unit and emulator test gates"),
]
tbl = s.shapes.add_table(len(rows), 2, Inches(0.4), Inches(1.35), Inches(9.2), Inches(3.6)).table
tbl.columns[0].width, tbl.columns[1].width = Inches(2.1), Inches(7.1)
for r, (k, v) in enumerate(rows):
    for c, value in enumerate((k, v)):
        cell = tbl.cell(r, c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = CARD if r % 2 == 0 else WHITE
        cell.margin_left = cell.margin_right = Inches(0.08)
        cell.margin_top = cell.margin_bottom = Inches(0.04)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf = cell.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        run(p, value, 11 if c == 0 else 10.5, bold=(c == 0), color=NAVY if c == 0 else INK)
tblPr = tbl._tbl.tblPr
tblPr.set("firstRow", "0")
tblPr.set("bandRow", "0")

# ---- 10. Cost ----------------------------------------------------------------------------------
s = slides[9]
set_heading(s, "Estimated implementation cost")
drivers = [
    ("Cloud Run", "Request-based billing; the gateway and four private agent services scale to zero when idle. No always-on VMs."),
    ("Gemini on Vertex AI", "Pay per token. Bounded prompts and output limits, per-request deadlines, per-user hourly ceilings and no automatic resend."),
    ("Google Maps", "Called only for an explicit trip or place request, under the same per-user hourly ceilings."),
    ("Firestore and Firebase Auth", "Small actor-private documents; reads are side-effect free. Google sign-in on Firebase Authentication."),
]
for i, (title, body) in enumerate(drivers):
    x, y = 0.4 + (i % 2) * 4.65, 1.45 + (i // 2) * 1.75
    card(s, x, y, 4.5, 1.5, title, [body], size=13, title_size=14, bullets=False)
footnote(s, "Qualitative estimate: production traffic and cost have not been measured. All services are serverless and pay-per-use.")

# ---- 11. Snapshots -----------------------------------------------------------------------------
s = slides[10]
set_heading(s, "Snapshots of the prototype")
for i, (name, label) in enumerate([("web-places.jpg", "Web: place cards with Go here and Favorite"), ("web-call-summary.jpg", "Web: call summary and follow-up drafts")]):
    w, h = fitted(IMG / name, 3.4, 3.3)
    picture(s, IMG / name, 0.4 + i * 3.6, 1.4, w, h, name=label)
    caption(s, 0.4 + i * 3.6, 1.45 + h, 3.4, label, size=11, color=INK)
w, h = fitted(IMG / "native-diagnosis.jpg", 1.85, 3.3)
picture(s, IMG / "native-diagnosis.jpg", 7.65, 1.4, w, h, name="Android diagnosis")
caption(s, 7.6, 1.45 + h, 2.0, "Android: tire warning", size=11, color=INK)
footnote(s, "Offline synthetic captures from the repository's browser and Android test fixtures. Live runs use Gemini and Google Maps with the same screens.")

# ---- 12. Performance ---------------------------------------------------------------------------
s = slides[11]
set_heading(s, "Prototype performance report / benchmarking")
stats = [
    ("14/14", "real-Gemini crew scenarios passed (first-run, telemetry, core; one run each)"),
    ("2.1 s", "real call-summary qualification: correct time, body and recipient (one call)"),
    ("245", "gateway / API regression tests passing offline"),
    ("74 + 22", "Android core unit tests and emulator UI tests passing"),
]
for i, (big, small) in enumerate(stats):
    x = 0.4 + i * 2.33
    box(s, x, 1.35, 2.18, 1.2, CARD)
    text(s, x + 0.08, 1.38, 2.02, 1.15, [([(big, 24, True, NAVY)], {"after": 2}), ([(small, 9.5, False, INK)], {})], margin=0.03)
scenarios = [("bad release", 67.7), ("healthy", 57.5), ("no data", 59.1), ("log injection", 152.0), ("destructive ask", 11.5),
             ("unregistered", 42.1), ("perm. denied", 58.7), ("no prev. rev.", 81.5), ("prev. not ready", 48.2),
             ("client errors", 48.3), ("bad canary", 61.3), ("read-only ask", 44.7), ("partial page", 42.3), ("missing value", 35.0)]
data = CategoryChartData()
data.categories = [n for n, _ in scenarios]
data.add_series("Seconds", [v for _, v in scenarios])
gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(0.4), Inches(2.7), Inches(5.7), Inches(2.4), data)
ch = gf.chart
ch.has_legend = False
ch.has_title = True
ch.chart_title.text_frame.text = "Crew scenario completion time (s), real Gemini, synthetic Google APIs"
for p in ch.chart_title.text_frame.paragraphs:
    for r in p.runs:
        r.font.size, r.font.bold, r.font.name, r.font.color.rgb = Pt(10), True, FONT, NAVY
plot = ch.plots[0]
plot.gap_width = 40
plot.has_data_labels = True
dl = plot.data_labels
dl.font.size, dl.font.name, dl.font.color.rgb = Pt(8), FONT, INK
dl.number_format, dl.number_format_is_linked = "0", False
dl.position = XL_LABEL_POSITION.OUTSIDE_END
plot.series[0].format.fill.solid()
plot.series[0].format.fill.fore_color.rgb = BLUE
cat, val = ch.category_axis, ch.value_axis
cat.tick_labels.font.size, cat.tick_labels.font.name = Pt(7.5), FONT
skip = cat._element.makeelement(qn("c:tickLblSkip"), {"val": "1"})
anchor_el = cat._element.find(qn("c:noMultiLvlLbl"))
anchor_el.addprevious(skip) if anchor_el is not None else cat._element.append(skip)
cat.reverse_order = True
val.tick_label_position = XL_TICK_LABEL_POSITION.NONE
val.major_tick_mark = XL_TICK_MARK.NONE
val.format.line.fill.background()
val.has_major_gridlines = False
val.maximum_scale = 175
cat.format.line.color.rgb = LINE
box(s, 6.3, 2.7, 3.3, 2.4, WARN_BG)
text(s, 6.4, 2.75, 3.1, 2.3, [
    ([("Limits we report", 11.5, True, WARN)], {"after": 3}),
    ([("One run per scenario; synthetic Google API responses, judged by Gemini.", 9.5, False, INK)], {"bullet": True, "after": 2}),
    ([("No measured productivity or MTTR gain; no physical-phone result yet.", 9.5, False, INK)], {"bullet": True, "after": 2}),
    ([("Earlier provider 429 and a 25 s deadline are kept on record, not hidden.", 9.5, False, INK)], {"bullet": True, "after": 2}),
    ([("Held-out first run scored 13/18 under a different protocol.", 9.5, False, INK)], {"bullet": True}),
], margin=0.03)

# ---- 13. Future --------------------------------------------------------------------------------
s = slides[12]
set_heading(s, "Additional details / future development")
card(s, 0.4, 1.35, 4.5, 3.2, "Next to prove", [
    "Physical-phone trial of the full signed-in flow in Korean and English.",
    "Counterbalanced two-person comparison: manual versus Aide, recording time, wrong approvals and understanding of uncertainty.",
    "A real reviewer approving a cloud change, including a deliberate conflict.",
], size=13, title_size=14)
card(s, 5.1, 1.35, 4.5, 3.2, "Next to build", [
    "Korea-capable road routing, replacing today's straight-line simulation.",
    "Real telephony, messaging and calendar connections with explicit consent.",
    "Connected-car APIs in place of the simulated vehicle twin.",
    "Push notifications for approvals, and correlating vehicle symptoms with backend incidents.",
], size=13, title_size=14)

# ---- 14. Links ---------------------------------------------------------------------------------
s = slides[13]
tf = heading_box(s).text_frame
links = {
    "GitHub Public Repository": (REPO_URL, REPO_URL),
    "Demo Video Link (3 Minutes)": (VIDEO_URL, VIDEO_URL),
    "Final Product Link": (PRODUCT_URL, PRODUCT_URL),
}
added = None
for p in list(tf.paragraphs):
    key = p.text.strip()
    if key in links and p.runs:
        shown, href = links[key]
        r0 = p.runs[0]
        p._p.append(copy.deepcopy(r0._r))
        new = p.runs[-1]
        new.text = ": "
        p._p.append(copy.deepcopy(r0._r))
        link_run = p.runs[-1]
        link_run.text = shown
        if href:
            link_run.hyperlink.address = href
        link_run.font.color.rgb = BLUE if href else INK
card(s, 0.4, 2.55, 9.2, 1.75, "Try it on the product link", [
    "Sign in with Google under My GCP workspace: you get your own simulated Aide EV.",
    "My vehicle: ask your own Aide. Charging & map: let Aide find a charger or dinner, then choose Go here.",
    "Calls: try an incoming call and let My Aide answer. Vehicle diagnosis: open the simulator and pick a warning.",
    "Cloud operations need organisation membership of a registered Cloud Run service; the architecture slide shows how that agent crew works.",
], size=12, title_size=13)

# ---- 15. Authority (spare content slide) ------------------------------------------------------
s = slides[14]
text(s, 0.29, 0.73, 9.4, 0.5, [([("Responsible autonomy: who authorises what", 16, False, INK)], {})], margin=0.1)
rows = [("Work", "What Aide can do", "What authorises it"),
        ("Reads and drafts", "Investigate, explain, propose, draft", "Current verified identity and bounded scope"),
        ("Known charging case", "One simulated remedy, then read-back", "Verified case, active 24-hour policy, safe conditions"),
        ("Real Cloud Run change", "One typed, conditional action", "Guardian verdict, exact reviewed state and a human decision")]
tbl = s.shapes.add_table(4, 3, Inches(0.4), Inches(1.4), Inches(9.2), Inches(2.5)).table
for c, wd in enumerate((2.4, 3.2, 3.6)):
    tbl.columns[c].width = Inches(wd)
for r, row in enumerate(rows):
    for c, value in enumerate(row):
        cell = tbl.cell(r, c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = NAVY if r == 0 else (CARD if r % 2 else WHITE)
        cell.margin_left = cell.margin_right = Inches(0.1)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        run(cell.text_frame.paragraphs[0], value, 11.5 if r == 0 else 11, bold=(r == 0 or c == 0), color=WHITE if r == 0 else (NAVY if c == 0 else INK))
tbl._tbl.tblPr.set("bandRow", "0")
for i, words in enumerate(["No model credentials", "No generated execution code", "No automatic resend after an unknown outcome"]):
    box(s, 0.4 + i * 3.1, 4.2, 2.95, 0.6, OK_BG)
    text(s, 0.45 + i * 3.1, 4.2, 2.85, 0.6, [([(words, 11, True, OK)], {"align": PP_ALIGN.CENTER})], anchor=MSO_ANCHOR.MIDDLE)

# ---- Remove the template's instruction slide (slide 2) -----------------------------------------
sld_ids = prs.slides._sldIdLst
instruction = list(sld_ids)[1]
prs.part.drop_rel(instruction.get(qn("r:id")))
sld_ids.remove(instruction)

prs.save(OUT)
print("wrote", OUT)

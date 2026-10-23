"""Die-cut sticker artwork for PawPin, as 120x120 SVG markup.

Every sticker = one white "die-cut" outline path (union of the silhouette
subpaths, stroked white) followed by the colored art paths.
"""
import math

WHITE = "#FFFFFF"


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def E(cx, cy, rx, ry, rot=0):
    t = math.radians(rot)
    sx, sy = cx - rx * math.cos(t), cy - rx * math.sin(t)
    ex, ey = cx + rx * math.cos(t), cy + rx * math.sin(t)
    return (f"M{f(sx)} {f(sy)} A{f(rx)} {f(ry)} {f(rot)} 1 0 {f(ex)} {f(ey)} "
            f"A{f(rx)} {f(ry)} {f(rot)} 1 0 {f(sx)} {f(sy)} Z")


def C(cx, cy, r):
    return E(cx, cy, r, r)


def star(cx, cy, R, r, n=5, rot=-90):
    pts = []
    for i in range(n * 2):
        rad = R if i % 2 == 0 else r
        a = math.radians(rot + i * 180 / n)
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z"


def heart(cx, cy, s):
    # base heart drawn around (60, 62) in a 120 box, scaled by s
    base = [("M", [(60, 102)]), ("C", [(26, 80), (12, 60), (18, 42)]), ("C", [(24, 24), (46, 20), (60, 36)]),
            ("C", [(74, 20), (96, 24), (102, 42)]), ("C", [(108, 60), (94, 80), (60, 102)])]
    out = []
    for cmd, pts in base:
        out.append(cmd + " ".join(f"{f(cx + (x - 60) * s)} {f(cy + (y - 62) * s)}" for x, y in pts))
    return " ".join(out) + " Z"


def paw(cx, cy, s, color):
    """Pad + four toes centred on (cx, cy)."""
    parts = [E(cx, cy + 6 * s, 11 * s, 9 * s)]
    for dx, dy in [(-13, -8), (-5, -15), (5, -15), (13, -8)]:
        parts.append(C(cx + dx * s, cy + dy * s, 4.6 * s))
    return "".join(p(d, color) for d in parts)


def p(d, fill="none", stroke=None, sw=None, cap="round", join="round"):
    s = f'<path d="{d}" fill="{fill}"'
    if stroke:
        s += f' stroke="{stroke}" stroke-width="{f(sw)}" stroke-linecap="{cap}" stroke-linejoin="{join}"'
    return s + "/>"


def outline(*subpaths, sw=12):
    return p(" ".join(subpaths), WHITE, WHITE, sw)


def svg(body, size=120):
    return f'<svg viewBox="0 0 120 120" w={{{size}}} h={{{size}}}>{body}</svg>'


# ---------------------------------------------------------------- stickers
COCOA, INK, CREAM, PINK, BLUSH = "#8A6342", "#3E2F25", "#FFF4DC", "#FFC2CE", "#FFB3C6"
MOON, SOFTY, SKY, COBALT, DEEP, SAND = "#FFD95A", "#FFF2AE", "#74C3FF", "#2858C8", "#183B73", "#D7B589"


def dog():
    ears = [E(31, 54, 14, 28, 20), E(89, 54, 14, 28, -20)]
    head = C(60, 62, 36)
    tag = C(60, 100, 6)
    return svg(
        outline(*ears, head, tag)
        + p(ears[0], COCOA) + p(ears[1], COCOA)
        + p(head, "#EECB97")
        + p(E(37, 75, 6, 4), PINK) + p(E(83, 75, 6, 4), PINK)
        + p(E(60, 79, 21, 15), CREAM)
        + p(E(46, 58, 4.5, 5.5), INK) + p(E(74, 58, 4.5, 5.5), INK)
        + p(C(47.6, 56.2, 1.6), WHITE) + p(C(75.6, 56.2, 1.6), WHITE)
        + p(E(60, 71, 7, 5), INK)
        + p("M57 82 Q60 90 63 82 Z", "#FF9DB0")
        + p("M52 79 Q56 84 60 79 Q64 84 68 79", stroke="#6B4B36", sw=2.4)
        + p("M36 91 Q60 104 84 91", stroke=COBALT, sw=6)
        + p(tag, MOON, MOON, 1.5)
    )


def cat():
    ears = ["M27 56 L31 18 L58 38 Z", "M93 56 L89 18 L62 38 Z"]
    head = E(60, 68, 40, 34)
    return svg(
        outline(*ears, head)
        + p(ears[0], "#F4D9AE", "#F4D9AE", 4) + p(ears[1], "#F4D9AE", "#F4D9AE", 4)
        + p("M34 46 L36 28 L50 38 Z", PINK, PINK, 2) + p("M86 46 L84 28 L70 38 Z", PINK, PINK, 2)
        + p(head, "#F4D9AE")
        + p("M60 37 V46", stroke=SAND, sw=3.2) + p("M51 39 L53 47", stroke=SAND, sw=3.2)
        + p("M69 39 L67 47", stroke=SAND, sw=3.2)
        + p(E(38, 76, 6, 4), PINK) + p(E(82, 76, 6, 4), PINK)
        + p("M41 64 Q47 58 53 64", stroke="#5A4030", sw=2.8)
        + p("M67 64 Q73 58 79 64", stroke="#5A4030", sw=2.8)
        + p("M56.5 71 H63.5 L60 75.5 Z", "#E58FA2", "#E58FA2", 1.5)
        + p("M53 78 Q56.5 82 60 77.5 Q63.5 82 67 78", stroke="#5A4030", sw=2.2)
        + p("M22 70 L38 72", stroke="#C9A77A", sw=1.8) + p("M22 78 L38 77", stroke="#C9A77A", sw=1.8)
        + p("M98 70 L82 72", stroke="#C9A77A", sw=1.8) + p("M98 78 L82 77", stroke="#C9A77A", sw=1.8)
    )


def _crescent():
    # outer circle O (54, 62) r 44, inner circle I (78, 44) r 36
    ox, oy, R = 54, 62, 44
    ix, iy, r = 80, 44, 36
    d = math.hypot(ix - ox, iy - oy)
    a = (R * R - r * r + d * d) / (2 * d)
    h = math.sqrt(R * R - a * a)
    mx, my = ox + a * (ix - ox) / d, oy + a * (iy - oy) / d
    p1 = (mx + h * (iy - oy) / d, my - h * (ix - ox) / d)
    p2 = (mx - h * (iy - oy) / d, my + h * (ix - ox) / d)
    return (f"M{f(p1[0])} {f(p1[1])} A{R} {R} 0 1 0 {f(p2[0])} {f(p2[1])} "
            f"A{r} {r} 0 0 1 {f(p1[0])} {f(p1[1])} Z")


def moon():
    cr = _crescent()
    return svg(
        outline(cr, sw=12)
        + p(cr, MOON)
        + p(C(46, 98, 3.4), "#F5C842") + p(C(22, 50, 2.6), "#F5C842")
        + p("M24 70 Q30 75 36 70", stroke="#B98C1E", sw=2.6)
        + p(E(30, 80, 5, 3.4), "#FFB7A8")
    )


def cloud():
    body = ("M32 88 C16 88 9 74 16 63 C11 49 24 38 39 43 C44 27 66 21 76 36 "
            "C88 28 108 36 106 55 C119 58 119 87 101 88 Z")
    return svg(
        outline(body)
        + p(body, "#FFFFFF", "#D4E6FB", 2)
        + p(E(45, 72, 4.5, 3), "#FFC9D6") + p(E(80, 72, 4.5, 3), "#FFC9D6")
        + p("M47 64 Q51 68 55 64", stroke="#6E93C8", sw=2.4)
        + p("M70 64 Q74 68 78 64", stroke="#6E93C8", sw=2.4)
        + p("M58 71 Q62 75 66 71", stroke="#6E93C8", sw=2)
    )


def paw_star():
    s = star(60, 63, 50, 25)
    return svg(
        outline(s, sw=18)
        + p(s, MOON, MOON, 6)
        + p(star(60, 63, 40, 20), "#FFE58A")
        + paw(60, 68, 1.05, COCOA)
    )


def sparkle():
    big = "M60 12 C63 44 76 57 106 60 C76 63 63 76 60 108 C57 76 44 63 14 60 C44 57 57 44 60 12 Z"
    small = "M96 12 C97 19 99 21 106 22 C99 23 97 25 96 32 C95 25 93 23 86 22 C93 21 95 19 96 12 Z"
    return svg(outline(big, small, sw=12) + p(big, MOON) + p(small, SOFTY, "#F5C842", 1)
               + p("M60 34 C61 52 66 58 84 60 C66 62 61 66 60 84", stroke="#FFF2AE", sw=2.5))


def heart_paw():
    h = heart(60, 62, 1)
    return svg(
        outline(h)
        + p(h, BLUSH)
        + p(E(35, 44, 8, 4.5, -40), "#FFE3EA")
        + paw(60, 66, 0.92, WHITE)
    )


def paw_pin():
    pin = "M60 110 C60 110 22 74 22 48 C22 27 39 10 60 10 C81 10 98 27 98 48 C98 74 60 110 60 110 Z"
    return svg(
        outline(pin)
        + p(pin, COBALT)
        + p(E(35, 36, 4.5, 9, 30), "#5A82E0")
        + p(C(60, 48, 24), WHITE)
        + paw(60, 50, 0.78, COBALT)
    )


def shield():
    outer = "M60 10 L98 24 C100 62 86 92 60 108 C34 92 20 62 22 24 Z"
    inner = "M60 22 L88 32 C89 62 79 84 60 96 C41 84 31 62 32 32 Z"
    return svg(
        outline(outer)
        + p(outer, SKY, SKY, 4)
        + p(inner, "#DCEEFF")
        + p("M50 58 V50 A10 10 0 0 1 70 50 V58", stroke=COBALT, sw=5)
        + p("M44 56 H76 A4 4 0 0 1 80 60 V78 A4 4 0 0 1 76 82 H44 A4 4 0 0 1 40 78 V60 A4 4 0 0 1 44 56 Z", COBALT)
        + p(C(60, 66, 3.6), WHITE) + p("M58.4 67 H61.6 V74 H58.4 Z", WHITE)
    )


def letter():
    body = "M20 32 H100 A8 8 0 0 1 108 40 V88 A8 8 0 0 1 100 96 H20 A8 8 0 0 1 12 88 V40 A8 8 0 0 1 20 32 Z"
    return svg(
        outline(body)
        + p(body, "#FFFFFF", "#CFE0F6", 2)
        + p("M15 92 L50 64", stroke="#DCE8F8", sw=2) + p("M105 92 L70 64", stroke="#DCE8F8", sw=2)
        + p("M15 38 L60 70 L105 38", stroke="#A9C3E6", sw=2.6)
        + p(heart(60, 72, 0.34), "#FF9FB6", "#FFFFFF", 2.5)
    )


def pet_tag():
    body = "M36 30 H84 A12 12 0 0 1 96 42 V92 A16 16 0 0 1 80 108 H40 A16 16 0 0 1 24 92 V42 A12 12 0 0 1 36 30 Z"
    qr = "M40 50 H80 A6 6 0 0 1 86 56 V88 A6 6 0 0 1 80 94 H40 A6 6 0 0 1 34 88 V56 A6 6 0 0 1 40 50 Z"

    def sq(x, y, s):
        return f"M{x} {y} H{x + s} V{y + s} H{x} Z"

    finder = ""
    for x, y in [(40, 56), (70, 56), (40, 78)]:
        finder += p(sq(x, y, 10), DEEP) + p(sq(x + 2, y + 2, 6), WHITE) + p(sq(x + 3.6, y + 3.6, 2.8), DEEP)
    mods = [(55, 57), (60, 57), (55, 62), (63, 63), (57, 67), (52, 71), (61, 72), (68, 70), (74, 73),
            (56, 80), (64, 79), (69, 84), (75, 81), (60, 86), (78, 87)]
    modules = "".join(p(sq(x, y, 3.4), DEEP) for x, y in mods)
    return svg(
        outline(body, C(60, 21, 12))
        + p(C(60, 21, 9), stroke=COCOA, sw=4)
        + p(body, SAND)
        + p(C(60, 39, 4), COCOA)
        + p(qr, WHITE)
        + finder + modules
    )


def shooting_star():
    s = star(80, 40, 26, 12.5)
    tail = "M66 50 C48 62 32 80 14 104 C38 88 56 76 76 62 Z"
    inner = "M69 54 C55 64 42 78 28 96 C46 84 60 74 75 60 Z"
    return svg(
        outline(s, tail, sw=16)
        + p(tail, "#CFE9FF") + p(inner, SKY)
        + p(s, MOON, MOON, 5)
        + p(star(80, 40, 18, 8.5), "#FFE58A")
    )


def rainbow():
    cx, cy = 60, 78

    def band(R, r):
        return f"M{cx - R} {cy} A{R} {R} 0 0 1 {cx + R} {cy} L{cx + r} {cy} A{r} {r} 0 0 0 {cx - r} {cy} Z"

    clouds = [C(24, 80, 11), C(36, 84, 9), C(15, 86, 7), C(96, 80, 11), C(84, 84, 9), C(105, 86, 7)]
    half = f"M{cx - 46} {cy} A46 46 0 0 1 {cx + 46} {cy} Z"
    return svg(
        outline(half, *clouds)
        + p(band(46, 37), "#FFB8C9") + p(band(37, 28), "#FFE58A") + p(band(28, 19), "#9ED6FF")
        + "".join(p(c, WHITE) for c in clouds)
    )


def bone():
    shaft = "M30 50 H90 V70 H30 Z"
    ends = [C(28, 48, 13), C(28, 72, 13), C(92, 48, 13), C(92, 72, 13)]
    return svg(
        outline(shaft, *ends)
        + p(shaft, "#F7E2BC") + "".join(p(e, "#F7E2BC") for e in ends)
        + p("M36 55 H78", stroke="#FFFFFF", sw=3.5)
        + p(C(24, 44, 3.5), "#FFFFFF")
    )


STICKERS = [
    ("Dog", dog, "Welcome, owner profiles"),
    ("Cat", cat, "Welcome, owner profiles"),
    ("Sleepy moon", moon, "Night alerts, calm waits"),
    ("Cloud", cloud, "Empty states, loading"),
    ("Paw star", paw_star, "Milestones, first pet"),
    ("Sparkle", sparkle, "Accent. Pairs with any"),
    ("Heart paw", heart_paw, "Reunions, thank-yous"),
    ("Paw pin", paw_pin, "Brand, nearby alerts"),
    ("Privacy shield", shield, "Privacy promises"),
    ("Love letter", letter, "Secure messages"),
    ("Pet tag", pet_tag, "Scan a tag, profiles"),
    ("Shooting star", shooting_star, "Success, all set"),
    ("Rainbow", rainbow, "Recovered, home again"),
    ("Bone", bone, "Playful empty states"),
]

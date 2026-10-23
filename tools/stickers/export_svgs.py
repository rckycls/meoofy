"""Exports the die-cut sticker artwork in stickers.py as plain SVG files.

stickers.py is the single artwork source for both the Figma board and the app.
This script turns each sticker into packages/ui/assets/stickers/<kebab-name>.svg;
`pnpm gen:stickers` then runs svgr over those files to produce the
react-native-svg components in packages/ui/src/stickers/generated/.

Run from anywhere: python3 tools/stickers/export_svgs.py
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent.parent / "packages" / "ui" / "assets" / "stickers"

# stickers.py is imported as a sibling module; keep it from leaving a
# __pycache__ directory in the source tree.
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))

from stickers import STICKERS  # noqa: E402

SHADOW_COLOR = "#53749A"
SHADOW_OPACITY = "0.18"
SHADOW_OFFSET_Y = 6

SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'
# svg() in stickers.py writes JSX-flavoured attributes (w={120} h={120}) on the
# root element, so the inner markup is cut out rather than parsed as XML.
SVG_RE = re.compile(r"^<svg [^>]*>(?P<inner>.*)</svg>$", re.DOTALL)
PATH_RE = re.compile(r"<path [^>]*/>")


def kebab(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def inner_markup(markup: str, name: str) -> str:
    match = SVG_RE.match(markup)
    if not match:
        raise ValueError(f"{name}: expected <svg ...>...</svg> markup")
    return match.group("inner")


def shadow_of(outline: str, name: str) -> str:
    """The die-cut outline, moved down and tinted: the soft shadow, without a runtime blur.

    The outline is a white fill plus a white stroke, and the stroke is what
    makes the die-cut border. The copy keeps the stroke geometry and swaps
    both paints for the shadow colour. With the stroke dropped, the copy is
    only the silhouette, which sits entirely inside the stroked outline once it
    is moved down by no more than the stroke's half-width, so it would never show.
    """
    for attribute, value in (("fill", "#FFFFFF"), ("stroke", "#FFFFFF")):
        if f'{attribute}="{value}"' not in outline:
            raise ValueError(f"{name}: first path is not a white {attribute} outline")
    shadow = outline.replace('fill="#FFFFFF"', f'fill="{SHADOW_COLOR}" fill-opacity="{SHADOW_OPACITY}"')
    shadow = shadow.replace(
        'stroke="#FFFFFF"', f'stroke="{SHADOW_COLOR}" stroke-opacity="{SHADOW_OPACITY}"'
    )
    return f'{shadow[:-2]} transform="translate(0 {SHADOW_OFFSET_Y})"/>'


def sticker_svg(name: str, markup: str) -> str:
    inner = inner_markup(markup, name)
    first = PATH_RE.match(inner)
    if not first:
        raise ValueError(f"{name}: the first element must be the die-cut outline path")
    outline = first.group(0)
    return f"{SVG_OPEN}{shadow_of(outline, name)}{inner}</svg>\n"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = set()
    for name, fn, _usage in STICKERS:
        file_name = f"{kebab(name)}.svg"
        (OUT_DIR / file_name).write_text(sticker_svg(name, fn()), encoding="utf-8")
        written.add(file_name)
    # A renamed or dropped sticker must not leave its old file behind.
    for stale in OUT_DIR.glob("*.svg"):
        if stale.name not in written:
            stale.unlink()
    print(f"wrote {len(written)} stickers to {OUT_DIR.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()

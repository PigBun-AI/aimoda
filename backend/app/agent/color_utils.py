"""
Color utilities for fashion search — inline implementation.

Replaces the external `shared.color_utils` module referenced by the MVP.
Provides color keyword → LAB reference mapping and fuzzy color matching.
"""

import math
from typing import Optional

# ── Color keyword → reference hex codes ──
COLOR_KEYWORDS: dict[str, list[str]] = {
    "red": ["#FF0000", "#DC143C", "#B22222", "#CD5C5C", "#FF6347"],
    "blue": ["#0000FF", "#4169E1", "#1E90FF", "#87CEEB", "#4682B4"],
    "green": ["#008000", "#228B22", "#32CD32", "#90EE90", "#2E8B57"],
    "black": ["#000000", "#1C1C1C", "#2F2F2F", "#0A0A0A"],
    "white": ["#FFFFFF", "#F5F5F5", "#FAFAFA", "#FFFAF0"],
    "navy": ["#000080", "#191970", "#00004D"],
    "burgundy": ["#800020", "#722F37", "#8B0000"],
    "pink": ["#FFC0CB", "#FF69B4", "#FF1493", "#DB7093"],
    "beige": ["#F5F5DC", "#FAEBD7", "#D2B48C", "#C8AD7F"],
    "brown": ["#8B4513", "#A0522D", "#D2691E", "#CD853F"],
    "gray": ["#808080", "#A9A9A9", "#696969", "#778899"],
    "grey": ["#808080", "#A9A9A9", "#696969", "#778899"],
    "cream": ["#FFFDD0", "#FFFACD", "#FFF8DC", "#FAF0E6"],
    "gold": ["#FFD700", "#DAA520", "#B8860B"],
    "purple": ["#800080", "#9370DB", "#8B008B", "#6A0DAD"],
    "orange": ["#FFA500", "#FF8C00", "#FF7F50", "#E65100"],
    "yellow": ["#FFFF00", "#FFD700", "#F0E68C", "#FADA5E"],
    "silver": ["#C0C0C0", "#A8A9AD", "#B0B0B0"],
    "ivory": ["#FFFFF0", "#FFF8E7", "#FAEBD7"],
    "tan": ["#D2B48C", "#C8AD7F", "#D2B48C"],
    "olive": ["#808000", "#6B8E23", "#556B2F"],
    "coral": ["#FF7F50", "#FF6347", "#E9967A"],
    "maroon": ["#800000", "#6B0000", "#5C0000"],
    "teal": ["#008080", "#20B2AA", "#2F4F4F"],
    "turquoise": ["#40E0D0", "#48D1CC", "#00CED1"],
    "lavender": ["#E6E6FA", "#D8BFD8", "#DDA0DD"],
    "magenta": ["#FF00FF", "#FF0090", "#C71585"],
    "khaki": ["#F0E68C", "#BDB76B", "#C3B091"],
}


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    """Convert hex color string to RGB tuple."""
    hex_str = hex_str.lstrip("#")
    return (int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))


def hex_to_hsv(hex_str: str) -> tuple[int, int, int]:
    """Convert hex color string to HSV tuple (H: 0-360, S: 0-100, V: 0-100)."""
    r, g, b = hex_to_rgb(hex_str)
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    mx = max(r, g, b)
    mn = min(r, g, b)
    df = mx - mn
    if mx == mn:
        h = 0.0
    elif mx == r:
        h = (60 * ((g - b) / df) + 360) % 360
    elif mx == g:
        h = (60 * ((b - r) / df) + 120) % 360
    elif mx == b:
        h = (60 * ((r - g) / df) + 240) % 360
    else:
        h = 0.0
    s = 0.0 if mx == 0 else (df / mx) * 100
    v = mx * 100
    return int(round(h)), int(round(s)), int(round(v))


def hex_to_lab(hex_str: str) -> tuple[float, float, float]:
    """Convert hex → sRGB → XYZ → CIELAB."""
    r, g, b = hex_to_rgb(hex_str)

    # sRGB → linear
    def linearize(v: int) -> float:
        v_norm = v / 255.0
        return ((v_norm + 0.055) / 1.055) ** 2.4 if v_norm > 0.04045 else v_norm / 12.92

    rl, gl, bl = linearize(r), linearize(g), linearize(b)

    # linear RGB → XYZ (D65)
    x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041

    # XYZ → Lab (D65 white point)
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t: float) -> float:
        return t ** (1.0 / 3.0) if t > 0.008856 else 7.787 * t + 16.0 / 116.0

    L = 116.0 * f(y / yn) - 16.0
    a = 500.0 * (f(x / xn) - f(y / yn))
    b_val = 200.0 * (f(y / yn) - f(z / zn))
    return (L, a, b_val)


def color_distance(hex1: str, hex2: str) -> float:
    """Delta-E (CIE76) between two hex colors."""
    L1, a1, b1 = hex_to_lab(hex1)
    L2, a2, b2 = hex_to_lab(hex2)
    return math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)


def color_matches(hex_list: list[str], color_keyword: str, threshold: float = 35.0) -> bool:
    """Check if any hex in list matches a color keyword within Delta-E threshold."""
    refs = COLOR_KEYWORDS.get(color_keyword.lower())
    if not refs:
        return False
    for hex_val in hex_list:
        if not hex_val:
            continue
        for ref in refs:
            try:
                if color_distance(hex_val, ref) < threshold:
                    return True
            except (ValueError, IndexError):
                continue
    return False

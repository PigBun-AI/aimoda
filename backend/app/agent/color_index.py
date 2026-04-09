"""
In-memory color index for fast Delta-E color similarity search.

Loads all extracted_colors from Qdrant at startup, pre-computes LAB values,
and provides vectorized NumPy search for <20ms query times.
"""

import math
import time
import threading
from typing import Optional

import numpy as np

from .color_utils import hex_to_hsv
from ..value_normalization import normalize_quarter_value

# ── Module-level cache ──
_color_index: Optional["ColorIndex"] = None
_lock = threading.Lock()


class ColorIndex:
    """Pre-computed in-memory index of all colors in the collection."""

    def __init__(self):
        # Mapping: hex → HSV np array
        self.unique_hexes: list[str] = []
        self.hsv_matrix: np.ndarray = np.empty((0, 3), dtype=np.float64)

        # Mapping: hex → list of (image_id, percentage, payload)
        self.hex_to_images: dict[str, list[tuple[str, float, dict]]] = {}

        self.loaded = False
        self.load_time: float = 0
        self.total_images: int = 0
        self.total_colors: int = 0

    def build(self, client, collection: str):
        """Scan all points and build the in-memory index."""
        start = time.time()

        hex_to_hsv_map: dict[str, tuple[int, int, int]] = {}
        hex_to_images: dict[str, list[tuple[str, float, dict]]] = {}

        scroll_offset = None
        batch_size = 1000
        total_images = 0

        while True:
            results, next_offset = client.scroll(
                collection_name=collection,
                limit=batch_size,
                offset=scroll_offset,
                with_payload=True,
            )

            for p in results:
                total_images += 1
                image_id = str(p.id)
                extracted_colors = p.payload.get("extracted_colors", [])

                for c in extracted_colors:
                    hex_val = c.get("hex", "").strip()
                    pct = c.get("percentage", 0.0)
                    if not hex_val or not hex_val.startswith("#"):
                        continue

                    # Pre-compute HSV if new hex
                    if hex_val not in hex_to_hsv_map:
                        try:
                            hex_to_hsv_map[hex_val] = hex_to_hsv(hex_val)
                        except (ValueError, IndexError):
                            continue

                    # Store image reference
                    if hex_val not in hex_to_images:
                        hex_to_images[hex_val] = []
                    hex_to_images[hex_val].append((image_id, pct, p.payload))

            if next_offset is None or len(results) < batch_size:
                break
            scroll_offset = next_offset

        # Build NumPy matrix for vectorized HSV indexing
        unique_hexes = list(hex_to_hsv_map.keys())
        if unique_hexes:
            hsv_values = [hex_to_hsv_map[h] for h in unique_hexes]
            hsv_matrix = np.array(hsv_values, dtype=np.float64)
        else:
            hsv_matrix = np.empty((0, 3), dtype=np.float64)

        self.unique_hexes = unique_hexes
        self.hsv_matrix = hsv_matrix
        self.hex_to_images = hex_to_images
        self.total_images = total_images
        self.total_colors = len(unique_hexes)
        self.load_time = time.time() - start
        self.loaded = True

        print(
            f"[ColorIndex] Built in {self.load_time:.2f}s: "
            f"{total_images} images, {self.total_colors} unique colors, "
            f"{sum(len(v) for v in hex_to_images.values())} color entries"
        )

    def search(
        self,
        target_hex: str,
        threshold: float = 75.0,
        min_percentage: float = 70.0,
        gender: str | None = None,
        quarter: str | None = None,
        page: int = 1,
        page_size: int = 56,
    ) -> dict:
        """Find images with colors similar to target_hex, sorted by score.

        Uses adaptive HSV matching window that tightens for desaturated/neutral colors
        to prevent white/cream/beige from matching pale tones.
        """
        if not self.loaded or len(self.hsv_matrix) == 0:
            return {"images": [], "total": 0, "page": page, "page_size": page_size, "has_more": False}

        start = time.time()

        # Compute target HSV
        try:
            target_hsv = np.array(hex_to_hsv(target_hex), dtype=np.float64)
        except (ValueError, IndexError):
            return {"images": [], "total": 0, "page": page, "page_size": page_size, "has_more": False}

        t_h, t_s, t_v = target_hsv

        # ── Adaptive HSV window ──
        # For low-saturation colors (pastels, whites), tighten S window to avoid
        # matching white/cream/beige. For near-neutral colors, tighten H window
        # since hue is unreliable at low saturation.
        if t_s < 15:
            # Near-achromatic (white, gray, black): hue is meaningless
            h_tol, s_tol, v_tol = 180, 10, 15
        elif t_s < 40:
            # Desaturated / pastel: tighten S and V to keep similar tone
            h_tol, s_tol, v_tol = 12, 15, 20
        elif t_s < 70:
            # Medium saturation: moderate tolerance
            h_tol, s_tol, v_tol = 12, 20, 25
        else:
            # High saturation (vivid colors): standard window
            h_tol, s_tol, v_tol = 15, 25, 25

        h_diff = np.abs(self.hsv_matrix[:, 0] - t_h)
        h_dist = np.minimum(h_diff, 360 - h_diff)
        s_dist = np.abs(self.hsv_matrix[:, 1] - t_s)
        v_dist = np.abs(self.hsv_matrix[:, 2] - t_v)

        # Apply adaptive coarse filter
        mask = (h_dist <= h_tol) & (s_dist <= s_tol) & (v_dist <= v_tol)
        matching_indices = np.where(mask)[0]

        normalized_quarter = normalize_quarter_value(quarter)

        # Collect all images for matching hexes, picking the BEST relevance color per image
        image_best: dict[str, tuple[float, float, dict, float]] = {}

        for idx in matching_indices:
            hex_val = self.unique_hexes[idx]

            # Base similarity score (weighted: H most important, then S, then V)
            base_sim = 100 - (h_dist[idx] * 0.5 + s_dist[idx] * 0.3 + v_dist[idx] * 0.2)

            for image_id, pct, payload in self.hex_to_images[hex_val]:
                if pct < min_percentage:
                    continue
                # Apply hard filters before scoring.
                if gender and payload.get("gender", "").lower() != gender.lower():
                    continue
                payload_quarter = normalize_quarter_value(payload.get("quarter") or payload.get("season"))
                if normalized_quarter and payload_quarter != normalized_quarter:
                    continue
                # Score combines color closeness AND percentage
                score = (base_sim - 5) + (pct / 100.0) * 5

                if score >= threshold:
                    dist = 100 - score
                    if image_id not in image_best or score > image_best[image_id][3]:
                        image_best[image_id] = (pct, dist, payload, score)

        # Sort by relevance score descending
        sorted_results = [
            (pct, dist, payload)
            for pct, dist, payload, _score in sorted(
                image_best.values(),
                key=lambda x: -x[3],
            )
        ]

        total = len(sorted_results)
        offset = (page - 1) * page_size
        page_results = sorted_results[offset: offset + page_size]

        elapsed = time.time() - start
        print(
            f"[ColorIndex] Search {target_hex} (thr={threshold}, min_pct={min_percentage}, "
            f"hsv_tol=H±{h_tol}/S±{s_tol}/V±{v_tol}): "
            f"{total} matches in {elapsed*1000:.1f}ms"
        )

        return {
            "results": page_results,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": offset + page_size < total,
        }


def get_color_index() -> ColorIndex:
    """Get or lazily build the color index singleton."""
    global _color_index
    if _color_index is not None and _color_index.loaded:
        return _color_index

    with _lock:
        if _color_index is not None and _color_index.loaded:
            return _color_index

        from .qdrant_utils import get_qdrant, get_collection

        _color_index = ColorIndex()
        client = get_qdrant()
        collection = get_collection()
        _color_index.build(client, collection)
        return _color_index

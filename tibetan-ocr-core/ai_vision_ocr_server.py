#!/usr/bin/env python3
"""Local AI Vision OCR adapter for Tibetan OCR correction.

This service exposes the same lightweight HTTP shape as the local BDRC wrapper:

- GET /health
- POST /ocr with multipart field "file"

It forwards the rendered page image plus optional BDRC OCR draft text to either
ModelAggregatorService or an OpenAI-compatible vision chat-completions endpoint.
"""

from __future__ import annotations

import base64
import cgi
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional runtime dependency
    Image = None  # type: ignore[assignment]

try:
    import cv2
    import numpy as np
except Exception:  # pragma: no cover - optional layout detector dependency
    cv2 = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]


HOST = os.environ.get("AI_VISION_OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("AI_VISION_OCR_PORT", "18092"))
PROVIDER = os.environ.get("AI_VISION_PROVIDER", "model_aggregator").strip().lower()
USE_MODEL_AGGREGATOR = PROVIDER in {"model_aggregator", "model-aggregator", "aggregator"}
BASE_URL = os.environ.get("AI_VISION_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
API_KEY = os.environ.get("AI_VISION_API_KEY", "")
AGGREGATOR_BASE_URL = os.environ.get("MODEL_AGGREGATOR_BASE_URL", "http://127.0.0.1:8890").rstrip("/")
AGGREGATOR_API_KEY = os.environ.get("MODEL_AGGREGATOR_API_KEY", "")
DEFAULT_MODEL = "gemini:gemini-2.5-flash" if USE_MODEL_AGGREGATOR else "qwen2.5-vl:7b"
MODEL = os.environ.get("AI_VISION_MODEL", DEFAULT_MODEL)
TIMEOUT = float(os.environ.get("AI_VISION_TIMEOUT", "120"))
MAX_TOKENS = int(os.environ.get("AI_VISION_MAX_TOKENS", "8192"))
TEMPERATURE = float(os.environ.get("AI_VISION_TEMPERATURE", "0.0"))
MAX_IMAGE_SIDE = int(os.environ.get("AI_VISION_MAX_IMAGE_SIDE", "1800"))
IMAGE_JPEG_QUALITY = int(os.environ.get("AI_VISION_IMAGE_JPEG_QUALITY", "88"))
LINE_REVIEW_TARGET_HEIGHT = int(os.environ.get("AI_VISION_LINE_REVIEW_TARGET_HEIGHT", "640"))
LINE_REVIEW_TILE_WIDTH = int(os.environ.get("AI_VISION_LINE_REVIEW_TILE_WIDTH", "1500"))
AGGREGATOR_ALLOW_FALLBACK = os.environ.get("AI_VISION_ALLOW_FALLBACK", "0").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def parse_model_list(value: str) -> list[str]:
    value = value.strip()
    if not value:
        return []
    if value.startswith("["):
        parsed = json.loads(value)
        return [str(item).strip() for item in parsed if str(item).strip()]
    return [item.strip() for item in value.split(",") if item.strip()]


AGGREGATOR_MODELS = parse_model_list(os.environ.get("AI_VISION_MODELS", ""))


def chat_completions_url() -> str:
    if BASE_URL.endswith("/chat/completions"):
        return BASE_URL
    return f"{BASE_URL}/chat/completions"


def aggregator_url(path: str) -> str:
    return f"{AGGREGATOR_BASE_URL}/{path.lstrip('/')}"


def default_prompt(draft_text: str) -> str:
    draft_lines = [line for line in draft_text.splitlines() if line.strip()]
    parts = [
        "请识别图片中的藏文印刷体文字。",
        "重点检查上加字、下加字、元音符号和堆叠字。",
        "不要根据语义自由扩写，不要补充图片中不存在的字。",
    ]
    if draft_text:
        parts.append(
            f"BDRC OCR 初稿共有 {len(draft_lines)} 行。请必须输出 {len(draft_lines)} 行，用换行逐行分隔；不得只输出前几行。"
        )
        parts.append("看不清或无法确认的行，请保留 BDRC 原行，只修正有图像证据的字。")
        parts.append("下面是 BDRC OCR 初稿。请以图片为准，只修正有视觉证据的错误：")
        parts.append(draft_text)
    else:
        parts.append("请完整输出整页所有藏文行，用换行逐行分隔；不得只输出前几行。")
    parts.append("只输出纯藏文文本，不要输出编号、解释、Markdown 表格或代码块。")
    return "\n\n".join(parts)


def image_data_url(image_bytes: bytes, filename: str) -> str:
    mime_type = mimetypes.guess_type(filename)[0] or "image/png"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def prepare_vision_image(image_bytes: bytes, filename: str) -> tuple[bytes, str, str]:
    """Downscale full-page OCR images before sending them to a slow vision model."""
    if Image is None or MAX_IMAGE_SIDE <= 0:
        mime_type = mimetypes.guess_type(filename)[0] or "image/png"
        return image_bytes, filename, mime_type

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            width, height = image.size
            if max(width, height) <= MAX_IMAGE_SIDE:
                mime_type = mimetypes.guess_type(filename)[0] or "image/png"
                return image_bytes, filename, mime_type

            normalized = image.convert("RGB")
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            normalized.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), resampling)

            output = BytesIO()
            normalized.save(
                output,
                format="JPEG",
                quality=max(60, min(95, IMAGE_JPEG_QUALITY)),
                optimize=True,
            )
            stem = os.path.splitext(filename or "page.png")[0] or "page"
            return output.getvalue(), f"{stem}.jpg", "image/jpeg"
    except Exception:
        mime_type = mimetypes.guess_type(filename)[0] or "image/png"
        return image_bytes, filename, mime_type


def parse_normalized_bbox(value: str) -> dict[str, float]:
    """Parse and validate a normalized source-line rectangle from multipart data."""
    try:
        raw = json.loads(value)
        bbox = {key: float(raw[key]) for key in ("x", "y", "width", "height")}
    except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
        raise RuntimeError("bbox must be a JSON object with x, y, width, and height") from exc
    if not (0 <= bbox["x"] < 1 and 0 <= bbox["y"] < 1 and bbox["width"] > 0 and bbox["height"] > 0):
        raise RuntimeError("bbox must describe a non-empty normalized source region")
    if bbox["x"] + bbox["width"] > 1.001 or bbox["y"] + bbox["height"] > 1.001:
        raise RuntimeError("bbox extends outside the source image")
    return bbox


def prepare_line_review_images(
    image_bytes: bytes, bbox: dict[str, float]
) -> tuple[list[bytes], dict[str, Any]]:
    """Tightly crop one OCR row, preserve ink color, enlarge it, then tile wide rows.

    A whole pecha page is intentionally downsized before ordinary OCR. That
    would make faint rubric text tiny again, so line review keeps each enlarged
    tile below the upstream maximum width instead of shrinking the whole row.
    """
    if Image is None:
        raise RuntimeError("Pillow is required for AI Vision line review")
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            source.load()
            image = source.convert("RGB")
            page_width, page_height = image.size
            raw_x = bbox["x"] * page_width
            raw_y = bbox["y"] * page_height
            raw_width = max(1.0, bbox["width"] * page_width)
            raw_height = max(1.0, bbox["height"] * page_height)
            # Keep Tibetan stacks and red punctuation at the line edges, but do
            # not include the surrounding frame or neighbouring rows.
            pad_x = max(5, round(raw_width * 0.06))
            pad_y = max(4, round(raw_height * 0.8))
            x0 = max(0, int(round(raw_x - pad_x)))
            y0 = max(0, int(round(raw_y - pad_y)))
            x1 = min(page_width, int(round(raw_x + raw_width + pad_x)))
            y1 = min(page_height, int(round(raw_y + raw_height + pad_y)))
            if x1 <= x0 or y1 <= y0:
                raise RuntimeError("bbox crop is empty")
            crop = image.crop((x0, y0, x1, y1))
            # A BDRC rubric band may include a long red rule and blank paper.
            # Locate saturated red glyph components before enlargement so a
            # short inscription is not split into a dozen mostly-empty tiles.
            if cv2 is not None and np is not None:
                rgb = np.asarray(crop)
                hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
                red = (((hsv[:, :, 0] <= 18) | (hsv[:, :, 0] >= 170)) &
                       (hsv[:, :, 1] >= 110)).astype(np.uint8)
                gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
                dark = (gray < 90) & (red == 0)
                if red.sum() >= 40 and red.sum() > dark.sum() * 3:
                    count, labels, stats, _ = cv2.connectedComponentsWithStats(red, 8)
                    kept = []
                    for component in range(1, count):
                        cx, cy, cw, ch, area = stats[component]
                        if area < 5 or cw > red.shape[1] * .65 or (cw > ch * 12) or (ch > cw * 4 and ch >= red.shape[0] * .85):
                            continue
                        # Ignore nearby-row components outside the requested band.
                        center_y = cy + ch / 2 + y0
                        if raw_y <= center_y <= raw_y + raw_height:
                            kept.append((cx, cy, cx + cw, cy + ch))
                    if kept:
                        tx0 = max(0, min(b[0] for b in kept) - 8)
                        tx1 = min(crop.width, max(b[2] for b in kept) + 8)
                        # Keep the full vertically padded bbox. Red/black
                        # connected components often capture only the middle
                        # stroke of Tibetan stacks; trimming their y bounds
                        # cuts off upper/lower marks and final punctuation.
                        crop = crop.crop((tx0, 0, tx1, crop.height))
                        x0, x1 = int(x0 + tx0), int(x0 + tx1)
            crop_width, crop_height = crop.size
            target_height = max(480, LINE_REVIEW_TARGET_HEIGHT)
            scale = target_height / max(1, crop_height)
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            enlarged = crop.resize(
                (max(1, round(crop_width * scale)), target_height),
                resampling,
            )
            tile_width = max(480, min(LINE_REVIEW_TILE_WIDTH, max(480, MAX_IMAGE_SIDE)))
            tiles: list[bytes] = []
            for left in range(0, enlarged.width, tile_width):
                right = min(enlarged.width, left + tile_width)
                tile = enlarged.crop((left, 0, right, enlarged.height))
                output = BytesIO()
                tile.save(output, format="PNG", optimize=True)
                tiles.append(output.getvalue())
            return tiles, {
                "source_bbox": bbox,
                "crop_pixels": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                "review_size": {"width": enlarged.width, "height": enlarged.height},
                "tile_count": len(tiles),
            }
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"unable to prepare line review crop: {exc}") from exc

def find_framed_text_region(gray: Any, red_ink: Any) -> tuple[int, int] | None:
    """Find the densest nested red-frame interior, if this is a framed page."""
    height, width = gray.shape[:2]
    horizontal = red_ink.sum(axis=1) >= max(20, round(width * 0.2))
    bands: list[tuple[int, int]] = []
    start = None
    for index, is_active in enumerate(horizontal):
        if is_active and start is None:
            start = index
        elif not is_active and start is not None:
            bands.append((start, index))
            start = None
    if start is not None:
        bands.append((start, height))
    if len(bands) < 2:
        return None

    best_region = None
    # Title pages can contain only a few sparse glyphs between the red rules.
    # Keep the threshold low enough to locate that frame; later rule and
    # region checks still reject pages without a usable three-column layout.
    best_density = 0.0015
    for left_index, left_band in enumerate(bands):
        for right_band in bands[left_index + 1:]:
            y0, y1 = left_band[1], right_band[0]
            if y1 - y0 < max(24, round(height * 0.08)):
                continue
            dark_ink = (gray[y0:y1] < 90) & (~red_ink[y0:y1])
            density = float(dark_ink.mean()) if dark_ink.size else 0.0
            if density > best_density:
                best_density = density
                best_region = (y0, y1)
    return best_region


def _cluster_positions(values: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Cluster nearby line coordinates and keep the strongest score per cluster."""
    clusters: list[list[tuple[float, float]]] = []
    for position, score in sorted(values):
        if not clusters or position - clusters[-1][-1][0] > tolerance:
            clusters.append([(position, score)])
        else:
            clusters[-1].append((position, score))
    return [
        (
            sum(position * score for position, score in cluster) / max(1e-6, sum(score for _, score in cluster)),
            max(score for _, score in cluster),
        )
        for cluster in clusters
    ]


def _hough_vertical_rule_candidates(
    gray: Any, y0: int, y1: int
) -> list[tuple[float, float]]:
    """Find long vertical frame rules when LSD misses faint/slanted lines."""
    if cv2 is None or np is None:
        return []
    height, width = gray.shape[:2]
    y0 = max(0, min(height - 1, int(y0)))
    y1 = max(y0 + 1, min(height, int(y1)))
    crop = gray[y0:y1]
    edges = cv2.Canny(crop, 40, 120)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(24, round(width * 0.008)),
        minLineLength=max(30, round((y1 - y0) * 0.45)),
        maxLineGap=max(8, round((y1 - y0) * 0.08)),
    )
    candidates: list[tuple[float, float]] = []
    for line in lines if lines is not None else []:
        x_start, y_start, x_end, y_end = map(float, line[0])
        dx = x_end - x_start
        dy = y_end - y_start
        length = abs(dy)
        # Glyph strokes can also look vertical, but they are shorter than the
        # long rules that span most of the inner frame.
        if length < (y1 - y0) * 0.55 or length < abs(dx) * 2:
            continue
        x = (x_start + x_end) / 2.0
        if x < width * 0.03 or x > width * 0.97:
            continue
        candidates.append((x, length))
    return candidates


def _red_vertical_rule_candidates(
    red_ink: Any, y0: int, y1: int
) -> list[tuple[float, float]]:
    """Find long, slightly slanted frame rules from the red-ink mask.

    At the browser's PDF render resolution the faded red rules can have too
    little grayscale contrast for the ordinary edge detector.  Their hue and
    saturation remain distinctive, so run the same line search on that mask.
    """
    if cv2 is None or np is None:
        return []
    height, width = red_ink.shape[:2]
    y0 = max(0, min(height - 1, int(y0)))
    y1 = max(y0 + 1, min(height, int(y1)))
    crop = (red_ink[y0:y1].astype(np.uint8) * 255)
    edges = cv2.Canny(crop, 30, 100)
    frame_height = y1 - y0
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(16, round(width * 0.002)),
        minLineLength=max(30, round(frame_height * 0.4)),
        maxLineGap=max(8, round(frame_height * 0.12)),
    )
    candidates: list[tuple[float, float]] = []
    for line in lines if lines is not None else []:
        x_start, y_start, x_end, y_end = map(float, line[0])
        dx = x_end - x_start
        dy = y_end - y_start
        vertical_length = abs(dy)
        if vertical_length < frame_height * 0.45 or vertical_length < abs(dx) * 2:
            continue
        x = (x_start + x_end) / 2.0
        if x < width * 0.03 or x > width * 0.97:
            continue
        candidates.append((x, vertical_length))
    return candidates


def _select_traditional_boundaries(
    clusters: list[tuple[float, float]], width: int
) -> list[float]:
    """Choose the outer and inner rules for the two side strips."""
    if len(clusters) < 4:
        return []
    positions = [position for position, _ in clusters]
    # A traditional pecha frame has two rule pairs near its left and right
    # margins.  The outer/inner rule in each pair defines a side strip; the
    # two inner rules define the wide center column.  Keeping the search in
    # those margin bands prevents red title glyphs from splitting the center.
    left_rules = [position for position in positions if position <= width * 0.30]
    right_rules = [position for position in positions if position >= width * 0.70]
    if len(left_rules) >= 2 and len(right_rules) >= 2:
        boundary_set = [left_rules[0], left_rules[-1], right_rules[0], right_rules[-1]]
        left_width = boundary_set[1] - boundary_set[0]
        center_width = boundary_set[2] - boundary_set[1]
        right_width = boundary_set[3] - boundary_set[2]
        if (
            center_width >= width * 0.25
            and 0 < left_width <= width * 0.22
            and 0 < right_width <= width * 0.22
        ):
            return boundary_set

    best: tuple[float, list[float]] | None = None
    left_start = positions[0]
    right_end = positions[-1]
    # Red title glyphs can appear as short vertical candidates inside the
    # middle column.  Consider non-adjacent candidates so that they do not
    # split the center column into several false gaps.
    for center_start_index in range(1, len(positions) - 2):
        for center_end_index in range(center_start_index + 1, len(positions) - 1):
            center_start = positions[center_start_index]
            center_end = positions[center_end_index]
            center_width = center_end - center_start
            left_width = center_start - left_start
            right_width = right_end - center_end
            if center_width < width * 0.25:
                continue
            if not (
                0 < left_width <= width * 0.22
                and 0 < right_width <= width * 0.22
            ):
                continue
            side_ratio = min(left_width, right_width) / max(left_width, right_width)
            if side_ratio < 0.7:
                continue
            score = center_width - abs(left_width - right_width) * 1.5
            boundary_set = [left_start, center_start, center_end, right_end]
            if best is None or score > best[0]:
                best = (score, boundary_set)
    return best[1] if best else []


def detect_traditional_column_bboxes(image_bytes: bytes) -> list[dict[str, float]]:
    """Find the three text columns inside a traditional pecha page frame.

    Traditional pages have a narrow side strip on each side of a wide central
    text area. The side strips are bounded by long, slightly slanted vertical
    rules. LSD is used instead of a simple red-pixel projection because the
    red ink can be faint or yellowed in scanned pages.
    """
    if cv2 is None or np is None:
        return []
    color = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if color is None:
        return []
    height, width = color.shape[:2]
    if width < 100 or height < 40:
        return []

    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(color, cv2.COLOR_BGR2HSV)
    hue, saturation, _ = cv2.split(hsv)
    red_ink = (saturation >= 80) & ((hue <= 22) | (hue >= 165))
    frame_region = find_framed_text_region(gray, red_ink)
    if not frame_region:
        return []
    y0, y1 = frame_region

    # LSD finds both red rules and dark rules after scanning/deskewing. Keep
    # lines that cross most of the text frame, then cluster duplicate edges.
    detector = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    segments = detector.detect(gray)[0]
    candidates: list[tuple[float, float]] = []
    min_length = max(25.0, height * 0.22)
    for segment in segments if segments is not None else []:
        x1, y_start, x2, y_end = map(float, segment[0])
        dx = x2 - x1
        dy = y_end - y_start
        length = float((dx * dx + dy * dy) ** 0.5)
        if length < min_length or abs(dy) < 1:
            continue
        if abs(dx) > abs(dy) * 0.25:
            continue
        overlap = min(y1, max(y_start, y_end)) - max(y0, min(y_start, y_end))
        if overlap < (y1 - y0) * 0.35:
            continue
        x = (x1 + x2) / 2.0
        if x < width * 0.04 or x > width * 0.96:
            continue
        candidates.append((x, length * max(0.25, overlap / max(1.0, y1 - y0))))

    clusters = _cluster_positions(
        candidates
        + _hough_vertical_rule_candidates(gray, y0, y1)
        + _red_vertical_rule_candidates(red_ink, y0, y1),
        max(10.0, width * 0.012),
    )
    boundaries = _select_traditional_boundaries(clusters, width)
    if len(boundaries) != 4:
        return []
    if not (boundaries[0] < boundaries[1] < boundaries[2] < boundaries[3]):
        return []

    top = max(0.0, y0 / height)
    bottom = min(1.0, y1 / height)
    regions = []
    labels = ("left", "center", "right")
    for label, start, end in zip(labels, boundaries, boundaries[1:]):
        regions.append({
            "id": label,
            "label": {"left": "左侧", "center": "中间", "right": "右侧"}[label],
            "role": "body" if label == "center" else "side",
            "direction": "horizontal" if label == "center" else "vertical",
            "text_orientation": "horizontal" if label == "center" else "vertical-or-page-number",
            "region_type": "body" if label == "center" else "margin",
            "x": round(max(0.0, start / width), 6),
            "y": round(top, 6),
            "width": round(max(0.0, (end - start) / width), 6),
            "height": round(max(0.0, bottom - top), 6),
        })
    return regions


def detect_text_line_bboxes(image_bytes: bytes) -> list[dict[str, float]]:
    """Detect text bands while rejecting thin page borders and rules."""
    if cv2 is None or np is None:
        return []

    color = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if color is None:
        return []
    height, width = color.shape[:2]
    if not width or not height:
        return []

    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(color, cv2.COLOR_BGR2HSV)
    hue, saturation, _ = cv2.split(hsv)
    red_ink = (saturation >= 120) & ((hue <= 18) | (hue >= 170))
    ink = (gray < 90) | red_ink
    frame_region = find_framed_text_region(gray, red_ink)

    # Long horizontal/vertical runs are usually pecha frames, table rules, or
    # scan edges. Remove their rows before projecting text density. Tibetan
    # glyphs have short disconnected runs, so this does not remove text rows.
    clean = ink.copy()
    max_rule_run = max(30, round(width * 0.03))
    for row_index, row in enumerate(ink):
        transitions = np.diff(np.r_[False, row, False].astype(np.int8))
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        if starts.size and int((ends - starts).max()) > max_rule_run:
            clean[row_index] = False

    # Vertical frame rules otherwise remain active through many text rows and
    # make every detected text band appear as wide as the whole inner frame.
    # Remove only continuous, page-scale runs; Tibetan glyph strokes are much
    # shorter and stay available to the row projection.
    max_vertical_rule_run = max(30, round(height * 0.12))
    for column_index, column in enumerate(clean.T):
        transitions = np.diff(np.r_[False, column, False].astype(np.int8))
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        for start, end in zip(starts, ends):
            if end - start > max_vertical_rule_run:
                clean[start:end, column_index] = False

    # A narrow outer margin avoids scan-edge noise while preserving ordinary
    # modern printed lines. The original adaptive detector remains the
    # fallback for low-contrast pages where this mask finds too little text.
    margin = round(width * 0.1)
    x_start, x_end = margin, width - margin
    scan_start, scan_end = frame_region or (0, height)
    row_density = clean[scan_start:scan_end, x_start:x_end].sum(axis=1)
    active = row_density >= max(3, round((x_end - x_start) * 0.02))
    bands: list[tuple[int, int]] = []
    start = None
    gap = 0
    max_gap = max(2, round(height * 0.003))
    min_height = max(3, round(height * 0.006))
    for index, is_active in enumerate(active):
        if is_active:
            if start is None:
                start = index
            gap = 0
            continue
        if start is None:
            continue
        gap += 1
        if gap > max_gap:
            end = index - gap + 1
            if end - start >= min_height:
                bands.append((start + scan_start, end + scan_start))
            start = None
            gap = 0
    if start is not None and scan_end - scan_start - start >= min_height:
        bands.append((start + scan_start, scan_end))

    boxes: list[dict[str, float]] = []
    for start, end in bands:
        columns = clean[start:end].sum(axis=0)
        occupied = np.flatnonzero(columns >= 1)
        if occupied.size == 0:
            continue
        pad_x = max(2, round(width * 0.006))
        pad_y = max(2, round(height * 0.006))
        x0 = max(0, int(occupied[0]) - pad_x)
        x1 = min(width, int(occupied[-1]) + 1 + pad_x)
        y0 = max(0, start - pad_y)
        y1 = min(height, end + pad_y)
        boxes.append({
            "x": round(x0 / width, 6),
            "y": round(y0 / height, 6),
            "width": round((x1 - x0) / width, 6),
            "height": round((y1 - y0) / height, 6),
        })

    # A page rule that survives masking is usually very thin and spans most of
    # the page. Exclude it before mapping model lines to source blocks.
    boxes = [
        box for box in boxes
        if not (box["height"] < 0.03 and box["width"] > 0.55)
    ]

    if len(boxes) >= 2:
        return boxes
    return detect_adaptive_text_line_bboxes(gray)


def detect_adaptive_text_line_bboxes(image: Any) -> list[dict[str, float]]:
    """Fallback projection for low-contrast pages without visible rules."""
    height, width = image.shape[:2]
    binary = cv2.adaptiveThreshold(
        image,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        15,
    )
    row_density = (binary > 0).sum(axis=1)
    active = row_density >= max(3, int(width * 0.004))
    bands: list[tuple[int, int]] = []
    start = None
    gap = 0
    max_gap = max(3, round(height * 0.004))
    min_height = max(3, round(height * 0.006))
    for index, is_active in enumerate(active):
        if is_active:
            if start is None:
                start = index
            gap = 0
            continue
        if start is None:
            continue
        gap += 1
        if gap > max_gap:
            end = index - gap + 1
            if end - start >= min_height:
                bands.append((start, end))
            start = None
            gap = 0
    if start is not None and height - start >= min_height:
        bands.append((start, height))

    boxes: list[dict[str, float]] = []
    for start, end in bands:
        columns = (binary[start:end] > 0).sum(axis=0)
        occupied = np.flatnonzero(columns >= 1)
        if occupied.size == 0:
            continue
        pad_x = max(2, round(width * 0.006))
        pad_y = max(2, round(height * 0.006))
        x0 = max(0, int(occupied[0]) - pad_x)
        x1 = min(width, int(occupied[-1]) + 1 + pad_x)
        y0 = max(0, start - pad_y)
        y1 = min(height, end + pad_y)
        boxes.append({
            "x": round(x0 / width, 6),
            "y": round(y0 / height, 6),
            "width": round((x1 - x0) / width, 6),
            "height": round((y1 - y0) / height, 6),
        })
    return boxes


def attach_layout_bboxes(
    lines: list[dict[str, Any]], image_bytes: bytes
) -> tuple[list[dict[str, Any]], list[dict[str, float]]]:
    boxes = detect_text_line_bboxes(image_bytes)
    if not boxes or not lines:
        return lines, boxes
    if len(lines) == len(boxes):
        return [dict(line, bbox=box) for line, box in zip(lines, boxes)], boxes

    # Some vision models merge adjacent physical lines into one response line.
    # Keep one physical band per response line. Merging bands makes the source
    # preview show multiple rows and is worse for proofreading than an explicit
    # approximate one-row mapping.
    if len(boxes) > len(lines):
        mapped: list[dict[str, float]] = []
        for line_index in range(len(lines)):
            box_index = round(line_index * (len(boxes) - 1) / max(1, len(lines) - 1))
            mapped.append(boxes[box_index])
        return [dict(line, bbox=box, bbox_approximate=True) for line, box in zip(lines, mapped)], boxes

    # A detector can merge closely spaced Tibetan rows into one band. When the
    # vision model returned more rows, split the tallest detected bands so every
    # OCR row remains locatable. These are explicitly approximate coordinates.
    if len(lines) > len(boxes):
        split_boxes = split_layout_bboxes(boxes, len(lines))
        return [dict(line, bbox=box, bbox_approximate=True) for line, box in zip(lines, split_boxes)], boxes
    return lines, boxes


def crop_image_to_bbox(image_bytes: bytes, bbox: dict[str, float]) -> bytes:
    """Crop a normalized region while retaining a small border for glyphs."""
    if Image is None:
        return image_bytes
    with Image.open(BytesIO(image_bytes)) as image:
        image.load()
        width, height = image.size
        pad_x = max(3, round(width * 0.008))
        pad_y = max(3, round(height * 0.012))
        x0 = max(0, round(bbox["x"] * width) - pad_x)
        y0 = max(0, round(bbox["y"] * height) - pad_y)
        x1 = min(width, round((bbox["x"] + bbox["width"]) * width) + pad_x)
        y1 = min(height, round((bbox["y"] + bbox["height"]) * height) + pad_y)
        cropped = image.crop((x0, y0, x1, y1)).convert("RGB")
        output = BytesIO()
        cropped.save(output, format="PNG", optimize=True)
        return output.getvalue()


def call_traditional_region_ocr(
    image_bytes: bytes, filename: str, prompt: str, regions: list[dict[str, float]]
) -> dict[str, Any]:
    """OCR the three traditional-page columns separately.

    A full-page prompt makes a vision model flatten the narrow side strips into
    the central rows. Cropping each detected column keeps the three physical
    regions independent and lets the UI show exactly three editable blocks.
    """
    region_results: list[dict[str, Any]] = []
    for region in regions:
        crop = crop_image_to_bbox(image_bytes, region)
        region_prompt = "\n\n".join([
            "这是传统藏文经书版式内框中的一个文字区域。",
            "区域的固定页面顺序是：左侧（left）→中间（center）→右侧（right）；不得交换区域身份。",
            f"当前区域：{region['label']}（{region['id']}）。只识别这个裁剪区域中的藏文，不要补写区域外内容。",
            "中间区域按页面从上到下输出正文行；左侧和右侧区域按该侧实际视觉顺序从上到下输出边注、页码或边栏文字。",
            "保留当前区域内部的换行；只输出纯藏文文本，不要编号、解释或 Markdown。",
            prompt,
            "最后再次确认：当前图片是单独裁剪的一个区域，只输出这个区域实际看见的藏文；看不清时输出空文本，不要输出‘无法辨认’等说明。",
        ])
        result = call_model_aggregator(crop, f"{region['id']}-{filename}", region_prompt) if USE_MODEL_AGGREGATOR else call_openai_compatible(crop, f"{region['id']}-{filename}", region_prompt)
        region_results.append({
            "id": region["id"],
            "label": region["label"],
            "role": region.get("role", "side"),
            "direction": region.get("direction", "vertical"),
            "text_orientation": region.get("text_orientation", "vertical"),
            "region_type": region.get("region_type", "margin"),
            "text": str(result.get("text") or "").strip(),
            "bbox": region,
            "lines": [
                {"text": line, "bbox": region, "bbox_approximate": True}
                for line in str(result.get("text") or "").splitlines()
                if line.strip()
            ],
            "line_count": len([line for line in str(result.get("text") or "").splitlines() if line.strip()]),
            "empty": not bool(str(result.get("text") or "").strip()),
            "model": result.get("model", ""),
        })

    text = "\n\n".join(region["text"] for region in region_results if region["text"])
    blocks = [
        {
            "text": region["text"],
            "bbox": region,
            "bbox_approximate": False,
            "region_id": region["id"],
            "region_label": region["label"],
            "region_role": region.get("role", "side"),
            "region_direction": region.get("direction", "vertical"),
            "line_count": region.get("line_count", 0),
        }
        for region in region_results
    ]
    resolved_models = [str(region["model"]) for region in region_results if region.get("model")]
    return {
        "text": text,
        "lines": blocks,
        "regions": region_results,
        "region_order": ["left", "center", "right"],
        "layout_bboxes": regions,
        "layout_bbox_source": "traditional-columns",
        "region_ocr": True,
        "model": resolved_models[0] if resolved_models else MODEL,
        "provider": "model_aggregator" if USE_MODEL_AGGREGATOR else "openai-compatible",
    }


def split_layout_bboxes(
    boxes: list[dict[str, float]], target_count: int
) -> list[dict[str, float]]:
    allocations = [1] * len(boxes)
    while sum(allocations) < target_count:
        target_index = max(
            range(len(boxes)),
            key=lambda index: boxes[index]["height"] / allocations[index],
        )
        allocations[target_index] += 1

    split: list[dict[str, float]] = []
    for box, count in zip(boxes, allocations):
        row_height = box["height"] / count
        for row_index in range(count):
            split.append({
                "x": box["x"],
                "y": round(box["y"] + row_height * row_index, 6),
                "width": box["width"],
                "height": round(row_height, 6),
            })
    return split


def build_layout_payload(image_bytes: bytes, line_count: int) -> dict[str, Any]:
    """Return source coordinates for existing OCR rows without calling a model."""
    count = max(0, int(line_count))
    layout_bboxes = detect_text_line_bboxes(image_bytes)
    if not count or not layout_bboxes:
        return {"lines": [], "layout_bboxes": layout_bboxes, "layout_bbox_source": "projection"}

    lines, _ = attach_layout_bboxes(
        [{"text": ""} for _ in range(count)],
        image_bytes,
    )
    return {
        "lines": lines,
        "layout_bboxes": layout_bboxes,
        "layout_bbox_source": "projection",
    }

def parse_model_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("text"), str):
        return payload["text"]
    if isinstance(payload.get("output"), str):
        return payload["output"]

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            chunks = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    chunks.append(item["text"])
            if chunks:
                return "\n".join(chunks)

    return json.dumps(payload, ensure_ascii=False)


def post_json(url: str, body: dict[str, Any], api_key: str = "") -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AI Vision upstream HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"AI Vision upstream unavailable: {exc.reason}") from exc

    return json.loads(response_body)


def get_json(url: str, api_key: str = "", timeout: float = 3.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"unavailable: {exc.reason}") from exc

    return json.loads(response_body)


def summarize_attempts(attempts: Any) -> str:
    if not isinstance(attempts, list) or not attempts:
        return ""
    chunks: list[str] = []
    for attempt in attempts[:6]:
        if not isinstance(attempt, dict):
            continue
        model = attempt.get("modelRef") or attempt.get("model") or "model"
        status = attempt.get("status") or "unknown"
        error = compact_upstream_error(str(attempt.get("error") or ""))
        chunks.append(f"{model}: {status}" + (f" ({redact_sensitive(str(error))})" if error else ""))
    return "；".join(chunks)


def compact_upstream_error(text: str) -> str:
    lowered = text.lower()
    if "http 503" in lowered or '"code": 503' in lowered or "unavailable" in lowered:
        if "high demand" in lowered:
            return "HTTP 503 high demand，模型暂时拥堵"
        return "HTTP 503，模型服务暂时不可用"
    if "timed out" in lowered or "timeout" in lowered:
        return "请求超时"
    if "429" in lowered or "resource_exhausted" in lowered:
        return "额度或频率限制"
    return text[:220] + ("..." if len(text) > 220 else "")


def redact_sensitive(text: str) -> str:
    redacted = text
    redacted = re.sub(r"([?&]key=)[^&\s)]+", r"\1***REDACTED***", redacted)
    redacted = re.sub(r"(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1***REDACTED***", redacted)
    redacted = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "***REDACTED***", redacted)
    return redacted


def call_model_aggregator_images(
    images: list[tuple[bytes, str]], prompt: str, *, preserve_size: bool = False
) -> dict[str, Any]:
    """Send one or more ordered image attachments in a single vision request."""
    attachment_ids: list[str] = []
    sent_sizes: list[int] = []
    for image_bytes, filename in images:
        if preserve_size:
            prepared_bytes = image_bytes
            prepared_filename = filename
            mime_type = mimetypes.guess_type(filename)[0] or "image/png"
        else:
            prepared_bytes, prepared_filename, mime_type = prepare_vision_image(image_bytes, filename)
        data_url = image_data_url(prepared_bytes, prepared_filename)
        upload = post_json(
            aggregator_url("/api/aggregate/upload"),
            {
                "name": prepared_filename,
                "kind": "image",
                "mimeType": mime_type,
                "size": len(prepared_bytes),
                "dataUrl": data_url,
            },
            AGGREGATOR_API_KEY,
        )
        if not upload.get("ok") or not upload.get("id"):
            raise RuntimeError(f"ModelAggregator upload failed: {upload.get('error') or upload}")
        attachment_ids.append(str(upload["id"]))
        sent_sizes.append(len(prepared_bytes))

    request_body: dict[str, Any] = {
        "attachmentIds": attachment_ids,
        "prompt": prompt,
        "allowFallback": AGGREGATOR_ALLOW_FALLBACK,
        "maxTokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }
    if AGGREGATOR_MODELS:
        request_body["models"] = AGGREGATOR_MODELS
    else:
        request_body["model"] = MODEL

    raw = post_json(
        aggregator_url("/api/aggregate/image-to-markdown"),
        request_body,
        AGGREGATOR_API_KEY,
    )
    if not raw.get("ok"):
        attempts = summarize_attempts(raw.get("attempts"))
        detail = raw.get("error") or "image-to-markdown failed"
        if attempts:
            detail = f"{detail}；{attempts}"
        raise RuntimeError(f"ModelAggregator image OCR failed: {redact_sensitive(detail)}")

    resolved_model = str(raw.get("modelRef") or raw.get("model") or MODEL).strip()
    resolved_provider = str(raw.get("provider") or "").strip().lower()
    if resolved_provider == "mathpix" or "mathpix" in resolved_model.lower():
        attempts = summarize_attempts(raw.get("attempts"))
        detail = "AI Vision 已拒绝 Mathpix 回退：Mathpix 面向数学公式，不用于藏文 OCR。"
        if attempts:
            detail = f"{detail}；上游尝试：{attempts}"
        raise RuntimeError(detail)

    text = str(raw.get("markdown") or raw.get("answer") or raw.get("text") or "").strip()
    primary_image = images[0][0] if images else b""
    lines, layout_bboxes = attach_layout_bboxes(
        [{"text": line} for line in text.splitlines() if line.strip()], primary_image
    )
    return {
        "text": text,
        "lines": lines,
        "layout_bboxes": layout_bboxes,
        "layout_bbox_source": "projection",
        "raw": raw,
        "model": resolved_model,
        "provider": "model_aggregator",
        "upstream": aggregator_url("/api/aggregate/image-to-markdown"),
        "image": {
            "originalSize": sum(len(image_bytes) for image_bytes, _filename in images),
            "sentSize": sum(sent_sizes),
            "count": len(images),
            "maxSide": MAX_IMAGE_SIDE,
        },
    }


def call_model_aggregator(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    return call_model_aggregator_images([(image_bytes, filename)], prompt)


def call_openai_compatible_images(
    images: list[tuple[bytes, str]], prompt: str
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    content.extend({
        "type": "image_url",
        "image_url": {"url": image_data_url(image_bytes, filename)},
    } for image_bytes, filename in images)
    body = {
        "model": MODEL,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": content,
            }
        ],
    }
    raw = post_json(chat_completions_url(), body, API_KEY)
    text = parse_model_text(raw).strip()
    primary_image = images[0][0] if images else b""
    lines, layout_bboxes = attach_layout_bboxes(
        [{"text": line} for line in text.splitlines() if line.strip()], primary_image
    )
    return {
        "text": text,
        "lines": lines,
        "layout_bboxes": layout_bboxes,
        "layout_bbox_source": "projection",
        "raw": raw,
        "model": MODEL,
        "provider": "openai-compatible",
        "upstream": chat_completions_url(),
    }


def call_openai_compatible(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    return call_openai_compatible_images([(image_bytes, filename)], prompt)


def call_line_review_vision(
    image_bytes: bytes, filename: str, bbox: dict[str, float], draft_text: str = ""
) -> dict[str, Any]:
    """Review exactly one source row with enlarged, ordered image tiles."""
    tiles, review_image = prepare_line_review_images(image_bytes, bbox)
    stem = os.path.splitext(filename or "page.png")[0] or "page"
    images = [(tile, f"{stem}-line-review-{index + 1}.png") for index, tile in enumerate(tiles)]
    prompt = "\n\n".join([
        "这是单行藏文 OCR 复核。图片按从左到右的视觉顺序排列；它们共同构成同一行文字。",
        "只转录图片中可见的这一行藏文。保留朱色文字；不要识别边框、邻行、页码或区域外内容。",
        "必须只输出一行纯藏文文本，不要解释、编号、Markdown 或‘无法辨认’。",
        "如果个别字无法确认，保留可见部分，不要按语义补写。",
        f"现有 OCR 草稿（仅供比对，不可照抄）：{draft_text}" if draft_text else "",
    ]).strip()
    if USE_MODEL_AGGREGATOR:
        result = call_model_aggregator_images(images, prompt, preserve_size=True)
    else:
        result = call_openai_compatible_images(images, prompt)
    text = "".join(part.strip() for part in str(result.get("text") or "").splitlines() if part.strip())
    return {
        **result,
        "text": text,
        "lines": [{"text": text, "bbox": bbox}] if text else [],
        "line_review": True,
        "review_image": review_image,
    }


def call_vision_model(
    image_bytes: bytes, filename: str, prompt: str, ocr_profile: str = ""
) -> dict[str, Any]:
    if ocr_profile == "traditional":
        regions = detect_traditional_column_bboxes(image_bytes)
        if len(regions) == 3:
            return call_traditional_region_ocr(image_bytes, filename, prompt, regions)
    if USE_MODEL_AGGREGATOR:
        return call_model_aggregator(image_bytes, filename, prompt)
    return call_openai_compatible(image_bytes, filename, prompt)


def health_payload() -> dict[str, Any]:
    if USE_MODEL_AGGREGATOR:
        upstream_health_url = aggregator_url("/api/aggregate/health")
        upstream_ok = False
        upstream_error = ""
        upstream_payload: dict[str, Any] = {}
        try:
            upstream_payload = get_json(upstream_health_url, AGGREGATOR_API_KEY)
            upstream_ok = bool(upstream_payload.get("ok", True))
        except Exception as exc:
            upstream_error = redact_sensitive(str(exc))

        return {
            "ok": upstream_ok,
            "model": MODEL,
            "models": AGGREGATOR_MODELS or [MODEL],
            "allow_fallback": AGGREGATOR_ALLOW_FALLBACK,
            "base_url": AGGREGATOR_BASE_URL,
            "upstream": aggregator_url("/api/aggregate/image-to-markdown"),
            "upstream_health": upstream_health_url,
            "upstream_ok": upstream_ok,
            "upstream_error": upstream_error,
            "upstream_payload": upstream_payload,
            "has_api_key": bool(AGGREGATOR_API_KEY),
            "provider": "model_aggregator",
        }
    return {
        "ok": True,
        "model": MODEL,
        "base_url": BASE_URL,
        "upstream": chat_completions_url(),
        "has_api_key": bool(API_KEY),
        "provider": "openai-compatible",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AIVisionOCRLocal/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            payload = health_payload()
            self.send_json(payload, status=200 if payload.get("ok") else 503)
            return
        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        path = self.path.rstrip("/")
        if path not in {"/ocr", "/layout", "/line-review"}:
            self.send_json({"error": "Not found"}, status=404)
            return

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            if "file" not in form:
                raise RuntimeError('multipart field "file" is required')

            file_item = form["file"]
            image_bytes = file_item.file.read()
            if not image_bytes:
                raise RuntimeError("uploaded file is empty")

            filename = getattr(file_item, "filename", "") or "page.png"
            if path == "/layout":
                line_count = field_value(form, "line_count")
                ocr_profile = field_value(form, "ocr_profile")
                try:
                    payload = build_layout_payload(image_bytes, int(line_count))
                except ValueError as exc:
                    raise RuntimeError("line_count must be an integer") from exc
                if ocr_profile == "traditional":
                    regions = detect_traditional_column_bboxes(image_bytes)
                    if len(regions) == 3:
                        payload["regions"] = [
                            {
                                **region,
                                "text": "",
                                "lines": [],
                                "line_count": 0,
                                "empty": True,
                            }
                            for region in regions
                        ]
                        payload["region_order"] = ["left", "center", "right"]
                        payload["lines"] = [{
                            "text": "",
                            "bbox": region,
                            "region_id": region["id"],
                            "region_label": region["label"],
                            "region_role": region["role"],
                            "region_direction": region["direction"],
                        } for region in regions]
                        payload["layout_bboxes"] = regions
                        payload["layout_bbox_source"] = "traditional-columns"
                self.send_json(payload)
                return

            if path == "/line-review":
                bbox = parse_normalized_bbox(field_value(form, "bbox"))
                payload = call_line_review_vision(
                    image_bytes,
                    filename,
                    bbox,
                    field_value(form, "ocr_text"),
                )
                self.send_json(payload)
                return

            draft_text = field_value(form, "ocr_text")
            prompt = field_value(form, "prompt") or default_prompt(draft_text)
            ocr_profile = field_value(form, "ocr_profile")
            payload = call_vision_model(image_bytes, filename, prompt, ocr_profile)
            self.send_json(payload)
        except Exception as exc:
            self.send_json({"error": redact_sensitive(str(exc))}, status=500)

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))


def field_value(form: cgi.FieldStorage, name: str) -> str:
    if name not in form:
        return ""
    item = form[name]
    if isinstance(item, list):
        item = item[0]
    value = item.value
    return value if isinstance(value, str) else ""


def main() -> None:
    print(f"AI Vision OCR local server: http://{HOST}:{PORT}")
    print(f"provider={health_payload()['provider']}")
    print(f"upstream={health_payload()['upstream']}")
    print(f"model={MODEL}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

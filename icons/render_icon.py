#!/usr/bin/env python3
"""Draw the AI sorting icon: a folder, with a sparkle for the model.

Run from this directory to refresh the PNGs.
"""

import math
import struct
import zlib
from pathlib import Path

PURPLE = (124, 58, 237, 255)
WHITE = (255, 255, 255, 255)
PALE = (214, 202, 255, 255)
CLEAR = (0, 0, 0, 0)

SPARK_CENTER = (74, 24)
SPARK_OUTER = 13
SPARK_INNER = 4.8


def in_round_rect(x, y, left, top, right, bottom, radius):
    if x < left or y < top or x >= right or y >= bottom:
        return False
    if radius <= 0:
        return True
    if x < left + radius and y < top + radius:
        return (x - (left + radius)) ** 2 + (y - (top + radius)) ** 2 <= radius ** 2
    if x >= right - radius and y < top + radius:
        return (x - (right - radius)) ** 2 + (y - (top + radius)) ** 2 <= radius ** 2
    if x < left + radius and y >= bottom - radius:
        return (x - (left + radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius ** 2
    if x >= right - radius and y >= bottom - radius:
        return (x - (right - radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius ** 2
    return True


def in_folder(u, v, left, top, width, height, tab):
    body_top = top + 11
    body = in_round_rect(u, v, left, body_top, left + width, top + height, 5)
    tab_shape = in_round_rect(u, v, left, top, left + tab, body_top + 6, 4)
    return body or tab_shape


def in_star(u, v, cx, cy, outer, inner):
    points = []
    for i in range(8):
        angle = -math.pi / 2 + i * math.pi / 4
        radius = outer if i % 2 == 0 else inner
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > v) != (yj > v):
            cross = (xj - xi) * (v - yi) / (yj - yi) + xi
            if u < cross:
                inside = not inside
        j = i
    return inside


def color_at(x, y, size):
    u = (x / size) * 96
    v = (y / size) * 96
    if not in_round_rect(u, v, 0, 0, 96, 96, 22):
        return CLEAR

    cx, cy = SPARK_CENTER
    if in_star(u, v, cx, cy, SPARK_OUTER, SPARK_INNER):
        return WHITE
    # Front folder, then the one peeking behind it. They stay clear of the sparkle.
    if in_folder(u, v, 14, 40, 52, 44, 24):
        return WHITE
    if in_folder(u, v, 28, 16, 34, 40, 16):
        return PALE
    return PURPLE


def write_png(path, size):
    samples = 4
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(samples):
                for sx in range(samples):
                    px = x + (sx + 0.5) / samples
                    py = y + (sy + 0.5) / samples
                    color = color_at(px, py, size)
                    for i in range(4):
                        acc[i] += color[i]
            count = samples * samples
            row.extend(round(channel / count) for channel in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def main():
    here = Path(__file__).resolve().parent
    for size, name in (
        (32, "icon-32.png"),
        (48, "icon-48.png"),
        (96, "icon-96.png"),
    ):
        write_png(here / name, size)


if __name__ == "__main__":
    main()

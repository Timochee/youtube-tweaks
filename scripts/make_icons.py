"""
Generate the three icon sizes Chrome expects (16, 48, 128 px).
The icon is a rounded red square (YouTube vibe) with a white play
triangle and a diagonal slash, signalling "play, but filtered".
"""

from PIL import Image, ImageDraw

RED = (229, 57, 53, 255)
WHITE = (255, 255, 255, 255)


def make_icon(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded red square background
    radius = size // 4
    draw.rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=radius,
        fill=RED,
    )

    # White play triangle, optically centered (slight nudge right)
    cx, cy = size // 2, size // 2
    tri_h = size // 2
    tri_w = int(tri_h * 0.85)
    nudge = max(1, size // 24)
    draw.polygon(
        [
            (cx - tri_w // 2 + nudge, cy - tri_h // 2),
            (cx - tri_w // 2 + nudge, cy + tri_h // 2),
            (cx + tri_w // 2 + nudge, cy),
        ],
        fill=WHITE,
    )

    # Diagonal slash, bottom-left to top-right.
    # Skip the slash at the smallest size: clutter at 16px hurts more than it helps.
    if size >= 32:
        slash_w = max(2, size // 10)
        pad = size // 7
        draw.line(
            [(pad, size - pad), (size - pad, pad)],
            fill=WHITE,
            width=slash_w,
        )

    return img


if __name__ == '__main__':
    import os
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(project_root, 'icons')
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(out_dir, f'icon{size}.png')
        make_icon(size).save(path)
        print(f'wrote {path}')

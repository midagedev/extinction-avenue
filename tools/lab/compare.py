# Side-by-side BEFORE / AFTER composites and contact sheets for the report (PIL).
#   python3 -I tools/lab/compare.py <dir with before-*.png and after-*.png> <outDir>
import os
import sys

from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
except OSError:
    font = ImageFont.load_default()


def label(im, text, color):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 22 + len(text) * 19, 48], fill=(0, 0, 0))
    d.text((12, 8), text, fill=color, font=font)
    return im


names = sorted(f[len('after-'):-4] for f in os.listdir(src) if f.startswith('after-') and f.endswith('.png'))
for n in names:
    b = os.path.join(src, f'before-{n}.png')
    if not os.path.exists(b):
        continue
    A = Image.open(os.path.join(src, f'after-{n}.png')).convert('RGB')
    B = Image.open(b).convert('RGB').resize(A.size)
    W, H = A.size
    c = Image.new('RGB', (W * 2 + 8, H), (20, 20, 20))
    c.paste(label(B, 'BEFORE (v2 procedural)', (255, 120, 90)), (0, 0))
    c.paste(label(A, 'AFTER (v3 rigged models)', (120, 255, 160)), (W + 8, 0))
    c = c.resize((c.width * 3 // 4, c.height * 3 // 4), Image.LANCZOS)
    c.save(os.path.join(out, f'compare-{n}.png'))
    print('compare', n)

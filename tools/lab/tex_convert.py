import sys
from PIL import Image

src, dst, size, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGB')
if im.size[0] != size:
    im = im.resize((size, size), Image.LANCZOS)
im.save(dst, 'JPEG', quality=q, optimize=True, subsampling=0 if 'normal' in dst else 2)
print(dst, im.size)

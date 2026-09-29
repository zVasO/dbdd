"""Swap the 16/24/32 px images Tauri downscales from icon.png for the
hand-tuned renders of icon-small.svg (small-16/24/32.png).

Run from apps/desktop/src-tauri/icons after `pnpm tauri icon`:
    python3 source/inject_small_sizes.py
"""
import shutil
import struct
from pathlib import Path

ICONS = Path(__file__).resolve().parent.parent
SMALL = {s: (ICONS / 'source' / f'small-{s}.png').read_bytes() for s in (16, 24, 32)}

shutil.copy(ICONS / 'source' / 'small-32.png', ICONS / '32x32.png')

# icon.ico: keep the directory order, replace the 16/24/32 PNG payloads
data = (ICONS / 'icon.ico').read_bytes()
_, kind, count = struct.unpack('<HHH', data[:6])
entries = []
for k in range(count):
    w, h, colors, res, planes, bpp, size, offset = struct.unpack('<BBBBHHII', data[6 + 16 * k:22 + 16 * k])
    payload = SMALL.get(w or 256, data[offset:offset + size])
    entries.append((w, h, colors, res, planes, bpp, payload))
offset = 6 + 16 * count
head, body = struct.pack('<HHH', 0, kind, count), b''
for w, h, colors, res, planes, bpp, payload in entries:
    head += struct.pack('<BBBBHHII', w, h, colors, res, planes, bpp, len(payload), offset)
    offset += len(payload)
    body += payload
(ICONS / 'icon.ico').write_bytes(head + body)

# icon.icns: drop the legacy 16/32 bitmaps, add PNG entries for 16, 32 and 16@2x
data = (ICONS / 'icon.icns').read_bytes()
chunks, i = [], 8
while i < len(data):
    tag, size = data[i:i + 4], struct.unpack('>I', data[i + 4:i + 8])[0]
    if tag not in (b'ic11', b'il32', b'l8mk', b'is32', b's8mk', b'icp4', b'icp5'):
        chunks.append((tag, data[i + 8:i + size]))
    i += size
chunks = [(b'icp4', SMALL[16]), (b'icp5', SMALL[32]), (b'ic11', SMALL[32])] + chunks
body = b''.join(tag + struct.pack('>I', 8 + len(p)) + p for tag, p in chunks)
(ICONS / 'icon.icns').write_bytes(b'icns' + struct.pack('>I', 8 + len(body)) + body)
print('small sizes injected')

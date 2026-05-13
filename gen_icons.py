#!/usr/bin/env python3
"""Generate minimal RGBA PNG icons for Tauri."""
import struct, zlib, os

def make_png(size=32, color=(124, 106, 247, 255)):  # RGBA purple
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)
    hdr  = b'\x89PNG\r\n\x1a\n'
    # color_type=6 = RGBA
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    row  = b'\x00' + bytes(color) * size  # filter=0, then RGBA pixels
    idat = chunk(b'IDAT', zlib.compress(row * size))
    iend = chunk(b'IEND', b'')
    return hdr + ihdr + idat + iend

os.makedirs('src-tauri/icons', exist_ok=True)
for name in ['icon.png', '32x32.png', '128x128.png', '128x128@2x.png']:
    with open(f'src-tauri/icons/{name}', 'wb') as f:
        f.write(make_png())
print('RGBA icons created.')

"""Minimal GeoTIFF / BigTIFF reader (numpy + zlib only) for single-band
rasters such as WorldPop: strips or tiles, uncompressed / Deflate / LZW,
optional horizontal predictor. Returns (array, (west, north, dx, dy), nodata)."""
import struct
import zlib
import numpy as np

TYPES = {1: ('B', 1), 2: ('s', 1), 3: ('H', 2), 4: ('I', 4), 5: ('II', 8), 11: ('f', 4),
         12: ('d', 8), 16: ('Q', 8), 17: ('q', 8)}


def _lzw(data):
    out, prev, table = bytearray(), None, [bytes([i]) for i in range(256)] + [b'', b'']
    width, bitpos, n = 9, 0, len(data) * 8
    while bitpos + width <= n:
        byte = bitpos >> 3
        chunk = int.from_bytes(data[byte:byte + 3].ljust(3, b'\0'), 'big')
        code = (chunk >> (24 - width - (bitpos & 7))) & ((1 << width) - 1)
        bitpos += width
        if code == 256:
            table, width, prev = table[:258], 9, None
            continue
        if code == 257:
            break
        if prev is None:
            entry = table[code]
        else:
            entry = table[code] if code < len(table) else prev + prev[:1]
            table.append(prev + entry[:1])
        out += entry
        prev = entry
        if len(table) + 1 >= (1 << width) and width < 12:
            width += 1
    return bytes(out)


def _unpredict(a, pred):
    # predictor 2 (horizontal differencing) works on the raw integer words, floats included
    if pred != 2:
        return a
    u = a.astype(a.dtype.newbyteorder('=')).view('u%d' % a.dtype.itemsize)
    return np.cumsum(u, axis=1, dtype=u.dtype).view(a.dtype.newbyteorder('='))


def read(path):
    f = open(path, 'rb')
    head = f.read(16)
    bo = '<' if head[:2] == b'II' else '>'
    big = struct.unpack(bo + 'H', head[2:4])[0] == 43
    f.seek(struct.unpack(bo + 'Q', head[8:16])[0] if big else struct.unpack(bo + 'I', head[4:8])[0])
    count = struct.unpack(bo + ('Q' if big else 'H'), f.read(8 if big else 2))[0]
    tags = {}
    for _ in range(count):
        if big:
            tag, typ, cnt = struct.unpack(bo + 'HHQ', f.read(12)); raw = f.read(8)
        else:
            tag, typ, cnt = struct.unpack(bo + 'HHI', f.read(8)); raw = f.read(4)
        fmt, size = TYPES[typ]
        total = size * cnt
        if total > len(raw):
            pos = f.tell()
            f.seek(struct.unpack(bo + ('Q' if big else 'I'), raw)[0])
            raw = f.read(total)
            f.seek(pos)
        if typ == 2:
            tags[tag] = raw[:cnt].rstrip(b'\0').decode()
        else:
            tags[tag] = list(struct.unpack(bo + fmt[0] * (cnt * len(fmt)), raw[:total]))
    W, H = tags[256][0], tags[257][0]
    bits, comp = tags[258][0], tags.get(259, [1])[0]
    pred = tags.get(317, [1])[0]
    sfmt = tags.get(339, [1])[0]
    dtype = np.dtype({(3, 32): 'f4', (3, 64): 'f8', (1, 8): 'u1', (1, 16): 'u2', (2, 16): 'i2', (1, 32): 'u4', (2, 32): 'i4'}[(sfmt, bits)]).newbyteorder(bo)

    def decode(off, n):
        f.seek(off)
        b = f.read(n)
        if comp in (8, 32946):
            b = zlib.decompress(b)
        elif comp == 5:
            b = _lzw(b)
        elif comp != 1:
            raise ValueError('compression %d not supported' % comp)
        return b

    out = np.zeros((H, W), dtype.newbyteorder('='))
    if 322 in tags:                                     # tiled
        tw, th = tags[322][0], tags[323][0]
        across = (W + tw - 1) // tw
        for i, (off, n) in enumerate(zip(tags[324], tags[325])):
            a = np.frombuffer(decode(off, n), dtype)[:tw * th].reshape(th, tw)
            a = _unpredict(a, pred)
            r0, c0 = (i // across) * th, (i % across) * tw
            out[r0:r0 + th, c0:c0 + tw] = a[:min(th, H - r0), :min(tw, W - c0)]
    else:                                               # strips
        rps = tags.get(278, [H])[0]
        for i, (off, n) in enumerate(zip(tags[273], tags[279])):
            r0 = i * rps
            rows = min(rps, H - r0)
            a = np.frombuffer(decode(off, n), dtype)[:rows * W].reshape(rows, W)
            out[r0:r0 + rows] = _unpredict(a, pred)
    sx, sy = tags[33550][0], tags[33550][1]
    tp = tags[33922]
    west, north = tp[3] - tp[0] * sx, tp[4] + tp[1] * sy
    nodata = float(tags[42113]) if 42113 in tags else None
    return out, (west, north, sx, sy), nodata

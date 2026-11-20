#!/usr/bin/env python3
"""Recompute the NSIS installer integrity CRC.

NSIS validates the installer at startup ("Installer integrity check has failed"
when it does not match). The CRC is a standard CRC-32 (poly 0xEDB88320, as used
by zlib) over the byte range [512, crc_field_offset) and is stored as a
little-endian uint32 at crc_field_offset, where

    crc_field_offset = firstheader_offset + length_of_all_following_data - 4

Any change at or beyond offset 512 — rcedit rewriting resources, an in-place
version-string patch, an injected build stamp — invalidates the stored value.
Run this BEFORE signing: the CRC field lives in the overlay that Authenticode
hashes, so writing it after signing breaks the signature.

Signing itself needs no repair: signtool only writes the PE checksum and the
certificate-table entry, both below offset 512, so a freshly signed installer
still passes the integrity check.

Usage: fix-nsis-crc.py <installer.exe> [--check]
"""

import os
import struct
import sys
import zlib

FH_SIG = 0xDEADBEEF
FH_MAGIC = b"NullsoftInst"
SCAN_LIMIT = 8 * 1024 * 1024


def find_firstheader(data):
    """Locate the NSIS firstheader: 0xDEADBEEF followed by "NullsoftInst"."""
    start = 0
    limit = min(len(data), SCAN_LIMIT)
    while True:
        sig = data.find(b"\xef\xbe\xad\xde", start, limit)
        if sig < 0:
            return None
        off = sig - 4  # siginfo is the 2nd int of the struct
        if off >= 0 and data[off + 8 : off + 8 + len(FH_MAGIC)] == FH_MAGIC:
            return off
        start = sig + 1


def crc_field_offset(data):
    off = find_firstheader(data)
    if off is None:
        raise SystemExit("error: NSIS firstheader not found (not an NSIS installer?)")
    flags = struct.unpack("<i", data[off : off + 4])[0]
    loafd = struct.unpack("<i", data[off + 24 : off + 28])[0]
    end = off + loafd
    if end > len(data) or end < 512 + 4:
        raise SystemExit(f"error: implausible NSIS data length (header={off}, end={end})")
    return off, flags, end - 4


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip())
        return 2
    path = argv[1]
    check_only = "--check" in argv[2:]

    with open(path, "rb") as f:
        data = bytearray(f.read())

    off, flags, crc_at = crc_field_offset(data)
    stored = struct.unpack("<I", data[crc_at : crc_at + 4])[0]
    computed = zlib.crc32(data[512:crc_at]) & 0xFFFFFFFF

    print(f"installer      : {path}")
    print(f"size           : {len(data)}")
    print(f"firstheader    : {off}")
    print(f"crc field at   : {crc_at}")
    print(f"stored crc     : 0x{stored:08X}")
    print(f"computed crc   : 0x{computed:08X}")

    if stored == computed:
        print("status         : OK (integrity check will pass)")
        return 0

    if check_only:
        print("status         : MISMATCH (integrity check would fail)")
        return 1

    struct.pack_into("<I", data, crc_at, computed)
    with open(path, "r+b") as f:
        f.seek(crc_at)
        f.write(struct.pack("<I", computed))
    print(f"status         : FIXED -> 0x{computed:08X}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

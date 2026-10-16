"""Inspect Jesse docx comments and anchored text."""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
PATH = Path(
    r"C:\Users\BrunoSotoRobles\Downloads"
    r"\Mallinnusohjeet arkkitehdeille ja rakennesuunnittelijoille_jesse.docx"
)


def main() -> None:
    with zipfile.ZipFile(PATH) as z:
        doc_xml = z.read("word/document.xml").decode("utf-8")
        comments_xml = z.read("word/comments.xml").decode("utf-8")

    root = ET.fromstring(comments_xml)
    for c in root.findall(".//w:comment", NS):
        cid = c.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}id")
        texts = [t.text or "" for t in c.findall(".//w:t", NS)]
        print(f"COMMENT {cid}: {''.join(texts)}")

    print("\n--- Anchored ranges ---")
    for m in re.finditer(r'w:commentRangeStart w:id="(\d+)"', doc_xml):
        cid = m.group(1)
        start = m.start()
        snippet = re.sub(r"<[^>]+>", "", doc_xml[start : start + 1200])
        snippet = re.sub(r"\s+", " ", snippet).strip()[:250]
        print(f"RANGE {cid}: {snippet}\n")


if __name__ == "__main__":
    main()

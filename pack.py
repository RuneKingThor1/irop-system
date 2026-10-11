"""Zip this system into <id>.zip next to system.json, the file its "download"
URL points at.

Usage: python pack.py

The zip holds system.json and the module, templates, styles and lang folders at
its top level, which is the layout Foundry's installer expects. Tests are left
out. Bump "version" in system.json before packing an update, or Foundry will
not offer it.
"""
import json, os, zipfile

root = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(root, "system.json"), encoding="utf8"))
out = os.path.join(root, f"{manifest['id']}.zip")

files = ["system.json"]
for sub in ("module", "templates", "styles", "lang", "assets", "packs"):
    for base, _, names in os.walk(os.path.join(root, sub)):
        files += [os.path.relpath(os.path.join(base, n), root).replace("\\", "/") for n in sorted(names)]

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(root, f), f)
print(f"{out}  v{manifest['version']}  ({len(files)} files)")

"""Copy this system into the local Foundry install for testing.

Usage: python install-local.py

Mirrors system.json and the module, templates, styles and lang folders into
<Foundry data>/Data/systems/irop. It is a copy, not a link, on purpose: Foundry's
own Uninstall button deletes the system folder, and through a link that would
delete this working copy too.

Rerun after every change. JavaScript, template and style changes need only a
browser refresh (F5) in Foundry; a change to system.json needs a Foundry restart.
"""
import json, os, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OPTIONS = os.path.expandvars(r"%LOCALAPPDATA%\FoundryVTT\Config\options.json")
PARTS = ["system.json", "module", "templates", "styles", "lang", "assets", "packs"]

manifest = json.load(open(os.path.join(ROOT, "system.json"), encoding="utf8"))
data_path = json.load(open(OPTIONS, encoding="utf8"))["dataPath"]
target = os.path.join(data_path, "Data", "systems", manifest["id"])

# Refuse to touch a folder that holds some other system.
existing = os.path.join(target, "system.json")
if os.path.exists(existing):
    other = json.load(open(existing, encoding="utf8")).get("id")
    if other != manifest["id"]:
        sys.exit(f"Refusing: {target} holds system '{other}', not '{manifest['id']}'.")

os.makedirs(target, exist_ok=True)
for part in PARTS:
    src, dst = os.path.join(ROOT, part), os.path.join(target, part)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    elif os.path.isfile(dst):
        os.remove(dst)
    if os.path.isdir(src):
        shutil.copytree(src, dst)
    elif os.path.isfile(src):
        shutil.copy2(src, dst)

count = sum(len(files) for _, _, files in os.walk(target))
print(f"Installed {manifest['title']} v{manifest['version']} to {target} ({count} files)")

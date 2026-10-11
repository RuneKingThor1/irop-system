"""Copy this working copy into the GitHub repo's clone, for Johnald to commit and push.

Usage: python sync-repo.py [path to the clone]

The clone defaults to C:\\Tempest Knights\\sacredconstellars\\irop-system. It is a mirror: files
changed here are copied, new ones added, and files gone from here are removed there. The clone's
.git folder is never touched, and built or local-only files (irop.zip, caches) are left out.

Nothing reaches Foundry until the version in system.json goes up and the push lands on main: the
release workflow then builds the zip and publishes the release Foundry updates from.
"""
import filecmp, os, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DEST = sys.argv[1] if len(sys.argv) > 1 else r"C:\Tempest Knights\sacredconstellars\irop-system"
SKIP_DIRS = {".git", "__pycache__", "node_modules"}
SKIP_FILES = {"irop.zip", "system.release.json"}

if not os.path.isdir(os.path.join(DEST, ".git")):
    sys.exit(f"Refusing: {DEST} is not a git clone.")

def files_under(base):
    found = set()
    for here, dirs, names in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if name in SKIP_FILES:
                continue
            found.add(os.path.relpath(os.path.join(here, name), base))
    return found

wanted = files_under(ROOT)
present = files_under(DEST)
copied = removed = 0
for rel in sorted(wanted):
    src, dst = os.path.join(ROOT, rel), os.path.join(DEST, rel)
    if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
        continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    copied += 1
for rel in sorted(present - wanted):
    os.remove(os.path.join(DEST, rel))
    removed += 1
# Folders left empty by a removal.
for here, dirs, names in os.walk(DEST, topdown=False):
    if (".git" not in os.path.relpath(here, DEST).split(os.sep)) and (here != DEST) and not os.listdir(here):
        os.rmdir(here)
print(f"{DEST}: {copied} copied, {removed} removed, {len(wanted)} files in all")

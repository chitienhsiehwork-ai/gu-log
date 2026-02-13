#!/usr/bin/env python3
"""Renumber all CP ticketIds to be sequential, syncing zh/en pairs."""
import re, json, os, glob

os.chdir(os.path.dirname(os.path.abspath(__file__)) + "/..")

# 1. Collect all zh CP files with their current ticketId
zh_files = []
for f in sorted(glob.glob("src/content/posts/clawd-picks-*.mdx")):
    if "/en-" in f:
        continue
    with open(f) as fh:
        content = fh.read()
    m = re.search(r'^ticketId:\s*["\']?(CP-(\d+))["\']?', content, re.MULTILINE)
    if not m:
        continue
    zh_files.append((int(m.group(2)), f, m.group(1)))

# Sort by current CP number
zh_files.sort(key=lambda x: x[0])
total = len(zh_files)
print(f"Total zh CP files: {total}")

# 2. Assign new sequential IDs and rewrite files
changes = 0
for new_num, (old_num, zh_path, old_id) in enumerate(zh_files, start=1):
    new_id = f"CP-{new_num}"
    base = os.path.basename(zh_path)
    en_path = f"src/content/posts/en-{base}"
    
    # Update zh file
    with open(zh_path) as fh:
        content = fh.read()
    old_zh_id = re.search(r'^ticketId:\s*["\']?(CP-\d+)["\']?', content, re.MULTILINE).group(1)
    if old_zh_id != new_id:
        content = re.sub(
            r'^(ticketId:\s*["\']?)CP-\d+(["\']?)',
            rf'\g<1>{new_id}\2',
            content, count=1, flags=re.MULTILINE
        )
        with open(zh_path, 'w') as fh:
            fh.write(content)
        changes += 1
        print(f"  {old_zh_id} → {new_id} ({base})")
    
    # Update en file (always sync to match zh)
    if os.path.exists(en_path):
        with open(en_path) as fh:
            en_content = fh.read()
        old_en_id = re.search(r'^ticketId:\s*["\']?(CP-\d+)["\']?', en_content, re.MULTILINE)
        if old_en_id and old_en_id.group(1) != new_id:
            en_content = re.sub(
                r'^(ticketId:\s*["\']?)CP-\d+(["\']?)',
                rf'\g<1>{new_id}\2',
                en_content, count=1, flags=re.MULTILINE
            )
            with open(en_path, 'w') as fh:
                fh.write(en_content)

print(f"\nChanged: {changes} zh files")

# 3. Update counter
with open("scripts/article-counter.json") as f:
    counter = json.load(f)
counter["CP"]["next"] = total + 1
with open("scripts/article-counter.json", "w") as f:
    json.dump(counter, f, indent=2)
    f.write("\n")
print(f"Counter: CP next = {total + 1}")

# 4. Verify
print("\n=== Verification ===")
# Check zh gaps
gaps = 0
for i in range(1, total + 1):
    found = False
    for f in glob.glob("src/content/posts/clawd-picks-*.mdx"):
        if "/en-" in f:
            continue
        with open(f) as fh:
            if re.search(rf'^ticketId:\s*["\']?CP-{i}["\']?', fh.read(), re.MULTILINE):
                found = True
                break
    if not found:
        print(f"  ❌ CP-{i}: MISSING")
        gaps += 1
if gaps == 0:
    print(f"  ✅ zh: CP-1 through CP-{total}, zero gaps!")

# Check pair matches
mismatches = 0
for f in glob.glob("src/content/posts/clawd-picks-*.mdx"):
    if "/en-" in f:
        continue
    base = os.path.basename(f)
    en = f"src/content/posts/en-{base}"
    if not os.path.exists(en):
        continue
    with open(f) as fh:
        zh_m = re.search(r'^ticketId:\s*["\']?(CP-\d+)', fh.read(), re.MULTILINE)
    with open(en) as fh:
        en_m = re.search(r'^ticketId:\s*["\']?(CP-\d+)', fh.read(), re.MULTILINE)
    if zh_m and en_m and zh_m.group(1) != en_m.group(1):
        print(f"  ❌ PAIR MISMATCH: {base} zh={zh_m.group(1)} en={en_m.group(1)}")
        mismatches += 1
if mismatches == 0:
    print(f"  ✅ en: All pairs match zh!")

if gaps > 0 or mismatches > 0:
    exit(1)
print("\nDone!")

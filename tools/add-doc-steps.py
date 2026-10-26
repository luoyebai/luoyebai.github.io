"""Add explicit presentation steps between existing Markdown blocks, once."""
from pathlib import Path
import re

for path in (Path(__file__).resolve().parents[1] / 'content/docs').glob('*.md'):
    text = path.read_text(encoding='utf-8')
    front, body = text.split('\n---', 1)
    if re.search(r'^--\s*$', body, re.M):
        continue
    lines = body.splitlines(keepends=True)
    output = []
    fence = None
    has_content = False
    blank = True
    for line in lines:
        stripped = line.strip()
        marker = re.match(r'^(`{3,}|~{3,})', stripped)
        if fence:
            output.append(line)
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
            blank = False
            continue
        if re.fullmatch(r'-{3,}|\+{4,}', stripped):
            has_content = False
        elif stripped and not line.startswith((' ', '\t')):
            heading = re.match(r'^#{1,6}\s', stripped)
            if has_content and not heading and (blank or re.match(r'^(?:[-+*]|\d+\.)\s', line)):
                output.append('\n--\n\n')
            has_content = True
        output.append(line)
        if marker:
            fence = marker[1]
        blank = not stripped
    path.write_text(front + '\n---' + ''.join(output), encoding='utf-8')
    print(path.name)

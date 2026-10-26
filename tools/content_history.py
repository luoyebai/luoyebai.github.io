"""Local, append-only content recovery. Never included in the public site.

Snapshots are content-addressed; lists are paginated, and no old user data is
automatically pruned. Callers serialize writes alongside content revisions.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import uuid


def _write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".history-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def _json(path: Path, fallback=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def _valid(value: str, length: int) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{%d}" % length, value):
        raise ValueError("恢复记录标识非法")
    return value


class Store:
    def __init__(self, root: str):
        self.root = Path(root) / ".blog-history"

    def _index(self):
        return _json(self.root / "index.json", {})

    def _put_index(self, index):
        _write(self.root / "index.json", json.dumps(index, ensure_ascii=False))

    @staticmethod
    def key(kind, slug):
        return kind + ":" + slug

    def group(self, kind, slug, create=False):
        index = self._index()
        key = self.key(kind, slug)
        group = index.get(key)
        if not group and create:
            group = uuid.uuid4().hex
            index[key] = group
            self._put_index(index)
        return _valid(group, 32) if group else None

    def bind(self, kind, slug, group, old_slug=None):
        index = self._index()
        if old_slug and old_slug != slug:
            index.pop(self.key(kind, old_slug), None)
        index[self.key(kind, slug)] = _valid(group, 32)
        self._put_index(index)

    def unbind(self, kind, slug):
        index = self._index()
        index.pop(self.key(kind, slug), None)
        self._put_index(index)

    def capture(self, kind, slug, text, reason="保存", group=None):
        # Request bodies are already bounded by the HTTP server. Keep the same
        # practical bound here for direct callers; fail before touching content.
        if len(text.encode("utf-8")) > 16 * 1024 * 1024:
            raise ValueError("单个版本超过 16 MB，未修改正文；请拆分文档后重试")
        group = group or self.group(kind, slug, create=True)
        revision = hashlib.sha256(text.encode("utf-8")).hexdigest()
        folder = self.root / "versions" / _valid(group, 32)
        meta_path = folder / (revision + ".json")
        if not meta_path.exists():
            _write(folder / (revision + ".md"), text)
            _write(meta_path, json.dumps(dict(id=revision, kind=kind, slug=slug,
                at=dt.datetime.now().isoformat(timespec="milliseconds"), reason=reason,
                bytes=len(text.encode("utf-8"))), ensure_ascii=False))
        return group, revision

    def versions(self, kind, slug, offset=0, limit=40):
        group = self.group(kind, slug)
        if not group:
            return [], 0
        files = list((self.root / "versions" / group).glob("*.json"))
        # Stat is cheap even for long histories; only read the current page.
        files.sort(key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True)
        offset, limit = max(0, int(offset)), min(40, max(1, int(limit)))
        return [_json(path) for path in files[offset:offset + limit]], len(files)

    def read(self, group, version):
        folder = self.root / "versions" / _valid(group, 32)
        version = _valid(version, 64)
        meta = _json(folder / (version + ".json"))
        if not meta:
            raise FileNotFoundError("版本不存在")
        return meta, (folder / (version + ".md")).read_text(encoding="utf-8")

    def trash(self, kind, slug, text, title):
        group, version = self.capture(kind, slug, text, "移入回收站")
        item = dict(id=uuid.uuid4().hex, group=group, version=version, kind=kind,
                    slug=slug, title=title, at=dt.datetime.now().isoformat(timespec="seconds"))
        _write(self.root / "trash" / (item["id"] + ".json"), json.dumps(item, ensure_ascii=False))
        return item

    def trash_item(self, item_id):
        item = _json(self.root / "trash" / (_valid(item_id, 32) + ".json"))
        if not item or item.get("restoredAt"):
            raise FileNotFoundError("回收站记录不存在或已恢复")
        return item

    def trash_list(self, offset=0, limit=40):
        items = [_json(path) for path in (self.root / "trash").glob("*.json")]
        items = sorted((item for item in items if not item.get("restoredAt")),
                       key=lambda item: (item["at"], item["id"]), reverse=True)
        offset, limit = max(0, int(offset)), min(40, max(1, int(limit)))
        return items[offset:offset + limit], len(items)

    def restored(self, item):
        item = dict(item, restoredAt=dt.datetime.now().isoformat(timespec="seconds"))
        _write(self.root / "trash" / (_valid(item["id"], 32) + ".json"), json.dumps(item, ensure_ascii=False))

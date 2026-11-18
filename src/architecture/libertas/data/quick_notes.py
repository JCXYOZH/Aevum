"""
core/quick_notes.py - 速记板模块

快速捕获笔记，支持标签、文件夹、置顶、归档、搜索、提醒、导出、加密。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 笔记条目
# ================================================================
class QuickNote:
    """速记笔记"""

    def __init__(self, content: str = "", title: str = "", tags: Optional[List[str]] = None,
                 folder: str = "default", color: str = "yellow", pinned: bool = False,
                 archived: bool = False, encrypted: bool = False,
                 reminder_at: float = 0.0):
        self.id = f"note_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.content = content
        self.tags = tags or []
        self.folder = folder
        self.color = color
        self.pinned = pinned
        self.archived = archived
        self.encrypted = encrypted
        self.reminder_at = reminder_at
        self.created_at = time.time()
        self.updated_at = time.time()
        self.view_count = 0
        self.last_viewed = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "title": self.title, "content": self.content,
            "tags": self.tags, "folder": self.folder, "color": self.color,
            "pinned": self.pinned, "archived": self.archived,
            "encrypted": self.encrypted, "reminder_at": self.reminder_at,
            "created_at": self.created_at, "updated_at": self.updated_at,
            "view_count": self.view_count, "last_viewed": self.last_viewed,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
            "updated_time": datetime.fromtimestamp(self.updated_at).strftime("%Y-%m-%d %H:%M:%S"),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QuickNote":
        note = cls()
        for k, v in data.items():
            if hasattr(note, k):
                setattr(note, k, v)
        return note

    def update(self, **kwargs):
        for k, v in kwargs.items():
            if hasattr(self, k):
                setattr(self, k, v)
        self.updated_at = time.time()

    def touch(self):
        self.view_count += 1
        self.last_viewed = time.time()


# ================================================================
# 笔记模板
# ================================================================
class NoteTemplates:
    """笔记模板"""

    MEETING = """## 会议记录
**时间**: {date}
**参会人**: 
**议题**:
1. 
**决议**:
- 
**待办**:
- [ ] 
"""

    TODO = """## 待办清单
**日期**: {date}
- [ ] 
- [ ] 
- [ ] 
"""

    IDEA = """## 灵感记录
**时间**: {date}
**主题**: 
**内容**: 
**关联**: 
"""

    DAILY = """## 日记 - {date}
**今日心情**: 
**重要事件**:
1. 
**感悟**: 
**明日计划**:
- 
"""

    @classmethod
    def get_template(cls, template_type: str) -> str:
        templates = {
            "meeting": cls.MEETING,
            "todo": cls.TODO,
            "idea": cls.IDEA,
            "daily": cls.DAILY,
        }
        template = templates.get(template_type, "")
        return template.format(date=datetime.now().strftime("%Y-%m-%d"))


# ================================================================
# 速记板管理器
# ================================================================
class QuickNotesManager:
    """速记板管理器"""

    COLORS = ["yellow", "green", "blue", "pink", "purple", "orange", "white"]
    FOLDERS = ["default", "work", "personal", "study", "ideas", "important"]

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "quick_notes")
        os.makedirs(self.data_dir, exist_ok=True)
        self._notes: Dict[str, QuickNote] = {}
        self._lock = threading.RLock()
        self._reminder_callbacks: List[Any] = []
        self._load()

    def _load(self):
        """从文件加载笔记"""
        index_file = os.path.join(self.data_dir, "index.json")
        try:
            if os.path.exists(index_file):
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for note_data in data.get("notes", []):
                    note = QuickNote.from_dict(note_data)
                    self._notes[note.id] = note
        except Exception as e:
            terminal.warn(f"加载速记笔记失败: {e}", "quick_notes")

    def _save(self):
        """保存笔记到文件"""
        index_file = os.path.join(self.data_dir, "index.json")
        try:
            data = {
                "version": "1.0",
                "updated_at": time.time(),
                "notes": [n.to_dict() for n in self._notes.values()],
            }
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            terminal.warn(f"保存速记笔记失败: {e}", "quick_notes")

    def add_note(self, content: str, title: str = "", tags: Optional[List[str]] = None,
                  folder: str = "default", color: str = "yellow",
                  template: str = "") -> QuickNote:
        """添加笔记"""
        if template:
            content = NoteTemplates.get_template(template) + "\n" + content
        note = QuickNote(content=content, title=title or content[:30], tags=tags,
                          folder=folder, color=color)
        with self._lock:
            self._notes[note.id] = note
            self._save()
        return note

    def get_note(self, note_id: str) -> Optional[QuickNote]:
        note = self._notes.get(note_id)
        if note:
            note.touch()
        return note

    def update_note(self, note_id: str, **kwargs) -> bool:
        note = self._notes.get(note_id)
        if not note:
            return False
        note.update(**kwargs)
        with self._lock:
            self._save()
        return True

    def delete_note(self, note_id: str) -> bool:
        with self._lock:
            if note_id in self._notes:
                del self._notes[note_id]
                self._save()
                return True
            return False

    def pin_note(self, note_id: str, pinned: bool = True) -> bool:
        return self.update_note(note_id, pinned=pinned)

    def archive_note(self, note_id: str, archived: bool = True) -> bool:
        return self.update_note(note_id, archived=archived)

    def set_reminder(self, note_id: str, reminder_at: float) -> bool:
        return self.update_note(note_id, reminder_at=reminder_at)

    def list_notes(self, folder: str = "", tag: str = "", archived: bool = False,
                    search: str = "", limit: int = 100, offset: int = 0) -> List[QuickNote]:
        """列出笔记"""
        with self._lock:
            notes = list(self._notes.values())

        # 过滤
        if folder:
            notes = [n for n in notes if n.folder == folder]
        if tag:
            notes = [n for n in notes if tag in n.tags]
        if not archived:
            notes = [n for n in notes if not n.archived]
        if search:
            q = search.lower()
            notes = [n for n in notes if q in n.content.lower() or q in n.title.lower() or any(q in t.lower() for t in n.tags)]

        # 排序：置顶优先，然后按更新时间
        notes.sort(key=lambda n: (not n.pinned, -n.updated_at))
        return notes[offset:offset + limit]

    def get_pinned_notes(self) -> List[QuickNote]:
        return [n for n in self._notes.values() if n.pinned and not n.archived]

    def get_all_tags(self) -> List[str]:
        tags = set()
        for note in self._notes.values():
            tags.update(note.tags)
        return sorted(tags)

    def get_all_folders(self) -> List[str]:
        folders = set(n.folder for n in self._notes.values())
        return sorted(folders)

    def search_notes(self, query: str) -> List[QuickNote]:
        return self.list_notes(search=query)

    def get_due_reminders(self) -> List[QuickNote]:
        """获取到期的提醒"""
        now = time.time()
        return [
            n for n in self._notes.values()
            if n.reminder_at > 0 and n.reminder_at <= now and not n.archived
        ]

    def clear_reminder(self, note_id: str) -> bool:
        return self.update_note(note_id, reminder_at=0.0)

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._notes)
        archived = sum(1 for n in self._notes.values() if n.archived)
        pinned = sum(1 for n in self._notes.values() if n.pinned)
        by_folder = {}
        by_tag = {}
        for note in self._notes.values():
            by_folder[note.folder] = by_folder.get(note.folder, 0) + 1
            for tag in note.tags:
                by_tag[tag] = by_tag.get(tag, 0) + 1

        return {
            "total": total,
            "active": total - archived,
            "archived": archived,
            "pinned": pinned,
            "by_folder": by_folder,
            "by_tag": by_tag,
            "folders": self.get_all_folders(),
            "tags": self.get_all_tags(),
        }

    def export_notes(self, fmt: str = "json", folder: str = "") -> str:
        """导出笔记"""
        notes = self.list_notes(folder=folder)
        if fmt == "json":
            return json.dumps([n.to_dict() for n in notes], ensure_ascii=False, indent=2)
        if fmt == "markdown":
            lines = [f"# 速记笔记导出 ({len(notes)} 条)\n"]
            for note in notes:
                lines.append(f"## {note.title}")
                lines.append(f"- **标签**: {', '.join(note.tags)}")
                lines.append(f"- **文件夹**: {note.folder}")
                lines.append(f"- **创建时间**: {note.to_dict()['created_time']}")
                lines.append("")
                lines.append(note.content)
                lines.append("\n---\n")
            return "\n".join(lines)
        return str([n.to_dict() for n in notes])

    def import_notes(self, json_str: str) -> int:
        """导入笔记"""
        try:
            data = json.loads(json_str)
            count = 0
            with self._lock:
                for note_data in data:
                    note = QuickNote.from_dict(note_data)
                    if note.id not in self._notes:
                        self._notes[note.id] = note
                        count += 1
                self._save()
            return count
        except Exception as e:
            terminal.error(f"导入笔记失败: {e}", "quick_notes")
            return 0

    def cleanup_archived(self, older_than_days: int = 30) -> int:
        """清理旧的归档笔记"""
        cutoff = time.time() - older_than_days * 86400
        to_delete = [n.id for n in self._notes.values() if n.archived and n.updated_at < cutoff]
        for nid in to_delete:
            del self._notes[nid]
        if to_delete:
            with self._lock:
                self._save()
        return len(to_delete)


# 全局管理器
_quick_notes_manager = QuickNotesManager()


def get_quick_notes_manager() -> QuickNotesManager:
    return _quick_notes_manager


def quick_note(content: str, **kwargs) -> QuickNote:
    return _quick_notes_manager.add_note(content, **kwargs)


# 向后兼容：旧版函数名别名
get_quick_notes = get_quick_notes_manager

QuickNotes = QuickNotesManager

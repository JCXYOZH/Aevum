"""
core/whiteboard.py - 协作白板

支持无限画布、元素操作、实时协作、历史版本、导出、模板。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 画布元素
# ================================================================
@dataclass
class BoardElement:
    """画布元素基类"""
    id: str = ""
    type: str = "text"  # text / shape / line / image / sticky / mindmap / connector
    x: float = 0.0
    y: float = 0.0
    width: float = 100.0
    height: float = 50.0
    rotation: float = 0.0
    z_index: int = 0
    content: str = ""
    style: Dict[str, Any] = field(default_factory=dict)
    locked: bool = False
    visible: bool = True
    group_id: str = ""
    created_by: str = ""
    created_at: float = 0.0
    updated_at: float = 0.0
    comments: List[Dict[str, Any]] = field(default_factory=list)

    def __post_init__(self):
        if not self.id:
            self.id = f"elem_{uuid.uuid4().hex[:8]}"
        if not self.created_at:
            self.created_at = time.time()
            self.updated_at = self.created_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "type": self.type, "x": self.x, "y": self.y,
            "width": self.width, "height": self.height, "rotation": self.rotation,
            "z_index": self.z_index, "content": self.content, "style": self.style,
            "locked": self.locked, "visible": self.visible, "group_id": self.group_id,
            "created_by": self.created_by, "created_at": self.created_at,
            "updated_at": self.updated_at, "comments": self.comments,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BoardElement":
        elem = cls()
        for k, v in data.items():
            if hasattr(elem, k):
                setattr(elem, k, v)
        return elem

    def move(self, x: float, y: float):
        self.x = x
        self.y = y
        self.updated_at = time.time()

    def resize(self, width: float, height: float):
        self.width = max(1, width)
        self.height = max(1, height)
        self.updated_at = time.time()

    def rotate(self, angle: float):
        self.rotation = angle % 360
        self.updated_at = time.time()


# ================================================================
# 白板
# ================================================================
@dataclass
class Whiteboard:
    """白板"""
    id: str = ""
    name: str = "未命名白板"
    description: str = ""
    elements: Dict[str, BoardElement] = field(default_factory=dict)
    view_x: float = 0.0
    view_y: float = 0.0
    zoom: float = 1.0
    created_by: str = ""
    created_at: float = 0.0
    updated_at: float = 0.0
    history: List[Dict[str, Any]] = field(default_factory=list)
    max_history: int = 50
    online_users: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    permissions: Dict[str, str] = field(default_factory=dict)  # user -> role

    def __post_init__(self):
        if not self.id:
            self.id = f"board_{uuid.uuid4().hex[:8]}"
        if not self.created_at:
            self.created_at = time.time()
            self.updated_at = self.created_at

    def add_element(self, element: BoardElement) -> str:
        self.elements[element.id] = element
        self._save_history("add", element.id)
        self.updated_at = time.time()
        return element.id

    def remove_element(self, element_id: str) -> bool:
        if element_id in self.elements:
            elem = self.elements.pop(element_id)
            self._save_history("remove", element_id, elem.to_dict())
            self.updated_at = time.time()
            return True
        return False

    def get_element(self, element_id: str) -> Optional[BoardElement]:
        return self.elements.get(element_id)

    def update_element(self, element_id: str, **kwargs) -> bool:
        elem = self.elements.get(element_id)
        if not elem or elem.locked:
            return False
        old_data = elem.to_dict()
        for k, v in kwargs.items():
            if hasattr(elem, k):
                setattr(elem, k, v)
        elem.updated_at = time.time()
        self._save_history("update", element_id, old_data)
        self.updated_at = time.time()
        return True

    def move_element(self, element_id: str, x: float, y: float) -> bool:
        return self.update_element(element_id, x=x, y=y)

    def resize_element(self, element_id: str, width: float, height: float) -> bool:
        return self.update_element(element_id, width=width, height=height)

    def bring_to_front(self, element_id: str):
        elem = self.elements.get(element_id)
        if elem:
            max_z = max((e.z_index for e in self.elements.values()), default=0)
            elem.z_index = max_z + 1
            self.updated_at = time.time()

    def send_to_back(self, element_id: str):
        elem = self.elements.get(element_id)
        if elem:
            min_z = min((e.z_index for e in self.elements.values()), default=0)
            elem.z_index = min_z - 1
            self.updated_at = time.time()

    def group_elements(self, element_ids: List[str]) -> str:
        group_id = f"group_{uuid.uuid4().hex[:6]}"
        for eid in element_ids:
            elem = self.elements.get(eid)
            if elem:
                elem.group_id = group_id
        self.updated_at = time.time()
        return group_id

    def ungroup_elements(self, group_id: str):
        for elem in self.elements.values():
            if elem.group_id == group_id:
                elem.group_id = ""
        self.updated_at = time.time()

    def get_elements_by_type(self, elem_type: str) -> List[BoardElement]:
        return [e for e in self.elements.values() if e.type == elem_type]

    def get_elements_in_area(self, x: float, y: float, width: float, height: float) -> List[BoardElement]:
        return [
            e for e in self.elements.values()
            if e.x >= x and e.y >= y and e.x <= x + width and e.y <= y + height
        ]

    def search_elements(self, query: str) -> List[BoardElement]:
        q = query.lower()
        return [
            e for e in self.elements.values()
            if q in e.content.lower() or q in e.type.lower()
        ]

    def _save_history(self, action: str, element_id: str, old_data: Optional[Dict] = None):
        entry = {
            "action": action,
            "element_id": element_id,
            "old_data": old_data,
            "timestamp": time.time(),
        }
        self.history.append(entry)
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]

    def undo(self) -> bool:
        if not self.history:
            return False
        entry = self.history.pop()
        if entry["action"] == "add":
            self.elements.pop(entry["element_id"], None)
        elif entry["action"] == "remove" and entry.get("old_data"):
            elem = BoardElement.from_dict(entry["old_data"])
            self.elements[elem.id] = elem
        elif entry["action"] == "update" and entry.get("old_data"):
            elem = BoardElement.from_dict(entry["old_data"])
            self.elements[elem.id] = elem
        self.updated_at = time.time()
        return True

    def set_view(self, x: float, y: float, zoom: float):
        self.view_x = x
        self.view_y = y
        self.zoom = max(0.1, min(4.0, zoom))

    def zoom_in(self, factor: float = 1.2):
        self.zoom = min(4.0, self.zoom * factor)

    def zoom_out(self, factor: float = 1.2):
        self.zoom = max(0.1, self.zoom / factor)

    def reset_view(self):
        self.view_x = 0
        self.view_y = 0
        self.zoom = 1.0

    def add_comment(self, element_id: str, user: str, text: str) -> bool:
        elem = self.elements.get(element_id)
        if not elem:
            return False
        comment = {
            "id": f"comment_{uuid.uuid4().hex[:6]}",
            "user": user,
            "text": text,
            "timestamp": time.time(),
            "resolved": False,
        }
        elem.comments.append(comment)
        self.updated_at = time.time()
        return True

    def resolve_comment(self, element_id: str, comment_id: str) -> bool:
        elem = self.elements.get(element_id)
        if not elem:
            return False
        for c in elem.comments:
            if c["id"] == comment_id:
                c["resolved"] = True
                self.updated_at = time.time()
                return True
        return False

    def user_join(self, user_id: str, user_name: str = ""):
        self.online_users[user_id] = {
            "name": user_name or user_id,
            "join_time": time.time(),
            "cursor_x": 0,
            "cursor_y": 0,
        }

    def user_leave(self, user_id: str):
        self.online_users.pop(user_id, None)

    def update_cursor(self, user_id: str, x: float, y: float):
        if user_id in self.online_users:
            self.online_users[user_id]["cursor_x"] = x
            self.online_users[user_id]["cursor_y"] = y

    def has_permission(self, user_id: str, action: str) -> bool:
        role = self.permissions.get(user_id, "viewer")
        if role == "owner":
            return True
        if role == "editor":
            return action in ("view", "edit", "comment")
        if role == "commenter":
            return action in ("view", "comment")
        return action == "view"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "elements": {k: v.to_dict() for k, v in self.elements.items()},
            "view_x": self.view_x, "view_y": self.view_y, "zoom": self.zoom,
            "created_by": self.created_by, "created_at": self.created_at,
            "updated_at": self.updated_at,
            "element_count": len(self.elements),
            "online_users": list(self.online_users.keys()),
        }

    def export_svg(self) -> str:
        """导出为 SVG"""
        elements_svg = ""
        for elem in sorted(self.elements.values(), key=lambda e: e.z_index):
            if not elem.visible:
                continue
            style = f"fill:{elem.style.get('fill', '#fff')};stroke:{elem.style.get('stroke', '#333')};stroke-width:{elem.style.get('stroke-width', 1)}"
            if elem.type == "text":
                elements_svg += f'<text x="{elem.x}" y="{elem.y + 20}" style="{style}">{elem.content}</text>'
            elif elem.type == "shape":
                shape = elem.style.get("shape", "rect")
                if shape == "rect":
                    elements_svg += f'<rect x="{elem.x}" y="{elem.y}" width="{elem.width}" height="{elem.height}" style="{style}"/>'
                elif shape == "circle":
                    elements_svg += f'<circle cx="{elem.x + elem.width/2}" cy="{elem.y + elem.height/2}" r="{min(elem.width, elem.height)/2}" style="{style}"/>'
            elif elem.type == "sticky":
                elements_svg += f'<rect x="{elem.x}" y="{elem.y}" width="{elem.width}" height="{elem.height}" fill="#ffeb3b" stroke="#fbc02d"/>'
                elements_svg += f'<text x="{elem.x + 5}" y="{elem.y + 20}" font-size="12">{elem.content}</text>'
            elif elem.type == "line":
                elements_svg += f'<line x1="{elem.x}" y1="{elem.y}" x2="{elem.x + elem.width}" y2="{elem.y + elem.height}" stroke="#333" stroke-width="2"/>'

        return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<rect width="100%" height="100%" fill="#f5f5f5"/>
{elements_svg}
</svg>'''

    def export_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2, default=str)


# ================================================================
# 白板模板
# ================================================================
class WhiteboardTemplates:
    """白板模板库"""

    @staticmethod
    def create_mindmap_board(name: str = "思维导图", center_text: str = "中心主题") -> Whiteboard:
        board = Whiteboard(name=name)
        center = BoardElement(type="mindmap", x=860, y=500, width=200, height=80,
                              content=center_text, style={"fill": "#2196F3", "color": "#fff"})
        board.add_element(center)
        for i, label in enumerate(["分支1", "分支2", "分支3", "分支4"]):
            angle = (i * 90 - 45) * 3.14159 / 180
            bx = 860 + 300 * (1 if i < 2 else -1)
            by = 500 + 200 * (1 if i % 2 == 0 else -1)
            branch = BoardElement(type="mindmap", x=bx, y=by, width=150, height=60,
                                  content=label, style={"fill": "#64B5F6"})
            board.add_element(branch)
            line = BoardElement(type="line", x=center.x + center.width, y=center.y + center.height/2,
                                width=branch.x - center.x - center.width, height=branch.y - center.y)
            board.add_element(line)
        return board

    @staticmethod
    def create_kanban_board(name: str = "看板") -> Whiteboard:
        board = Whiteboard(name=name)
        columns = ["待办", "进行中", "已完成"]
        colors = ["#FF9800", "#2196F3", "#4CAF50"]
        for i, (col, color) in enumerate(zip(columns, colors)):
            x = 50 + i * 320
            header = BoardElement(type="shape", x=x, y=50, width=280, height=50,
                                  content=col, style={"fill": color, "color": "#fff", "shape": "rect"})
            board.add_element(header)
            for j in range(3):
                card = BoardElement(type="sticky", x=x + 15, y=120 + j * 100,
                                    width=250, height=80, content=f"任务 {j+1}",
                                    style={"fill": "#FFF9C4"})
                board.add_element(card)
        return board

    @staticmethod
    def create_freeform_board(name: str = "自由画布") -> Whiteboard:
        return Whiteboard(name=name)


# ================================================================
# 白板管理器
# ================================================================
class WhiteboardManager:
    """白板管理器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "whiteboards")
        os.makedirs(self.data_dir, exist_ok=True)
        self._boards: Dict[str, Whiteboard] = {}
        self._lock = threading.RLock()
        self._wan = None
        self._load_all()

    def set_wan(self, wan):
        """设置广域网实例"""
        self._wan = wan

    def _load_all(self):
        try:
            for filename in os.listdir(self.data_dir):
                if filename.endswith(".json"):
                    try:
                        filepath = os.path.join(self.data_dir, filename)
                        with open(filepath, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        board = Whiteboard(id=data["id"], name=data.get("name", "未命名"))
                        for elem_data in data.get("elements", {}).values():
                            board.elements[elem_data["id"]] = BoardElement.from_dict(elem_data)
                        self._boards[board.id] = board
                    except Exception:
                        pass
        except Exception:
            pass

    def create_board(self, name: str = "未命名白板", template: str = "freeform",
                     created_by: str = "") -> Whiteboard:
        with self._lock:
            if template == "mindmap":
                board = WhiteboardTemplates.create_mindmap_board(name)
            elif template == "kanban":
                board = WhiteboardTemplates.create_kanban_board(name)
            else:
                board = WhiteboardTemplates.create_freeform_board(name)
            board.created_by = created_by
            self._boards[board.id] = board
            self._save_board(board)
            return board

    def get_board(self, board_id: str) -> Optional[Whiteboard]:
        return self._boards.get(board_id)

    def list_boards(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": b.id, "name": b.name, "elements": len(b.elements),
                "updated_at": b.updated_at, "created_by": b.created_by,
            }
            for b in sorted(self._boards.values(), key=lambda x: x.updated_at, reverse=True)
        ]

    def delete_board(self, board_id: str) -> bool:
        with self._lock:
            if board_id in self._boards:
                del self._boards[board_id]
                filepath = os.path.join(self.data_dir, f"{board_id}.json")
                if os.path.exists(filepath):
                    os.remove(filepath)
                return True
            return False

    def rename_board(self, board_id: str, new_name: str) -> bool:
        board = self._boards.get(board_id)
        if board:
            board.name = new_name
            board.updated_at = time.time()
            self._save_board(board)
            return True
        return False

    def _save_board(self, board: Whiteboard):
        try:
            filepath = os.path.join(self.data_dir, f"{board.id}.json")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(board.to_dict(), f, ensure_ascii=False, indent=2, default=str)
        except Exception as e:
            terminal.warn(f"保存白板失败: {e}", "whiteboard")

    def save_all(self):
        for board in self._boards.values():
            self._save_board(board)

    def get_stats(self) -> Dict[str, Any]:
        total_elements = sum(len(b.elements) for b in self._boards.values())
        return {
            "total_boards": len(self._boards),
            "total_elements": total_elements,
            "storage_dir": self.data_dir,
        }


# 全局管理器
_whiteboard_manager = WhiteboardManager()


def get_whiteboard_manager() -> WhiteboardManager:
    return _whiteboard_manager

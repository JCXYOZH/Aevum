"""终端表格渲染。"""

from typing import Any, List, Optional

from .styles import Color, get_terminal_size
from .writer import _writer


class Table:
    """终端表格渲染器"""

    def __init__(self, headers: List[str], rows: Optional[List[List[Any]]] = None,
                 header_color: str = Color.CYAN + Color.BOLD,
                 border_color: str = Color.GRAY,
                 align: Optional[List[str]] = None,
                 max_col_width: int = 40):
        self.headers = headers
        self.rows = rows or []
        self.header_color = header_color
        self.border_color = border_color
        self.align = align or ["left"] * len(headers)
        self.max_col_width = max_col_width

    def add_row(self, row: List[Any]):
        self.rows.append([str(c) for c in row])

    def _col_widths(self) -> List[int]:
        widths = [len(h) for h in self.headers]
        for row in self.rows:
            for i, cell in enumerate(row):
                if i < len(widths):
                    widths[i] = max(widths[i], min(len(str(cell)), self.max_col_width))
        return [w + 2 for w in widths]

    def _format_cell(self, value: str, width: int, align: str, color: str = "") -> str:
        value = str(value)
        if len(value) > width - 2:
            value = value[:width - 5] + "..."
        padding = width - 2 - len(value)
        if align == "right":
            return f" {color}{value}{Color.RESET}{' ' * padding} "
        elif align == "center":
            left = padding // 2
            right = padding - left
            return f"{' ' * left}{color}{value}{Color.RESET}{' ' * right} "
        else:
            return f" {color}{value}{Color.RESET}{' ' * padding} "

    def render(self) -> str:
        if not self.headers:
            return ""
        widths = self._col_widths()
        bc = self.border_color

        # 顶边框
        top = bc + "┌" + "┬".join("─" * w for w in widths) + "┐" + Color.RESET
        # 表头
        header_cells = []
        for i, h in enumerate(self.headers):
            header_cells.append(self._format_cell(h, widths[i], self.align[i], self.header_color))
        header_line = bc + "│" + bc.join(header_cells) + bc + "│" + Color.RESET
        # 分隔线
        sep = bc + "├" + "┼".join("─" * w for w in widths) + "┤" + Color.RESET
        # 数据行
        data_lines = []
        for row in self.rows:
            cells = []
            for i, cell in enumerate(row):
                if i < len(widths):
                    cells.append(self._format_cell(cell, widths[i], self.align[i]))
            data_lines.append(bc + "│" + bc.join(cells) + bc + "│" + Color.RESET)
        # 底边框
        bottom = bc + "└" + "┴".join("─" * w for w in widths) + "┘" + Color.RESET

        lines = [top, header_line, sep] + data_lines + [bottom]
        return "\n".join(lines)

    def print(self):
        _writer.submit(self.render())
"""本地 Web 访问引擎公共入口。"""

import inspect as _inspect

from .constants import *
from .budget import *
from .cache import *
from .browser import *
from .browser_html import *
from .fetch import *
from .search import *
from .utils import *

def _link_functions():
    modules = [m for m in globals().values() if _inspect.ismodule(m) and m.__name__.startswith(__name__ + '.')]
    funcs = {}
    for m in modules:
        for name, obj in vars(m).items():
            if _inspect.isfunction(obj) and getattr(obj, '__module__', '') == m.__name__:
                funcs[name] = obj
    for m in modules:
        for name, obj in funcs.items():
            vars(m)[name] = obj
    globals().update(funcs)

_link_functions()

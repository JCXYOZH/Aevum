"""外部网页搜索与抓取公共入口。"""

import inspect as _inspect

from .constants import *
from .session import *
from .engines import *
from .redirects import *
from .backends import SEARCH_BACKENDS
from .search import *
from .summarize import *

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

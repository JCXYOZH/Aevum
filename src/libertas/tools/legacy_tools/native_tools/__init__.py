"""原生网络安全工具公共入口。"""

import inspect as _inspect

from .constants import *
from .core import *
from .scan import *
from .scan_advanced import *
from .dns import *
from .dns_enum import *
from .dns_records import *
from .http import *
from .http_crawl import *
from .http_checks import *
from .web_vuln import *
from .web_vuln_checks import *
from .creds import *
from .misc import *
from .security_payloads import *
from .exploit_builders import *
from .exploit_helpers import *
from .args import *
from .runner import *
from .data import NATIVE_TOOLS

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

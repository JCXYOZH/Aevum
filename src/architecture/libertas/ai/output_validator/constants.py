"""输出校验规则常量。"""

import re



_EMPTY_PATTERNS = [
    re.compile(r'^[\s\n\r]*$'),
    re.compile(r'^(对方暂时没有回应|暂无回应|无响应|no response)\s*$', re.IGNORECASE),
]

_REFUSAL_PATTERNS = [
    re.compile(r'我(无法|不能|没法|不便|不会|没有办法)(帮你|为你|给你)?(搜索|查询|查找|访问|浏览|联网|上网|连接网络)'),
    re.compile(r'(无法|不能|没法|不便)(帮你|为你|给你)?(搜索|查询|查找|访问互联网|浏览网页|联网|上网|连接网络|获取网络)'),
    re.compile(r'(作为|身为).{0,10}(AI|语言模型|人工智能|助手).{0,20}(无法|不能|无法直接|无法访问|无法联网)'),
    re.compile(r'我(目前|现在|这边)?(无法|不能)(访问|连接|使用)(互联网|网络|网页|网站|在线)'),
    re.compile(r'(抱歉|对不起|不好意思).{0,20}(无法|不能|没法).{0,10}(搜索|访问|联网|查询|浏览)'),
    re.compile(r'I(\'m| am)? (sorry|afraid) I (can\'t|cannot|am unable to) (browse|search|access|connect to)'),
    re.compile(r'我(无法|不能)直接(访问|浏览|查看)(网页|网站|互联网|网络)'),
    re.compile(r'需要你(自己|手动)(搜索|查询|查找|访问)'),
    re.compile(r'建议你(直接|自行)(搜索|查询|百度|谷歌)'),
    re.compile(r'(无法|不能|没法)(访问|连接|获取).{0,10}(互联网|网络|在线|实时|最新)'),
    re.compile(r'(我|抱歉|对不起|不好意思)?(无法|不能|没法|不会|不能够)(帮你|为你|给你)?(执行|运行|操作|使用|调用)(这个|该)?(工具|命令|操作|指令)'),
    re.compile(r'(抱歉|对不起|不好意思).{0,10}(做不到|无法完成|不能帮|无能为力|无法协助)'),
    re.compile(r'我(无法|不能|没法)(完成|做到|协助|帮助|处理)'),
]

_KNOWN_CONTROL_TAGS = {"TOOL", "WEB_SEARCH", "WEB_FETCH", "WEB_DEEP_SEARCH", "WEB_TO_RAG", "FILE", "END"}

_DSML_TAG_RE = re.compile(r'<<<([A-Z_]+)[:>]')

_URL_RE = re.compile(r'https?://[^\s\)\]>"\'，。、；：！？）】》]+')

_TOOL_TAG_RE = re.compile(r'<<<TOOL:([^>]+)>>>')

_SEARCH_TAG_RE = re.compile(r'<<<WEB_SEARCH:([^>]+)>>>')

_FILE_TAG_RE = re.compile(r'<<<FILE:([^>]+)>>>')

_KNOWN_OFFICIAL_DOMAINS = [
    "python.org", "docs.python.org", "github.com", "stackoverflow.com", "wikipedia.org",
    "developer.mozilla.org", "linux.die.net", "man7.org", "gnu.org",
    "nmap.org", "curl.se", "httpd.apache.org", "nginx.org", "apache.org",
    "www.w3.org", "w3.org", "tools.ietf.org", "ietf.org", "reactjs.org", "vuejs.org",
    "nodejs.org", "pypi.org", "packaging.python.org", "debian.org", "ubuntu.com",
    "redhat.com", "microsoft.com", "apple.com", "google.com", "cloudflare.com",
    "owasp.org", "cve.mitre.org", "nvd.nist.gov", "exploit-db.com", "rapid7.com",
]

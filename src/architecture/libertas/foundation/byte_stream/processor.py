"""响应处理与统一结果。"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .errors import ByteStreamError
from .text import safe_decode
from .codec import decode_request_body, encode_response_body, is_encoded_request, detect_request_encoding


class ProcessResult:
    """响应体处理结果"""
    success: bool = True
    content: str = ""
    raw_size: int = 0
    processed_size: int = 0
    encoding: str = "utf-8"
    steps: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    is_base64: bool = False
    is_compressed: bool = False
    is_js_rendered: bool = False
    is_js_beautified: bool = False
    title: str = ""
    text_content: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

class ResponseProcessor:
    """响应体处理器"""

    def __init__(self, headless: bool = True, js_render: bool = False,
                 js_beautify: bool = False, extract_text: bool = True):
        self.headless = headless
        self.js_render = js_render
        self.js_beautify = js_beautify
        self.extract_text = extract_text
        self._browser = None

    def _get_browser(self):
        """获取浏览器自动化实例（懒加载）"""
        if self._browser is None:
            try:
                from ..security.browser_automation import BrowserAutomation
                self._browser = BrowserAutomation(headless=self.headless)
            except Exception:
                self._browser = None
        return self._browser

    def auto_decompress(self, data: bytes, headers: Dict[str, str] = None) -> Tuple[bytes, str]:
        """自动检测并解压响应体"""
        if not data:
            return data, ""
        algorithm = ""
        if headers:
            content_encoding = headers.get('Content-Encoding', '').lower().strip()
            if content_encoding:
                encodings = [e.strip() for e in content_encoding.split(',')]
                for enc in reversed(encodings):
                    if enc in ('gzip', 'x-gzip'):
                        try:
                            data = gzip.decompress(data)
                            algorithm = "gzip"
                        except Exception:
                            pass
                    elif enc == 'deflate':
                        try:
                            data = zlib.decompress(data)
                            algorithm = "deflate"
                        except zlib.error:
                            try:
                                data = zlib.decompress(data, -zlib.MAX_WBITS)
                                algorithm = "deflate"
                            except Exception:
                                pass
                    elif enc == 'br':
                        if _HAS_BROTLI:
                            try:
                                data = brotli.decompress(data)
                                algorithm = "br"
                            except Exception:
                                pass
        if not algorithm and len(data) > 2:
            if data[0] == 0x1f and data[1] == 0x8b:
                try:
                    data = gzip.decompress(data)
                    algorithm = "gzip(auto)"
                except Exception:
                    pass
            elif data[0] == 0x78:
                try:
                    data = zlib.decompress(data)
                    algorithm = "deflate(auto)"
                except Exception:
                    pass
        return data, algorithm

    def detect_charset(self, data: bytes) -> str:
        """检测字节数据的编码"""
        if not data:
            return "utf-8"
        if data[:3] == b'\xef\xbb\xbf':
            return "utf-8-sig"
        if data[:2] == b'\xff\xfe':
            return "utf-16-le"
        if data[:2] == b'\xfe\xff':
            return "utf-16-be"
        try:
            data.decode('utf-8')
            return "utf-8"
        except UnicodeDecodeError:
            pass
        if _HAS_CHARDET:
            result = chardet.detect(data)
            if result and result.get('encoding') and result.get('confidence', 0) > 0.5:
                return result['encoding'].lower()
        for enc in ['gbk', 'gb2312', 'gb18030', 'big5', 'shift_jis', 'euc-kr', 'latin-1']:
            try:
                data.decode(enc)
                return enc
            except UnicodeDecodeError:
                continue
        return "utf-8"

    def decode_to_text(self, data: bytes, encoding: str = None) -> Tuple[str, str]:
        """将字节数据解码为文本"""
        if not data:
            return "", "utf-8"
        if encoding is None:
            encoding = self.detect_charset(data)
        try:
            text = data.decode(encoding, errors='replace')
            return text, encoding
        except Exception:
            text = data.decode('utf-8', errors='replace')
            return text, "utf-8"

    def is_base64_text(self, text: str) -> bool:
        """检测文本是否是Base64编码"""
        if not text or len(text) < 8:
            return False
        cleaned = re.sub(r'\s+', '', text)
        if not re.match(r'^[A-Za-z0-9+/]+={0,2}$', cleaned):
            return False
        if len(cleaned) % 4 != 0:
            return False
        try:
            decoded = base64.b64decode(cleaned)
            if len(decoded) > 0:
                printable = sum(1 for b in decoded if 32 <= b <= 126 or b in (9, 10, 13))
                if printable / len(decoded) > 0.7:
                    return True
                if len(decoded) > 2 and (decoded[0] == 0x1f or decoded[0] == 0x78):
                    return True
        except Exception:
            return False
        return False

    def decode_base64_text(self, text: str) -> Tuple[bytes, bool]:
        """解码Base64文本"""
        try:
            cleaned = re.sub(r'\s+', '', text)
            decoded = base64.b64decode(cleaned)
            return decoded, True
        except Exception:
            return b"", False

    def render_js_page(self, url: str, wait_time: int = 3,
                       wait_for_selector: str = None) -> Tuple[str, Dict[str, Any]]:
        """使用无头浏览器渲染JS页面"""
        browser = self._get_browser()
        if browser is None:
            return "", {"error": "browser automation not available"}
        try:
            page = browser.fetch(url=url, wait_for_selector=wait_for_selector, wait_time=wait_time)
            metadata = {
                "engine": page.engine_used,
                "status_code": page.status_code,
                "final_url": page.final_url,
                "title": page.title,
                "load_time": page.load_time,
            }
            return page.content, metadata
        except Exception as e:
            return "", {"error": str(e)}

    def beautify_js_code(self, js_code: str) -> Tuple[str, bool]:
        """美化/反混淆JS代码"""
        if not _HAS_JSBEAUTIFIER:
            return js_code, False
        try:
            opts = jsbeautifier.default_options()
            opts.indent_size = 2
            opts.indent_char = ' '
            opts.max_preserve_newlines = 2
            opts.preserve_newlines = True
            opts.brace_style = 'collapse,preserve-inline'
            opts.space_before_conditional = True
            opts.wrap_line_length = 0
            beautified = jsbeautifier.beautify(js_code, opts)
            return beautified, True
        except Exception:
            return js_code, False

    def extract_html_text(self, html: str) -> Tuple[str, str]:
        """从HTML中提取正文文本和标题"""
        if not html:
            return "", ""
        title = ""
        text = ""
        if _HAS_BS4:
            try:
                soup = BeautifulSoup(html, 'html.parser')
                if soup.title and soup.title.string:
                    title = soup.title.string.strip()
                for tag in soup(['script', 'style', 'noscript', 'iframe', 'svg']):
                    tag.decompose()
                text = soup.get_text(separator='\n', strip=True)
                text = re.sub(r'\n{3,}', '\n\n', text)
                return text, title
            except Exception:
                pass
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
        cleaned = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.IGNORECASE | re.DOTALL)
        cleaned = re.sub(r'<style[^>]*>.*?</style>', '', cleaned, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<[^>]+>', '\n', cleaned)
        try:
            import html as html_module
            text = html_module.unescape(text)
        except Exception:
            pass
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()
        return text, title

    def process(self, raw_data: bytes, headers: Dict[str, str] = None,
                url: str = "") -> ProcessResult:
        """完整的响应体处理流程"""
        result = ProcessResult(raw_size=len(raw_data))
        if not raw_data:
            result.content = ""
            result.steps.append("empty")
            return result
        data = raw_data

        # 步骤1: 解压
        try:
            data, algorithm = self.auto_decompress(data, headers)
            if algorithm:
                result.is_compressed = True
                result.steps.append(f"decompress:{algorithm}")
        except Exception as e:
            result.errors.append(f"decompress failed: {e}")

        # 步骤2: 编码检测与转换
        try:
            text, encoding = self.decode_to_text(data)
            result.encoding = encoding
            result.steps.append(f"decode:{encoding}")
        except Exception as e:
            result.errors.append(f"decode failed: {e}")
            text = data.decode('utf-8', errors='replace')

        # 步骤3: Base64检测与解码
        try:
            if self.is_base64_text(text):
                decoded_bytes, success = self.decode_base64_text(text)
                if success:
                    result.is_base64 = True
                    result.steps.append("base64_decode")
                    decoded_bytes, alg2 = self.auto_decompress(decoded_bytes)
                    if alg2:
                        result.steps.append(f"decompress_after_b64:{alg2}")
                    text, enc2 = self.decode_to_text(decoded_bytes)
                    result.encoding = enc2
        except Exception as e:
            result.errors.append(f"base64 failed: {e}")

        # 步骤4: JS渲染
        if self.js_render and url:
            try:
                rendered_html, meta = self.render_js_page(url)
                if rendered_html:
                    text = rendered_html
                    result.is_js_rendered = True
                    result.steps.append("js_render")
                    result.metadata.update(meta)
            except Exception as e:
                result.errors.append(f"js_render failed: {e}")

        # 步骤5: JS美化
        if self.js_beautify and text:
            is_js = False
            if url and (url.endswith('.js') or 'javascript' in (headers or {}).get('Content-Type', '')):
                is_js = True
            elif re.search(r'(function|var|let|const|=>|console\.log)', text[:500]):
                is_js = True
            if is_js:
                try:
                    beautified, success = self.beautify_js_code(text)
                    if success:
                        text = beautified
                        result.is_js_beautified = True
                        result.steps.append("js_beautify")
                except Exception as e:
                    result.errors.append(f"js_beautify failed: {e}")

        # 步骤6: 提取网页正文
        if self.extract_text and text:
            try:
                extracted_text, title = self.extract_html_text(text)
                if title:
                    result.title = title
                if extracted_text:
                    result.text_content = extracted_text
                    result.steps.append("extract_text")
            except Exception as e:
                result.errors.append(f"extract_text failed: {e}")

        result.content = text
        result.processed_size = len(text.encode('utf-8', errors='replace'))
        return result

def process_response(raw_data: bytes, headers: Dict[str, str] = None,
                     url: str = "", js_render: bool = False,
                     js_beautify: bool = False) -> ProcessResult:
    """便捷函数：处理响应体"""
    processor = ResponseProcessor(
        js_render=js_render,
        js_beautify=js_beautify,
        extract_text=True
    )
    return processor.process(raw_data, headers, url)

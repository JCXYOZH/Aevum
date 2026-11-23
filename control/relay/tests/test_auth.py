# ============================================================
# tests/test_auth.py — 令牌校验与启动守门的回归测试
#
# 覆盖三类路径：
#   1. 非回环无令牌：main() 必须拒绝启动（exit 4），不能只打 warning；
#   2. 前缀令牌：authorized() 必须拒绝（防时序泄露的常数时间比较）；
#   3. 正确令牌：authorized() 必须放行。
# 运行：python -m unittest discover -s control/relay/tests -v
#       或 cd control/relay && python -m unittest discover -s tests -v
# ============================================================
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from relay.__main__ import _parse_args, main  # noqa: E402
from relay.server import RelayApp  # noqa: E402

TOKEN = "secret-token-123"


class AuthorizedTokenTests(unittest.TestCase):
    """authorized() 的令牌比较：常数时间、bytes 比较、拒绝前缀。"""

    def setUp(self):
        self.app = RelayApp(token=TOKEN)

    def test_correct_token_header(self):
        self.assertTrue(self.app.authorized(TOKEN, ""))

    def test_correct_token_bearer(self):
        self.assertTrue(self.app.authorized("", TOKEN))

    def test_prefix_token_rejected(self):
        # 只知道前缀的攻击者必须拿不到任何信息（也不能被放行）
        self.assertFalse(self.app.authorized(TOKEN[:-1], ""))
        self.assertFalse(self.app.authorized("", TOKEN[:6]))

    def test_wrong_token_rejected(self):
        self.assertFalse(self.app.authorized("wrong-token-123", "wrong-token-123"))

    def test_empty_token_rejected_when_token_set(self):
        self.assertFalse(self.app.authorized("", ""))

    def test_non_ascii_token_does_not_raise(self):
        # bytes 化后，非 ASCII 令牌走比较而不是抛 TypeError
        app = RelayApp(token="令牌-不是-ascii")
        self.assertTrue(app.authorized("令牌-不是-ascii", ""))
        self.assertFalse(app.authorized("令牌", ""))

    def test_no_token_mode_allows_all(self):
        app = RelayApp(token="")
        self.assertTrue(app.authorized("", ""))


class StartupGateTests(unittest.TestCase):
    """非回环无令牌的启动守门：默认拒绝，逃生旗标显式确认。"""

    def test_remote_no_token_refused(self):
        rc = main(["--host", "0.0.0.0"])
        self.assertEqual(rc, 4)

    def test_default_host_is_loopback(self):
        # 回环无令牌是默认开发形态，不会在守门处被拒。
        args = _parse_args([])
        self.assertIn(args.host, ("127.0.0.1", "localhost", "::1"))

    def test_escape_hatch_flag_parsed(self):
        args = _parse_args(["--host", "0.0.0.0", "--insecure-remote-no-token"])
        self.assertTrue(args.insecure_remote_no_token)


if __name__ == "__main__":
    unittest.main()

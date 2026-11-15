"""旧 Web UI 接口兼容层。

Aevum 当前没有与旧 `interfaces.web` 等价的 get_MrHua / queue_orb_command。
这里保留同名可调用对象，避免导入期失败；接入 Aevum Web 层后应替换为真实实现。
"""

def get_MrHua():
    return None


def queue_orb_command(command):
    return None

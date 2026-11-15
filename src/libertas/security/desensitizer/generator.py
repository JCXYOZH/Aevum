"""假数据生成。"""

import random
import string
from typing import Any, Dict, List

class FakeDataGenerator:
    """假数据生成器"""

    _first_names = ["张", "李", "王", "刘", "陈", "杨", "赵", "黄", "周", "吴"]
    _given_names = ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋"]

    @classmethod
    def fake_phone(cls) -> str:
        prefixes = ["138", "139", "136", "135", "158", "159", "188", "189"]
        return random.choice(prefixes) + "".join(random.choices(string.digits, k=8))

    @classmethod
    def fake_email(cls) -> str:
        name = "".join(random.choices(string.ascii_lowercase, k=8))
        domain = random.choice(["example.com", "test.com", "demo.org"])
        return f"{name}@{domain}"

    @classmethod
    def fake_name(cls) -> str:
        return random.choice(cls._first_names) + random.choice(cls._given_names)

    @classmethod
    def fake_id_card(cls) -> str:
        area = "".join(random.choices(string.digits, k=6))
        birth = f"{random.randint(1970, 2005)}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"
        seq = "".join(random.choices(string.digits, k=3))
        check = random.choice(string.digits + "X")
        return area + birth + seq + check

    @classmethod
    def fake_ip(cls) -> str:
        return f"{random.randint(10, 250)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"

    @classmethod
    def fake_address(cls) -> str:
        provinces = ["北京市", "上海市", "广东省", "浙江省", "江苏省"]
        cities = ["朝阳区", "海淀区", "浦东新区", "广州市", "杭州市"]
        return f"{random.choice(provinces)}{random.choice(cities)}{random.randint(1, 100)}号"

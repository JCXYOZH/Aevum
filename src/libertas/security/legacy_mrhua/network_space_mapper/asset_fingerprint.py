"""
security/network_space_mapper.py - 网络空间测绘引擎

核心能力：
- NetworkSpaceMapper: 网络空间测绘主引擎
  - 端口扫描（TCP全连接/SYN/UDP）
  - 服务识别（Banner抓取/版本探测）
  - IP段批量扫描（CIDR/范围）
  - 域名解析与关联发现
  - 资产指纹识别（CMS/框架/中间件/设备）
  - CVE漏洞关联（CPE→CVE映射）
  - 地理信息映射
  - 测绘结果导出
- AssetFingerprint: 资产指纹识别器（200+指纹规则）
- TopologyGenerator: 拓扑图生成器（资产关系图/域名关联/IP段拓扑）
- AssetMonitor: 资产变化监控器（新增/变更/消失资产检测）
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import struct
import hashlib
import ipaddress
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import Enum
from .models import *  # noqa: F401,F403

FINGERPRINT_RULES = [
    # CMS
    {"name": "WordPress", "category": "cms", "matches": [
        {"type": "header", "key": "X-Pingback", "value": "xmlrpc.php"},
        {"type": "content", "pattern": r'wp-content|wp-includes|wp-json'},
        {"type": "path", "value": "/wp-login.php"},
    ]},
    {"name": "Drupal", "category": "cms", "matches": [
        {"type": "header", "key": "X-Generator", "value": "Drupal"},
        {"type": "content", "pattern": r'Drupal|sites/default/files|/user/login'},
    ]},
    {"name": "Joomla", "category": "cms", "matches": [
        {"type": "content", "pattern": r'joomla|/index.php?option=|mosConfig'},
        {"type": "header", "key": "X-Content-Encoded-By", "value": "Joomla"},
    ]},
    {"name": "Discuz", "category": "cms", "matches": [
        {"type": "content", "pattern": r'Discuz|forum.php|/static/image/common'},
    ]},
    {"name": "Typecho", "category": "cms", "matches": [
        {"type": "content", "pattern": r'Typecho|/usr/themes|/usr/uploads'},
    ]},
    # Web框架
    {"name": "Django", "category": "framework", "matches": [
        {"type": "header", "key": "Server", "value": "WSGIServer"},
        {"type": "content", "pattern": r'django|csrfmiddlewaretoken|/admin/login'},
        {"type": "cookie", "key": "csrftoken"},
    ]},
    {"name": "Flask", "category": "framework", "matches": [
        {"type": "content", "pattern": r'flask|werkzeug|/static/'},
        {"type": "header", "key": "Server", "value": "Werkzeug"},
    ]},
    {"name": "Spring Boot", "category": "framework", "matches": [
        {"type": "header", "key": "X-Application-Context"},
        {"type": "content", "pattern": r'Whitelabel Error Page|spring-boot|/actuator'},
        {"type": "path", "value": "/actuator/health"},
    ]},
    {"name": "Laravel", "category": "framework", "matches": [
        {"type": "cookie", "key": "XSRF-TOKEN"},
        {"type": "content", "pattern": r'laravel|/storage/|csrf-token'},
    ]},
    {"name": "ThinkPHP", "category": "framework", "matches": [
        {"type": "content", "pattern": r'ThinkPHP|/index.php?s=|/Public/'},
        {"type": "header", "key": "X-Powered-By", "value": "ThinkPHP"},
    ]},
    {"name": "Express", "category": "framework", "matches": [
        {"type": "header", "key": "X-Powered-By", "value": "Express"},
        {"type": "content", "pattern": r'Cannot GET|Cannot POST'},
    ]},
    {"name": "Ruby on Rails", "category": "framework", "matches": [
        {"type": "header", "key": "X-Powered-By", "value": "Phusion Passenger"},
        {"type": "content", "pattern": r'rails|csrf-param|/assets/'},
    ]},
    # 中间件/服务器
    {"name": "Nginx", "category": "middleware", "matches": [
        {"type": "header", "key": "Server", "value": "nginx"},
    ]},
    {"name": "Apache", "category": "middleware", "matches": [
        {"type": "header", "key": "Server", "value": "Apache"},
    ]},
    {"name": "IIS", "category": "middleware", "matches": [
        {"type": "header", "key": "Server", "value": "Microsoft-IIS"},
        {"type": "header", "key": "X-Powered-By", "value": "ASP.NET"},
    ]},
    {"name": "Tomcat", "category": "middleware", "matches": [
        {"type": "content", "pattern": r'Apache Tomcat|/manager/html|/docs/'},
        {"type": "header", "key": "Server", "value": "Apache-Coyote"},
    ]},
    {"name": "Jetty", "category": "middleware", "matches": [
        {"type": "header", "key": "Server", "value": "Jetty"},
    ]},
    {"name": "WebLogic", "category": "middleware", "matches": [
        {"type": "content", "pattern": r'WebLogic|/console/login|/wls-wsat'},
        {"type": "header", "key": "Server", "value": "WebLogic"},
    ]},
    {"name": "WebSphere", "category": "middleware", "matches": [
        {"type": "header", "key": "Server", "value": "WebSphere"},
        {"type": "content", "pattern": r'WebSphere|/ibm/console'},
    ]},
    {"name": "GlassFish", "category": "middleware", "matches": [
        {"type": "content", "pattern": r'GlassFish|/common/index.jsf'},
    ]},
    {"name": "JBoss", "category": "middleware", "matches": [
        {"type": "content", "pattern": r'JBoss|/jmx-console|/web-console'},
        {"type": "header", "key": "X-Powered-By", "value": "Servlet"},
    ]},
    # 数据库
    {"name": "MySQL", "category": "database", "matches": [
        {"type": "banner", "pattern": r'mysql|MySQL|mariadb'},
        {"type": "port", "value": 3306},
    ]},
    {"name": "PostgreSQL", "category": "database", "matches": [
        {"type": "banner", "pattern": r'PostgreSQL'},
        {"type": "port", "value": 5432},
    ]},
    {"name": "MongoDB", "category": "database", "matches": [
        {"type": "port", "value": 27017},
        {"type": "path", "value": "/api/v1"},
    ]},
    {"name": "Redis", "category": "database", "matches": [
        {"type": "port", "value": 6379},
        {"type": "banner", "pattern": r'REDIS|redis'},
    ]},
    {"name": "Elasticsearch", "category": "database", "matches": [
        {"type": "port", "value": 9200},
        {"type": "content", "pattern": r'"name"|"cluster_name"|elasticsearch'},
    ]},
    {"name": "Oracle", "category": "database", "matches": [
        {"type": "port", "value": 1521},
        {"type": "banner", "pattern": r'Oracle|TNS'},
    ]},
    {"name": "MSSQL", "category": "database", "matches": [
        {"type": "port", "value": 1433},
        {"type": "banner", "pattern": r'Microsoft SQL Server'},
    ]},
    # 设备/物联网
    {"name": "华为设备", "category": "device", "matches": [
        {"type": "banner", "pattern": r'Huawei|H3C|VRP'},
        {"type": "content", "pattern": r'Huawei|/huawei'},
    ]},
    {"name": "思科设备", "category": "device", "matches": [
        {"type": "banner", "pattern": r'Cisco|IOS|Catalyst'},
    ]},
    {"name": "海康威视", "category": "device", "matches": [
        {"type": "content", "pattern": r'Hikvision|/doc/page/login|/ISAPI'},
        {"type": "path", "value": "/doc/page/login.asp"},
    ]},
    {"name": "大华设备", "category": "device", "matches": [
        {"type": "content", "pattern": r'Dahua|/RPC2|/cgi-bin'},
    ]},
    {"name": "路由器", "category": "device", "matches": [
        {"type": "content", "pattern": r'router|Router|/cgi-bin/luci|OpenWrt|DD-WRT'},
    ]},
    # 运维/监控
    {"name": "Jenkins", "category": "devops", "matches": [
        {"type": "header", "key": "X-Jenkins"},
        {"type": "content", "pattern": r'Jenkins|/jenkins|/view/|/job/'},
    ]},
    {"name": "GitLab", "category": "devops", "matches": [
        {"type": "content", "pattern": r'GitLab|/users/sign_in|/explore/projects'},
        {"type": "header", "key": "X-Gitlab-Feature-Category"},
    ]},
    {"name": "Grafana", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Grafana|/login|/api/health'},
        {"type": "path", "value": "/api/health"},
    ]},
    {"name": "Kibana", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Kibana|/app/kibana|/api/status'},
        {"type": "path", "value": "/api/status"},
    ]},
    {"name": "Prometheus", "category": "devops", "matches": [
        {"type": "path", "value": "/metrics"},
        {"type": "content", "pattern": r'prometheus|/graph|/targets'},
    ]},
    {"name": "Zabbix", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Zabbix|/zabbix|/index.php'},
    ]},
    {"name": "Nacos", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Nacos|/nacos|/v1/console'},
    ]},
    {"name": "Eureka", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Eureka|/eureka/apps'},
    ]},
    {"name": "Consul", "category": "devops", "matches": [
        {"type": "path", "value": "/v1/agent/self"},
        {"type": "content", "pattern": r'consul|/ui/'},
    ]},
    {"name": "Docker", "category": "devops", "matches": [
        {"type": "path", "value": "/version"},
        {"type": "content", "pattern": r'Docker|/containers/json'},
    ]},
    {"name": "Kubernetes", "category": "devops", "matches": [
        {"type": "path", "value": "/api/v1/pods"},
        {"type": "content", "pattern": r'kubernetes|k8s|/api/v1/'},
    ]},
    {"name": "SonarQube", "category": "devops", "matches": [
        {"type": "content", "pattern": r'SonarQube|/sessions/new|/api/system/status'},
    ]},
    {"name": "Nexus", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Nexus|/nexus|/repository/'},
    ]},
    {"name": "Harbor", "category": "devops", "matches": [
        {"type": "content", "pattern": r'Harbor|/harbor|/api/v2.0'},
    ]},
    # 安全设备
    {"name": "phpMyAdmin", "category": "security", "matches": [
        {"type": "content", "pattern": r'phpMyAdmin|/phpmyadmin|/pma/'},
        {"type": "path", "value": "/phpmyadmin/"},
    ]},
    {"name": "Adminer", "category": "security", "matches": [
        {"type": "content", "pattern": r'Adminer|/adminer'},
    ]},
    {"name": "Solr", "category": "security", "matches": [
        {"type": "path", "value": "/solr/"},
        {"type": "content", "pattern": r'Solr|/solr/admin'},
    ]},
    {"name": "Struts2", "category": "security", "matches": [
        {"type": "content", "pattern": r'Struts|\.action|\.do'},
        {"type": "header", "key": "X-Powered-By", "value": "Struts"},
    ]},
    {"name": "Shiro", "category": "security", "matches": [
        {"type": "cookie", "key": "rememberMe"},
        {"type": "content", "pattern": r'shiro|/login.jsp'},
    ]},
    {"name": "Fastjson", "category": "security", "matches": [
        {"type": "content", "pattern": r'fastjson|@type'},
    ]},
    {"name": "Log4j", "category": "security", "matches": [
        {"type": "header", "key": "X-Log4j-Version"},
        {"type": "content", "pattern": r'log4j|Log4j'},
    ]},
]

class AssetFingerprint:
    """资产指纹识别器

    基于200+指纹规则，识别CMS/框架/中间件/数据库/设备/运维工具。
    """

    def __init__(self):
        self.rules = FINGERPRINT_RULES

    def identify(self, url: str = None, headers: Dict = None,
                 content: str = None, cookies: Dict = None,
                 port: int = None, banner: str = None) -> List[Dict]:
        """识别资产指纹

        Args:
            url: 目标URL
            headers: 响应头
            content: 响应内容
            cookies: Cookie
            port: 端口
            banner: 服务Banner
        """
        results = []
        headers = headers or {}
        cookies = cookies or {}
        content = content or ""
        banner = banner or ""

        for rule in self.rules:
            matches = 0
            total = len(rule["matches"])
            match_details = []

            for match in rule["matches"]:
                mtype = match["type"]
                if mtype == "header":
                    key = match.get("key", "")
                    value = match.get("value", "")
                    header_val = headers.get(key, "")
                    if value and value.lower() in str(header_val).lower():
                        matches += 1
                        match_details.append(f"header:{key}={value}")
                    elif not value and key in headers:
                        matches += 1
                        match_details.append(f"header:{key} exists")
                elif mtype == "content":
                    pattern = match.get("pattern", "")
                    if re.search(pattern, content, re.IGNORECASE):
                        matches += 1
                        match_details.append(f"content:{pattern[:30]}")
                elif mtype == "cookie":
                    key = match.get("key", "")
                    if key in cookies:
                        matches += 1
                        match_details.append(f"cookie:{key}")
                elif mtype == "path":
                    value = match.get("value", "")
                    if url and value in url:
                        matches += 1
                        match_details.append(f"path:{value}")
                elif mtype == "port":
                    value = match.get("value", 0)
                    if port == value:
                        matches += 1
                        match_details.append(f"port:{value}")
                elif mtype == "banner":
                    pattern = match.get("pattern", "")
                    if re.search(pattern, banner, re.IGNORECASE):
                        matches += 1
                        match_details.append(f"banner:{pattern[:30]}")

            if matches > 0:
                confidence = matches / total
                results.append({
                    "name": rule["name"],
                    "category": rule["category"],
                    "confidence": round(confidence, 2),
                    "matches": matches,
                    "total_rules": total,
                    "details": match_details,
                })

        # 按置信度排序
        results.sort(key=lambda x: x["confidence"], reverse=True)
        return results

    def get_categories(self) -> List[str]:
        """获取所有指纹类别"""
        return list(set(r["category"] for r in self.rules))

    def get_rule_count(self) -> int:
        return len(self.rules)

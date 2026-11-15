"""获取并分析网站robots.txt和sitemap.xml，发现隐藏路径，支持路径可访问性验证实现。"""

import urllib.request

import urllib.error

import ssl

import re

import concurrent.futures

def _fetch_url(url, timeout=10):
    """获取URL内容"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={"User-Agent": "Libertas-Robots-Scanner/2.0"})
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        return resp.read().decode("utf-8", errors="replace"), resp.status
    except urllib.error.HTTPError as e:
        try:
            return e.read().decode("utf-8", errors="replace"), e.code
        except Exception:
            return "", e.code
    except Exception as e:
        return "", 0

def _check_path_accessible(base_url, path):
    """检查路径是否可访问"""
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={"User-Agent": "Libertas-Scanner/2.0"})
        resp = urllib.request.urlopen(req, timeout=8, context=ctx)
        return {"path": path, "status": resp.status, "accessible": True,
                "length": len(resp.read())}
    except urllib.error.HTTPError as e:
        if e.code not in (404,):
            return {"path": path, "status": e.code, "accessible": True,
                    "length": 0}
        return {"path": path, "status": 404, "accessible": False}
    except Exception:
        return {"path": path, "status": 0, "accessible": False}

def robots_check(target: str = "", verify_paths: bool = False) -> dict:
    """robots.txt检查"""
    if not target:
        return {"success": False, "error": "请输入域名"}
    if not target.startswith("http"):
        target = "http://" + target

    try:
        # 1. 获取robots.txt
        robots_url = target.rstrip("/") + "/robots.txt"
        robots_content, robots_status = _fetch_url(robots_url)

        if robots_status != 200:
            return {"success": True, "result": {
                "目标": target,
                "robots_url": robots_url,
                "robots_status": robots_status,
                "message": f"robots.txt不存在或无法访问（HTTP {robots_status}）",
                "建议": "robots.txt缺失可能导致搜索引擎无法正确索引，但也可能暴露更多路径"
            }}

        # 2. 解析robots.txt
        disallowed = []
        allowed = []
        sitemaps = []
        user_agents = []
        crawl_delay = ""
        host = ""
        other_directives = []

        for line in robots_content.split("\n"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            low = line.lower()
            if low.startswith("disallow:"):
                path = line.split(":", 1)[1].strip()
                if path:
                    disallowed.append(path)
            elif low.startswith("allow:"):
                path = line.split(":", 1)[1].strip()
                if path:
                    allowed.append(path)
            elif low.startswith("sitemap:"):
                sitemaps.append(line.split(":", 1)[1].strip())
            elif low.startswith("user-agent:"):
                user_agents.append(line.split(":", 1)[1].strip())
            elif low.startswith("crawl-delay:"):
                crawl_delay = line.split(":", 1)[1].strip()
            elif low.startswith("host:"):
                host = line.split(":", 1)[1].strip()
            else:
                other_directives.append(line)

        # 3. 有趣路径检测（敏感关键词）
        sensitive_keywords = [
            "admin", "login", "backup", "config", "secret", "private", "test",
            "dev", "api", ".env", ".git", "debug", "console", "dashboard",
            "manager", "management", "setup", "install", "phpmyadmin", "wp-admin",
            "cpanel", "whm", "webmail", "mail", "ftp", "ssh", "database", "db",
            "sql", "dump", "log", "logs", "tmp", "temp", "upload", "uploads",
            "files", "download", "downloads", "backup", "backups", "archive",
            "old", "new", "staging", "prod", "production", "internal", "intranet",
            "extranet", "portal", "gateway", "proxy", "vpn", "remote", "monitor",
            "grafana", "kibana", "elasticsearch", "prometheus", "zabbix", "nagios",
            "jenkins", "ci", "cd", "deploy", "deployment", "docker", "kubernetes",
            "k8s", "registry", "harbor", "nexus", "artifactory", "sonarqube",
            "gitlab", "github", "bitbucket", "svn", "git", ".svn", ".git",
            "phpinfo", "info.php", "test.php", "server-status", "server-info",
            "actuator", "swagger", "api-docs", "graphql", "graphiql", "playground",
            "redoc", "openapi", "docs", "documentation", "readme", "changelog",
            "license", "authors", "contributors", "credits", "humans.txt",
            "security.txt", ".well-known", "crossdomain.xml", "clientaccesspolicy.xml",
            "web.config", ".htaccess", ".htpasswd", "composer.json", "package.json",
            "requirements.txt", "gemfile", "pipfile", "go.mod", "cargo.toml",
            "pom.xml", "build.gradle", "node_modules", "vendor", "lib", "libs",
        ]

        interesting_paths = []
        for path in disallowed:
            path_lower = path.lower()
            matched_keywords = [kw for kw in sensitive_keywords if kw in path_lower]
            if matched_keywords:
                interesting_paths.append({
                    "path": path,
                    "matched_keywords": matched_keywords,
                    "risk_level": "高" if any(kw in path_lower for kw in
                        ["admin", "login", "backup", "config", "secret", ".env", ".git",
                         "phpmyadmin", "wp-admin", "database", "db", "sql", "dump",
                         "server-status", "actuator", "swagger", "api-docs", "graphql"])
                        else "中" if any(kw in path_lower for kw in
                        ["test", "dev", "debug", "console", "dashboard", "manager",
                         "setup", "install", "upload", "files", "download", "log", "tmp"])
                        else "低"
                })

        # 4. 获取sitemap内容
        sitemap_urls = []
        for sitemap_url in sitemaps[:5]:
            try:
                sitemap_content, sitemap_status = _fetch_url(sitemap_url, timeout=8)
                if sitemap_status == 200:
                    # 提取URL
                    urls = re.findall(r"<loc>(.*?)</loc>", sitemap_content, re.IGNORECASE)
                    sitemap_urls.extend(urls[:100])
            except Exception:
                continue

        # 5. 路径可访问性验证（可选）
        verification_results = []
        if verify_paths and interesting_paths:
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                futures = [executor.submit(_check_path_accessible, target, p["path"])
                           for p in interesting_paths[:20]]
                for future in concurrent.futures.as_completed(futures):
                    result = future.result()
                    if result:
                        verification_results.append(result)

        return {
            "success": True,
            "result": {
                "目标": target,
                "robots_url": robots_url,
                "robots_status": robots_status,
                "User-Agent": list(set(user_agents)),
                "禁止路径数": len(disallowed),
                "禁止路径": disallowed[:100],
                "允许路径数": len(allowed),
                "允许路径": allowed[:50],
                "Sitemap数": len(sitemaps),
                "Sitemap": sitemaps,
                "Sitemap提取URL数": len(sitemap_urls),
                "Sitemap URL示例": sitemap_urls[:20],
                "Crawl-Delay": crawl_delay or "未设置",
                "Host": host or "未设置",
                "其他指令": other_directives,
                "有趣路径数": len(interesting_paths),
                "有趣路径": interesting_paths[:50],
                "路径验证": verification_results if verify_paths else "未启用",
                "高风险路径": [p for p in interesting_paths if p["risk_level"] == "高"],
                "中风险路径": [p for p in interesting_paths if p["risk_level"] == "中"],
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

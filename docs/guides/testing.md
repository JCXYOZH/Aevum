# 测试

当前仓库的 `tests/` 有单元、集成、性能、安全目录，但依赖并未固定在 `requirements-dev.txt`；本轮没有把运行时覆盖率当成结论。

可复算的静态审计：

```powershell
D:\venv\Scripts\python.exe tools\analyze.py
```

拆分回归至少做：

```powershell
python -m compileall -q src\libertas apps\console\monitor
python apps\console\monitor\desktop_server.py --help
curl http://127.0.0.1:8781/
```

涉及订阅时，必须走真实 `POST /api/loop/subscribe`，不要用临时 SMTP 脚本代替代码路径。

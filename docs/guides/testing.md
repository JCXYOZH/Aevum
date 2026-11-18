# 测试

`tests/` 下有单元、集成、性能、安全目录；依赖以 `requirements-dev.txt` 为准，当前覆盖率不作为结论。

可复算的静态审计：

```powershell
D:\venv\Scripts\python.exe ops\tools\analyze.py
```

核心与控制平面的编译回归：

```powershell
python -m compileall -q control src\architecture\libertas src\kernel\host\bridge src\kernel\host\console
```

导入回归：

```powershell
$env:PYTHONPATH = "src\kernel;src\architecture;src\shared"
python -c "import libertas, fortuna, memoria, common; from control.registry import DEFAULT_CORES"
```

归档后端只用于查旧行为，不参与主线回归。涉及订阅等旧接口时，必须走真实代码路径，不要用临时 SMTP 脚本代替。

# 从这里开始

三条路，选一条。每条不超过五分钟。

## 我只是想看看这是什么

1. [README.md](README.md) —— 项目是干什么的，代码在哪张表里
2. [PROGRESS.md](PROGRESS.md) —— 真实进度，含"未完成"清单
3. [ROADMAP.md](ROADMAP.md) —— 接下来打算做什么
4. `apps/community/web/index.html` —— 页面本身，双击就能打开

## 我想提代码

1. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) —— 先知道边界在哪
2. [CONTRIBUTING.md](CONTRIBUTING.md) —— 一次更新一次提交，怎么提交信息
3. [PROGRESS.md](PROGRESS.md) 的"缺口"一节 —— 那里写着现在缺什么
4. 从 [ROADMAP.md](ROADMAP.md) 的 P1 或 P2 挑一件，别自己发明需求

## 我要把它挂到服务器

1. [apps/community/README.md](apps/community/README.md) —— 静态站怎么起、怎么更新
2. `deployment/` —— **全是 0 字节占位**，不是能用的编排文件
3. `docs/guides/deployment.md` —— 同样为空，别照着它做

## 第一次来容易踩的坑

- 仓库里绝大多数文件是 0 字节。这是占位，不是坏文件，也不是未完成的实现。
- `README.md` 过去装的是行为准则，现在它在 `CODE_OF_CONDUCT.md`。
- `fortuna` / `libertas` / `memoria` 是同一个仓库里的三个模块，不是三个仓库。
- 站点没有构建步骤，也没有依赖，改完 HTML 刷新即生效。

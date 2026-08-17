# 快手直播 m3u 生成器（纯 HTTP）

抓取 [快手游戏直播·热门](https://live.kuaishou.com/live/HOT) 页面同款接口（含**下拉加载更多**），
生成 `kuaishou_live.m3u` 播放列表。**纯 HTTP、免登录、免签名、无浏览器依赖**，
单文件 Python 标准库实现，复制即可运行。

> 🤖 后续 AI 接手指南见 **[AGENTS.md](./AGENTS.md)**（代码结构、不变量、验证清单）。

## 快速开始

```bash
# 0) 环境：仅需 Python 3.8+（只用标准库，无需 pip install）

# 1) 试跑（只打印统计，不写文件）
python3 update_m3u.py --dry-run

# 2) 生成 / 刷新 kuaishou_live.m3u（默认 50 页并发，约 2000 个不重复房间，约 8 秒）
python3 update_m3u.py

# 3) 指定抓取页数（1~50）
python3 update_m3u.py --pages 10
```

生成结果示例（与用户要求的格式完全一致）：

```
#EXTINF:-1 tvg-logo="" group-title="王者荣耀" tvg-id="bh6jarZBi4U", 王者荣耀九天狐「白+」-九天狐露脸养猪流冲第1
https://tx-origin.pull.yximgs.com/gifshow/bh6jarZBi4U_GameAvcFhdL3.flv?txSecret=...&txTime=...&stat=...
```

## 目录结构

| 文件 | 说明 |
|---|---|
| `update_m3u.py` | 主脚本：并发翻页抓取 → 去重 → 取最高清晰度 CDN 直链 → 写 m3u |
| `sources.txt` | 来源配置（当前 `HOT:50` = 热门页抓 50 页） |
| `kuaishou_live.m3u` | 输出文件：本轮在播房间播放列表 |
| `README.md` | 本文件（面向人） |
| `AGENTS.md` | 面向后续 AI 接管的快速上手文档 |
| `tools/mcpcli.mjs` | 历史分析辅助脚本（js-reverse MCP 客户端，管线不使用，可忽略/删除） |

## 工作流程

```
sources.txt ──► live_api/hot/list（每页 50 房间，8 线程并发翻页）
                    │
                    ▼
            合并去重（按 page 首次出现保留，约 2000 个唯一房间）
                    │
                    ▼
        取每房间最高清晰度 CDN 直链（FLV, level/码率最大）
                    │
                    ▼
        kuaishou_live.m3u（#EXTM3U + EXTINF + URL 成对）
```

## 接口分析（抓包结论）

页面打开与下拉加载时的核心请求（均为 `live.kuaishou.com`）：

| 接口 | 作用 | 纯 HTTP 可用 |
|---|---|---|
| `GET /live_api/hot/list?type=HOT&filterType=0&page=N&pageSize=24` | **热门房间列表 + 每房间 4 档清晰度 CDN 直链**；下拉"加载更多"就是 page 递增 | ✅ 免签名免 Cookie（裸请求也 200） |
| `GET /live_api/category/simple` | 分类元数据（热门 9 类 + 推荐 8 类） | ✅ |
| `GET /live_api/category/classify` / `category/data` | 游戏分类列表（类型/房间数，**非房间流**） | ✅ |
| `GET /live_api/liveroom/livedetail` | 进房详情（按 principalId，含 playUrls.h264/hevc） | ❌ 需页面内 `$encode` 签名 |

### hot/list 响应关键结构

```jsonc
{ "data": { "list": [ {
  "id": "bh6jarZBi4U",                 // ← tvg-id（房间号/直播流 id）
  "caption": "九天狐露脸养猪流冲第1",    // ← 房间名
  "author": { "name": "王者荣耀九天狐「白+」", "originUserId": 596989039 },
  "gameInfo": { "name": "王者荣耀" },   // ← group-title（分类）
  "playUrls": [ { "adaptationSet": { "representation": [
    { "qualityType": "STANDARD", "bitrate": 1000, "level": 30,
      "url": "https://tx-origin.pull.yximgs.com/gifshow/..._GameAvcSdL0.flv?txSecret=...&txTime=..." },
    { "qualityType": "HIGH",     "bitrate": 2000, "level": 50, ... },
    { "qualityType": "SUPER",    "bitrate": 4000, "level": 70, ... },
    { "qualityType": "BLUE_RAY", "bitrate": 8000, "level": 130, "url": "..._GameAvcFhdL3.flv?..." }  // ← 脚本取这档
  ] } } ]
} ] } }
```

字段映射（接口 → m3u 参数）：

- `tvg-id` = 房间 `id`（如 `bh6jarZBi4U`）
- `group-title` = `gameInfo.name`（分类，如 王者荣耀/和平精英）
- 频道名 = `author.name`（用户昵称）+ `-` + `caption`（房间标题）
- 播放地址 = 4 档中 `level`（其次 `bitrate`）最大一档的 `url`（蓝光质臻 8M）

## 关键运行特征（实测数据）

- **分页**：每页固定 50 个在播房间；`hasMore` 恒为 `true`（服务端不封底），靠脚本页数上限截断。
- **翻页深度**：前几页基本不重复；页数越深重复率越高（热门房间反复出现）。
  50 页 = 2500 条原始记录 → **约 2000 个唯一房间**（实测 2082~2084）。
- **并发**：8 线程翻 50 页约 **7.5 秒、零失败、无风控**（每页恰好请求一次，各线程抓不同页）。
- **签名时效**：CDN 直链带 `txSecret`/`txTime`，实测 **24 小时有效**。
- **编码**：FLV over HTTP（`video/x-flv`，魔数 `FLV\x01`）。接口不下发 m3u8（`.flv` 改 `.m3u8` 是 404）。
- **可播性**：实时抽取样 15 条 **15/15 可播**；下播房间会 404，属正常。

## 配置说明（sources.txt）

```
HOT              # 热门页，默认 50 页
HOT:50           # 显式 50 页（上限 50）
https://live.kuaishou.com/live/HOT:50   完整 URL 加页数
```

- 命令行 `--pages N` 会覆盖所有来源的页数。
- 目前仅实现热门流（`live_api/hot/list`）；分类页 `category/*` 接口返回的是**分类元数据**而非房间流，
  未来若要做"按分类抓取"，需要另寻房间流接口（见 AGENTS.md「扩展方向」）。

## 注意事项 / FAQ

- **为什么是 FLV 不是 m3u8？** 快手网页播放器本身就走 FLV，接口不提供 HLS；
  PotPlayer / mpv / IINA / VLC 均可直接播 FLV 直链。
- **某个频道 404？** 主播下播了。脚本每次运行只输出"此刻在播"的房间；建议 cron 每小时跑一次保持新鲜。
- **不想动仓库文件只想看？** `--dry-run` 只打印统计和前面 5 条示例。
- **风控？** 实测 8 并发 50 页无风控；如需更保守可调 `update_m3u.py` 顶部 `PAGE_WORKERS`。

## 历史沿革（为什么长这样）

1. 逆向分析 `live.kuaishou.com/live/HOT` 页面请求（浏览器抓包 + 页面 JS 分包静态分析）。
2. 确认 `live_api/hot/list` 纯 HTTP 可用且自带 CDN 直链；`liveroom/livedetail` 需 `$encode` 签名弃用。
3. 参照 [douyin-actions](https://github.com/pan8664716/douyin_live) 项目模式搭建（sources.txt + update_m3u.py + m3u）。
4. 曾配置 GitHub Actions 每小时自动更新，后按用户要求停用（工作流文件已删除，勿重新启用除非用户要求）。
5. 仓库挂载于 `git@github.com:pan8664716/kuaishou-live.git`（曾用名 kuaishou-m3u，已改名）。

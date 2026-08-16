# 快手直播 m3u 生成器（纯 HTTP + GitHub Actions）

抓取 [快手游戏直播·热门](https://live.kuaishou.com/live/HOT) 页面同款接口（含**下拉加载更多**），
生成 `kuaishou_live.m3u`，每条格式：

```
#EXTINF:-1 tvg-logo="" group-title="王者荣耀" tvg-id="bh6jarZBi4U", 王者荣耀九天狐「白+」-九天狐露脸养猪流冲第1
https://tx-origin.pull.yximgs.com/gifshow/bh6jarZBi4U_GameAvcFhdL3.flv?txSecret=...&txTime=...&stat=...
```

## 接口分析（抓包结论）

页面打开与下拉加载时请求的核心接口：

| 接口 | 作用 | 纯 HTTP 是否可用 |
|---|---|---|
| `GET /live_api/hot/list?type=HOT&filterType=0&page=N&pageSize=24` | **热门房间列表 + 每房间 4 档清晰度 CDN 直链**；页面下拉"加载更多"就是 `page` 递增翻同一个接口 | ✅ 可用，免签名免 Cookie |
| `GET /live_api/category/simple` | 分类元数据（热门 9 类 + 推荐 8 类） | ✅ 可用 |
| `GET /live_api/category/classify` / `category/data` | 游戏分类列表（类型/房间数，非房间流） | ✅ 可用 |
| `GET /live_api/liveroom/livedetail` | 进房详情（按 principalId） | ❌ 需要页面内 `$encode` 签名，纯 HTTP 拿不到 |

关键点：

- `hot/list` 每页固定返回 **50 个在播房间**，`page` 递增可一直翻（`hasMore` 恒为 true，
  由脚本用页数上限截断）。实测 **8 线程并发翻 50 页约 7.5 秒、零失败、无风控**，
  50 页 ≈ 2500 条原始记录，**去重后约 2000 个不重复房间**（远页会出现热门房间重复）。
- 每个房间的 `playUrls[].adaptationSet.representation` 有 4 档：
  `STANDARD`(高清 1M) / `HIGH`(超清 2M) / `SUPER`(蓝光 4M) / `BLUE_RAY`(蓝光质臻 8M)，
  每档都是带 `txSecret`/`txTime` 签名的 **HTTP-FLV CDN 直链**
  （`tx-origin.pull.yximgs.com` 等），**签名 24 小时有效**。
- 脚本取 `level` 最大的一档（蓝光质臻，8000kbps）作为"cdn 最高清晰度播放地址"。
- 网页播放器走 FLV 流，接口不下发 m3u8（把 `.flv` 改成 `.m3u8` 是 404），
  因此 m3u 内放的是 FLV 直链 —— PotPlayer / mpv / IINA / VLC 均可直接播放。

字段映射（接口 → m3u 参数）：

- `tvg-id` = 房间 `id`（如 `bh6jarZBi4U`）
- `group-title` = `gameInfo.name`（分类，如 王者荣耀/和平精英）
- 频道名 = `author.name`（用户昵称） + `-` + `caption`（房间标题）

## 本地使用

```bash
# 试跑（只打印统计，不写文件）
python3 update_m3u.py --dry-run

# 生成 / 刷新 kuaishou_live.m3u（默认 50 页并发，约 2000 房间）
python3 update_m3u.py

# 指定页数（1~50）
python3 update_m3u.py --pages 10
```

`sources.txt` 来源配置（当前默认 `HOT:50`）：

```
HOT              # 热门页，默认 50 页
HOT:50           # 显式 50 页（上限 50）
https://live.kuaishou.com/live/HOT:50
```

## GitHub Actions 定时更新（每小时）

已内置 `.github/workflows/update-m3u.yml`：每小时（北京时间整点）+ 手动触发跑一次，
用纯 HTTP 生成 m3u 并自动提交回仓库。**无需浏览器/Node 依赖**。

部署到 https://github.com/pan8664716/kuaishou-m3u ：

```bash
cd /Users/star/Downloads/kuaishou
git init -b main
git add -A && git commit -m "init: 快手直播 m3u 每小时更新"
git branch -M main
git remote add origin https://github.com/pan8664716/kuaishou-m3u.git
git push -u origin main
```

推送后手动触发一次验证：仓库页面 → **Actions** → **更新快手直播 m3u** → **Run workflow**，
之后每小时自动更新。

## 注意事项

- 列表 = "此刻在播"：主播下播后地址立刻 404。GitHub Actions 每小时刷新一次即保持可用。
- 播放器若遇到个别 404 频道，跳到下一个即可（属于正常下播）。
- 实测抽样可播率：50 页全量列表随机抽 15 条 **15/15 可播**。

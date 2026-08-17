# AGENTS.md — 后续 AI 接管本仓库的快速上手

本文件写给接管的 AI / 开发者：**5 分钟理解项目、安全修改、正确验证**。
人的使用文档见 README.md；本文件专注"改代码前必须知道的约束"。

## 1. 这个项目是什么

用纯 HTTP 抓快手游戏直播**热门页**（https://live.kuaishou.com/live/HOT，含下拉加载更多），
生成标准 m3u 播放列表。核心是一个动作：

```
GET https://live.kuaishou.com/live_api/hot/list?type=HOT&filterType=0&page=N&pageSize=24
  → 每页 50 个在播房间，每个房间自带 4 档清晰度的 CDN FLV 直链
  → 脚本并发翻页、按房间号去重、取最高清晰度直链、写 kuaishou_live.m3u
```

## 2. 文件地图

| 文件 | 角色 | 修改时注意 |
|---|---|---|
| `update_m3u.py` | 唯一入口函数 `run()`；纯标准库（json/os/sys/time/urllib/concurrent.futures） | 保持纯 HTTP、无第三方依赖 |
| `sources.txt` | 来源配置，格式 `HOT[:N]` / 完整 URL `:N`，N 上限 50 | 别破坏 `load_sources()` 的解析假设 |
| `kuaishou_live.m3u` | 输出产物，提交进仓库 | 由脚本生成，不要手改；改动应通过脚本 |
| `README.md` | 人类文档 | 大改动记得同步 |
| `tools/mcpcli.mjs` | 历史逆向分析用的 MCP 客户端辅助 | 管线不用，可忽略或删除 |

## 3. 代码结构与关键函数（update_m3u.py）

- `parse_args(argv)`：`--dry-run`、`--pages N`（覆盖所有来源页数）。
- `load_sources(pages_override)`：读 sources.txt → `[(来源名大写, 页数)]`，页码 clamp 到 1..50。
- `fetch_page(source, page)`：单次 GET，成功返回 `(page, room_list)`；**异常被吞掉**返回 `(page, [])`
  并打印一行——换句话说"缺页不报错、只是少房间"，改代码勿改变该容错语义。
- `best_play_url(room)`：从所有 `playUrls[].adaptationSet.representation` 中取
  `(level, bitrate)` 排序最大者的 `url`。**这是"最高清晰度"的唯一判定逻辑。**
- `room_to_entry(room)`：生成 `#EXTINF:-1 tvg-logo="" group-title="<gameInfo.name 兜底'分类'>" tvg-id="<id>", <author.name>-<caption 兜底'直播间'>`。
  注意：m3u 输出字符串在逗号后有一个空格（`tvg-id="...", `）。改格式前先问用户，m3u 被下游播放器消费。
- `fetch_source(source, pages)`：把 page 1..pages **逐个提交**到线程池（`min(PAGE_WORKERS, pages)` 个 worker），
  `as_completed` 合并：**每个页面恰好请求一次，8 个线程各抓不同页，不是重复抓同一页**；
  去重规则 = 首次出现保留（多页重复时保留先完成/先出现的一页）。
- `run(dry_run, pages_override)`：多来源并发（`MAX_SOURCE_WORKERS=2`）→ 去重 → 组条目
  （无 URL 的房间跳过）→ 写文件。文件头 4 行，之后每条 = `#EXTINF` + `URL` 两行。

常量（文件顶部可调）：`DEFAULT_PAGES=50`、`MAX_PAGES=50`、`PAGE_WORKERS=8`、
`MAX_SOURCE_WORKERS=2`、`REQUEST_TIMEOUT=20`、`UA`（桌面 Chrome）。

## 4. 铁律 / 已知约束（勿破坏）

1. **保持纯 HTTP + 标准库**：这是项目立身之本；不要引入 requests/浏览器/签名算法。
   `liveroom/livedetail` 需要页面内 `$encode` 签名，**已确认纯 HTTP 不可用**，不要尝试用它。
2. **FLV 不是 m3u8**：网页播放器走 FLV；把 `.flv` 改成 `.m3u8` 会 404。不要"优化"成 m3u8。
3. **CDN 签名 24 小时有效**：m3u 是"此刻在播快照"，下播/过期即 404。刷新 = 重新跑脚本。
4. **`hasMore` 恒为 true**：服务端翻页永不到底，页数上限是唯一的截断手段（50）。
5. **`pageSize=24` 参数实际被忽略**：每页固定返回 50 条；不要依赖 pageSize 控制条数。
6. **去重以房间 `id`（liveId）为准**，如 `bh6jarZBi4U`；不是 `author.originUserId`。
7. **并发已实测安全**：8 线程 50 页 ≈ 7.5 秒、零失败。提高并发有风控风险，改动需实测。
8. **输出编码 UTF-8**：昵称/标题含 emoji 与特殊字符（如「白+」），写文件必须 `encoding='utf-8'`。
9. **Actions 已停用**：仓库无 `.github/workflows`。除非用户明确要求，不要重新加定时任务。

## 5. 怎么验证改动

```bash
# 语法与试跑
python3 -m py_compile update_m3u.py
python3 update_m3u.py --dry-run

# 全量跑一遍并核对数量（期望：约 2000+ 房间、无失败页提示）
python3 update_m3u.py

# m3u 结构自检：头部 4 行后，EXTINF 与 URL 两两成对、tvg-id 无重复
python3 - <<'PY'
import re
lines = open('kuaishou_live.m3u', encoding='utf-8').read().splitlines()
inf = [l for l in lines if l.startswith('#EXTINF')]
urls = [l for l in lines if l.startswith('http')]
ids = [re.search(r'tvg-id="([^"]*)"', l).group(1) for l in inf]
assert lines[0] == '#EXTM3U'
assert len(inf) == len(urls), f'EXTINF({len(inf)}) != URL({len(urls)})'
assert len(ids) == len(set(ids)), '房间号重复'
print(f'OK: {len(inf)} 条，房间号唯一')
PY

# 抽查 CDN 直链可播（期望返回 FLV 魔数 464c5601）
curl -m 8 -s "$(sed -n '6p' kuaishou_live.m3u)" | head -c 3 | xxd
```

改动小、行为验证以 `--dry-run` 输出 + m3u 自检为准；改动抓取逻辑后必须做全量跑 + 抽查可播。

## 6. Git / 仓库约定

- 远程：`git@github.com:pan8664716/kuaishou-live.git`，分支 `main`（单分支工作流）。
- 提交信息：中文、`conventional` 前缀：`feat:` / `fix:` / `docs:` / `chore:`。
- `kuaishou_live.m3u` 每次运行会变（房间在变），它是**产物也是仓库内容**，正常提交。
- 曾用名 `kuaishou-m3u`（已改名 kuaishou-live，远程 URL 已同步过）。

## 7. 扩展方向（未实现，先问用户再动）

- **按分类抓取**：`category/*` 接口只给分类元数据（游戏 id/名称/房间数），没有房间流；
  需要逆向分类页的房间列表接口（可能走签名，纯 HTTP 可行性未知）。
- **m3u8 输出**：目前无 HLS 来源；若未来接口提供 `representation.m3u8` 字段，可在
  `best_play_url` 里优先 m3u8（vendors.js 播放器代码显示结构上支持该字段）。
- **历史房间保留**：现在只输出本轮在播房间；若要增量保留历史，需自带动态解析服务
  （参考 douyin-actions 的 pages.dev Worker 方案）。
- **GitHub Actions 每小时自动更新**：架构上可随时再加（纯 Python 即可），但用户已明确停用，需重新确认。

## 8. 参考项目

同一作者的抖音版：[pan8664716/douyin_live](https://github.com/pan8664716/douyin_live)
（本项目的来源配置 + 增量合并 + Actions 模式参考自它；其浏览器兜底方案在此项目被刻意省略）。

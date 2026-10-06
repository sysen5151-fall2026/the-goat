# Wayly NYC 景点数据采集规范（nyc-poi v2）

采集结果按 `data/nyc-poi-template.csv` 填写（一行 = 一个地点），审核后转成 `data/nyc-poi-v1.json` 的结构。
**原则：只填有来源的事实；查不到就留空，不要猜。** 规划器对"空"和"填错"的处理完全不同：空 = 未知（保守处理），填错 = 会被当成事实用来排行程。

## A. 必填（缺一项就不能发布）

| 字段 | 类型 / 格式 | 示例 | 规划器怎么用 |
|---|---|---|---|
| `id` | 小写英文 + 连字符，唯一，发布后不再改 | `brooklyn-bridge` | 保存的行程、AI 白名单都靠它关联 |
| `name` | 官方英文名 | `Brooklyn Bridge` | 展示；用户点名识别（+200 分） |
| `neighborhood` | 街区名 | `DUMBO / Lower Manhattan` | 展示 |
| `borough` | `Manhattan` / `Brooklyn` / `Queens` / `Bronx` / `Staten Island` | `Brooklyn` | 以后做区域筛选 |
| `latitude` / `longitude` | WGS84 十进制，至少 5 位小数 | `40.70608` / `-73.99686` | 距离、空间半径、路线；**取入口位置，不要取建筑中心** |
| `interests` | 用 `\|` 分隔，**第一个是主类别**；可选值：`landmark` `museum` `architecture` `park` `waterfront` `food` | `landmark\|architecture\|waterfront` | 兴趣匹配 +50 分、兴趣覆盖、地图卡片的分类图 |
| `planningAllowanceUsd` | 整数，**每人**美元 | `0` | 预算可行性检查（× 人数） |
| `expectedSpendSemantics` | `per_person_reference`（每人）/ `group_fixed`（整团一个价，如包场）/ `free` / `unknown` | `free` | 决定金额乘不乘人数；`unknown` 的地点不会被排进行程 |
| `priceNote` | 一句话说明钱花在哪 | `Free to walk across.` | 详情页"Budget note" |
| `suggestedMinutes` | 整数，建议停留分钟数 | `45` | 时间窗口、每天几站的计算 |
| `sourceName` | 来源机构名 | `NYC DOT` | 来源页 |
| `sourceUrl` | 官方页面 URL（优先官方网站，其次政府/维基） | `https://www.nyc.gov/...` | 来源页、可点击核验 |
| `reviewedOn` | `YYYY-MM-DD`，你核对来源的日期 | `2026-10-05` | 超过 180 天要复核 |
| `accessNote` | 一句话：入口、排队、安检、需要预约等 | `Enter the walkway from City Hall Park...` | 详情页"Access note" |

## B. 强烈建议（影响排行程的准确度）

| 字段 | 格式 | 规划器怎么用 |
|---|---|---|
| `aliases` | `\|` 分隔的常用叫法 | `the met\|met museum` → 用户输入里提到就当成"点名" |
| `keywordTags` | `\|` 分隔的主题词，小写英文 | `skyline\|sunset\|kids\|rainy-day` → 匹配用户"Anything specific?"里的主题（+60 分） |
| `openingHoursText` | 原文抄写，如 `Mo-Th 10:00-17:00; Fr-Sa 10:00-21:00` | 以后做开放时间校验（目前只展示） |
| `closedWeekdays` | `\|` 分隔：`mon` `tue` `wed` `thu` `fri` `sat` `sun`，**只填官网明确写的固定闭馆日** | 选到闭馆日直接排除；留空 = 未知，不是"每天开" |
| `ticketUrl` | 购票 / 预约链接 | 详情页跳转 |
| `reservationRequired` | `yes` / `no` / 留空 | 提示用户提前预约 |
| `priceSourceUrl` | 价格来源页（和 sourceUrl 不同时填） | 价格可追溯 |
| `wheelchairAccessible` | `yes` / `partial` / `no` / 留空 | 用户勾选无障碍时：只有 `yes` 且有证据才保留 |
| `accessibilityEvidenceUrl` | 无障碍信息来源页 | 没证据的 `yes` 会被当成未知 |
| `dietaryTags` | `\|` 分隔：`vegetarian` `vegan` `halal` `kosher` `coffee` | 用户选"Vegetarian-friendly"/"Coffee stop"时匹配（仅 food 类） |
| `dietaryEvidenceUrl` | 菜单或官网页面 | 同上，无证据不采信 |
| `address` | 完整街道地址 | 展示、地图跳转 |

## C. 图片（解决"详情页没图"）

| 字段 | 格式 | 说明 |
|---|---|---|
| `wikipediaTitle` | 英文维基条目标题，原样复制 | **最省事**：填了这个，App 会自动从维基拉主图，`imageUrl` 可以不填 |
| `wikidataId` | `Q` 开头 | 以后做多语言名称、坐标核对 |
| `imageUrl` | 图片直链（https），优先 Wikimedia Commons | 有就优先用它；**不要用 Unsplash/Google 搜到的随便一张图**——v1 里就有两站共用同一张错误图片 |
| `imageCreditUrl` | 图片原始页面（Commons 文件页） | 有 `imageUrl` 时必填 |
| `imageLicense` | `CC BY-SA 4.0` / `CC BY 2.0` / `Public domain` 等 | 商用前要确认可用 |

图片回退顺序：`imageUrl` → `wikipediaTitle` 的维基主图 → 本地分类插画。三者至少有其一（`npm run verify:catalog` 会检查）。

## D. 审核字段（采集人填，不给用户看）

| 字段 | 格式 | 说明 |
|---|---|---|
| `reviewedBy` | 名字或缩写 | 谁核对的 |
| `reviewStatus` | `draft` / `reviewed` / `published` / `retired` | 只有 `published` 进规划器 |
| `notes` | 自由文本 | 疑问、待复核点 |

## 采集建议

1. **先扩量再扩字段**：每个兴趣类别先补到 15–20 个（现在 20 个总数太少，AI 在 ≤8 的候选里挑，选择余地很小）；food 类最缺。
2. **地理分布**：Midtown、Lower Manhattan、Brooklyn（DUMBO / Williamsburg）、Upper West/East Side 各至少 8 个，空间半径筛选才有东西可选。
3. **价格**：博物馆写成人票价、餐厅写人均 → `per_person_reference`；"随意捐赠"写建议金额 + 在 `priceNote` 注明 pay-what-you-wish；查不到 → `unknown`（不要写 0）。
4. **坐标**：在 Google Maps 右键入口位置复制坐标即可。
5. 采完把 CSV 发我，我写一个导入脚本转 JSON，并跑校验。

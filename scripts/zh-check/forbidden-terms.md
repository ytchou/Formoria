# zh-TW Forbidden Terms Dictionary（支語防線）

Taiwan-Mandarin term dictionary: Mainland (CN) usages that must not appear in published zh-TW content, with the Taiwan replacements. This is the single source of truth — consumed by the `content-translate` agent, the `/social-content` skill, and parsed mechanically by `check.py` in this directory.

**Scanner contract:** `check.py` treats every markdown table row whose third cell is `HARD-BAN`, `PREFER-TW`, `CONTEXT`, or `SOCIAL-ONLY` as a scan entry (first cell = terms to detect, split on `／`; second cell = suggested replacement). Rows marked `ALLOW` are never flagged. Fenced code blocks, inline code, and HTML comments are skipped.

**Severity tiers:**

| Severity | Meaning | Scanner behavior |
|---|---|---|
| HARD-BAN | Instantly reads as 支語 to a Taiwanese reader; zero ambiguity | Error — blocks output (exit 1) |
| PREFER-TW | Both forms seen in Taiwan, but the TW form is standard; CN form signals mainland influence | Warning — fix unless quoted |
| CONTEXT | The term has a legitimate TW meaning; only the CN sense is banned (see note) | Warning — judge by context |
| SOCIAL-ONLY | Crossed-over slang acceptable in casual social posts, not in articles | Warning in articles; allowed with `--channel social` |
| ALLOW | Fully crossed over into Taiwanese usage — do NOT flag (over-banning reads as out of touch) | Skipped |

---

## A. General / conversational

| 禁用 (CN) | 使用 (TW) | 嚴重度 | 備註 |
|---|---|---|---|
| 視頻 | 影片 | HARD-BAN | 視訊 for video calls specifically |
| 質量 | 品質 | HARD-BAN | 質量 in TW = physical mass only |
| 信息 | 資訊／訊息 | HARD-BAN | 資訊 = information broadly; 訊息 = a message |
| 網絡 | 網路 | HARD-BAN | |
| 小夥伴 | 夥伴／朋友 | HARD-BAN | Mainland internet culture term |
| 家人們 | 大家 | HARD-BAN | Mainland livestream culture; extremely grating |
| 牛逼 | 厲害／超強 | HARD-BAN | Vulgar CN slang |
| 靠譜 | 可靠／靠得住 | HARD-BAN | |
| 給力 | 很棒／讚 | HARD-BAN | |
| 接地氣 | 親民／貼近生活 | HARD-BAN | |
| 干貨／乾貨 | 實用內容 | HARD-BAN | CN "substantive content" sense doesn't exist in TW (乾貨 = dried goods only) |
| 博主 | 部落客／創作者 | HARD-BAN | |
| 公交車 | 公車 | HARD-BAN | |
| 外賣 | 外送 | HARD-BAN | |
| 打車 | 叫車／搭計程車 | HARD-BAN | |
| 盒飯 | 便當 | HARD-BAN | |
| 方便麵 | 泡麵 | HARD-BAN | |
| 保安 | 保全／警衛 | HARD-BAN | |
| 工資 | 薪水／薪資 | HARD-BAN | |
| 立馬 | 馬上／立刻 | HARD-BAN | |
| 渠道 | 管道／通路 | HARD-BAN | |
| 合同 | 合約／契約 | HARD-BAN | |
| 反饋 | 回饋 | HARD-BAN | |
| 運營 | 營運／經營 | HARD-BAN | Character order reversed in TW |
| 概率 | 機率 | HARD-BAN | |
| 演示 | 展示／示範／demo | HARD-BAN | |
| 激活 | 啟用／啟動 | HARD-BAN | |
| 高級感 | 質感 | HARD-BAN | |
| 公眾號 | 粉專／官方帳號 | HARD-BAN | WeChat concept; use the TW platform equivalent |
| 音頻 | 音訊 | HARD-BAN | |
| 鏈接 | 連結 | HARD-BAN | |
| 移動端 | 行動版／行動裝置 | HARD-BAN | |
| 短信 | 簡訊 | HARD-BAN | |
| 點贊 | 按讚 | HARD-BAN | |
| 頭像 | 大頭貼／頭貼 | PREFER-TW | |
| 當前 | 目前／現在 | PREFER-TW | 當前 sounds stiff/official in TW |
| 海量 | 大量／巨量 | PREFER-TW | |
| 素質 | 素養 | PREFER-TW | For personal quality/cultivation |
| 用戶 | 使用者 | PREFER-TW | 用戶 creeping in via app localizations; 使用者 is standard |
| 水平 | 水準 | CONTEXT | 水平 in TW = horizontal; standard/level → 水準 |
| 挺 | 蠻／很／還蠻 | CONTEXT | Only the adverb sense ("挺好") is CN; 挺 = to support is legit TW |
| 項目 | 專案 | CONTEXT | Project → 專案; 項目 = "item" (檢查項目) is legit TW |
| 社區 | 社群 | CONTEXT | Online community → 社群; residential 社區 is legit TW |

## B. Tech / computing

| 禁用 (CN) | 使用 (TW) | 嚴重度 | 備註 |
|---|---|---|---|
| 軟件 | 軟體 | HARD-BAN | |
| 硬件 | 硬體 | HARD-BAN | |
| 內存 | 記憶體 | HARD-BAN | |
| 硬盤 | 硬碟 | HARD-BAN | |
| 鼠標 | 滑鼠 | HARD-BAN | |
| 屏幕 | 螢幕 | HARD-BAN | |
| 打印 | 列印 | HARD-BAN | 打印機 → 印表機 |
| 服務器 | 伺服器 | HARD-BAN | |
| 數據庫 | 資料庫 | HARD-BAN | |
| 算法 | 演算法 | HARD-BAN | Scanner auto-excludes matches inside 演算法 |
| 代碼 | 程式碼 | HARD-BAN | |
| 編程 | 程式設計／寫程式 | HARD-BAN | |
| 雲計算 | 雲端運算 | HARD-BAN | |
| 默認 | 預設 | HARD-BAN | |
| 文件夾 | 資料夾 | HARD-BAN | |
| 互聯網 | 網際網路 | HARD-BAN | |
| 接口 | 介面 | HARD-BAN | Hardware port → 連接埠 |
| 優化 | 最佳化／改善 | HARD-BAN | Creeping into TW tech speech but still flagged by 支語警察 |
| 加載 | 載入 | HARD-BAN | |
| 異步 | 非同步 | HARD-BAN | |
| 數組 | 陣列 | HARD-BAN | |
| 賦值 | 指派／指定 | HARD-BAN | |
| 哈希 | 雜湊 | HARD-BAN | |
| 緩存 | 快取 | HARD-BAN | |
| 集成 | 整合 | HARD-BAN | |
| 模塊 | 模組 | HARD-BAN | |
| 全局 | 全域 | HARD-BAN | |
| 遞歸 | 遞迴 | HARD-BAN | |
| 構造函數 | 建構子 | HARD-BAN | |
| 插件 | 外掛／擴充功能 | HARD-BAN | Explicitly prohibited by WordPress TW style guide |
| 集群 | 叢集 | HARD-BAN | |
| 操作系統 | 作業系統 | HARD-BAN | |
| 驅動程序 | 驅動程式 | HARD-BAN | |
| 應用程序 | 應用程式／App | HARD-BAN | |
| 卸載 | 解除安裝／移除 | PREFER-TW | 卸載 cargo sense is legit TW but rare in tech content |
| 遍歷 | 走訪 | PREFER-TW | |
| 注釋 | 註解 | PREFER-TW | |
| 克隆 | 複製 | PREFER-TW | `git clone` stays English in code contexts |
| 點擊 | 點選／按 | PREFER-TW | |
| 實現 | 實作 | CONTEXT | Implement (code) → 實作; 實現夢想 is legit TW |
| 響應 | 回應 | CONTEXT | Respond → 回應; 響應式設計 (RWD) is the established TW term — allowed |
| 訪問 | 存取／造訪 | CONTEXT | Access (data/site) → 存取／造訪; 訪問 = interview is legit TW |
| 支持 | 支援 | CONTEXT | Tech compatibility → 支援; supporting a person/cause → 支持 is legit TW |
| 程序 | 程式 | CONTEXT | Computer program → 程式; 程序 = procedure (作業程序) is legit TW |
| 文件 | 檔案 | CONTEXT | Computer file → 檔案; paper document → 文件 is legit TW |
| 菜單 | 選單 | CONTEXT | UI menu → 選單; restaurant menu → 菜單 is legit TW |
| 窗口 | 視窗 | CONTEXT | UI window → 視窗; 聯絡窗口 (contact point) is legit TW |
| 函數 | 函式 | CONTEXT | Code function → 函式; math function → 函數 is legit TW |
| 對象 | 物件 | CONTEXT | OOP object → 物件; 對象 = target/partner is legit TW |
| 保存 | 儲存／存檔 | CONTEXT | Save a file → 儲存; preserving (保存食物) is legit TW |
| 刷新 | 重新整理 | CONTEXT | UI refresh → 重新整理; 刷新紀錄 (break a record) is legit TW |
| 設置 | 設定 | CONTEXT | Settings/configure → 設定; 設置 = to erect/install is legit TW |
| 高級 | 進階 | CONTEXT | Advanced (feature) → 進階; luxury sense is legit TW |
| 協議 | 協定 | CONTEXT | Technical protocol → 協定; human agreement → 協議 is legit TW |
| 數據 | 資料 | CONTEXT | Prefer 資料 generally; 大數據／數據分析 are established TW terms — allowed |

## C. AI / LLM terms

| 禁用 (CN) | 使用 (TW) | 嚴重度 | 備註 |
|---|---|---|---|
| 人工智能 | 人工智慧 | HARD-BAN | THE canonical TW/CN split for AI |
| 智能 | 智慧 | HARD-BAN | 智慧手機、智慧家電、生成式 AI（不是生成式人工智能） |
| 智能體 | AI 代理人 | HARD-BAN | AI agent; "AI Agent" in English is also fine |
| 神經網絡 | 神經網路 | HARD-BAN | Covered by 網絡 but listed for clarity |
| 詞元／令牌 | token | PREFER-TW | Keep English — TW AI writing does not translate "token" |
| 推理 | 推論 | CONTEXT | Model inference (serving/output) → 推論 (NVIDIA TW, TechOrange convention); logical reasoning／chain-of-thought → 推理 is correct |

## D. Mainland business buzzwords

| 禁用 (CN) | 使用 (TW) | 嚴重度 | 備註 |
|---|---|---|---|
| 賦能 | 幫助／讓…能夠 | HARD-BAN | |
| 抓手 | 切入點／著力點 | HARD-BAN | |
| 閉環 | 完整流程／循環 | HARD-BAN | |
| 底層邏輯 | 基本原理／根本邏輯 | HARD-BAN | |
| 顆粒度 | 精細度／細緻程度 | HARD-BAN | |
| 拉通 | 打通／整合 | HARD-BAN | |
| 鏈路 | 流程／環節 | HARD-BAN | |
| 私域流量 | 自有受眾 | HARD-BAN | |
| 賽道 | 領域／市場 | CONTEXT | Racing sense is legit TW |
| 護城河 | 競爭優勢 | PREFER-TW | Buffett-moat metaphor circulates in TW investing; still reads CN in business prose |
| 落地 | 執行／實施 | CONTEXT | Physical landing is legit TW; business "落地" → 執行 |
| 對齊 | 統一／協調 | CONTEXT | Text/object alignment is legit TW; business "對齊目標" → 統一目標 |
| 打造 | 建立／製作／創造 | PREFER-TW | Overused CN-flavored verb; fine occasionally, never as default |

## E. Mainland internet slang（未跨海）

| 禁用 (CN) | 使用 (TW) | 嚴重度 | 備註 |
|---|---|---|---|
| 絕絕子 | 超讚／太強了 | HARD-BAN | |
| 尊嘟假嘟 | 真的假的 | HARD-BAN | |
| YYDS | 太神了／GOAT | HARD-BAN | Recognized but reads foreign |
| 小姐姐／小哥哥 | 正妹／帥哥（或直接稱呼） | HARD-BAN | |
| 顯眼包 | 很搶戲的人／活寶 | HARD-BAN | |
| 鬆弛感 | 從容／自在 | HARD-BAN | |
| 頂流 | 頂尖／一線／最紅 | HARD-BAN | |
| 破防 | 太有感／被戳到 | SOCIAL-ONLY | Largely accepted in TW youth social usage; avoid in articles |
| 顏值 | 外貌／長相 | SOCIAL-ONLY | Accepted in casual speech; avoid in articles |
| 天花板 | 頂尖／極致 | SOCIAL-ONLY | Metaphorical "ceiling"; partially crossed over |

## F. Crossed-over allowlist（已在台灣落地 — 不要標記）

Over-banning these reads as out of touch. Rule of thumb: if mainstream TW media (天下雜誌、數位時代、INSIDE) uses the term without quotation marks, it has crossed over.

| 詞 | 使用 | 狀態 | 備註 |
|---|---|---|---|
| 躺平 | — | ALLOW | Widely used by TW media and youth; no TW equivalent |
| 內捲 | — | ALLOW | Use the traditional spelling 內捲 (not 内卷) |
| 擺爛 | — | ALLOW | TW-native or fully convergent |
| 大數據 | — | ALLOW | Established TW term |
| 數據分析 | — | ALLOW | Established TW term |
| 微調 | — | ALLOW | Fine-tuning; universal across TW/CN |
| 開源 | — | ALLOW | Open source; universal |

## G. Keep-English list（不要硬翻）

Taiwanese tech writing code-switches heavily —「用 LLM 跑 benchmark，token 數大概 4K」is natural; forcing full translations reads *less* native. Keep these in English:

token, prompt, LLM, GPT, RAG, API, SDK, CLI, benchmark, embedding, agent（技術語境）, pipeline, demo, bug, PR, repo, commit, code review, deadline, feedback, mindset, vibe, FOMO, chill

Translate conceptual/descriptive terms instead: 人工智慧, 機器學習, 深度學習, 演算法, 推論, 神經網路, 生成式 AI, 提示工程.

---

## Maintenance

New 支語 emerges constantly; crossed-over status shifts. Review quarterly:

1. **Diff against community dictionary**: [Chinese-Vocabulary-Radar `taiwan_china_vocabs.json`](https://github.com/aronhack/Chinese-Vocabulary-Radar) — 1000+ pairs, MIT/CC0, the best machine-consumable source for new entries.
2. **Watch the discourse**: search PTT and Threads for 「支語」/「支語警察」 to catch newly-irritating terms early; annually review the CN 十大流行語 list for terms entering TW discourse.
3. **Promotion/demotion rule**: term appears unquoted in mainstream TW media → move to ALLOW; term only appears with 「」or "(中國用語)" annotation → keep banned; term fills a genuine lexical gap → monitor, don't preemptively ban.

Other sources: [教育部兩岸常用詞語對照表](https://dict.concised.moe.edu.tw/appendix.jsp?ID=54), [NAER 樂詞網](https://terms.naer.edu.tw/), [中華語文知識庫](https://www.chinese-linguipedia.org/search_difference.html), [Wikibooks 兩岸計算機術語對照](https://zh.wikibooks.org/zh-tw/%E5%A4%A7%E9%99%86%E5%8F%B0%E6%B9%BE%E8%AE%A1%E7%AE%97%E6%9C%BA%E6%9C%AF%E8%AF%AD%E5%AF%B9%E7%85%A7%E8%A1%A8), [WordPress 台灣正體樣式指南](https://tw.wordpress.org/team/handbook/localization/zh-tw-localization-style-guide/).

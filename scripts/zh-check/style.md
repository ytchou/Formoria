# zh-TW Written Style Rules（長文風格規範）

Structural and mechanical rules for written Taiwan-Mandarin long-form content.

**Related files:** AI patterns → `../humanizer/zh-tw/ai-patterns.md`. Humanization goals → `../humanizer/zh-tw/humanize-goals.md`. Protection list → `../humanizer/zh-tw/protection-list.md`. Vocabulary bans → `forbidden-terms.md`. Social register → `social-voice.md`.

## 1. 歐化中文 fixes（余光中 framework）

| Pattern | Bad | Good |
|---------|-----|------|
| Passive 被 for positive events | 他的意見不被人們接受 | 大家都不接受他的意見 |
| 的 stacking (max 2 per noun phrase) | 參差的斑駁的黑影 | 參差而斑駁的黑影 |
| 進行+noun | 進行調查 / 進行研究 | 調查 / 著手研究 |
| Unnecessary pronouns | 他走進他的房間，打開他的電腦 | 走進房間，打開電腦 |
| 當...的時候 | 當你寫完稿子的時候 | 稿子寫完後 |
| 作為 overuse | 作為一個丈夫，他十分深情 | 他是個深情的丈夫 |
| 之一 padding | 名著之一 | 名著 |
| Unnecessary 地 with adverbs | 慢慢地走、小聲地說話 | 慢慢走、小聲說話 |
| 們 overuse | 醫生們、老師們 | 醫生、老師 |
| 關於/有關 padding | 討論過關於諾羅病毒的事 | 討論過諾羅病毒 |
| Abstract noun subjects | 他收入的減少改變了他的生活方式 | 他因為收入減少而改變生活方式 |
| -性 suffix inflation | 可讀性頗高 | 很好看 |
| 和 connecting verbs | 幫助和支持 | 幫助並支持 or 幫助、支持 |
| 透過 misuse | 透過研究我們發現 | 研究發現 or 從研究結果來看 |

## 2. Sentence rhythm

Max 25 characters between punctuation marks (余光中 rule). Short-short-short-long pattern. Front-load time/condition/context before the main clause. Topic-comment structure (topic first, then comment).

## 3. Data presentation

- Chinese approximate first, then precise: 「超過六成（63.2%）」
- Fraction idioms: 近三成、逾半數、不到一成、將近四分之三
- Ratio framing for impact: 「每10人中就有3人」 beats 「30%的人」
- Comparison with action verbs: 「較去年成長了近兩成」 not 「比去年增加了19.8%」
- Arabic numerals for: statistics, years, measurements, ages, money
- Chinese numerals for: approximations（數十、幾百）, ordinals in prose（第一次）, idioms（一石二鳥）

## 4. Chengyu（成語）

0–2 per article. Everyday ones only（事半功倍、一石二鳥 OK）. AI-overused chengyu to avoid: 古色古香, 跌宕起伏, 應有盡有, 無微不至, 博大精深, 源遠流長, 與時俱進, 日新月異, 獨樹一幟, 薪火相傳, 兼容並蓄, 歷久彌新. These sound like a press release.

## 5. Punctuation standard（教育部《重訂標點符號手冊》）

- Full-width marks in Chinese prose: 。，、？！：；
- Quotation: 「」single, 『』nested — never curly quotes ""
- Titles: 《書名／作品》,〈篇名／章節〉
- Parentheses: （）in Chinese text; half-width () when the content is English/code
- Dash: ——（two em-dashes）; ellipsis: ……（six dots）
- Enumeration comma 、 for list items（A、B、C）

## 6. 盤古之白 spacing

- One half-width space between Chinese and Latin text: 「使用 LLM 進行推論」not「使用LLM進行推論」
- One half-width space between Chinese and numerals: 「約 4,000 個 token」
- NO space before/after full-width punctuation
- NO extra space inside half-width parentheses: (LLM) not ( LLM )

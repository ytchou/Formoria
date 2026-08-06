/**
 * Real page evidence for the DEV-1309 site-identity eval fixtures, captured on
 * 2026-08-05 by fetching each fixture's subject URL and reading its <title>,
 * meta description, and the first ~1200 characters of body prose (h1/h2/p/li) —
 * the same three fields the production scraper hands the arbiter.
 *
 * This file is CAPTURED, not authored. Nothing here may be hand-written: the
 * eval's riskiest assumption is Han-language calibration against real Han page
 * text, and fabricated page copy would score the fixture author rather than the
 * model. A host that could not be captured carries `unscoreable` with the HTTP
 * status instead, and the harness reports those separately rather than counting
 * them as passes.
 *
 * Regenerate by re-fetching each subject URL; do not edit by hand.
 */
export type SiteIdentityCapturedEvidence = {
  title?: string
  description?: string
  story?: string
  /** The URL actually read, after redirects. Absent when the capture failed. */
  capturedFrom?: string
  /** Set when no page text could be captured — the HTTP status or transport error. */
  unscoreable?: string
}

export const SITE_IDENTITY_EVIDENCE: Record<string, SiteIdentityCapturedEvidence> = {
  "smore": {
    title: "Smore Newsletter Builder for Educators - Sign Up Free",
    description: "Create engaging newsletters with Smore's easy-to-use newsletter builder. Keep families & educators informed with customizable templates. Get started for free!",
    story: "Did you know? Smore is WCAG 2.1 AA compliant for creators and readers. Find out more. Who We’re For Solutions for Educators Solutions for Schools Solutions for Districts Features Accessibility Collaboration Newsletter Templates Resources Resource Library Case Studies The newsletter builder for schools & districts Smore users see a 28% improvement in family engagement rates on average! Whether you’re in a classroom or at the district office, Smore newsletters help you keep your audience engaged with well-designed updates you can create in minutes. Trusted by more than 1 million educators in 20,000+ schools and districts How do you want to create a newsletter? Create your own newsletters and engage your audience. Perfect for individual educators or school leaders who want to send updates to families, staff, and students. Send newsletters, with help from your team when you want it. Smore for Teams allows you to share newsletters, lists, and templates. Perfect for a group looking to strengthen family engagement together. Smore’s drag-and-drop editor makes it easy to build newsletters that include everything from videos to polls to downloadable documents. Find a template for your first ",
    capturedFrom: "https://www.smore.com/",
  },
  "kokoyun-slippers": {
    title: "微型創業鳳凰",
    story: "創業顧問諮詢 創業諮詢介紹 就業保險失業者創業協助 法規介紹 失業中高齡者及高齡者創業貸款 法規介紹 新住民創業服務需求調查表 微型創業鳳凰 微型創業鳳凰 創業顧問諮詢 創業諮詢介紹 就業保險失業者創業協助 法規介紹 失業中高齡者及高齡者創業貸款 法規介紹 新住民創業服務需求調查表 因應「微型創業鳳凰貸款」申請書調整，系統將於115/8/5 17:30進行更新。 因應「就業保險失業者創業貸款」申請書調整，系統將於115/8/5 17:30進行更新。 新版「微型創業鳳凰貸款」申請書於115年8月1日生效。 新版「就業保險失業者創業貸款」申請書於115年8月1日生效。 微型創業協助措施懶人包在此 最新消息 115-07-30 新版「微型創業鳳凰貸款」申請書於115年8月1日生效。 115-07-30 115年7月30日「微型創業鳳凰貸款要點」修正發布，並自115年8月1日施行 115-07-02 新版「就業保險失業者創業貸款」申請書於115年8月1日生效。 115-08-05 115年8月19日（星期三）下午6時30分至10時30分將進行網站維護 115-07-09 新創經營穩健起步 掌握風險管理關鍵策略 115-07-09 食安管理再升級 掌握GHP修正重點降低違規風險 115-06-15 2026創業頭家看板牆 115-06-10 115年6月10日「就業保險失業者創業協助辦法」修正發布，並自115年8月1日施行 微創楷模得獎名單 113年度微創楷模得獎名單 111年度微創楷模得獎名單 109年度微創楷模得獎名單 107年度微創楷模得獎名單 103年度微創楷模得獎名單 頒獎花絮 2024年度微創楷模頒獎典禮大合照 2022年度微創楷模頒獎典禮大合照 2020年度微創楷模頒獎典禮大合照 2018優良顧問頒獎典禮大合照 煜堂食品企業股份有限公司(稻禮) 維特魯威運動科技有限公司 入門班 【課程說明】 提供適性評量協助、創業趨勢、創業準備等準備課程。 【對象】 想創業不知從何著手 【時數】 3小時 線上報名 進階班 【課程說明】 撰寫創業計畫書、學習創業經營面、財務面、行銷面內容。 【對象】 參加過入門班/已創業者 【時數】 18小時 線上報名 精進班 【課程說明】 提供不同的主題式講座深入探討與經驗分享，提升創業功力。 【對象】 已創業並想增進不同技能者 【時數】 3小時 線上報名 就業保險失業者創業貸款 108-10-03 為失業之被保險人建構創業友善環境，創造就業機會，提供創業陪伴服務及融資信用保證專案。 微型創業鳳凰貸款 108-10-03 為提昇我國婦女、中高齡國民及離島居民勞動力參與率，發展微型企業、創造就業機會，提供創業貸款利息補貼、創業協助。 創業顧問諮詢 創業諮詢介紹 就業保險失業者創業協助 法規介紹 失業中高齡者及高齡者創業貸款 法規介紹 新住",
    capturedFrom: "https://beboss.wda.gov.tw/",
  },
  "unicorn-163": {
    title: "萌动新世界，心动一整夏！《逆水寒：新世界》暑期版本开启",
    description: "夏日炎炎，有你才甜。《逆水寒：新世界》迎来了最浪漫的一次更新！七夕特别活动甜蜜上线，等你共赴鹊桥之约。大富翁2V2双人玩法快乐出击，双人携手，赚钱我有！",
    story: "《逆水寒：新世界》预约启动，享专属外观等启程好礼！ 《逆水寒：新世界》预约启动，享专属外观等启程好礼！ 把寒妃打入冷宫吧，陛下！外面已经40℃啦！ 新闻 08 05 半价时装、绑凿礼包……逆水寒88萌趣专场等您来！ 新闻 08 04 【新时装】沁一口甜！穿上新衣，坠入马卡龙色的童话梦境 新闻 08 04 夏日清凉突袭！绝品发型【浅溪】清爽登场 新闻 08 03 把寒妃打入冷宫吧，陛下！外面已经40℃啦！ 新闻 08 05 半价时装、绑凿礼包……逆水寒88萌趣专场等您来！ 新闻 08 04 【新时装】沁一口甜！穿上新衣，坠入马卡龙色的童话梦境 新闻 08 04 夏日清凉突袭！绝品发型【浅溪】清爽登场 新闻 08 03 《逆水寒：新世界》4.1.2版本（2026年7月）更新公告 公告 07 30 《逆水寒：新世界》更新公告 公告 06 25 《逆水寒》手游3.3.4版本（2026年5月）更新公告 公告 05 28 关于《仙逆》联动外观商城界面配置错误的补偿公告 公告 02 24 400-001-8163",
    capturedFrom: "https://h.163.com/",
  },
  "lishan-fuguoyuan": {
    unscoreable: "HTTP 403",
  },
  "yuhe-dictionary": {
    title: "教育部《重編國語辭典修訂本》2021",
    description: "教育部國語辭典修訂本 字典查詢",
    story: "教育部《重編國語辭典修訂本》",
    capturedFrom: "https://dict.revised.moe.edu.tw/",
  },
  "yu-behance": {
    title: "Search Projects :: Photos, videos, logos, illustrations and branding :: Behance",
    description: "Behance is the world",
    story: "在 App Store 上下载 在 Google Play 上获取 转到 adobe.com 免费获取 Adobe Express Behance Behance 导航到 behance.net 全球 最佳创作者 齐聚 Behance 一个综合性平台，可帮助雇主和创作者发现灵感、建立联系，畅游创意世界 Most Appreciated Most Discussed 为你而设的星形图标 For You 关注心形图标 Following 最好的 Behance 图标 Behance 作品精选 Premiere Pro After Effects Substance 3D Designer Substance 3D Painter Substance 3D Sampler Substance 3D Stager Try Behance Pro Try Recruiter Pro Do not sell or share my personal information Built For Creatives Try Behance Pro Find Inspiration Sell Creative Assets Sell Freelance Services Try Recruiter Pro Graphic Designers Photographers Video Editors Web Designers Illustrators About Behance Adobe Portfolio Download the App Popular Search Terms Pinterest Pinterest Facebook Facebook Do not sell or share my personal information",
    capturedFrom: "https://www.behance.net/",
  },
  "manman-iyp": {
    title: "中華黃頁網路電話簿",
    description: "SuperhiPage中華黃頁網路電話簿擁有全台灣75萬戶工商客戶的店家資訊、優惠訊息與地圖,隨時隨地提供您生活消費與工商採購指南。不管您是要找食衣住行育樂的店家、婚喪喜慶的服務、醫療美容的諮詢、加工製造的工廠，SuperhiPage都可以滿足您生活資訊與工商媒合的需求。",
    story: "⭐2026 網紅稅怎麼報？一篇看懂課稅門檻、追溯年限與合法節稅，文末加碼會計/記帳士推薦 🍽️ 台東老字號台菜餐廳推薦｜在地人聚餐首選，經典合菜一次滿足 🔧高雄電器維修服務懶人包｜冷氣、冰箱、洗衣機專業維修 laundry 生活消費 menu_book 休閒文化 emoji_transportation 工商服務 water_ec 工業製品 stethoscope 社會服務 LIAN HONG TEA Co., Ltd. Dargon Tea Master of the Lane 鴻恒工程 / 鴻霖工程-屋屋修繕/舊屋翻新/泥作工程/磁磚舖設/抓漏防水/油漆/居家水電/居家清潔 節日總是來得比想像中快，每當曆日翻到下半年，不少人便開始想「... 為什麼濕氣問題總在交屋後才爆發 台灣氣候潮濕，尤其新成屋、裝潢... 在精密機械加工的世界裡，車床夾頭就像是機台的「萬能雙手」，負... 結構、管線與鄰損：拆除現場「最危險的 3 件事」 拆除現場常常... Facebook粉絲專頁 call 0800-080-580 mail service@chyp.com.tw SuperhiPage a]:block [&>a:hover]:text-neutral-500 [&>a]:transition-colors [&>a]:py-1.5\"> 關於我們 網站導覽 隱私權政策 服務條款 聯絡我們 登錄店家 廣告媒體 a]:block [&>a:hover]:text-neutral-500 [&>a]:transition-colors [&>a]:py-1.5\"> 線上媒體 戶外媒體 平面廣告 工商日誌 相關資訊 a]:block [&>a:hover]:text-neutral-500 [&>a]:transition-colors [&>a]:py-1.5\"> 簡訊平台 最新消息 中華電信 英文黃頁(ENG) 平面刊物索取 SuperLife 醫健快搜 中華黃頁網路電話簿刊登資訊如有錯誤或不刊登，請洽本公司 客服信箱 ，我們將提供相關協助資訊、儘速確認更正。 本網站內容及資訊僅作為使用者查詢參考，不作為交易或決策依據。",
    capturedFrom: "https://www.iyp.com.tw/",
  },
  "yuanzuo-momoshop": {
    title: "momo購物網 - 好評推薦 - 2026年8月",
    description: "momo購物網提供美妝保養、流行服飾、時尚精品、3C、數位家電、生活用品、美食旅遊票券…等數百萬件商品。快速到貨、超商取貨讓您購物最便利。mo店+商品抵用券天天搶、免運吃到飽，電視/直播商品限時下殺，每日讓您享超低價，並享有十天猶豫期；momo購物網為富邦及台灣大哥大關係企業",
    capturedFrom: "https://www.momoshop.com.tw/main/Main.jsp",
  },
  "nudream-nahoku": {
    unscoreable: "HTTP 400",
  },
  "dtbbag": {
    title: "Darker Than Black Bags",
    description: "『DarkerThanBlackBags（以下簡稱 DTBBag ）』品牌創立的初衷，單純希望『美麗有質感的設計』不只侷限於秀場或櫥窗，材質上使用『天然鞣製皮革』，期許透過每個人、每一天、每一種不同生活與習慣給予包包不同的歲月痕跡，讓「設計的人」跟「使用的人」都感到開心；DTBBag 設計上擺脫性別隔閡、簡單中性、注重細節與整體風格，這就是『DarkerThanBlackBags』。",
    story: "Hobo Bags（22） Shoulder Bag（31） Cross Body Bag（3） Small Leather Goods（2） NTD$ 16,500 起 NTD$ 9,980 起 NTD$ 13,500 起 台北中山南西店正式盛大開幕 聯絡電話：+886 953177996 週一 ～ 週五（國定假日除外）： 09：00 ～ 20：00 eMail： info@dtbbag.com © All rights reserved. Made by 可彼設計有限公司",
    capturedFrom: "https://www.dtbbag.com/",
  },
  "74ounce": {
    title: "74OUNCE BAGSMART 全家人的包",
    description: "多款男包、女包、真皮皮夾、錢包、兒童護脊書包、皮帶、配件，款式眾多人氣推薦，兼具實用與高品質，上班通勤、休閒外出、送禮自用兩相宜，90天商品免費保固，滿足全家人的包包聰明選擇-盡在74OUNCE",
    story: "輸入手機下載官方APP，購物更便利 0 購物車內目前沒有商品",
    capturedFrom: "https://www.74oz.com.tw/",
  },
  "1cmhandmake": {
    title: "一公分手作 – 一公分手作｜最豐富的袖珍黏土資訊站",
    story: "線上商店 袖珍手作 袖珍黏土材料包 認識袖珍黏土 初學者專區 使用者帳號或電子郵件地址 將會透過電子郵件傳送一個設定新密碼的連結給您. Your personal data will be used to support your experience throughout this website, to manage access to your account, and for other purposes described in our 隱私權政策 . 使用者帳號或電子郵件地址 線上商店 袖珍手作 袖珍黏土材料包 認識袖珍黏土 初學者專區 食物，是我們生活的一部分，也是我們的文化。 你是否曾留意身邊習以為常，卻富有在地特色的食物們? 跟著一公分手作，透過袖珍黏土的小小世界，尋找食物中的故事與溫度！ 袖珍古早點心組 // 製作日誌 初學者專區 , 關於工具 初學者專區 , 關於黏土 風乾土與軟陶的差異？如何在兩者間選擇？//上篇 不透明樹脂黏土（7g） NT$ 30 加入購物車 丹麥條材料包 NT$ 360 加入購物車 來包水餃囉// 給大人的黏土課VOL.4 查看內容 克林姆麵包材料包 NT$ 320 加入購物車 半透明樹脂黏土（7g） NT$ 30 加入購物車 售罄 可以開燈的冰菓室 NT$ 2,880 查看內容 謝謝老師會用不同的講解方式讓每個人都可以理解做法，下次有其他有興趣的課程，會想再次參加。 — 指尖上的新年菜 學員 老師很有耐心的示範～看似很小的作品很快就能上手！做完成品會很有成就感！ — 台式麵包三重奏 學員 追蹤一公分手作官方LINE，可以優先收到課程及活動 ✎ 版權所有 © 2026 - 一公分手作｜1cmhandmade.com",
    capturedFrom: "https://1cmhandmade.com/",
  },
  "new-buffalo": {
    title: "牛頭牌・台灣鞋 Newbuffalo",
    description: "七十載步履陪伴，最懂台灣人的腳步 從創立最初「人人有鞋穿」的樸實初心，到如今走過七十年歲月，「牛頭牌台灣鞋」始終用心守護這片土地上的每雙腳步。 七十年來，我們專注於鞋款的研發與工藝突破。從順應國人足型的專屬楦頭、精心調校的彈性材質，到每一處符合人體工學的舒適版型，我們將七十年的沉澱化為對細節的堅持，持續打造最適合台灣人穿著的極致舒適體驗。 土豆星球鞋、廚師鞋、工作用鞋等...... 每一項研發，都投入了長時間研究、測試，改良，進而開始打樣，開模、成型，生產。 每一個階段，都是我們不段努力而來的成果，現在，有足底疼痛困擾的您，可以有更好的選擇。 「土豆星球系列商品，專為足底疼痛來做設計」，「廚師鞋系列鞋款」，「工作鞋款」，您都可在這裡找到更多的選擇。 穿對鞋子，腳底就更輕鬆，心情也更愉悅了，「牛頭牌．台灣鞋」關心國人雙腳的健康。",
    story: "牛頭牌・台灣鞋 Newbuffalo Currency $ TWD $ TWD AU$ AUD $ HKD ( 0 件商品 $0 ) 購物車沒有加入任何商品 × Copyright ©2026 牛頭牌・台灣鞋 新獻股份有限公司 | 統一編號 24912772",
    capturedFrom: "https://www.newbuffalo.com.tw/",
  },
  "tipsy-farm": {
    title: "微醺農場成立於2016年，青年返鄉為家鄉注入活力與生氣，以溫室設施栽培並導入智慧化栽培模式，建構小黃瓜專業生產團隊，以共創共營的團體戰排程生產，解決各合作夥伴周年穩定的小黃瓜與季節牛番茄之需求，提升農村農業競爭力與經濟效益。 - 微醺農場",
    description: "微醺農場成立於2016年，坐落在人口僅一百人的小村莊，以生產安全無毒的果菜為己任，取得產銷履歷(TGAP)與全球優良農業規範(Global G.A.P.)認證。透過溫室設施進行小黃瓜周年度和牛番茄半年度的生產，並以縮短供應鏈的方式落實減碳運輸、產地直送各種大小餐飲業者或銷售據點的服務。我們期望透過實質的產業聚落之建立來形成共享經濟體，讓願意返鄉/留鄉/移居的青年有在地農業經營的支持系統，縮短他們的從農碰撞期與摸索期，並有效提升系統中合作團隊的競爭力與經濟效益，讓偏鄉農業能穩健經營，實踐共創、共好、共營、共榮和共享的理念，朝農業的永續發展前進。",
    story: "微醺農場/微醺農創共享基地 趕快去加入喜歡的商品吧! 採購與合作 生鮮產品(大量、長期配合請內洽 0921341626，line ID: p789426) 果菜商業合作(大量、長期配合請內洽 0921341626，line ID: p789426)",
    capturedFrom: "https://www.whfarm.com.tw/index",
  },
  "immugoat": {
    title: "乙木羊鮮羊奶-台灣生態循環鮮羊奶",
    description: "來自彰化埔心35年的乳羊牧場 『台灣生態循環鮮羊奶』從牧場直接到您手上，透明純淨喝的安心！ 「乙木」代表五行中的「草」，柔軟堅韌的特質，象徵農家腳踏實地、不屈不饒的精神。 乙木羊意謂『吃牧草的羊』，羊隻天天吃著自家栽種、純淨無汙染的新鮮牧草，進而生產出高品質鮮羊乳。 「羊吃得好，人才吃得好」從一片綠草原開始的初心，也守護著消費者的健康美好。 #台灣羊升級計畫 #純淨好喝鮮羊奶",
    story: "{{ 'fb_in_app_browser_popup.desc' | translate }} {{ 'fb_in_app_browser_popup.copy_link' | translate }} {{ 'in_app_browser_popup.desc' | translate }} {{word('consent_desc')}} {{word('read_more')}} {{word('consent_desc')}} {{word('read_more')}} {{setting.description}} 繁體中文 English 滿額優惠｜$1200免運 {{ childProduct.title_translations | translateModel }} {{ getChildVariationShorthand(childProduct.child_variation) }} {{ getSelectedItemDetail(selectedChildProduct, item).childProductName }} x {{ selectedChildProduct.quantity || 1 }} {{ getSelectedItemDetail(selectedChildProduct, item).childVariationName }} 來自彰化埔心35年的乳羊牧場 「乙木」代表五行中的「草」， 柔軟堅韌的特質，象徵農家腳踏實地、不屈不饒的精神。 乙木羊意謂『吃牧草的羊』，羊隻天天吃著自家栽種、純淨無汙染的新鮮牧草，進而生產出高品質鮮羊乳。 「羊吃得好，人才吃得好」從一片綠草原開始的初心，也守護著消費者的健康美好。 『台灣第一瓶生態循環的鮮羊奶』 從牧場直接到您手上，透明純淨喝的安心！ #台灣羊升級計畫 #純淨好喝鮮羊奶 0988-154-916 營業時間 9 : 00 ~ 18 : 00 客服信箱 immugoat@gmail.com 榮總門市｜台中市西屯區台灣大道四段1650號-台中榮總門診大樓二樓 基地：臺中市南區永和里五權南一路23號 牧場：彰化縣埔心鄉南昌南路112號",
    capturedFrom: "https://www.immugoat.com/",
  },
  "jaibei": {
    title: "恆瑞亞實業有限公司",
    description: "恆瑞亞實業有限公司於牙刷製作上擁有35年技術與經驗， 與各大教學醫院牙科部、牙醫診所長期合作 為提供國人更優質的產品與服務， 2024年投創新品牌-Jaibei 佳貝牙刷口腔清潔產品。",
    story: "恆瑞亞實業有限公司(佳貝牙刷） 產品介紹 佳貝牙刷 成人系列 恆瑞亞實業有限公司於牙刷製作上擁有35年技術與經驗， 與各大教學醫院牙科部、牙醫診所長期合作 為提供國人更優質的產品與服務，2024年投創新品牌- Jaibei 佳貝牙刷口腔清潔產品 ☎️ 02-2915-0081 ☎️ 02-2915-0083 地址 231新北市新店區寶橋路235巷16弄2號3樓 EMAIL jaibei0168@gmail.com jaibei0168@gmail.com https://lin.ee/7IRxmDY https://www.facebook.com/p/%E4%BD%B3%E8%B2%9D%E7%89%99%E5%88%B7-61559628433653/ jaibei0168@gmail.com https://lin.ee/7IRxmDY https://www.facebook.com/p/%E4%BD%B3%E8%B2%9D%E7%89%99%E5%88%B7-61559628433653/ 產品介紹 佳貝牙刷 成人系列 jaibei0168@gmail.com https://lin.ee/7IRxmDY https://www.facebook.com/p/%E4%BD%B3%E8%B2%9D%E7%89%99%E5%88%B7-61559628433653/",
    capturedFrom: "https://www.jaibei.com.tw/",
  },
  "1koshijimi": {
    title: "壹顆蜆",
    story: "．堅持以自然生態海水養殖方式 ．秉持著 堅持品質 與 永續思維 ．讓日本黑蜆沒有土味跟腥味 ．養出台灣人也能吃到的日本種黑蜆 『 引進日本的養生之道-大和黑蜆 』 我是楊宏達，在彰化海口深耕40年。 我熱愛這片土地， 一直堅持著優質水產品的理念 我與家人都秉持職人精神相信 堅持品質 與 永續思維 能讓彰化沿海的漁業有了更好的未來， 讓周遭的生態環境受益， 也讓彰化沿海的水產品更加豐富。 壹顆蜆，不僅是壹顆美味的蜆， 更是這片土地上最普普通通的人們， 所共同支持的信仰。 特價 加入購物車 【巨大大蝦！季節限定】海水混養草蝦 (600g/盒) - 【巨大大蝦！季節限定】海水混養草蝦 (600g/盒) 數量 + 加入購物車 特價 加入購物車 【巨蝦！季節限定】海水混養草蝦 (600g/盒) - 【巨蝦！季節限定】海水混養草蝦 (600g/盒) 數量 + 加入購物車 特價 加入購物車 7/20出貨 黃金比例蛤蜊（600克/包） - 7/20出貨 黃金比例蛤蜊（600克/包） 數量 + 加入購物車 加入購物車 冷藏文蛤特惠8入組 $1272元 - 冷藏文蛤特惠8入組 $1272元 數量 + 加入購物車 特價 加入購物車 文蛤真空包 - 文蛤真空包 數量 + 加入購物車 特價 加入購物車 甕滴 大和黑蜆精 - 甕滴 大和黑蜆精 數量 + 加入購物車 特價 加入購物車 黑蜆真空包（冷凍出貨） - 黑蜆真空包（冷凍出貨） 數量 + 加入購物車 特價 選擇規格 黑蜆魚薯薯(原味/辣味) 選擇規格 此產品有多種款式。 可在產品頁面選擇選項 每一顆黑蜆都大粒又飽滿唷！",
    capturedFrom: "https://1koshijimi.com.tw/",
  },
  "cucumber": {
    title: "master",
    description: "廣源良堅持植萃精華–絲瓜水（菜瓜水）、絲瓜籽、蘆薈、小黃瓜、綠豆薏仁、秋葵、植萃面膜、綠食防曬、噴霧水、保濕、精華液、清潔卸妝等的天然保養肌膚新主張。",
    story: "NEW!!!【 日本上市。台灣絲瓜水正式進駐日本官網 】 誠品expoBEAUTY專訪 〈島嶼上的一抹浪漫〉 廣源良跟上直播趨勢！上商業周刊報導了 三立新聞採訪，38年本土老牌廣源良成新秀！ 龍耀媽祖祭！攜手『大甲鎮瀾宮』成為肌膚的守護神 洗沐品牌「HAIR FACE」誕生！細心呵護您的肌膚！ 換季敏感知多少⁉️點擊查看敏弱肌保養祕訣 美人圈專欄 7款開架「保濕精華液」評比推薦！ 榮獲國際天然認證 直擊廣源良活動花絮 【會員獨享】壽星領取生日禮 New！夏日新體感「蘆薈涼感保濕噴霧」冰涼上市 經典絲瓜系列 蘆薈滋潤系列 小黃瓜舒敏系列 綠豆薏仁亮白系列 絲瓜籽修護系列 秋葵凍齡系列 植萃面膜系列 綠食防曬系列 噴霧水系列 冰鎮保養系列 頭皮賦活 清潔卸妝 化妝水 精華液 乳液/乳霜 面膜 防曬 凝膠類 眼霜 護手霜 身體乳 特殊護理 特惠組合 送禮專區 油性肌膚 乾性肌膚 混合肌膚 敏感肌膚 頭皮",
    capturedFrom: "https://www.cucumber.com.tw/ec/tw/",
  },
  "shunyun-tea": {
    title: "福壽山順韻茶葉-父親節感恩獻禮",
    description: "今年父親節，就用好茶為爸爸獻上祝福！來自大梨山茶區的頂級好茶，現在全館特價滿斤就享88折，滿額還有精美茶具等超值好禮。獨家專享加價購優惠，用最划算的價格、送最精緻的禮。",
    story: "{{ 'fb_in_app_browser_popup.desc' | translate }} {{ 'fb_in_app_browser_popup.copy_link' | translate }} {{ 'in_app_browser_popup.desc' | translate }} {{word('consent_desc')}} {{word('read_more')}} {{word('consent_desc')}} {{word('read_more')}} {{setting.description}} 繁體中文 English 農藥檢驗證明 政府產地認證 {{ childProduct.title_translations | translateModel }} {{ getChildVariationShorthand(childProduct.child_variation) }} {{ getSelectedItemDetail(selectedChildProduct, item).childProductName }} x {{ selectedChildProduct.quantity || 1 }} {{ getSelectedItemDetail(selectedChildProduct, item).childVariationName }} 農藥檢驗證明 政府產地認證 🎖️梨山茶產地證明標章 {{ childProduct.title_translations | translateModel }} {{ getChildVariationShorthand(childProduct.child_variation) }} {{ getSelectedItemDetail(selectedChildProduct, item).childProductName }} x {{ selectedChildProduct.quantity || 1 }} {{ getSelectedItemDetail(selectedChildProduct, item).childVariationName }} 訂購流程 付款&運送服務方式 退換貨說明 隱私權條款 專人服務時間 週一至週五 9:00~17:00 LINE: @good.tea gathergoodtea@gmail.com 04-23725017 台中市和平區梨山里中正路37號 2021 &copy;順韻茶業有限公司 統編：91062790",
    capturedFrom: "https://www.shunyuntea.com/",
  },
  "mazupu": {
    title: "首頁",
    story: "經 典 滋 味 ， 一 個 你 無 法 忘 懷 的 傳 統 在 地 好 味 道 。 經 典 滋 味 ， 一 個 你 無 法 忘 懷 的 傳 統 在 地 好 味 道 。 創新&傳統結合。 民國九十九年由第二代慢慢接手經營， 改名媽祖埔豆腐張，堅持傳承的傳統工法與積極研發產品口味， 我們將傳統臭豆腐好滋味與新食材結合， 嚴格把關食材之選用， 永續經營與創新傳承媽祖埔豆腐張。 民國九十九年由第二代慢慢接手經營， 堅持傳承的傳統工法與積極研發產品口味， 我們將傳統臭豆腐好滋味與新食材結合， 永續經營與創新傳承媽祖埔豆腐張。 媽祖埔非常注重飲食衛生與安全， 客人絕對吃得出來的安心， 炸出來的臭豆腐才會好吃! 這幾年，我們熟悉的媽祖埔臭豆腐 竟然已經成了一種品牌了呢！ 由老闆的小孩在雲林虎尾傳承著這道家鄉味， 如果你來訪雲林東勢想順道品嘗， 記得要拉長耳朵、聽音辨位， 追著這台唱著葉啟田老歌又飄忽不定的小發財， 這是陪了我們三十年的家鄉味。 媽祖埔非常注重飲食衛生與安全， 客人絕對吃得出來的安心， 炸出來的臭豆腐才會好吃! 傳說中在地的家鄉味!這幾年， 我們熟悉的媽祖埔臭豆腐竟然已經成了一種品牌了呢！ 由老闆的小孩在雲林虎尾傳承著這道家鄉味， 如果你來訪雲林東勢想順道品嘗， 記得要拉長耳朵、聽音辨位， 追著這台唱著葉啟田老歌又飄忽不定的小發財， 這是陪了我們三十年的家鄉味。 媽祖埔豆腐張 國際出貨記錄 本店食材皆嚴選優良品質、符合衛生法規，請安心食用。 1991年 - 創立品牌，以餐車兜售。 2012年 - 開立虎尾直營門市。 2018年 - 建立官網與各大網路商城通路。 2018年 - 店面大改造，品牌形象建立。 2018年 - 雲林縣地方型 sbir計畫輔導廠商。 2018年 - 參展高雄國際美食展。 2019年 - 麻辣傳說與貿易商合作，銷往北美市場。 2019年 - 商品進駐台北微風南山都會生活館。 2019年 - 參展上海一帶一路國際食品展。 2020年 - 日本樂天，開通進軍日本市場。 2021年 - 榮獲經濟部商業司評選為美食特色餐廳。 2022年 - 雲林縣政府頒發SBIR年度榮譽獎 2023年 - 經濟部商業司評選為台灣好食 2024年 - 雲林縣政府頒發SBIR年度榮譽獎 1991年 - 創立品牌，以餐車兜售。 2012年 - 開立虎尾直營門市。 2018年 - 建立官網與各大網路商城通路。 2018年 - 店面大改造，品牌形象建立。 2018年 - 雲林縣地方型 sbir計畫輔導廠商。 2018年 - 參展高雄國際美食展。 2019年 - 麻辣傳說與貿易商合作，銷往北美市場。 2019年 - 商品進駐台北微風南山都會生活館。 2019年 - 參展上海一帶一路國際食品展。 2020年 - 日本樂天，開通進軍日本市場。 2021年 - 榮獲經濟部商業司",
    capturedFrom: "https://www.mzp1991.com/",
  },
  "daughter-tea": {
    title: "女兒不懂茶-紅烏龍專賣店",
    description: "妳的師傅，是茶爸爸跟我說，在茶面前，請保持謙卑。女兒不懂茶品牌誕生於2019年台東鹿野，堅持永續生態與大自然共存的理念，推廣在地飲茶文化，持續創造新的觀點，除了茶空間的體驗服務外一直有客人在詢問茶園體驗導覽的行程因此我們整理了幾個方案希望來到台東鹿野的你，不只喝到紅烏龍也能在茶園中，循著職人茶農的帶領您走訪鹿野紅烏龍之旅吧。",
    story: "所有商品 + - 精選組合 關於女兒不懂茶 + - 關於品牌 女兒創作 + - 手繪Q&A 所有商品 arrow down 精選組合 關於女兒不懂茶 arrow down 關於品牌 女兒創作 arrow down 手繪Q&A 您的好友送您 回饋金！立即註冊領取。 您的好友送您 回饋金！立即註冊領取。 鹿野本店限定【品茗體驗】時光封存｜自己與未來的一場茶香對話 NT$ 1,500.00 鹿野本店限定【品茗體驗】茶香漫步｜擁抱自然與茶香的品茗時光 三角立體原葉－紅烏龍品味茶包 經典風味-紅烏龍三角立體隨手茶包 從 NT$ 210.00 起 果香風味-紅烏龍三角立體隨手茶包 從 NT$ 230.00 起 炭焙風味-紅烏龍三角立體隨手茶包 從 NT$ 230.00 起 果酸風味-紅烏龍三角立體隨手茶包 從 NT$ 260.00 起 花香風味-紅烏龍三角立體隨手茶包 從 NT$ 260.00 起 【五包綜合優惠組】經典＋果香+炭焙+果酸＋花香風味茶包 NT$ 1,000.00 NT$ 1,190.00 -16% 預購商品【中秋禮】鹿野紅鳳梨酥＋三款風味紅烏龍茶包禮盒 NT$ 760.00 NT$ 780.00 -2.6% 【茶禮】四款風味紅烏龍茶包綜合禮-附提袋 【季節限定】戶外野餐時光－野餐籃與茶葉組 NT$ 1,920.00 NT$ 2,280.00 -15.8% 【季節限定】戶外野餐時光－野餐籃與茶包組 【五款風味綜合組】各8公克紅烏龍原葉茶 - 嚐鮮組 從 NT$ 680.00 起 縱谷間的茶・經典有機紅烏龍 NT$ 750.00 NT$ 890.00 -15.7% 果樹下的茶・果香有機紅烏龍 NT$ 800.00 NT$ 980.00 -18.4% 營火旁的茶・炭焙有機紅烏龍 NT$ 800.00 NT$ 980.00 -18.4% 野溪邊的茶・果酸有機紅烏龍 NT$ 850.00 NT$ 1,020.00 -16.7% 花園裡的茶・花香有機紅烏龍 花火釀的茶・蜜香有機紅烏龍 © 2026 女兒不懂茶 icon-facebook Facebook icon-instagram Instagram icon-youtube YouTube icon-line Line American Express 服務條款 | 隱私政策 | 退款政策",
    capturedFrom: "https://www.daughter-tea.com/",
  },
  "kajitsu": {
    title: "菓實日 | 用純粹的心意來製作一盒包含森林的餅乾",
    description: "菓實日是一個以在地文化為核心的法式甜點品牌。我們深深喜愛的台灣山林特有種動物，轉化成為一片片慢工製作的餅乾，帶著天然食材的香氣與酥脆的口感，不分年齡可以一起品嚐的好味道。",
    story: "{{ 'fb_in_app_browser_popup.desc' | translate }} {{ 'fb_in_app_browser_popup.copy_link' | translate }} {{ 'in_app_browser_popup.desc' | translate }} {{word('consent_desc')}} {{word('read_more')}} {{word('consent_desc')}} {{word('read_more')}} {{setting.description}} 桃園高鐵站門市(靠近2號出口) 營業時間09:00~19:30 {{ childProduct.title_translations | translateModel }} {{ getChildVariationShorthand(childProduct.child_variation) }} {{ getSelectedItemDetail(selectedChildProduct, item).childProductName }} x {{ selectedChildProduct.quantity || 1 }} {{ getSelectedItemDetail(selectedChildProduct, item).childVariationName }} 客服時間：09:00-17:00 (週二到五) 電話：02-23055663 信箱： service@kajitsu.com.tw 地址：台北市萬華區德昌街10巷12號 (生產製作空間不對外開放) 營業人名稱：實品實業股份有限公司 A-124972530-00001-1 產品皆已投保富邦產險產品責任險 Copyright&copy; 實品實業股份有限公司",
    capturedFrom: "https://www.kajitsu.com.tw/",
  },
  "yuyu-tea": {
    title: "郁郁 YùYù",
    description: "與氣味有關的｜郁郁YùYù 以獨特視角的茶日常，透過不同業種角度，跨界呈現茶的更多可能！ 【茶品的花香氣】 將在地花朵香氣以古法工藝製程，保留至台灣茶中，呈現新傳統風味！！ 【關於土地上的氣味】 ｜茶韻擴香｜ 以經典台灣茶為發想，嗅覺呈現《我眼裡的茶香氣》 ｜山韻擴香｜ 以台灣木精油為基底，調配勾勒山林的氣味回憶《哪些我們走過的山林》",
    story: "( 0 件商品 $0 ) 購物車沒有加入任何商品 × Copyright ©2026 郁郁YùYù 郁郁有限公司/島序有限公司 | 統一編號 93776294/62229304",
    capturedFrom: "https://www.yuyuteadaily.com/",
  },
  "pangscent": {
    title: "雱 PĀNG - 台灣靈魂 無性別香氛 | 共創嗅覺與視覺的感官藝術 | Taiwanese Soul, Gender-Free Fragrance | Creating Sensory Art through Scent and Vision",
    description: "雱 PĀNG，臺灣獨立無性別香氛品牌。以台灣風土地景為靈感，獨立調配淡香精、空間織品噴霧、信封香氛袋與薰香油等產品。嗅覺創作結合視覺藝術，為生活注入個性與文化厚度。香材符合歐盟 IFRA 標準、全純素配方，通過 SGS 檢驗並投保產品責任險。",
    story: "淡香精 Eau de Parfum 空間除臭香氛噴霧 Deodorising Room & Fabric Spray 菱炭線香 BIOCHAR INCENSE 護手精華霜 HAND SERUM CREAM 空間織品香氛噴霧 ROOM & FABRIC SPRAY 信封香氛袋 SCENTED ENVELOPE 複方薰香油 OIL BURNER BLEND 胺基酸潔膚露 AMINO ACID HAND & BODY WASH 拉拉紅玉 Lala Ruby 淡香精 EDP，雱 PĀNG 全新香氣，2026 台灣文博會正式首發。拉拉山水蜜桃、日月潭紅玉紅茶與五月玫瑰交織，一場屬於台灣風土的慢步旅程。 茶蕨 Fern Murmur 淡香精 EDP，雱 PĀNG 全新香氣，2026 台灣文博會正式首發。青蕨、金萱烏龍與皮革交織，獻給在自然中尋找深邃力量的你。 獨我 Solitude 淡香精 Eau de Parfum，雱 PĀNG 全新香氣，2026 台灣文博會正式首發。皂香、粉紅胡椒、鳶尾木蘭與白麝香交織，獻給選擇與自己對話的你。 雱 PĀNG 首度參展 CREATIVE EXPO TAIWAN 2026 臺灣文博會，在新銳品牌文創風格 S-007攤位。現在三款全新淡香精首發 — 獨我、茶蕨、拉拉紅玉，南港展會展期專屬優惠，8月6日至12日台北南港展覽館1館S區，立即上文博網站預約免排隊入場！ 雱共共國際有限公司 PANG GONG GONG CO., LTD. 統一編號 00196768 +886-7-9715750 info@pangscent.com 高雄市前鎮區新衙路288-6號四樓之一（Reserved Only）Working Hours：10am - 6pm 為了讓您有更好的網站使用體驗，我們會使用一些稱為「Cookie」的小檔案來記住您的偏好設定、分析網站使用情況，並提供適合您的內容。您可以選擇要使用哪些功能。 確保網站基本功能正常運作，例如：登入狀態、購物車內容、安全防護等。 了解訪客如何使用網站，例如：最受歡迎的頁面、停留時間、點擊行為等。 根據您的瀏覽習慣顯示相關的廣告和產品推薦。 記住您的個人偏好，例如：語言選擇、字體大小、主題顏色等。",
    capturedFrom: "https://www.pangscent.com/",
  },
}

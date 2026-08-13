# must-not-break

Cases the linter MUST NOT flag. A linter that over-fires gets switched off,
so this file matters as much as should-fix.md. `--selftest` asserts each case
produces zero findings, minus the rules listed in `ignore:` — which is only
ever used for document-shape rules a fixture is too small to satisfy.

## case: proper-noun-contains-banned-substring
expect: none
note: a shop actually named 「…們」, plus two Mainland platforms named as the
subject of the sentence rather than used as vocabulary.

````
《朋友們選物所》是台南的一間小店，店主把貨架分成三區，最靠門口那一區只放能修的東西。這個名字在招牌上掛了十二年，不是誰替它加上去的稱呼。她也常看別人在「小紅書」跟「公眾號」上怎麼拍同一批貨，看完通常就把手機關掉，回頭繼續擦架子。
````

## case: honorific-inside-quoted-example
expect: none
note: quoted customer-service copy is the author's material, not the author's
prose.

````
去年後台收到一封信，開頭寫著「您好，想問這款陶杯還有沒有貨」，客服照著範本回了「您好，感謝您的來信」。這種公文腔在客服信箱裡還算合理，放進文章裡讀者卻會立刻退開，所以我把它留在引號裡當材料，自己寫的時候一律用你。
````

## case: pattern-mentioned-not-used
expect: none
note: the sentence discusses 『不是A而是B』 and must not be flagged for
containing it.

````
我最近盡量不寫『不是A，而是B』這種句型，因為它讀起來太順，順到讓人懷疑句子後面沒有東西撐著。編輯給的建議很簡單：把對比拆成兩句，前一句擺事實，後一句擺結果，中間不要放轉折詞去撐場面。
````

## case: numeric-range-dashes
expect: none
note: en dash between digits, and an em dash between digits — both are
typography, not connectors.

````
展期是 8/6–8/12，地點在花博公園爭艷館，週五延長到晚上八點。館內那面年表牆從 1939—1945 一路排到今年，字很小，站近一點才看得完。想避開人潮就挑週四下午三點到五點，攤位主人比較有空跟你講完一整段話。
````

## case: single-legitimate-contrast
expect: none
note: exactly one 「不是…而是…」 in an article is human.

````
她說這批杯子不是為了展覽做的，而是店裡本來就要補的貨。展期剛好撞上，就順手擺了出來。這種順序在小品牌很常見，先有要做的事，展覽只是把它擺到別人看得見的地方，順便省下一筆拍照費。
````

## case: fenced-code-block-is-not-prose
expect: none
ignore: paragraph-length
note: the fenced block holds 您 and ——; both must be stripped before analysis.

````
下面這段是寄給品牌的信件範本，貼在這裡只是給編輯看格式，不算文章正文，也不該被當成內文檢查。

```text
您好——這是一封範本信——請勿直接沿用。
```

範本裡那些破折號跟敬稱是刻意留著的，信件語氣本來就跟文章不同，改掉反而會讓收信人覺得唐突。
````

## case: exactly-two-de
expect: none
note: at the threshold, not over it.

````
這是一款用苗栗土燒的手工陶碗，碗口比一般的飯碗寬一些，端起來剛好貼合掌心。窯主說形狀是為了讓熱湯散得快，不用等太久就能入口，冬天在家吃麵的時候差別最明顯。
````

## case: exclamation-in-heading
expect: none
ignore: paragraph-length
note: headings may exclaim; body prose may not.

````
## 來看看吧！

展場的動線今年改了，從南側進場的人會先遇到食品區，這件事在官方地圖上看不出來。想直接看陶瓷就從北側門進去，可以少走十分鐘，體力也留得比較多。
````

## case: link-text-is-prose-target-is-not
expect: none
note: 織療室 must count as prose; the slug must not be linted or counted.

````
[織療室](/brands/ziliaoshi) 的店主自己改了一台舊烘乾機，把溫度壓在攝氏四十度以下，說是為了讓布不縮水。這件事她講得很快，好像人人都會，但整條街只有她一個人這樣做，別家寧可送去外面烘。
````

## case: pronoun-plurals-and-idiomatic-men
expect: none
note: 我們 / 他們 / 人們 are not the 們 tell.

````
我們去的那天是週四，他們說週末人潮是平日三倍，人們通常在下午兩點以後才進場。她們兩個顧攤的年輕人輪流吃飯，中間那段時間攤位上只剩一張手寫的紙條，寫著十分鐘後回來。
````

## case: nav-only-link-line
expect: none
note: a category CTA line is navigation, not a paragraph.

````
[瀏覽本站全部工藝文創品牌](/brands?category=craft) →
````

## case: price-and-stock-as-deferral
expect: none
note: naming price and stock in order to hand them to the brand is the CORRECT form; only an asserted claim is a violation.

````
價格與庫存以品牌官方頁面為準，這裡不做即時同步。想確認尺寸，官方商品頁上有完整規格表，比我在這裡轉述可靠。展場現貨也常常和線上不一樣，同一款可能只帶了兩三件過來，賣完就沒有了。真的想要某個顏色，先問攤主還有沒有，不要等到最後一天再回頭找。
````

## case: quoted-superlative-from-a-source
expect: none
note: a superlative inside 「」 is the source's wording, not ours — the protection list governs.

````
攤主說「這是我做過最好的一批」，講這句話時她正在擦第三個杯子，手沒有停。我沒辦法查證這句話，也不打算幫她背書，只能說那批確實只有十二件，杯口的厚度比架上其他款薄一些。她說薄到這個程度，十件裡會破兩件，所以平常不做。
````

## case: era-phrase-mid-paragraph
expect: none
note: only the opening sentence is the tell; a transition using the same words is ordinary prose.

````
她從二〇一四年開始接單，做的是修補。近年來，送修件數比新做的還多，這件事她自己也沒預料到，工作室後面那排等著補的碗已經堆到第三層。客人送來的多半不貴，一只兩三百塊日用碗，修起來工錢常常超過原價。她照修，理由是那只碗通常有名字，是誰買的、誰摔的，說得出來。
````

## case: real-uncertainty-not-a-confession-hook
expect: none
note: genuine uncertainty stated mid-paragraph reports something; only the manufactured opener is banned.

````
這批釉在不同窯次差很多，我看了三次，每次顏色都不太一樣。老實說我到現在還分不出來哪一窯算成功，攤主說她也還在調，配方本上記到第四十七號。她讓我看那本簿子，每一頁都有一小塊試片黏在旁邊，顏色從灰綠一路走到接近土黃，中間有七八頁被劃掉。
````

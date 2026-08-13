# should-fix

Cases the linter MUST flag. Format is documented at the top of check.py:
a `## case:` heading, an `expect:` rule id, then the input in a four-backtick
fence. `--selftest` asserts the expected rule appears in the findings; other
findings on the same fixture are allowed and ignored.

## case: not-a-but-b-second-occurrence
expect: not-a-but-b
note: one contrast is human; the second is the tell, so the fixture has two.

````
這不是策展篩選，而是資格審查。要進來的品牌得先證明自己真的在做東西，這一關卡掉的比想像中多。這不只是形式，而是門檻，過不了的人連報名頁都看不到。
````

## case: not-a-but-b-bujin-geng
expect: not-a-but-b
note: 「不僅…更…」 is the same construction wearing a different coat.

````
這條產線不是為了展覽而開的，而是為了消化去年的庫存。它不僅解決了倉儲，更讓工班在淡季有事可做，聽起來漂亮，實際上是被逼出來的。
````

## case: honorific-nin
expect: honorific-nin

````
邀請您一同前往展區探索，現場有三十個攤位，每個攤位都有人可以問。
````

## case: nominalization
expect: nominalization

````
品牌自己進行了技術開發，作出了改良，最後在窯溫上實現了穩定。
````

## case: formulaic-closing
expect: formulaic-closing

````
總的來說，這次展覽值得一提的是它的多樣性，從陶瓷到織品都有人在做。
````

## case: plural-men
expect: plural-men

````
這些品牌們都很用心，設計師們也把細節做到位，創作者們在現場輪流顧攤。
````

## case: em-dash-density
expect: em-dash-density
note: two dash runs in a 35-character fixture — far over one per 500 字.

````
他們自己弄了一套技術——就為了不讓邊緣積水——這件事聽起來很小。
````

## case: de-density
expect: de-density

````
這是一個非常有質感的台灣品牌的手工陶瓷的生活道具。
````

## case: three-part-parallel
expect: three-part-parallel

````
讀懂、拆解、生成，三個步驟缺一不可。
````

## case: exclamation
expect: exclamation

````
想找到屬於你的特別風格嗎？來這裡準沒錯！
````

## case: paragraph-length-short
expect: paragraph-length
note: about 30 CJK characters standing alone — a sentence pretending to be a
段落.

````
展場今年改了動線，從南側進去會先碰到食品區，陶瓷被排到最後面。
````

## case: paragraph-length-long
expect: paragraph-length
note: one unbroken block over 220 字.

````
展場今年改了動線，從南側進去的人會先碰到食品區，陶瓷區被排到最後面，這件事在官方地圖上完全看不出來，因為地圖是照攤位編號畫的而不是照人走路的順序畫的，所以第一次來的人幾乎都會在食品區耗掉半小時，等走到陶瓷區的時候體力已經用掉一半，攤位主人說下午三點以後客人的問題會變得很短，多半只剩下多少錢跟能不能宅配這兩句，而上午來的人會問土是哪裡挖的、窯燒幾度、為什麼碗口要留一圈沒有釉，這些問題他們很願意回答但下午幾乎沒有人問，所以如果你真的想聽故事就早一點到，不要照著地圖的順序走，直接往北側門進去，先把最想看的攤位看完再回頭逛食品區，這樣一整天的體力分配才會合理一點。
````

## case: formoria-early
expect: formoria-early

````
展場今年改了動線，從南側進去會先碰到食品區。Formoria 在開展前一週去走過一次，把幾個容易錯過的攤位記了下來，這篇就是那份筆記整理出來的版本。
````

## case: formoria-count
expect: formoria-count
note: four mentions in one article, all after the opening window.

````
展場今年改了動線，從南側進去的人會先碰到食品區，陶瓷區被排到最後面，這件事在官方地圖上完全看不出來，因為地圖是照攤位編號畫的，而不是照人走路的順序畫的。第一次來的人幾乎都會在食品區耗掉半小時，等走到陶瓷區的時候，體力已經用掉一半。

Formoria 在開展前一週去走過一次。Formoria 的做法是先問攤主土是哪裡挖的。Formoria 也順手記了幾個容易錯過的攤位。Formoria 把那份筆記整理成了這篇文章，供你在現場對照著看。
````

## case: sentence-monotony
expect: sentence-monotony
note: three consecutive sentences of nearly identical length.

````
展場今年改了動線南側進去先碰到食品區陶瓷被排到後面。地圖是照攤位編號畫的不是照人走路順序畫的很難看懂。第一次來的人多半在食品區耗掉半小時才走到後面。
````

## case: honorific-nin-in-body-prose
expect: honorific-nin
note: 敬稱 buried mid-paragraph, not in the opening greeting position.

````
攤主說她最怕客人客氣，因為一旦開始說請您慢慢看，對話就結束了，剩下的時間兩個人只會站在原地看杯子。
````

## case: nominalization-yuyi
expect: nominalization
note: 予以 / 加以 are the stiffest members of the family.

````
對於這些反覆出現的問題，主辦單位表示會予以檢討，也會加以改善，明年的動線圖會重畫。
````

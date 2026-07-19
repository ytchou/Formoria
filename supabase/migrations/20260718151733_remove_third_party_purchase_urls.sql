-- DEV-1083 + DEV-1089: remove third-party pages from the direct-purchase field.
-- No verified first-party replacement is stored for these brands, so leaving the
-- field empty is safer than presenting an aggregator, article, or social profile
-- as the brand's storefront.

UPDATE public.brands
SET purchase_website = NULL
WHERE status = 'approved'
  AND lower(
    split_part(
      regexp_replace(purchase_website, '^https?://', '', 'i'),
      '/',
      1
    )
  ) = ANY (ARRAY[
    'apisc.atri.org.tw',
    'biggo.com.tw',
    'biggo.hk',
    'birusay.com',
    'buy.line.me',
    'cdn-news.org',
    'earthingway.waca.ec',
    'fanfan-select.pixnet.net',
    'fgblog.fashionguide.com.tw',
    'foo67d.pixnet.net',
    'giftshop-tw.line.me',
    'hamuhamu100.pixnet.net',
    'minimedusa.pixnet.net',
    'mq2.tw',
    'n.yam.com',
    'news.videoland.com.tw',
    'newsinsightpress.com',
    'online.uni-prosperity.com.tw',
    'penguinma.com',
    'portaly.cc',
    'recedeheart7.pixnet.net',
    'rita11836.pixnet.net',
    'searchingc.com',
    'shaoye07.pixnet.net',
    'tw.bid.yahoo.com',
    'tw.buy.yahoo.com',
    'twbuystore.com',
    'vocus.cc',
    'www.afasale.tw',
    'www.books.com.tw',
    'www.breezeonline.com',
    'www.citiesocial.com',
    'www.cool-style.com.tw',
    'www.dcard.tw',
    'www.douyin.com',
    'www.elle.com',
    'www.findprice.com.tw',
    'www.gtbg.com.tw',
    'www.lbj.tw',
    'www.momoshop.com.tw',
    'www.niusnews.com',
    'www.sohu.com',
    'www.taipeicdd.taipei',
    'www.threads.net',
    'www.tw.coupang.com',
    'www.vk123.me',
    'www.zhihu.com'
  ]::text[]);

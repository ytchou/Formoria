/**
 * Every label and tag string of the detect user message
 * (`category-classifier.ts#renderDetectUserMessage`). The Jev eval parser
 * (`jev.ts#JEV_INPUT_LABELS`) reuses these, so the production renderer and the
 * eval parser cannot drift apart.
 */
export const DETECT_MESSAGE_LABELS = {
  brandSlug: "品牌 slug",
  brandName: "品牌名稱",
  description: "描述",
  /** The brand's purchase website. */
  website: "網站",
  /** The `website_url` the brand was submitted with. */
  submittedWebsite: "提交網址",
  /** One line per search result; may repeat. */
  searchResult: "搜尋結果",
  /** One line per probed URL; may repeat. */
  probe: "探測",
  /** The value written for a missing field. */
  missing: "無",
  /** Result tag: the link is on one of the brand's own URLs. */
  tagSite: "官網",
  /** Result tag: the link is the brand's own Instagram profile. */
  tagInstagram: "IG 相符",
  /** Probe text for a URL that returned no usable head. */
  unreachable: "無法連線",
  /** Probe suffix before the Instagram follower count. */
  igFollowers: "IG 追蹤者",
} as const;

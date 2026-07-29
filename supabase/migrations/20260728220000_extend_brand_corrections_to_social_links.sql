alter table public.brand_field_corrections
  drop constraint brand_field_corrections_field_check;

alter table public.brand_field_corrections
  add constraint brand_field_corrections_field_check
  check (
    field in (
      'price_range',
      'product_type',
      'product_tags',
      'purchase_website',
      'purchase_pinkoi',
      'purchase_shopee',
      'social_instagram',
      'social_threads',
      'social_facebook'
    )
  );

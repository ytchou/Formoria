-- TypeSafe Jev decision model (DEV-1824). Output tokens are free.
insert into llm_model_prices (model, input_per_m, cached_input_per_m, output_per_m, effective_from, source)
values
  ('jev-1.13.0', 0.042, 0.042, 0, '2026-09-15T00:00:00Z', 'typesafe public pricing, captured 2026-09-22')
on conflict (model, effective_from) do nothing;

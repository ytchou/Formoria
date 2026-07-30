CREATE OR REPLACE FUNCTION find_similar_brands(
  p_names text[],
  p_threshold float DEFAULT 0.6
)
RETURNS TABLE(input_name text, brand_name text, brand_slug text, similarity_score float)
LANGUAGE sql STABLE
AS $$
  SELECT
    n AS input_name,
    b.name AS brand_name,
    b.slug AS brand_slug,
    LEAST(
      word_similarity(b.name, n),
      word_similarity(n, b.name)
    )::float AS similarity_score
  FROM unnest(p_names) AS n
  JOIN brands b
    ON word_similarity(b.name, n) >= p_threshold
    AND word_similarity(n, b.name) >= p_threshold
  WHERE b.status = 'approved'
  ORDER BY n, similarity_score DESC;
$$;

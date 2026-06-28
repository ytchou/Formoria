-- Deactivate all region tags (preserve data for audit trail)
UPDATE taxonomy_tags SET is_active = false WHERE category = 'region';

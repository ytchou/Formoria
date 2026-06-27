ALTER TABLE brand_submissions ADD COLUMN denial_reason TEXT DEFAULT NULL;
COMMENT ON COLUMN brand_submissions.denial_reason IS 'Preset rejection category key (not_mit, insufficient_info, duplicate, policy_violation, other). NULL for non-rejected or legacy rows.';

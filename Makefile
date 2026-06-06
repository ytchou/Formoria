.PHONY: dev-all doctor seed seed-qa-brand reset-qa-brand

dev-all:
	pnpm dev

doctor:
	@bash scripts/doctor.sh

seed: ## Seed taxonomy and sample brands
	@echo "Seeding taxonomy and sample brands..."
	npx supabase db query --linked --file supabase/seed.sql
	@echo "Done."

seed-qa-brand: ## Seed the fully-populated, claimable QA test brand (test-brand-qa)
	@echo "Seeding QA test brand (test-brand-qa)..."
	npx supabase db query --linked --file supabase/seed-qa-brand.sql
	@echo "Done. Visit /test-brand-qa to claim it."

reset-qa-brand: ## Reset QA brand: remove owner+claims (re-claimable) and restore all fields
	@echo "Resetting QA test brand ownership + data..."
	npx supabase db query --linked --file supabase/reset-qa-brand.sql
	npx supabase db query --linked --file supabase/seed-qa-brand.sql
	@echo "Done. test-brand-qa is claimable again."

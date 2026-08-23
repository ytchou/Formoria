.PHONY: doctor seed eval

PNPM ?= corepack pnpm

doctor:
	@bash scripts/doctor.sh

seed: ## Seed taxonomy and sample brands
	@echo "Seeding taxonomy and sample brands..."
	npx supabase db query --linked --file supabase/seed.sql
	@echo "Done."

eval: ## Run enrichment golden-set evaluation
	$(PNPM) curate eval

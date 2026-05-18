.PHONY: dev-all doctor seed

dev-all:
	pnpm dev

doctor:
	@bash scripts/doctor.sh

seed: ## Seed taxonomy and sample brands
	@echo "Seeding taxonomy and sample brands..."
	npx supabase db query --linked --file supabase/seed.sql
	@echo "Done."

seed-brands: ## Bulk import all brands from taiwan-brands dataset
	@bash scripts/seed-brands-runner.sh

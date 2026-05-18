.PHONY: dev-all doctor seed

dev-all:
	pnpm dev

doctor:
	@bash scripts/doctor.sh

seed: ## Seed taxonomy and sample brands
	@echo "Seeding taxonomy and sample brands..."
	npx supabase db execute --file supabase/seed.sql
	@echo "Done."

# scripts/threads-scraper/

# @formoria-script
# purpose: Parked Threads and website scraping pipeline for brand discovery; wired to nothing today.
# class: parked
# invoke: bash scripts/threads-scraper/run-pipeline.sh
# target: none
# safety: writes
# owner: engineering
# notes: kept deliberately (DEV-1318); do not delete in a dead-code pass

A multi-stage pipeline that scraped Threads and brand websites into candidate
brand records. Nothing in the app, CI, or a cron job calls it.

**Only this README is tracked.** `.gitignore` ignores the whole directory, so
the pipeline files below exist on a working machine and not in a clone. This
file is force-added so the registry still records that the directory is parked
rather than gone.

It is **kept on purpose**. It is the only working implementation of the
discovery scrape, and its Python stages carry the selectors and rate-limit
handling that took the longest to get right. A dead-code sweep must leave it
alone.

| stage | file |
|---|---|
| scrape Threads | `scrape.py`, `scrape-vk123.py` |
| scrape websites | `scrape-website.ts` |
| resolve and merge | `resolve-and-merge.py` |
| fill gaps | `fill-gaps.py` |
| shorten descriptions | `shorten_descriptions.py` |
| enrich and finalize | `enrich.ts`, `finalize.ts` |
| run the whole pipeline | `run-pipeline.sh` |

Python dependencies are in `requirements.txt`.

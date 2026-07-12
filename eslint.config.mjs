import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".worktrees/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/admin/content/**",
    "scripts/threads-scraper/**",
    "tina/__generated__/**",
  ]),
  // UI sourcing rules: raw styled HTML elements must use ui/ primitives.
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/**", "src/components/microsite/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name='button'] JSXAttribute[name.name='className']",
          message:
            "Raw styled <button> — use <Button> from '@/components/ui/button'. Exception: // eslint-disable-next-line no-restricted-syntax -- ui-exception: <reason>",
        },
        {
          selector:
            "JSXOpeningElement[name.name='select'] JSXAttribute[name.name='className']",
          message:
            "Raw styled <select> — use <NativeSelect> from '@/components/ui/native-select'. Exception: // eslint-disable-next-line no-restricted-syntax -- ui-exception: <reason>",
        },
        {
          selector:
            "JSXOpeningElement[name.name='textarea'] JSXAttribute[name.name='className']",
          message:
            "Raw styled <textarea> — use <Textarea> from '@/components/ui/textarea'. Exception: // eslint-disable-next-line no-restricted-syntax -- ui-exception: <reason>",
        },
        {
          selector:
            "JSXOpeningElement[name.name='label'] JSXAttribute[name.name='className']",
          message:
            "Raw styled <label> — use <Label> from '@/components/ui/label'. Exception: // eslint-disable-next-line no-restricted-syntax -- ui-exception: <reason>",
        },
        {
          selector:
            "JSXOpeningElement[name.name='input'] JSXAttribute[name.name='className']",
          message:
            "Raw styled <input> — use <Input> from '@/components/ui/input'. Exception: // eslint-disable-next-line no-restricted-syntax -- ui-exception: <reason>",
        },
      ],
    },
  },
  // Grandfather block: existing violations suppressed pending migration to ui/ primitives.
  // Remove a file from this list once its violations have been converted.
  // Note: Next.js dynamic route brackets are escaped (\\[ \\]) so micromatch
  // treats them as literals rather than character-class syntax.
  {
    files: [
      "src/app/\\[locale\\]/(protected)/dashboard/brands/\\[slug\\]/edit/sections/locations-section.tsx",
      "src/app/admin/review-queue/submissions/submissions-review-list.tsx",
      "src/components/brands/brand-filter-sidebar.tsx",
      "src/components/brands/claim-brand-cta.tsx",
      "src/components/brands/save-brand-button.tsx",
      "src/components/brands/share-dialog.tsx",
      "src/components/dashboard/analytics-chart.tsx",
      "src/components/dashboard/onboarding-step-list.tsx",
      "src/components/forms/product-tag-field.tsx",
      "src/components/navigation/nav-category-tabs.tsx",
      "src/components/upload/ImageUploader.tsx",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import playwright from "eslint-plugin-playwright";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // A suppression that suppresses nothing is worse than no suppression: it reads
  // as a deliberate, reviewed exemption while the rule it names is still firing
  // one line away. email-capture-form.tsx had exactly that — a
  // react-hooks/exhaustive-deps directive placed on the hook opening when the
  // rule reports at the dependency array.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  // no-unused-vars is an error, not a warning. Warnings do not fail CI, which is
  // how 66 of them accumulated unnoticed — and one was masking a misplaced
  // suppression in email-capture-form.tsx. The ignore patterns encode intent that
  // already existed in the code: `_`-prefixed bindings are deliberate, and
  // rest-sibling destructuring is the idiom used to omit keys.
  // `SurfaceImage` (`components/ui/image.tsx`) is the app's `next/image`
  // wrapper, so every image call site now renders through a name that
  // eslint-config-next's `alt-text` default (`img: ["Image"]`) does not know.
  // Its own props type already makes `alt` required, but a type error and a
  // lint warning catch different mistakes — `alt={undefined}` type-checks under
  // a loose value while the rule sees a missing description.
  {
    rules: {
      "jsx-a11y/alt-text": [
        "warn",
        { elements: ["img"], img: ["Image", "SurfaceImage"] },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
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
    // Gitignored Playwright artifacts: the MCP server's scratch scripts, and
    // the HTML report's bundled vendor JS. All generated, never reviewed, and
    // they trip rules like no-this-alias — 184 errors from `playwright-report/`
    // alone, purely from having run the e2e suite locally.
    //
    // This matters beyond noise: `pnpm lint` is an `&&` chain, so a failure
    // here silently skips check:frontend-tokens and check:test-boundaries,
    // making a local run that "fails" and one that never checked the real rules
    // indistinguishable.
    ".playwright-mcp/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  // Vacuity rules for the e2e suite.
  //
  // A test that reports green without exercising the behaviour it names is worse
  // than a flaky one: a flake tells you something is wrong, a vacuous pass tells
  // you something is right when nothing was checked. This suite had 122 skip
  // sites and 47 guarded early returns against ~260 tests, so roughly a third of
  // it could pass having asserted nothing (DEV-1414).
  //
  // `allowConditional: true` is deliberate. An environment-conditional skip
  // (PREVIEW_MODE, missing admin credentials, a feature flag that is off by
  // deployed default) is a legitimate portability guard. A *state*-conditional
  // skip is not, because the condition it depends on is the very thing the test
  // should be asserting — but that distinction is semantic and no rule can see
  // it. What the rule can stop is the static `test.skip()` that quietly disables
  // a test forever.
  //
  // Existing violations are recorded in eslint-suppressions.json and only ever
  // shrink: `pnpm lint` fails on a *new* violation, and --prune-suppressions
  // removes entries as they are fixed. Big-banging a suite this size would mean
  // either a red gate for weeks or a wave of reflexive eslint-disable comments.
  {
    files: ["e2e/**/*.ts"],
    plugins: { playwright },
    rules: {
      "playwright/no-skipped-test": ["error", { allowConditional: true }],
      "playwright/no-conditional-in-test": "error",
      "playwright/no-conditional-expect": "error",
      "playwright/expect-expect": "error",
      "playwright/no-focused-test": "error",
      // Hard sleeps. Only one in this suite is defensible — proving a popup did
      // *not* open has no readiness signal to wait on — so this stays a warning
      // rather than forcing a disable comment onto the one legitimate case.
      "playwright/no-wait-for-timeout": "warn",
    },
  },
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
      "src/components/brands/brand-filter-sidebar.tsx",
      "src/components/brands/claim-brand-cta.tsx",
      "src/components/brands/image-carousel.tsx",
      "src/components/brands/report-dialog.tsx",
      "src/components/brands/save-brand-button.tsx",
      "src/components/dashboard/onboarding-step-list.tsx",
      "src/components/navigation/nav-category-tabs.tsx",
      "src/components/newsletter/email-capture-form.tsx",
      "src/components/upload/ImageUploader.tsx",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);

export default eslintConfig;

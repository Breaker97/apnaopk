import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const relaxedNextVitals = nextVitals.map((config) => {
  if (!config.plugins?.["react-hooks"]) return config;

  return {
    ...config,
    rules: {
      ...config.rules,
      "react-hooks/immutability": "warn",
      // Only asks whether the React Compiler could keep a component's own
      // useMemo/useCallback. The compiler is off (next.config.ts), so there
      // is nothing for it to check; turn it back on with the compiler.
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  };
});

const relaxedNextTs = nextTs.map((config) => {
  if (!config.rules?.["@typescript-eslint/no-explicit-any"]) return config;

  return {
    ...config,
    rules: {
      ...config.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      // An underscore prefix is the codebase's convention for "deliberately
      // unused": rest-destructuring a field away (`const { _bn, ...rest }`),
      // a callback parameter kept for its position, an ignored catch binding.
      // Without these patterns the rule reported ~30 of those as dead code.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  };
});

const eslintConfig = defineConfig([
  ...relaxedNextVitals,
  ...relaxedNextTs,
  // The locale boundary, enforced rather than remembered.
  //
  // The store's default language is served without a URL prefix
  // (lib/i18n/locale-prefix.ts), which only holds if every link and every
  // router push goes through the two modules that translate between the app's
  // `/${locale}/…` spelling and the address bar's. Code written straight
  // against `next/link` prints the prefix verbatim and spends a 308 getting
  // rid of it; worse, a locale-less href on a page in another language
  // navigates into the wrong one.
  //
  // This keeps arriving by merge — a parallel branch predating the boundary
  // brought six such files in at once — so it is an error, not a convention:
  // `pnpm lint` is `eslint --quiet`, which reports errors only.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                "Import Link from @/components/language/link — it resolves the locale prefix. See lib/i18n/locale-prefix.ts.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname"],
              message:
                "Import useRouter/usePathname from @/hooks/use-locale-navigation — they translate between the app's path spelling and the address bar's. The rest of next/navigation is fine.",
            },
          ],
        },
      ],
      // Turbopack cannot see which members of zod's `z` object a module uses,
      // so `import { z }` (or the default import) puts all of zod — every
      // error-message locale, the JSON Schema converters — into each page with
      // a form: 210 KB of the login page. A namespace import is shaken.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value='zod'] > ImportSpecifier[imported.name='z'], ImportDeclaration[source.value='zod'] > ImportDefaultSpecifier",
          message:
            'Import zod as a namespace: `import * as z from "zod"`. `import { z }` ships every zod locale to the browser.',
        },
      ],
    },
  },
  // The two modules that ARE the boundary, and so are the only ones that may
  // reach through it.
  {
    files: ["components/language/link.tsx", "hooks/use-locale-navigation.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // A `.cjs` file is CommonJS on purpose: `scripts/lib/*.cjs` are loaded with
  // `node --require` before any ESM loader exists, so `require()` is the only
  // import they can use.
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Local vendor archives and agent artifacts are not application source.
    "Storify-v*/**",
    "__MACOSX/**",
    "__agent__/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    // …but `next.config.ts` lets NEXT_DIST_DIR move the build output (a
    // second dev server, a screenshot run), and one build into `.next-x`
    // put four thousand generated-chunk errors in front of `pnpm lint`.
    // Same failure as the worktree entry below, different cause.
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The entries above are root-relative, so a linked worktree's own build
    // output (`.worktrees/<name>/.next/**`) slipped past them and its compiled
    // chunks were linted as source — thousands of errors in generated code
    // that no source change could ever fix, which left `pnpm lint` permanently
    // red and useless as a signal.
    "**/.worktrees/**",
  ]),
]);

export default eslintConfig;

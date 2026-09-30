import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Electron 主进程为 CommonJS（package.json 是 "type":"module"，故用 .cjs）
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'release*/**', 'dist/**']),
]);

export default eslintConfig;

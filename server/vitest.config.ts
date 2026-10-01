import { defineConfig } from 'vitest/config';

// server のソースは NodeNext 方式で相対 import に .js を付けるため、
// テスト実行時に .js → .ts を解決するプラグインを挟む。
export default defineConfig({
  plugins: [
    {
      name: 'resolve-ts-from-js-specifier',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
        const resolved = await this.resolve(source.replace(/\.js$/, '.ts'), importer, {
          skipSelf: true,
        });
        return resolved ?? null;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

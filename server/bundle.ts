import { transformCSS } from "../compiler/mod.ts";
import { readCode } from "../lib/fs.ts";
import { toLocalPath } from "../lib/path.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";

export type BundleCSSOptions = {
  cssModules?: boolean;
  minify?: boolean;
  resolveAlephPkgUri?: boolean;
  hmr?: boolean;
  toJS?: boolean;
};

export async function bundleCSS(
  specifier: string,
  rawCode: string,
  options: BundleCSSOptions,
  tracing = new Set<string>(),
): Promise<{ code: string; deps?: string[] }> {
  let { code: css, dependencies, exports } = await transformCSS(specifier, rawCode, {
    ...options,
    analyzeDependencies: true,
    drafts: {
      nesting: true,
      customMedia: true,
    },
  });
  const deps = dependencies?.filter((dep) => dep.type === "import").map((dep) => {
    let url = dep.url;
    if (util.isLikelyHttpURL(specifier)) {
      if (!util.isLikelyHttpURL(url)) {
        url = new URL(url, specifier).toString();
      }
    } else {
      url = "." + new URL(url, `file://${specifier.slice(1)}`).pathname;
    }
    return url;
  });
  const eof = options.minify ? "" : "\n";
  if (deps) {
    const imports = await Promise.all(deps.map(async (url) => {
      if (tracing.has(url)) {
        return "";
      }
      tracing.add(url);
      const [css] = await readCode(url);
      const { code, deps: subDeps } = await bundleCSS(url, css, { minify: options.minify }, tracing);
      if (subDeps) {
        deps.push(...subDeps);
      }
      return code;
    }));
    css = imports.join(eof) + eof + css;
  }
  if (options.toJS) {
    const alephPkgUri = getAlephPkgUri();
    const cssModulesExports: Record<string, string> = {};
    if (exports) {
      for (const [key, value] of Object.entries(exports)) {
        cssModulesExports[key] = value.name;
      }
    }
    return {
      code: [
        options.hmr && `import createHotContext from "${toLocalPath(alephPkgUri)}framework/core/hmr.ts";`,
        options.hmr && `import.meta.hot = createHotContext(${JSON.stringify(specifier)});`,
        `import { applyCSS } from "${
          options.resolveAlephPkgUri ? toLocalPath(alephPkgUri).slice(0, -1) : alephPkgUri
        }/framework/core/style.ts";`,
        `export const css = ${JSON.stringify(css)};`,
        `export default ${JSON.stringify(cssModulesExports)};`,
        `applyCSS(${JSON.stringify(specifier)}, css);`,
        options.hmr && `import.meta.hot.accept();`,
      ].filter(Boolean).join(eof),
      deps,
    };
  }
  return { code: css, deps };
}
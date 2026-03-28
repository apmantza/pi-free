import { promises } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip, constants } from 'node:zlib';
import { resolve, basename, dirname, relative } from 'pathe';
import c from 'picocolors';
import fg from 'fast-glob';
import { stringify } from 'flatted';

async function getModuleGraph(ctx, id) {
  const graph = {};
  const externalized = /* @__PURE__ */ new Set();
  const inlined = /* @__PURE__ */ new Set();
  function clearId(id2) {
    return id2?.replace(/\?v=\w+$/, "") || "";
  }
  async function get(mod, seen = /* @__PURE__ */ new Map()) {
    if (!mod || !mod.id)
      return;
    if (seen.has(mod))
      return seen.get(mod);
    let id2 = clearId(mod.id);
    seen.set(mod, id2);
    const rewrote = await ctx.vitenode.shouldExternalize(id2);
    if (rewrote) {
      id2 = rewrote;
      externalized.add(id2);
      seen.set(mod, id2);
    } else {
      inlined.add(id2);
    }
    const mods = Array.from(mod.importedModules).filter((i) => i.id && !i.id.includes("/vitest/dist/"));
    graph[id2] = (await Promise.all(mods.map((m) => get(m, seen)))).filter(Boolean);
    return id2;
  }
  await get(ctx.server.moduleGraph.getModuleById(id));
  return {
    graph,
    externalized: Array.from(externalized),
    inlined: Array.from(inlined)
  };
}

function getOutputFile(config) {
  if (!config?.outputFile)
    return;
  if (typeof config.outputFile === "string")
    return config.outputFile;
  return config.outputFile.html;
}
const distDir = resolve(fileURLToPath(import.meta.url), "../../dist");
class HTMLReporter {
  start = 0;
  ctx;
  reportUIPath;
  options;
  constructor(options) {
    this.options = options;
  }
  async onInit(ctx) {
    this.ctx = ctx;
    this.start = Date.now();
  }
  async onFinished() {
    const result = {
      paths: this.ctx.state.getPaths(),
      files: this.ctx.state.getFiles(),
      config: this.ctx.config,
      unhandledErrors: this.ctx.state.getUnhandledErrors(),
      moduleGraph: {}
    };
    await Promise.all(
      result.files.map(async (file) => {
        result.moduleGraph[file.filepath] = await getModuleGraph(this.ctx, file.filepath);
      })
    );
    await this.writeReport(stringify(result));
  }
  async writeReport(report) {
    const htmlFile = this.options.outputFile || getOutputFile(this.ctx.config) || "html/index.html";
    const htmlFileName = basename(htmlFile);
    const htmlDir = resolve(this.ctx.config.root, dirname(htmlFile));
    const metaFile = resolve(htmlDir, "html.meta.json.gz");
    await promises.mkdir(resolve(htmlDir, "assets"), { recursive: true });
    const promiseGzip = promisify(gzip);
    const data = await promiseGzip(report, {
      level: constants.Z_BEST_COMPRESSION
    });
    await promises.writeFile(metaFile, data, "base64");
    const ui = resolve(distDir, "client");
    const files = fg.sync("**/*", { cwd: ui });
    await Promise.all(files.map(async (f) => {
      if (f === "index.html") {
        const html = await promises.readFile(resolve(ui, f), "utf-8");
        const filePath = relative(htmlDir, metaFile);
        await promises.writeFile(
          resolve(htmlDir, htmlFileName),
          html.replace("<!-- !LOAD_METADATA! -->", `<script>window.METADATA_PATH="${filePath}"<\/script>`)
        );
      } else {
        await promises.copyFile(resolve(ui, f), resolve(htmlDir, f));
      }
    }));
    this.ctx.logger.log(`${c.bold(c.inverse(c.magenta(" HTML ")))} ${c.magenta("Report is generated")}`);
    this.ctx.logger.log(`${c.dim("       You can run ")}${c.bold(`npx vite preview --outDir ${relative(this.ctx.config.root, htmlDir)}`)}${c.dim(" to see the test results.")}`);
  }
}

export { HTMLReporter as default };

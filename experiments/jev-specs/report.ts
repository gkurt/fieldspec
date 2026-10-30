/**
 * Draws every generated spec as a form, beside what the models decided.
 *   bun experiments/jev-specs/report.ts [results.json] [report.html] [title]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createForm } from "../../src/index.ts";
import { defaultStyles, FormView } from "../../src/react/index.tsx";
import type { Result } from "./generate.ts";

const [input = join(import.meta.dir, "out", "results.json"), output = join(import.meta.dir, "out", "report.html"), heading = "Specs generated with Jev"] = process.argv.slice(2);
const results = JSON.parse(readFileSync(input, "utf8")) as Result[];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cards = results.map((r) => {
  const form = renderToStaticMarkup(createElement(FormView, { form: createForm(r.spec) }));
  const ms = r.wallMs ?? r.calls.reduce((n, c) => n + c.ms, 0);
  const models = [...new Set(r.calls.map((c) => c.model.replace(/ ×\d+$/, "")))].join(" + ");
  const tokens = r.calls.reduce((n, c) => n + c.tokens, 0);
  const rows = r.sources
    .map((s) => {
      const [key, ...rest] = s.split(": ");
      const when = r.shownWhen[key!];
      return `<tr><td><code>${esc(key!)}</code></td><td>${esc(rest.join(": "))}${when ? `<br><small>shown when ${esc(when)}</small>` : ""}</td></tr>`;
    })
    .join("");
  return `<section class="case">
  <header><h2>${esc(r.criteria)}</h2>
  <p class="meta"><span class="tag ${r.explicit ? "" : "vague"}">${r.explicit ? "explicit" : "vague"}</span> <span class="tag ${r.valid ? "ok" : "bad"}">${r.valid ? "valid spec" : "invalid"}</span> ${models} · ${r.calls.length} request${r.calls.length > 1 ? "s" : ""} · ${ms} ms · ${tokens.toLocaleString()} tokens</p></header>
  <div class="cols">
    <div class="form">${form}</div>
    <div><table>${rows}</table>${(r.applied ?? []).length ? `<p class="added">Read from the text by Clairic</p><ul class="added">${r.applied.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${r.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}${r.faults.map((f) => `<p class="note">${esc(f)}</p>`).join("")}
    <details><summary>Spec</summary><pre>${esc(JSON.stringify(r.spec, null, 2))}</pre></details></div>
  </div>
</section>`;
});

writeFileSync(
  output,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Specs from Jev</title>
<style>${defaultStyles}
body { font: 14px/1.45 system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #f6f6f4; color: #1d1d1f; }
main { max-width: 1100px; margin: 0 auto; display: grid; gap: 20px; }
h1 { font-size: 22px; margin: 0; } h2 { font-size: 15px; margin: 0 0 4px; }
.case { background: #fff; border: 1px solid #e3e3e0; border-radius: 12px; padding: 16px; }
.meta { margin: 0 0 12px; color: #666; font-size: 12.5px; }
.tag { display: inline-block; padding: 1px 8px; border-radius: 99px; background: #eef2ff; color: #3949ab; font-weight: 600; }
.tag.vague { background: #fff4e5; color: #a15c00; } .tag.ok { background: #e8f6ee; color: #1b7a43; } .tag.bad { background: #fdecec; color: #b42318; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
@media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; } td { border-top: 1px solid #eee; padding: 4px 6px; vertical-align: top; }
pre { font-size: 11.5px; background: #f6f6f4; padding: 8px; border-radius: 8px; overflow: auto; max-height: 320px; }
.note { color: #a15c00; font-size: 12.5px; }
p.added { margin: 10px 0 2px; font-size: 12px; font-weight: 600; color: #1b7a43; } ul.added { margin: 0; padding-left: 18px; font: 11.5px ui-monospace, monospace; color: #333; } summary { cursor: pointer; margin-top: 8px; color: #555; }
</style></head><body><main><h1>${esc(heading)}</h1>${cards.join("\n")}</main></body></html>`,
);
console.log(output);

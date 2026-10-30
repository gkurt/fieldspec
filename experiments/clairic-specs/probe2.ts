/** Can Clairic read the numbers a description states: ranges, defaults, units, durations? */
import { clairic, type ClairicAnswer } from "./clairic.ts";

const show = (a: ClairicAnswer) => `${JSON.stringify(a.value)}${a.value === null ? ` [guess ${JSON.stringify(a.guess)}]` : ""} conf ${a.confidence?.toFixed(2)} p_null ${a.p_null?.toFixed(2) ?? "-"}`;
const UNITS = "\n\nUnits: °C, °F, mm, cm, m, mm/s, %, ms, s, min, h, days, people, GB.";
const text = "Worker settings: request timeout between 5 and 300 seconds (default 60), up to 10 retries, a concurrency of 1 to 64 workers, a cache size of at most 8 GB, keep logs for a week by default, and log level (debug, info or warn, default info).";
const per = (name: string) => ({
  [`${name.replace(/ /g, "_")}.min`]: { type: "number" as const, instructions: `The smallest value allowed for ${name}, as stated` },
  [`${name.replace(/ /g, "_")}.max`]: { type: "number" as const, instructions: `The largest value allowed for ${name}, as stated` },
  [`${name.replace(/ /g, "_")}.default`]: { type: "number" as const, instructions: `The default value of ${name}, as stated` },
  [`${name.replace(/ /g, "_")}.unit`]: { type: "text" as const, instructions: `The unit, from the list of units, that ${name} is measured in` },
});
const r = await clairic(text + UNITS, {
  ...per("request timeout"), ...per("retries"), ...per("concurrency"), ...per("cache size"),
  "log_retention.default": { type: "duration", unit: "days", instructions: "How long logs are kept by default" },
  "log_level.options": { type: "list", items: "text", instructions: "The options listed for log level" },
  "log_level.default": { type: "text", instructions: "The default log level, as stated" },
});
console.log(`${r.ms.toFixed(0)} ms, ${r.tokens} tok, ${r.passes} passes`);
for (const [k, a] of Object.entries(r.answers)) console.log(`  ${k}: ${show(a)}`);

/** Quick probes of what Clairic can contribute to a spec. Prints each answer in short. */
import { clairic, type ClairicAnswer } from "./clairic.ts";

const show = (a: ClairicAnswer) => {
  if (a.type === "estimate") return `median ${a.median} (p10 ${a.p10}, p90 ${a.p90})`;
  return `${JSON.stringify(a.value)}${a.guess !== undefined && a.value === null ? ` [guess ${JSON.stringify(a.guess)}]` : ""} conf ${a.confidence?.toFixed(2)} p_null ${a.p_null?.toExponential(1) ?? "-"}`;
};

async function probe(title: string, state: string, fields: Parameters<typeof clairic>[1]) {
  const r = await clairic(state, fields);
  console.log(`\n■ ${title}  (${r.ms.toFixed(0)} ms, ${r.tokens} tok, ${r.passes} passes)`);
  for (const [k, a] of Object.entries(r.answers)) console.log(`  ${k}: ${show(a)}`);
}

const wedding = "Wedding RSVP: guest name, attending or not, number of guests, meal choice (beef, fish or vegetarian), dietary restrictions, and a song request.";
const printer = "3D printer profile: nozzle temperature, bed temperature, layer height, infill percentage, print speed, filament color.";
const backup = "Settings for a scheduled backup job: how often it runs (hourly, daily or weekly), retention in days, compress archives, encrypt backups, and an email to notify when a backup fails.";
const vague = "A bug report form for a mobile app.";

const asked = { type: "list" as const, items: "text" as const, instructions: "Each piece of information the form asks the person filling it in for, one per item" };

await probe("fields: wedding", wedding, { title: { type: "text", instructions: "What the form is, in a few words" }, fields: asked });
await probe("fields: backup", backup, { fields: asked });
await probe("fields: vague", vague, { fields: asked });

await probe("options", wedding, {
  meal: { type: "list", items: "text", instructions: "The options listed for the meal choice" },
  attending: { type: "list", items: "text", instructions: "The options listed for whether the guest is attending" },
  song: { type: "list", items: "text", instructions: "The options listed for the song request" },
});

const UNITS = "\n\nUnits: °C, °F, mm, cm, m, mm/s, cm/s, %, s, min, h, days, g, kg, px, MB, GB.";
await probe("numbers: printer", printer + UNITS, {
  nozzleMin: { type: "estimate", min: 0, max: 400, step: 5, instructions: "The lowest nozzle temperature in °C a printer profile would sensibly allow" },
  nozzleMax: { type: "estimate", min: 0, max: 400, step: 5, instructions: "The highest nozzle temperature in °C a printer profile would sensibly allow" },
  nozzleDefault: { type: "estimate", min: 0, max: 400, step: 5, instructions: "A typical nozzle temperature in °C for PLA" },
  nozzleUnit: { type: "text", instructions: "The unit, from the list of units, that nozzle temperature is measured in" },
  layerMax: { type: "estimate", min: 0, max: 2, step: 0.02, instructions: "The thickest sensible layer height in mm" },
  layerDefault: { type: "estimate", min: 0, max: 2, step: 0.02, instructions: "A typical layer height in mm" },
  layerUnit: { type: "text", instructions: "The unit, from the list of units, that layer height is measured in" },
  speedDefault: { type: "estimate", min: 0, max: 500, step: 5, instructions: "A typical print speed in mm/s" },
  speedUnit: { type: "text", instructions: "The unit, from the list of units, that print speed is measured in" },
  retention: { type: "number", integer: true, instructions: "Retention in days" },
});

await probe("defaults: backup", backup + UNITS, {
  retentionDefault: { type: "estimate", min: 1, max: 365, step: 1, scale: "log", instructions: "A sensible default for how many days to keep backups" },
  guests: { type: "estimate", min: 1, max: 20, step: 1, instructions: "The most guests one wedding RSVP would sensibly allow (state is unrelated)" },
});

const KINDS = "\n\nKinds of answer: short text; long text; email address; password; web address; phone number; whole number; measurement; percentage; yes or no; one choice from a list; several choices from a list; date; date and time; colour; file upload.";
await probe("kinds as spans", wedding + KINDS, {
  guestName: { type: "text", instructions: "The kind of answer, from the kinds listed, that guest name takes" },
  attending: { type: "text", instructions: "The kind of answer, from the kinds listed, that attending or not takes" },
  number: { type: "text", instructions: "The kind of answer, from the kinds listed, that number of guests takes" },
  meal: { type: "text", instructions: "The kind of answer, from the kinds listed, that meal choice takes" },
  dietary: { type: "text", instructions: "The kind of answer, from the kinds listed, that dietary restrictions takes" },
  song: { type: "text", instructions: "The kind of answer, from the kinds listed, that a song request takes" },
});

const CATALOG = "\n\nCommon fields: email address; password; full name; phone number; postal address; company name; title; detailed description; steps to reproduce; expected behaviour; severity; screenshot; device platform; OS version; app version; device model; rating; newsletter opt-in; preferred language; time zone; coupon code; delivery date.";
await probe("catalog as spans: vague", vague + CATALOG, {
  picks: { type: "list", items: "text", instructions: "The common fields a form like this would ask for" },
});

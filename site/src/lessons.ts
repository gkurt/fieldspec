/**
 * The tutorial's steps: one spec, the settings of a web service, grown a feature at a time.
 * Each step is a whole spec; the page shows what changed since the one before.
 */
import { define, type Infer } from "../../src/index.ts";

// The fields, as they are first written. Later steps change some of them.
const name = { type: "string" } as const;
const replicas = { type: "int", min: 1, max: 20, default: 2 } as const;
const region = { type: "enum", options: ["eu-west", "us-east", "ap-south"], default: "eu-west" } as const;
const isPublic = { type: "boolean" } as const;

export const one = define({ fields: { name } });

export const kinds = define({ fields: { name, replicas, region, public: isPublic } });

const named = {
  type: "string",
  label: "Service name",
  placeholder: "checkout-api",
  hint: "Lowercase letters, digits and dashes.",
  pattern: "^[a-z][a-z0-9-]*$",
  required: true,
} as const;
const regions = {
  type: "enum",
  default: "eu-west",
  options: [
    { value: "eu-west", label: "Europe" },
    { value: "us-east", label: "US East" },
    { value: "ap-south", label: "Asia" },
  ],
} as const;
const reachable = { type: "boolean", label: "Reachable from the internet" } as const;

export const words = define({ fields: { name: named, replicas, region: regions, public: reachable } });

const cpu = { use: "percent", label: "CPU limit", default: 0.5 } as const;
const port = { use: "port", default: 8080 } as const;
const contact = { use: "email", label: "On-call email" } as const;

export const presets = define({ fields: { name: named, replicas, region: regions, public: reachable, cpu, port, contact } });

const slider = { ...replicas, render: "slider" } as const;
const segmented = { ...regions, render: "segmented" } as const;
const toggle = { ...reachable, render: "switch" } as const;

export const controls = define({ fields: { name: named, replicas: slider, region: segmented, public: toggle, cpu, port, contact } });

const domain = {
  type: "string",
  placeholder: "shop.example.com",
  visible: { $state: "public", eq: true },
  required: { $state: "public", eq: true },
} as const;
const autoscale = { type: "boolean", render: "switch", label: "Scale with load" } as const;
const maxReplicas = { type: "int", label: "At most", min: 1, max: 50, default: 6, visible: { $state: "autoscale", eq: true } } as const;

export const conditions = define({
  fields: { name: named, region: segmented, public: toggle, domain, replicas: slider, autoscale, maxReplicas, cpu, port, contact },
});

const groupsOf = {
  network: { label: "Network" },
  scaling: { label: "Scaling", render: { type: "collapsible", props: { collapsed: false } } },
} as const;
const g = <F extends object, G extends string>(field: F, group: G) => ({ ...field, group }) as const;

export const grouped = define({
  fields: {
    name: named,
    region: segmented,
    public: g(toggle, "network"),
    domain: g(domain, "network"),
    port: g(port, "network"),
    replicas: g(slider, "scaling"),
    autoscale: g(autoscale, "scaling"),
    maxReplicas: g(maxReplicas, "scaling"),
    cpu: g(cpu, "scaling"),
    contact: { ...contact, order: 1 },
  },
  groups: groupsOf,
});

const health = {
  type: "object",
  label: "Health check",
  fields: {
    on: { type: "boolean", render: "switch", label: "Check health", default: true },
    path: { type: "string", default: "/healthz", visible: { $state: "on", eq: true } },
    interval: { type: "int", min: 1, max: 300, default: 10, unit: "s", visible: { $state: "on", eq: true } },
  },
} as const;

const base = {
  name: named,
  region: segmented,
  public: g(toggle, "network"),
  domain: g(domain, "network"),
  port: g(port, "network"),
  replicas: g(slider, "scaling"),
  autoscale: g(autoscale, "scaling"),
  maxReplicas: g(maxReplicas, "scaling"),
  cpu: g(cpu, "scaling"),
  contact: { ...contact, order: 1 },
} as const;

export const objects = define({ fields: { ...base, health }, groups: groupsOf });

const env = { type: "record", label: "Environment", values: { type: "string" }, default: { NODE_ENV: "production" } } as const;
const alerts = {
  type: "array",
  items: {
    type: "object",
    render: "row",
    fields: {
      channel: { type: "enum", options: ["email", "slack"], render: "segmented" },
      target: { type: "string" },
    },
  },
} as const;
const features = { type: "set", items: { type: "enum", options: ["cache", "tracing", "canary"] }, render: "checks" } as const;

export const collections = define({ fields: { ...base, health, env, alerts, features }, groups: groupsOf });

const source = {
  type: "variant",
  key: "from",
  variants: {
    git: { label: "Git repository", fields: { repo: { type: "url", protocols: ["https:"] }, branch: { type: "string", default: "main" } } },
    image: { label: "Container image", fields: { image: { type: "string", placeholder: "ghcr.io/acme/shop" }, tag: { type: "string", default: "latest" } } },
  },
} as const;

const { name: _name, ...afterName } = base;

export const variants = define({ fields: { name: named, source, ...afterName, health, env, alerts, features }, groups: groupsOf });

const Probe = {
  type: "object",
  fields: {
    path: { type: "string", default: "/healthz" },
    interval: { type: "int", min: 1, max: 300, default: 10, unit: "s" },
  },
} as const;
const liveness = { use: "Probe", label: "Liveness check" } as const;
const readiness = { use: "Probe", label: "Readiness check", optional: true } as const;

export const definitions = define({
  fields: { name: named, source, ...afterName, liveness, readiness, env, alerts, features },
  groups: groupsOf,
  defs: { Probe },
});

const domainFor = {
  ...domain,
  label: { $cond: { $state: "/name", eq: "" }, $then: "Domain", $else: { $template: "Domain for ${/name}" } },
  group: "network",
} as const;
const warned = {
  ...slider,
  hint: { $cond: { $state: "replicas", eq: 1 }, $then: "With one replica, every deploy is downtime.", $else: "" },
  group: "scaling",
} as const;

const lately = {
  ...{ name: named, source, ...afterName },
  domain: domainFor,
  replicas: warned,
  liveness,
  readiness,
  env,
  alerts,
  features,
} as const;

export const expressions = define({
  fields: lately,
  groups: groupsOf,
  defs: { Probe },
});

export const layouts = define({
  fields: lately,
  groups: groupsOf,
  defs: { Probe },
  layouts: {
    tabs: {
      type: "tabs",
      children: [
        { type: "stack", props: { title: "Service" }, children: [{ field: "name" }, { field: "source" }, { field: "region" }, { field: "contact" }] },
        { type: "stack", props: { title: "Network" }, children: [{ group: "network" }] },
        { type: "stack", props: { title: "Scaling" }, children: [{ group: "scaling" }] },
        { type: "stack", props: { title: "More" }, children: [{ type: "rest" }] },
      ],
    },
  },
});

// What `Infer` makes of them. The page shows these as written; the compiler holds them to it.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const holds = <T extends true>() => undefined as unknown as T;

export const TYPES = {
  one: `type Service = {
  name: string;
}`,
  kinds: `type Service = {
  name: string;
  replicas: number;
  region: "eu-west" | "us-east" | "ap-south";
  public: boolean;
}`,
  presets: `type Service = {
  …
  cpu: number;
  port: number;
  contact: string;
}`,
  objects: `type Service = {
  …
  health: { on: boolean; path: string; interval: number };
}`,
  collections: `type Service = {
  …
  env: Record<string, string>;
  alerts: { channel: "email" | "slack"; target: string }[];
  features: Set<"cache" | "tracing" | "canary">;
}`,
  variants: `type Service = {
  name: string;
  source:
    | { from: "git"; repo: URL; branch: string }
    | { from: "image"; image: string; tag: string };
  …
}`,
  definitions: `type Probe = { path: string; interval: number };
type Service = {
  …
  liveness: Probe;
  readiness?: Probe;
}`,
} as const;

type Probed = { path: string; interval: number };
holds<Equal<Infer<typeof one>, { name: string }>>();
holds<Equal<Infer<typeof kinds>, { name: string; replicas: number; region: "eu-west" | "us-east" | "ap-south"; public: boolean }>>();
holds<Equal<Pick<Infer<typeof presets>, "cpu" | "port" | "contact">, { cpu: number; port: number; contact: string }>>();
holds<Equal<Infer<typeof objects>["health"], { on: boolean; path: string; interval: number }>>();
holds<Equal<Infer<typeof collections>["env"], Record<string, string>>>();
holds<Equal<Infer<typeof collections>["alerts"], { channel: "email" | "slack"; target: string }[]>>();
holds<Equal<Infer<typeof collections>["features"], Set<"cache" | "tracing" | "canary">>>();
holds<Equal<Infer<typeof variants>["source"], { from: "git"; repo: URL; branch: string } | { from: "image"; image: string; tag: string }>>();
holds<Equal<Infer<typeof definitions>["liveness"], Probed>>();
holds<Equal<Infer<typeof definitions>["readiness"], Probed | undefined>>();
holds<Equal<"readiness" extends keyof Infer<typeof definitions> ? ({} extends Pick<Infer<typeof definitions>, "readiness"> ? true : false) : false, true>>();

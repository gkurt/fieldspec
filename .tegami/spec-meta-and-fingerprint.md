---
packages:
  fieldspec:
    type: minor
---

### A spec has `meta` for what the application keeps, and `fingerprint` says whether its description still matches

A spec takes a top-level `meta`, never interpreted, whose `description` is `{ text, of }`: the spec in plain words and the fingerprint of the spec the text last matched. `fingerprint(spec)` is the same whatever the order of keys and leaves out `meta` and `$schema`; `withDescription`, `descriptionOf`, `stampDescription` and `isDescriptionStale` write, read, stamp and compare the description. `toJSONSchema` carries `meta` as `x-meta`.

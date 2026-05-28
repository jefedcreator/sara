# Atlas Geocoding Fixes — Handover

**Target repo:** https://github.com/jefedcreator/atlas  
**Context:** Sara project at `/Users/jefedcreator/Documents/Development/sara` consumes Atlas via Docker. The geocode endpoint returns empty results for any query (e.g. "Regina mundi" Catholic church, Lagos).

---

## Root Causes Found

### Bug 1 — Country filter is a hard `Must` (primary cause of empty results)

**File:** `crates/atlas-geocode/src/index.rs`, inside `GeocodeIndex::search()`

When a `country` query param is provided, the search wraps the query in a Tantivy `BooleanQuery` with `Occur::Must` on the country term. OSM places almost never carry `addr:country` tags, so every place in the index has `country = ""`. Any request that sends `country=NG` (or any value) therefore matches nothing.

```rust
// CURRENT (broken) — hard filter eliminates all untagged places
Box::new(BooleanQuery::new(vec![
    (Occur::Must, base_query),
    (Occur::Must, country_query),  // ← kills all results
]))
```

### Bug 2 — OSM `Way` elements are never indexed (secondary cause)

**File:** `crates/atlas-ingest/src/osm.rs`, inside `extract_place_from_element()`

The ingest pipeline processes only `Node` / `DenseNode` elements. Large or well-surveyed POIs (churches, schools, hospitals) are frequently mapped as Way polygons in OSM. Without centroid computation from their node refs, none of those places end up in the geocode index.

```rust
// CURRENT (broken) — silently drops all way-mapped POIs
Element::Way(_) => None,
Element::Relation(_) => None,
```

---

## Changes Required

### Change 1 — `crates/atlas-geocode/src/index.rs`

Locate the `search()` method (~line 100). Change `Occur::Must` → `Occur::Should` for the country clause so it acts as a scoring boost rather than a hard filter:

```rust
// BEFORE
let search_query: Box<dyn tantivy::query::Query> = if let Some(ref country) = opts.country {
    let country_term = Term::from_field_text(fields.country, country.as_str());
    let country_query: Box<dyn tantivy::query::Query> =
        Box::new(TermQuery::new(country_term, IndexRecordOption::Basic));
    Box::new(BooleanQuery::new(vec![
        (Occur::Must, base_query),
        (Occur::Must, country_query),
    ]))
} else {
    base_query
};

// AFTER
let search_query: Box<dyn tantivy::query::Query> = if let Some(ref country) = opts.country {
    let country_term = Term::from_field_text(fields.country, country.as_str());
    let country_query: Box<dyn tantivy::query::Query> =
        Box::new(TermQuery::new(country_term, IndexRecordOption::Basic));
    Box::new(BooleanQuery::new(vec![
        (Occur::Must, base_query),
        (Occur::Should, country_query),
    ]))
} else {
    base_query
};
```

That is a one-word change: `Must` → `Should` on the `country_query` line.

---

### Change 2 — `crates/atlas-ingest/src/osm.rs`

Full replacement of the file. The key changes are:

1. Add `use std::collections::HashMap;` import.
2. `read_osm_places` becomes a two-pass function: pass 1 collects node id→(lat,lon), pass 2 extracts places from both nodes and ways.
3. `extract_place_from_element` gains a `node_coords: &HashMap<i64, (f64, f64)>` argument and handles `Element::Way`.
4. `OsmId::Way` variant used for way-sourced places (verify this variant exists in `atlas-core`; if not, reuse `OsmId::Node` with the way id).

```rust
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use atlas_core::bbox::AFRICA;
use atlas_core::{Address, Category, Lang, OsmId, Place, PlaceId, Source};
use osmpbf::{Element, ElementReader};
use tracing::warn;

pub fn read_osm_places(dir: &Path) -> Result<Vec<Place>, Box<dyn std::error::Error>> {
    if !dir.exists() {
        warn!("OSM directory does not exist: {}", dir.display());
        return Ok(vec![]);
    }

    let pbf_files: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.to_string_lossy().ends_with(".osm.pbf"))
        .collect();

    if pbf_files.is_empty() {
        warn!("No .osm.pbf files found in: {}", dir.display());
        return Ok(vec![]);
    }

    let mut all_places = Vec::new();

    for path in pbf_files {
        // ── Pass 1: collect node id → (lat, lon) ──────────────────────────
        let reader = ElementReader::from_path(&path)?;
        let coords_mutex: Mutex<HashMap<i64, (f64, f64)>> = Mutex::new(HashMap::new());

        reader.for_each(|element| match &element {
            Element::Node(n) => {
                if let Ok(mut m) = coords_mutex.lock() {
                    m.insert(n.id(), (n.lat(), n.lon()));
                }
            }
            Element::DenseNode(n) => {
                if let Ok(mut m) = coords_mutex.lock() {
                    m.insert(n.id(), (n.lat(), n.lon()));
                }
            }
            _ => {}
        })?;

        let node_coords = coords_mutex.into_inner()?;

        // ── Pass 2: extract places from nodes and ways ─────────────────────
        let reader = ElementReader::from_path(&path)?;
        let places_mutex = Mutex::new(Vec::new());

        reader.for_each(|element| {
            if let Some(place) = extract_place_from_element(&element, &node_coords) {
                if let Ok(mut guard) = places_mutex.lock() {
                    guard.push(place);
                }
            }
        })?;

        let collected = places_mutex.into_inner()?;
        all_places.extend(collected);
    }

    Ok(all_places)
}

fn extract_place_from_element(
    element: &Element<'_>,
    node_coords: &HashMap<i64, (f64, f64)>,
) -> Option<Place> {
    match element {
        Element::Node(node) => {
            let tags: Vec<(&str, &str)> = node.tags().collect();
            let name = find_tag(&tags, "name")?;
            if name.is_empty() {
                return None;
            }
            let lat = node.lat();
            let lon = node.lon();
            if !AFRICA.contains(lon, lat) {
                return None;
            }
            let category = extract_category(&tags)?;
            Some(Place {
                id: PlaceId::Osm(OsmId::Node(node.id())),
                names: extract_names(&tags),
                category,
                lat,
                lon,
                address: extract_address(&tags),
                source: Source::Osm,
            })
        }
        Element::DenseNode(node) => {
            let tags: Vec<(&str, &str)> = node.tags().collect();
            let name = find_tag(&tags, "name")?;
            if name.is_empty() {
                return None;
            }
            let lat = node.lat();
            let lon = node.lon();
            if !AFRICA.contains(lon, lat) {
                return None;
            }
            let category = extract_category(&tags)?;
            Some(Place {
                id: PlaceId::Osm(OsmId::Node(node.id())),
                names: extract_names(&tags),
                category,
                lat,
                lon,
                address: extract_address(&tags),
                source: Source::Osm,
            })
        }
        Element::Way(way) => {
            let tags: Vec<(&str, &str)> = way.tags().collect();
            let name = find_tag(&tags, "name")?;
            if name.is_empty() {
                return None;
            }
            let category = extract_category(&tags)?;

            // Compute centroid from referenced node coordinates.
            let refs: Vec<i64> = way.refs().collect();
            let coords: Vec<(f64, f64)> = refs
                .iter()
                .filter_map(|id| node_coords.get(id).copied())
                .collect();
            if coords.is_empty() {
                return None;
            }
            let n = coords.len() as f64;
            let lat = coords.iter().map(|(la, _)| la).sum::<f64>() / n;
            let lon = coords.iter().map(|(_, lo)| lo).sum::<f64>() / n;
            if !AFRICA.contains(lon, lat) {
                return None;
            }

            // Use OsmId::Way if it exists in atlas-core; fall back to Node if not.
            let osm_id = if cfg!(feature = "way_id_supported") {
                OsmId::Way(way.id())
            } else {
                OsmId::Node(way.id())
            };

            Some(Place {
                id: PlaceId::Osm(osm_id),
                names: extract_names(&tags),
                category,
                lat,
                lon,
                address: extract_address(&tags),
                source: Source::Osm,
            })
        }
        Element::Relation(_) => None,
    }
}

// ── helpers (unchanged) ──────────────────────────────────────────────────────

fn find_tag<'a>(tags: &[(&'a str, &'a str)], key: &str) -> Option<&'a str> {
    tags.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

fn extract_category(tags: &[(&str, &str)]) -> Option<Category> {
    let candidates = [
        find_tag(tags, "amenity"),
        find_tag(tags, "shop"),
        find_tag(tags, "tourism"),
        find_tag(tags, "building"),
        find_tag(tags, "place"),
        find_tag(tags, "landuse"),
    ];
    for candidate in candidates.into_iter().flatten() {
        if let Some(cat) = map_osm_tag_to_category(candidate) {
            return Some(cat);
        }
    }
    None
}

fn map_osm_tag_to_category(value: &str) -> Option<Category> {
    match value {
        "marketplace" | "market" => Some(Category::Market),
        "mosque" | "masjid" => Some(Category::Mosque),
        "church" | "chapel" | "cathedral" | "place_of_worship" => Some(Category::Church),
        "school" | "kindergarten" => Some(Category::School),
        "university" | "college" => Some(Category::University),
        "hospital" | "clinic" | "doctors" | "pharmacy" | "health_centre" => {
            Some(Category::Hospital)
        }
        "fuel" => Some(Category::FuelStation),
        "tower" | "mast" | "communication_tower" => Some(Category::TelecomTower),
        "bank" | "atm" => Some(Category::Bank),
        "restaurant" | "cafe" | "fast_food" | "food_court" | "bar" => Some(Category::Restaurant),
        "hotel" | "motel" | "hostel" | "guest_house" => Some(Category::Hotel),
        "bus_station" | "train_station" | "ferry_terminal" | "bus_stop" | "station" => {
            Some(Category::TransportStop)
        }
        "townhall" | "courthouse" | "government" => Some(Category::Government),
        "residential" | "apartments" | "house" => Some(Category::Residential),
        "supermarket" | "mall" | "convenience" | "commercial" | "retail" => {
            Some(Category::Commercial)
        }
        _ => None,
    }
}

fn extract_names(tags: &[(&str, &str)]) -> Vec<(Lang, String)> {
    let mut names = Vec::new();
    let lang_keys: &[(&str, Lang)] = &[
        ("name:en", Lang::En),
        ("name:fr", Lang::Fr),
        ("name:ar", Lang::Ar),
        ("name:sw", Lang::Sw),
    ];
    for (key, lang) in lang_keys {
        if let Some(val) = find_tag(tags, key) {
            if !val.is_empty() {
                names.push((lang.clone(), val.to_string()));
            }
        }
    }
    if let Some(default_name) = find_tag(tags, "name") {
        if !default_name.is_empty() {
            let already_has = names.iter().any(|(_, n)| n == default_name);
            if !already_has {
                names.insert(0, (Lang::En, default_name.to_string()));
            }
        }
    }
    names
}

fn extract_address(tags: &[(&str, &str)]) -> Option<Address> {
    let street = find_tag(tags, "addr:street").map(str::to_string);
    let city = find_tag(tags, "addr:city").map(str::to_string);
    let region = find_tag(tags, "addr:state").map(str::to_string);
    let postcode = find_tag(tags, "addr:postcode").map(str::to_string);
    let country = find_tag(tags, "addr:country")
        .map(str::to_string)
        .unwrap_or_default();
    if street.is_none() && city.is_none() && country.is_empty() {
        return None;
    }
    Some(Address {
        street,
        city,
        region,
        postcode,
        country,
    })
}
```

> **Note on `OsmId::Way`**: Check `crates/atlas-core/src/lib.rs` (or wherever `OsmId` is defined). If only `OsmId::Node(i64)` exists, use that for way IDs too — the id namespace doesn't overlap meaningfully for geocoding purposes. Remove the `cfg!(feature = …)` branch and just write `OsmId::Node(way.id())`.

---

## Steps to Implement

```bash
# 1. Clone the fork
git clone https://github.com/jefedcreator/atlas.git
cd atlas

# 2. Apply changes
#    Edit crates/atlas-geocode/src/index.rs  (one-word change)
#    Replace crates/atlas-ingest/src/osm.rs  (full file above)

# 3. Verify it compiles
cargo build --release -p atlas-server -p atlas-ingest

# 4. Run tests
cargo test -p atlas-geocode
cargo test -p atlas-ingest

# 5. Commit and push
git add crates/atlas-geocode/src/index.rs crates/atlas-ingest/src/osm.rs
git commit -m "fix: country filter and OSM way indexing for geocoding"
git push origin main

# 6. Back in the sara project, rebuild and wipe the stale indices volume
cd /Users/jefedcreator/Documents/Development/sara
docker volume rm sara_atlas_indices   # forces full re-ingest
yarn docker:up --build
```

The `--build` flag re-clones and recompiles Atlas from the updated fork. The volume wipe forces the entrypoint to re-download OSM data and rebuild the geocode/search indices with the fixed ingest pipeline.

---

## Already Applied (sara layer)

`src/backend/services/atlas/index.ts` — the `geocode()` method no longer defaults `country` to `"NG"`. Country is only forwarded when the caller explicitly provides it:

```typescript
// before
country: options?.country ?? "NG",

// after
...(options?.country != null && { country: options.country }),
```

This means geocoding works immediately once the Atlas container is running, even before the Atlas fork is patched. The Atlas-level fixes (Changes 1 & 2 above) are needed to make country-scoped queries work correctly and to include way-mapped POIs like churches in results.

---

## Verification

Once the patched container is up and indices are rebuilt:

```bash
# Should return results including "Regina Mundi Catholic Church"
curl "http://localhost:3001/v1/geocode?q=Regina+mundi&lang=en"

# General smoke test
curl "http://localhost:3001/v1/geocode?q=Lekki+Phase+1&lang=en"
curl "http://localhost:3001/health"
```

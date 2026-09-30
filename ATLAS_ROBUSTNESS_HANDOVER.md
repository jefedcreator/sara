# Atlas Geocoding Robustness — Handover

**Target repo:** https://github.com/jefedcreator/atlas  
**Problem:** Queries like "LUTH" return empty results even though Lagos University Teaching Hospital
exists in OSM. Root causes:

1. The category check is a hard gate — any named node/way without a recognised category
   is silently dropped. This keeps the index at ~1,982 places for all of Lagos.
2. Only `primary_name` is indexed — `alt_name`, `short_name`, and `official_name` OSM tags
   are never read, so acronyms ("LUTH") and alternate spellings are invisible to search.
3. The category map is narrow — `leisure`, `natural`, `healthcare`, `office`, and
   several `building` tag values are not handled, so parks, campuses, and many named
   buildings never enter the index.

---

## Change 1 — `crates/atlas-core/src/place.rs`

Add a `Place` catch-all variant to `Category` and wire it into the three existing `match` blocks.

```rust
// ── enum ──────────────────────────────────────────────────────────────────
pub enum Category {
    Market,
    Mosque,
    Church,
    School,
    University,
    Hospital,
    FuelStation,
    TelecomTower,
    Bank,
    Restaurant,
    Hotel,
    TransportStop,
    Government,
    Residential,
    Commercial,
    Place,   // ← NEW: catch-all for suburbs, parks, campuses, etc.
}

// ── as_str() ──────────────────────────────────────────────────────────────
// Add one arm at the end of the existing match:
Category::Place => "place",

// ── from_str_opt() ────────────────────────────────────────────────────────
// Add one arm at the end of the existing match:
"place" | "suburb" | "neighbourhood" | "locality" | "city"
| "town" | "village" | "hamlet" | "park" | "garden"
| "stadium" | "sports_centre" | "beach" | "bay" | "campus"
| "water" | "nature_reserve" => Some(Category::Place),

// ── is_landmark() ─────────────────────────────────────────────────────────
// No change needed — Category::Place is intentionally not a landmark.
```

---

## Change 2 — `crates/atlas-ingest/src/osm.rs`

Three sub-changes. Apply them to the file that already contains the Way centroid code from
the previous handover.

### 2a — Remove the category hard gate (three places — Node, DenseNode, Way arms)

```rust
// BEFORE (in all three match arms)
let category = extract_category(&tags)?;

// AFTER — falls back to Place instead of dropping the record
let category = extract_category(&tags).unwrap_or(Category::Place);
```

### 2b — Expand `extract_names()` to include alt/short/official names

Replace the existing `extract_names` function in full:

```rust
fn extract_names(tags: &[(&str, &str)]) -> Vec<(Lang, String)> {
    let mut names = Vec::new();

    // Language-tagged variants
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

    // Default name — insert first so it becomes primary_name
    if let Some(default_name) = find_tag(tags, "name") {
        if !default_name.is_empty() {
            let already_has = names.iter().any(|(_, n)| n == default_name);
            if !already_has {
                names.insert(0, (Lang::En, default_name.to_string()));
            }
        }
    }

    // Alternate / short / official names — appended after primary so they're
    // searchable but don't override the display name.
    for key in &["alt_name", "short_name", "official_name", "loc_name"] {
        if let Some(val) = find_tag(tags, key) {
            if !val.is_empty() && !names.iter().any(|(_, n)| n == val) {
                names.push((Lang::En, val.to_string()));
            }
        }
    }

    names
}
```

### 2c — Expand `extract_category()` and `map_osm_tag_to_category()`

Replace both functions in full:

```rust
fn extract_category(tags: &[(&str, &str)]) -> Option<Category> {
    let candidates = [
        find_tag(tags, "amenity"),
        find_tag(tags, "shop"),
        find_tag(tags, "tourism"),
        find_tag(tags, "building"),
        find_tag(tags, "place"),
        find_tag(tags, "landuse"),
        find_tag(tags, "leisure"),     // ← new
        find_tag(tags, "natural"),     // ← new
        find_tag(tags, "healthcare"),  // ← new
        find_tag(tags, "office"),      // ← new
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
        // ── existing ──────────────────────────────────────────────────────
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

        // ── building tag values (many large POIs only have building=*) ────
        "hospital" => Some(Category::Hospital),
        "school" => Some(Category::School),
        "university" => Some(Category::University),
        "church" => Some(Category::Church),
        "mosque" => Some(Category::Mosque),
        "stadium" => Some(Category::Place),
        "public" | "civic" | "office" => Some(Category::Government),

        // ── healthcare tag ────────────────────────────────────────────────
        "health_post" | "health_centre" | "hospital" | "clinic" | "pharmacy" => {
            Some(Category::Hospital)
        }

        // ── office tag ────────────────────────────────────────────────────
        "government" | "ngo" | "company" | "educational_institution"
        | "telecommunication" | "financial" => Some(Category::Government),

        // ── leisure tag ───────────────────────────────────────────────────
        "park" | "garden" | "nature_reserve" | "stadium" | "sports_centre"
        | "recreation_ground" => Some(Category::Place),

        // ── natural tag ───────────────────────────────────────────────────
        "beach" | "bay" | "water" | "coastline" | "wetland" => Some(Category::Place),

        // ── place tag (suburbs, neighbourhoods, localities) ───────────────
        "city" | "town" | "suburb" | "neighbourhood" | "locality"
        | "village" | "hamlet" | "borough" | "quarter" => Some(Category::Place),

        _ => None,
    }
}
```

> **Note:** Rust match arms are checked in order and must be non-overlapping. The
> `"hospital"`, `"school"`, `"university"`, `"church"`, `"mosque"`, `"stadium"`
> values appear in both the top section (for `amenity` key) and the new `building`
> section — this is fine because Rust's match deduplicates by first match. The
> compiler may warn about unreachable patterns; remove the later duplicates if so.
> Concretely: keep the `amenity`-oriented arms as-is and remove any exact duplicates
> introduced by the `building` section. The intent is that `building=hospital` falls
> through to `Some(Category::Hospital)` — it's the same string value regardless of
> which tag key it came from.

---

## Change 3 — `crates/atlas-geocode/src/index.rs`

In the `build()` method, replace the block that indexes a single primary name with a loop
over all names. The first name added is what `get_first()` returns on retrieval (display
name), so primary name must come first — it already does because `extract_names()` inserts
it at position 0.

```rust
// BEFORE — only indexes primary_name
let primary_name = place.primary_name(None).to_string();
let ascii_name = strip_diacritics(&primary_name);
let phonetic = phonetic_encode(&ascii_name);

// ... doc.add_text(fields.name, &primary_name); etc.

// AFTER — indexes all names; primary is first so get_first() returns it for display
for (idx, (_, name)) in place.names.iter().enumerate() {
    let ascii = strip_diacritics(name);
    let phonetic = phonetic_encode(&ascii);
    doc.add_text(fields.name, name.as_str());
    doc.add_text(fields.name_ascii, &ascii);
    doc.add_text(fields.name_phonetic, &phonetic);

    // Only store address / coordinates / category once (on the first / primary name)
    if idx == 0 {
        // these are added outside this loop — see below
    }
}
```

Full replacement of the per-place indexing block inside the `for place in places` loop
(keep everything else — `country`, `city`, `address_full`, `source_id` unchanged):

```rust
for place in places {
    let country = place
        .address
        .as_ref()
        .map(|a| a.country.clone())
        .unwrap_or_default();

    let city = place
        .address
        .as_ref()
        .and_then(|a| a.city.clone())
        .unwrap_or_default();

    let address_full = place
        .address
        .as_ref()
        .map(|a| a.full_string())
        .unwrap_or_default();

    let source_id_str = format!("{:?}", place.id);

    let mut doc = TantivyDocument::new();

    // Index every name variant (primary first → returned by get_first on retrieval)
    for (_, name) in &place.names {
        let ascii = strip_diacritics(name);
        let phonetic = phonetic_encode(&ascii);
        doc.add_text(fields.name, name.as_str());
        doc.add_text(fields.name_ascii, &ascii);
        doc.add_text(fields.name_phonetic, &phonetic);
    }

    // If a place somehow has no names, skip it
    if place.names.is_empty() {
        continue;
    }

    doc.add_text(fields.category, place.category.as_str());
    doc.add_text(fields.country, &country);
    doc.add_text(fields.city, &city);
    doc.add_f64(fields.lat, place.lat);
    doc.add_f64(fields.lon, place.lon);
    doc.add_text(fields.address_full, &address_full);
    doc.add_bytes(fields.source_id, source_id_str.as_bytes().to_vec());

    writer
        .add_document(doc)
        .map_err(|e| AtlasError::GeocodeIndexError(e.to_string()))?;
}
```

---

## Steps to Apply

```bash
# 1. Clone the fork (if not already local)
git clone https://github.com/jefedcreator/atlas.git
cd atlas

# 2. Apply the three changes:
#    - crates/atlas-core/src/place.rs    (add Category::Place + 2 match arms)
#    - crates/atlas-ingest/src/osm.rs    (unwrap_or, extract_names, category map)
#    - crates/atlas-geocode/src/index.rs (index all names)

# 3. Verify
cargo build --release -p atlas-server -p atlas-ingest
cargo test --workspace

# 4. Commit and push
git add crates/atlas-core/src/place.rs \
        crates/atlas-ingest/src/osm.rs \
        crates/atlas-geocode/src/index.rs
git commit -m "fix: index all name variants, remove category gate, expand tag coverage"
git push origin main

# 5. Wipe the stale indices and rebuild in the sara project
cd /Users/jefedcreator/Documents/Development/sara
docker compose down
docker volume rm sara_atlas_indices sara_atlas_osm
yarn docker:up --build
```

The first startup after the volume wipe re-downloads the Nigeria OSM PBF and rebuilds all
indices with the expanded pipeline. Expect the indexed-places count to rise substantially
above 1,982 — well-covered African cities typically yield 20,000–60,000 named places per
metro extract at this scope.

---

## Expected Outcomes

| Query | Before | After |
|---|---|---|
| `Regina Mundi` | ✓ (already fixed) | ✓ |
| `LUTH` | ✗ empty | ✓ `Lagos University Teaching Hospital` via `short_name` |
| `Victoria Island` | transport stops only | + neighbourhood node / area |
| `Eko Hotel` | ✗ (hotel way, no `alt_name`) | ✓ if OSM has the record |
| `Lekki Phase 1` | ✗ (`place=neighbourhood` dropped) | ✓ |

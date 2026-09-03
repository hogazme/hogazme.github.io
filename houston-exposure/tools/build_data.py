"""Build the three shipped artefacts for the Houston exposure dashboard.

Reads the frozen projection outputs from the mobility_detection_paper
houston_embedding directory and writes houston-exposure/data/.

Run rarely; the outputs are committed. From the repo root:
    python houston-exposure/tools/build_data.py
"""
import json
import os

import numpy as np
import pandas as pd

SRC = os.environ.get(
    "HX_EMBED_DIR",
    r"C:/Users/mobix/projects/mobility_detection_paper/houston_embedding")
PANEL = os.environ.get(
    "HX_PANEL_CSV",
    r"C:/Users/mobix/projects/mobility_detection_paper_SI/panels/"
    r"Houston-Pasadena-The Woodlands, TX_panel.csv")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data")

N_UPSTREAM = 2891          # CBGs in the frozen projection
# Tracts dropped from the dashboard after review. 48167723900 (Galveston County
# tract 7239) is almost entirely open water in Galveston Bay; its three block
# groups paint the bay itself. The projection was fit with them in (216 of
# 208,152 rows); they are removed here, not refit.
EXCLUDE_TRACTS = {"48167723900"}
N_CBG, N_MONTH = 2888, 72

REGIMES = [
    {"label": "A", "from": "2019-01", "to": "2022-11",
     "note": "POI roster frozen at 98,656 for 47 months"},
    {"label": "B", "from": "2022-12", "to": "2022-12",
     "note": "partial month: 32,774 POIs, 7.4M visits"},
    {"label": "C", "from": "2023-01", "to": "2023-12",
     "note": "roster grows to 115,804; out-of-scope share steps to ~0.36"},
    {"label": "D", "from": "2024-01", "to": "2024-12",
     "note": "3-4x the visits of 2023 on an identical roster"},
]


def _assert_unique_pairs(u):
    """A duplicated (cbg_geoid, year_month) pair combined with the missing
    pair it displaces would still pass the aggregate row-count check, and
    would silently leave one CBG-month at its np.zeros() default of 0
    instead of raising. With the row-count check already holding, no
    duplicates implies no missing pairs either, so this closes that gap."""
    dup = u.duplicated(["cbg_geoid", "year_month"]).sum()
    assert dup == 0, (
        f"{dup} duplicate (cbg_geoid, year_month) pairs in components table")


def load_components():
    u = pd.read_parquet(os.path.join(SRC, "houston_components_uint8.parquet"))
    all_geoids = sorted(u["cbg_geoid"].unique())
    assert len(all_geoids) == N_UPSTREAM, f"expected {N_UPSTREAM} upstream CBGs"
    dropped = [g for g in all_geoids if str(g)[:11] in EXCLUDE_TRACTS]
    assert len(dropped) == N_UPSTREAM - N_CBG, f"exclusion removed {len(dropped)} CBGs"
    u = u[~u["cbg_geoid"].isin(dropped)]
    geoids = np.array([g for g in all_geoids if g not in set(dropped)], dtype=np.int64)
    months = sorted(u["year_month"].unique().tolist())
    assert len(geoids) == N_CBG, f"expected {N_CBG} CBGs, got {len(geoids)}"
    assert len(months) == N_MONTH, f"expected {N_MONTH} months, got {len(months)}"
    assert months[0] == "2019-01" and months[-1] == "2024-12"
    expected = pd.date_range("2019-01-01", "2024-12-01",
                             freq="MS").strftime("%Y-%m").tolist()
    assert months == expected, "months are not contiguous 2019-01..2024-12"
    assert len(u) == N_CBG * N_MONTH, f"expected {N_CBG * N_MONTH} rows, got {len(u)}"
    _assert_unique_pairs(u)

    gpos = {g: i for i, g in enumerate(geoids)}
    mpos = {m: i for i, m in enumerate(months)}
    planes = np.zeros((3, N_MONTH, N_CBG), dtype=np.uint8)
    gi = u["cbg_geoid"].map(gpos).to_numpy()
    mi = u["year_month"].map(mpos).to_numpy()
    for k, col in enumerate(("c1", "c2", "c3")):
        v = u[col].to_numpy()
        assert v.dtype == np.uint8, f"{col} is {v.dtype}, expected uint8"
        assert v.min() == 0 and v.max() == 255, f"{col} does not span 0-255"
        planes[k, mi, gi] = v
    return geoids, months, planes


def load_reach(geoids, months):
    """Radius of gyration of the activity footprint, one number per CBG-month.

    The panel carries rg per category (km). The shipped value is the
    visit-share-weighted mean over categories with a defined rg, i.e. the
    footprint radius of where this community's visits actually went. Two
    planes: pooled percentile rank as uint8 (the colour channel, same
    convention as c1-c3) and km x 2 as uint8 (for display; 0.5 km steps,
    clamps at 127.5 km which no CBG-month reaches)."""
    head = pd.read_csv(PANEL, nrows=1)
    rg_cols = [c for c in head.columns if c.startswith("rg_")]
    assert len(rg_cols) == 11, f"expected 11 rg_ columns, got {len(rg_cols)}"
    pct_cols = ["pct_" + c[3:] for c in rg_cols]
    assert all(c in head.columns for c in pct_cols), "pct_ columns missing"
    df = pd.read_csv(PANEL, usecols=["CBG", "year_month"] + rg_cols + pct_cols)
    df = df[df["CBG"].isin(set(int(g) for g in geoids))]
    assert len(df) == N_CBG * N_MONTH, f"panel has {len(df)} rows for our CBGs"
    assert df.duplicated(["CBG", "year_month"]).sum() == 0

    rg = df[rg_cols].to_numpy(dtype=float)
    w = df[pct_cols].to_numpy(dtype=float)
    w = np.where(np.isnan(rg), 0.0, w)
    wsum = w.sum(axis=1)
    assert (wsum > 0).all(), "a CBG-month has no category with a defined rg"
    overall = np.nansum(rg * w, axis=1) / wsum
    assert np.isfinite(overall).all()

    # Pooled percentile rank over all 208,152 rows, scaled to 0-255 like c1-c3.
    order = overall.argsort(kind="stable")
    ranks = np.empty(len(overall), dtype=float)
    ranks[order] = np.arange(len(overall))
    pct = np.round(ranks / (len(overall) - 1) * 255).astype(np.uint8)
    km2 = np.clip(np.round(overall * 2), 0, 255).astype(np.uint8)

    gpos = {int(g): i for i, g in enumerate(geoids)}
    mpos = {m: i for i, m in enumerate(months)}
    gi = df["CBG"].map(gpos).to_numpy()
    mi = df["year_month"].map(mpos).to_numpy()
    planes = np.zeros((2, N_MONTH, N_CBG), dtype=np.uint8)
    planes[0, mi, gi] = pct
    planes[1, mi, gi] = km2
    assert planes[0].min() == 0 and planes[0].max() == 255
    monthly_mean = [float(planes[0, m].mean()) for m in range(N_MONTH)]
    stats = {"median_km": round(float(np.median(overall)), 2),
             "p10_km": round(float(np.percentile(overall, 10)), 2),
             "p90_km": round(float(np.percentile(overall, 90)), 2)}
    return planes, monthly_mean, stats


def _income_gap_cols(columns):
    """Over zero matching columns, (g == N_MONTH).all(axis=1) is vacuously
    True for every row, which would silently mark every CBG as imputed
    instead of failing if the upstream column prefix ever changes."""
    cols = [c for c in columns if c.startswith("income_exposure_gap_")]
    assert cols, (
        "no columns matching prefix 'income_exposure_gap_' found in "
        "houston_imputation_mask.parquet")
    return cols


def load_imputed_cbgs():
    """The 168 CBGs whose ACS median_household_income is 0, so every
    income_exposure_gap column is undefined in all 72 months."""
    mk = pd.read_parquet(os.path.join(SRC, "houston_imputation_mask.parquet"))
    cols = _income_gap_cols(mk.columns)
    g = mk.groupby("cbg_geoid")[cols].sum()
    return set(g.index[(g == N_MONTH).all(axis=1)].tolist())


def monthly_means(planes):
    """Houston-wide mean of each shipped channel per month, computed over the
    shipped CBG set (not the upstream csv, which includes the excluded tract)."""
    return {f"c{k + 1}": [float(planes[k, m].mean()) for m in range(N_MONTH)]
            for k in range(3)}


def load_loadings():
    df = pd.read_csv(os.path.join(SRC, "houston_pca_loadings_pc1_3_sorted.csv"))
    out = {}
    for pc in ("PC1", "PC2", "PC3"):
        top = df[df["component"] == pc].nsmallest(12, "rank_by_abs")
        out[pc] = [{"feature": r.feature, "loading": round(float(r.loading), 4)}
                   for r in top.itertuples()]
    return out


def build_topojson(geoids, imputed):
    topo = json.load(open(os.path.join(SRC, "houston_cbgs.topo.json"),
                          encoding="utf-8"))
    key = next(iter(topo["objects"]))
    if key != "data":
        topo["objects"]["data"] = topo["objects"].pop(key)
    geoms = topo["objects"]["data"]["geometries"]
    assert len(geoms) == N_UPSTREAM, f"topojson has {len(geoms)} geometries"
    gpos = {int(g): i for i, g in enumerate(geoids)}
    geoms = [g for g in geoms if int(g["properties"]["cbg_geoid"]) in gpos]
    assert len(geoms) == N_CBG
    topo["objects"]["data"]["geometries"] = geoms
    seen = set()
    for g in geoms:
        p = g["properties"]
        gid = int(p["cbg_geoid"])
        assert gid in gpos, f"polygon {gid} is not in the component table"
        seen.add(gid)
        p["cbg_geoid"] = gid
        p["idx"] = gpos[gid]
        p["imputed_income"] = 1 if gid in imputed else 0
    missing = set(gpos) - seen
    assert not missing, f"{len(missing)} CBGs have no polygon: {sorted(missing)[:5]}"
    return topo


def main():
    os.makedirs(OUT, exist_ok=True)
    geoids, months, planes = load_components()
    imputed = load_imputed_cbgs() & set(int(g) for g in geoids)
    reach, reach_mean, reach_stats = load_reach(geoids, months)
    print(f"  {len(geoids)} CBGs x {len(months)} months; "
          f"{len(imputed)} imputed-income CBGs; reach median {reach_stats['median_km']} km")

    # Five planes: c1, c2, c3, rg percentile, rg km x 2.
    with open(os.path.join(OUT, "components.bin"), "wb") as f:
        f.write(planes.tobytes(order="C"))
        f.write(reach.tobytes(order="C"))

    results = json.load(open(os.path.join(SRC, "houston_embedding_results.json"),
                             encoding="utf-8"))
    meta = {
        "n_cbgs": N_CBG,
        "n_months": N_MONTH,
        "months": months,
        "cbg_geoids": [int(g) for g in geoids],
        "monthly_mean_uint8": dict(monthly_means(planes), rg=reach_mean),
        "flags": {"bad_months": ["2022-12"], "regimes": REGIMES,
                  "excluded_tracts": sorted(EXCLUDE_TRACTS)},
        "loadings": load_loadings(),
        "stats": {
            "evr": [round(v, 4) for v in
                    results["part2"]["explained_variance_ratio_1_10"][:3]],
            "evr_cum3": round(results["part2"]["cumulative_pc1_3"], 4),
            "n_components_for_90pct": results["part2"]["n_components_for_90pct"],
            "morans_I_mean": round(results["part4c"]["monthly_I"]["mean"], 4),
            "n_islands": results["part4c"]["n_islands_zero_degree_excluded"],
            "n_imputed_cbgs": len(imputed),
            "reach_km": reach_stats,
        },
    }
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"))

    topo = build_topojson(geoids, imputed)
    with open(os.path.join(OUT, "houston_cbgs.topo.json"), "w",
              encoding="utf-8") as f:
        json.dump(topo, f, separators=(",", ":"))

    for name in ("components.bin", "meta.json", "houston_cbgs.topo.json"):
        p = os.path.join(OUT, name)
        print(f"  {os.path.getsize(p) / 1e6:7.3f} MB  {name}")


if __name__ == "__main__":
    main()

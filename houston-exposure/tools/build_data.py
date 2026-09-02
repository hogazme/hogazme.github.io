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
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data")

N_CBG, N_MONTH = 2891, 72

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


def load_components():
    u = pd.read_parquet(os.path.join(SRC, "houston_components_uint8.parquet"))
    geoids = np.array(sorted(u["cbg_geoid"].unique()), dtype=np.int64)
    months = sorted(u["year_month"].unique().tolist())
    assert len(geoids) == N_CBG, f"expected {N_CBG} CBGs, got {len(geoids)}"
    assert len(months) == N_MONTH, f"expected {N_MONTH} months, got {len(months)}"
    assert months[0] == "2019-01" and months[-1] == "2024-12"
    expected = pd.date_range("2019-01-01", "2024-12-01",
                             freq="MS").strftime("%Y-%m").tolist()
    assert months == expected, "months are not contiguous 2019-01..2024-12"
    assert len(u) == N_CBG * N_MONTH, f"expected 208,152 rows, got {len(u)}"

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


def load_imputed_cbgs():
    """The 168 CBGs whose ACS median_household_income is 0, so every
    income_exposure_gap column is undefined in all 72 months."""
    mk = pd.read_parquet(os.path.join(SRC, "houston_imputation_mask.parquet"))
    cols = [c for c in mk.columns if c.startswith("income_exposure_gap_")]
    g = mk.groupby("cbg_geoid")[cols].sum()
    return set(g.index[(g == N_MONTH).all(axis=1)].tolist())


def load_monthly_means(months):
    mm = pd.read_csv(os.path.join(SRC, "houston_monthly_component_means.csv"))
    mm = mm.set_index("year_month").loc[months]
    return {f"c{k}": [float(v) for v in mm[f"pc{k}_mean_uint8"]] for k in (1, 2, 3)}


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
    assert len(geoms) == N_CBG, f"topojson has {len(geoms)} geometries"
    gpos = {int(g): i for i, g in enumerate(geoids)}
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
    imputed = load_imputed_cbgs()
    print(f"  {len(geoids)} CBGs x {len(months)} months; "
          f"{len(imputed)} imputed-income CBGs")

    with open(os.path.join(OUT, "components.bin"), "wb") as f:
        f.write(planes.tobytes(order="C"))

    results = json.load(open(os.path.join(SRC, "houston_embedding_results.json"),
                             encoding="utf-8"))
    meta = {
        "n_cbgs": N_CBG,
        "n_months": N_MONTH,
        "months": months,
        "cbg_geoids": [int(g) for g in geoids],
        "monthly_mean_uint8": load_monthly_means(months),
        "flags": {"bad_months": ["2022-12"], "regimes": REGIMES},
        "loadings": load_loadings(),
        "stats": {
            "evr": [round(v, 4) for v in
                    results["part2"]["explained_variance_ratio_1_10"][:3]],
            "evr_cum3": round(results["part2"]["cumulative_pc1_3"], 4),
            "n_components_for_90pct": results["part2"]["n_components_for_90pct"],
            "morans_I_mean": round(results["part4c"]["monthly_I"]["mean"], 4),
            "n_islands": results["part4c"]["n_islands_zero_degree_excluded"],
            "n_imputed_cbgs": len(imputed),
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

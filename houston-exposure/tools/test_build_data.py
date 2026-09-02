"""Tests for the dashboard data build. Run from the repo root:
    python -m pytest houston-exposure/tools/test_build_data.py -v
"""
import json
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_data as B  # noqa: E402

DATA = os.path.join(os.path.dirname(HERE), "data")


@pytest.fixture(scope="module")
def built():
    B.main()
    return True


def test_binary_is_three_planes_of_208152(built):
    raw = open(os.path.join(DATA, "components.bin"), "rb").read()
    assert len(raw) == 3 * 72 * 2891 == 624456


def test_golden_values_at_known_offsets(built):
    raw = np.frombuffer(open(os.path.join(DATA, "components.bin"), "rb").read(),
                        dtype=np.uint8)
    plane = 72 * 2891
    # CBG 480157601002 is index 0; 2019-01 is month 0; 2024-12 is month 71.
    assert raw[0] == 141                      # c1, month 0
    assert raw[plane + 0] == 245              # c2, month 0
    assert raw[2 * plane + 0] == 85           # c3, month 0
    assert raw[71 * 2891] == 98               # c1, month 71


def test_meta_shape_and_month_order(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    assert m["n_cbgs"] == 2891 and m["n_months"] == 72
    assert len(m["months"]) == 72
    assert m["months"][0] == "2019-01" and m["months"][-1] == "2024-12"
    assert m["months"] == sorted(m["months"])
    assert len(m["cbg_geoids"]) == 2891
    assert m["cbg_geoids"][0] == 480157601002
    assert m["cbg_geoids"] == sorted(m["cbg_geoids"])


def test_monthly_means_present_for_three_channels(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    for ch in ("c1", "c2", "c3"):
        assert len(m["monthly_mean_uint8"][ch]) == 72
    assert m["monthly_mean_uint8"]["c1"][0] == pytest.approx(134.471117, abs=1e-4)
    assert m["monthly_mean_uint8"]["c3"][0] == pytest.approx(129.179869, abs=1e-4)


def test_every_cbg_has_a_polygon_and_idx_matches_meta(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    topo = json.load(open(os.path.join(DATA, "houston_cbgs.topo.json"),
                          encoding="utf-8"))
    geoms = topo["objects"]["data"]["geometries"]
    assert len(geoms) == 2891
    by_geoid = {g["properties"]["cbg_geoid"]: g["properties"] for g in geoms}
    assert set(by_geoid) == set(m["cbg_geoids"])
    for i, gid in enumerate(m["cbg_geoids"]):
        assert by_geoid[gid]["idx"] == i


def test_imputed_income_flag_marks_168_cbgs(built):
    topo = json.load(open(os.path.join(DATA, "houston_cbgs.topo.json"),
                          encoding="utf-8"))
    geoms = topo["objects"]["data"]["geometries"]
    n = sum(1 for g in geoms if g["properties"]["imputed_income"] == 1)
    assert n == 168


def test_flags_name_the_bad_month_and_regimes(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    assert m["flags"]["bad_months"] == ["2022-12"]
    assert len(m["flags"]["regimes"]) == 4
    assert m["stats"]["n_imputed_cbgs"] == 168
    assert m["stats"]["evr_cum3"] == pytest.approx(0.4738, abs=1e-3)

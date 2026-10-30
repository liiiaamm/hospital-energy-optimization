"""Solve the model for a grid of scenarios and write docs/scenarios.json for the web simulator.

    python scripts/precompute.py
"""
import itertools
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from model import (CRITICAL, DEMAND, EXISTING, EXISTING_FUEL, FUEL_CAPACITY, GENERATORS, IMPORTANCE,  # noqa: E402
                   MAX_POWER, MIN_LEVEL, SERVICES, UNIT_COST, build_model, solve, summarise)

DURATIONS = [12, 24, 36, 48, 72]
BUDGETS = [0, 15_000, 27_000, 42_000, 55_000, 82_000, 110_000, 165_000]
LAMBDAS = [0.0, 0.25, 0.5, 0.75, 1.0]


def survival(cov, duration):
    """Hours in which every critical service keeps at least MIN_LEVEL of its demand."""
    return sum(1 for t in range(duration) if all(cov[s][t] >= MIN_LEVEL - 1e-6 for s in CRITICAL))


def main():
    scenarios = {}
    t0 = time.time()
    for d, b, lam in itertools.product(DURATIONS, BUDGETS, LAMBDAS):
        m = build_model(d, b, lam)
        solve(m, time_limit=60)
        r = summarise(m)
        r["survival_hours"] = survival(r["coverage"], d)
        r["coverage"] = {s: [round(v, 3) for v in r["coverage"][s]] for s in SERVICES}
        r["produced"] = {g: [round(v, 2) for v in r["produced"][g]] for g in GENERATORS}
        scenarios[f"{d}|{b}|{lam}"] = r
        print(f"{d:>3}h  ${b:>7}  λ={lam:<4}  bought={r['bought']}  survival={r['survival_hours']}h", flush=True)
    meta = {
        "durations": DURATIONS, "budgets": BUDGETS, "lambdas": LAMBDAS,
        "services": SERVICES, "critical": CRITICAL, "generators": GENERATORS,
        "demand": DEMAND, "importance": IMPORTANCE, "unit_cost": UNIT_COST,
        "fuel_capacity": FUEL_CAPACITY, "max_power": MAX_POWER,
        "existing": EXISTING, "existing_fuel": EXISTING_FUEL, "min_level": MIN_LEVEL,
    }
    out = ROOT / "docs" / "scenarios.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"meta": meta, "scenarios": scenarios}, separators=(",", ":")))
    print(f"{len(scenarios)} scenarios in {time.time() - t0:.0f}s -> {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

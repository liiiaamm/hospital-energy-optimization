"""Hospital blackout model: generator investment plus hourly load shedding.

Same formulation as ``optimization_model.ipynb``, packaged as a function so it can be
solved for many scenarios. Works with the free HiGHS solver (``pip install highspy``)
or with Gurobi if it is installed.

    from model import build_model, solve, summarise
    m = build_model(duration=24, budget=60_000, lambda_utility=0.5)
    solve(m)
    print(summarise(m))
"""

from __future__ import annotations

import pyomo.environ as pe

GENERATORS = ("Large", "Medium", "Small")
SERVICES = ("UCI", "OperatingRoom", "ER", "Lab", "Pharmacy", "Admin")
CRITICAL = ("UCI", "OperatingRoom", "ER")

FUEL_CAPACITY = {"Large": 500, "Medium": 150, "Small": 60}  # kWh per unit
MAX_POWER = {"Large": 250, "Medium": 75, "Small": 30}  # kW per unit
UNIT_COST = {"Large": 55_000, "Medium": 27_000, "Small": 15_000}  # $ per unit
EXISTING = {"Large": 1, "Medium": 1, "Small": 1}
EXISTING_FUEL = {"Large": 500, "Medium": 150, "Small": 60}

DEMAND = {"UCI": 30, "OperatingRoom": 35, "ER": 25, "Lab": 15, "Pharmacy": 10, "Admin": 5}  # kW
IMPORTANCE = {"UCI": 100, "OperatingRoom": 85, "ER": 70, "Lab": 30, "Pharmacy": 15, "Admin": 5}

MAX_GAP = 0.20  # max coverage difference between critical services in the same hour
MIN_LEVEL = 0.10  # minimum coverage of critical services while the hospital "survives"
RESIDUAL_FINAL_VALUE = 0.05  # weight of the last hour relative to the first
MAX_STARTS = 5  # generator start-ups allowed per type


def urgency_rate(duration: int) -> float:
    if duration <= 1:
        return 0.0
    return (1 / RESIDUAL_FINAL_VALUE) ** (1 / (duration - 1)) - 1


def build_model(duration: int = 24, budget: float = 20_000, lambda_utility: float = 0.5) -> pe.ConcreteModel:
    m = pe.ConcreteModel()
    rate = urgency_rate(duration)

    m.T = pe.Set(initialize=list(range(1, duration + 1)))
    m.G = pe.Set(initialize=GENERATORS)
    m.S = pe.Set(initialize=SERVICES)
    m.S_crit = pe.Set(initialize=CRITICAL)

    max_pts = sum(IMPORTANCE.values()) * sum(1 / (1 + rate) ** (t - 1) for t in range(1, duration + 1))
    k_factor = max_pts / (1 / max(IMPORTANCE.values()))

    # decisions
    m.z_inv = pe.Var(m.G, within=pe.NonNegativeIntegers)  # units bought
    m.a = pe.Var(m.G, m.T, within=pe.NonNegativeIntegers)  # units running
    m.u = pe.Var(m.G, m.T, within=pe.NonNegativeReals)  # energy produced
    m.x = pe.Var(m.S, m.T, bounds=(0, 1))  # share of each service's demand covered
    m.y = pe.Var(m.T, within=pe.Binary)  # 1 if critical services stay above MIN_LEVEL
    m.z_min = pe.Var(within=pe.NonNegativeReals)  # worst weighted coverage (equity)
    m.start = pe.Var(m.G, m.T, within=pe.NonNegativeIntegers)

    def objective(m):
        utility = sum(
            sum(IMPORTANCE[s] * m.x[s, t] for s in m.S) / (1 + rate) ** (t - 1) for t in m.T
        )
        return lambda_utility * utility + (1 - lambda_utility) * k_factor * m.z_min

    m.objective = pe.Objective(rule=objective, sense=pe.maximize)

    m.c_budget = pe.Constraint(expr=sum(UNIT_COST[g] * m.z_inv[g] for g in m.G) <= budget)
    m.c_availability = pe.Constraint(m.G, m.T, rule=lambda m, g, t: m.a[g, t] <= EXISTING[g] + m.z_inv[g])
    m.c_power = pe.Constraint(m.G, m.T, rule=lambda m, g, t: m.u[g, t] <= MAX_POWER[g] * m.a[g, t])
    m.c_fuel = pe.Constraint(
        m.G, rule=lambda m, g: sum(m.u[g, t] for t in m.T) <= EXISTING_FUEL[g] * EXISTING[g] + FUEL_CAPACITY[g] * m.z_inv[g]
    )
    m.c_balance = pe.Constraint(
        m.T, rule=lambda m, t: sum(m.u[g, t] for g in m.G) == sum(DEMAND[s] * m.x[s, t] for s in m.S)
    )
    m.c_y_link = pe.Constraint(
        m.S, m.T, rule=lambda m, s, t: m.x[s, t] >= m.y[t] * MIN_LEVEL if s in CRITICAL else pe.Constraint.Skip
    )
    m.c_continuity = pe.Constraint(
        m.S, m.T, rule=lambda m, s, t: m.x[s, t] <= m.x[s, t - 1] if (t > 1 and s in CRITICAL) else pe.Constraint.Skip
    )
    m.c_maximin = pe.Constraint(m.S, m.T, rule=lambda m, s, t: m.z_min <= m.x[s, t] / IMPORTANCE[s])
    m.c_equity_gap = pe.Constraint(
        m.S, m.S, m.T,
        rule=lambda m, s1, s2, t: m.x[s1, t] - m.x[s2, t] <= MAX_GAP if (s1 in CRITICAL and s2 in CRITICAL) else pe.Constraint.Skip,
    )
    m.c_def_start = pe.Constraint(
        m.G, m.T, rule=lambda m, g, t: m.start[g, t] >= m.a[g, t] - (m.a[g, t - 1] if t > 1 else 0)
    )
    m.c_limit_starts = pe.Constraint(m.G, rule=lambda m, g: sum(m.start[g, t] for t in m.T) <= MAX_STARTS)
    return m


def solve(m: pe.ConcreteModel, time_limit: float = 60, mip_gap: float = 1e-4):
    """Solve with HiGHS if available, otherwise Gurobi."""
    for name in ("appsi_highs", "highs", "gurobi"):
        solver = pe.SolverFactory(name)
        if solver.available(exception_flag=False):
            if name.endswith("highs"):
                solver.options["time_limit"] = time_limit
                solver.options["mip_rel_gap"] = mip_gap
            else:
                solver.options["TimeLimit"] = time_limit
                solver.options["MIPGap"] = mip_gap
            return solver.solve(m, load_solutions=True)
    raise RuntimeError("No MILP solver found. Install HiGHS with: pip install highspy")


def summarise(m: pe.ConcreteModel) -> dict:
    """Plain-Python view of a solved model, used by the web simulator."""
    v = pe.value
    T = list(m.T)
    bought = {g: int(round(v(m.z_inv[g]))) for g in m.G}
    fuel_total = {g: EXISTING_FUEL[g] * EXISTING[g] + FUEL_CAPACITY[g] * bought[g] for g in m.G}
    produced = {g: [max(0.0, v(m.u[g, t])) for t in T] for g in m.G}
    return {
        "bought": bought,
        "spent": sum(UNIT_COST[g] * bought[g] for g in m.G),
        "fuel_total": fuel_total,
        "coverage": {s: [round(min(1.0, max(0.0, v(m.x[s, t]))), 4) for t in T] for s in m.S},
        "running": {g: [int(round(v(m.a[g, t]))) for t in T] for g in m.G},
        "produced": {g: [round(e, 3) for e in produced[g]] for g in m.G},
        "survival_hours": int(round(sum(v(m.y[t]) for t in T))),
        "equity": round(v(m.z_min), 6),
        "objective": round(v(m.objective), 3),
    }


if __name__ == "__main__":
    import json
    import sys
    import time

    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    budget = float(sys.argv[2]) if len(sys.argv) > 2 else 20_000
    lam = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
    t0 = time.time()
    model = build_model(duration, budget, lam)
    solve(model)
    out = summarise(model)
    print(json.dumps({k: out[k] for k in ("bought", "spent", "survival_hours", "equity", "objective")}, indent=2))
    print(f"solved in {time.time() - t0:.1f}s")

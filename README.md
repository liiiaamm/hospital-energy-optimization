<div align="center">
  <img src="assets/banner_readme.png" alt="Hospital energy optimization" width="100%">
</div>

# Hospital Energy Optimization

A hospital loses grid power for 24 hours or more. It has a fixed budget for generators, limited fuel, and six services that all want electricity: ICU, operating rooms, ER, lab, pharmacy and admin. Who gets power, for how long, and which generators should the hospital have bought beforehand?

This project answers both questions with one mixed-integer linear program in Pyomo. Built as a course project at Comillas ICAI (September–December 2025).

## The model

Two decisions are taken together:

- **Before the blackout (investment):** how many large, medium and small generators to buy, $z^{inv}_g$, subject to $\sum_g \text{Cost}_g \, z^{inv}_g \le \text{Budget}$.
- **During the blackout (operation):** which generators run each hour, how much energy each produces, and what fraction $x_{s,t}$ of each service's demand is covered.

The objective trades off two goals that pull in opposite directions:

$$
\max \; Z = \lambda_1 \sum_{t}\sum_{s} \frac{W_s \, x_{s,t}}{(1+\alpha)^{t-1}} \; + \; \lambda_2 \, K \, z^{min}
$$

- **Utility (first term):** serve the most important services, weighted by $W_s$ (ICU = 100, admin much lower). The discount $\alpha$ makes early hours count more.
- **Equity (second term):** maximise $z^{min}$, the worst-served critical service, so no unit is left in the dark for long.

Constraints cover the budget, generator availability and power limits, fuel tanks, the hourly energy balance, minimum service levels, monotonic load shedding, and a maximum coverage gap between critical services.

## What came out of it

- The best protocol changes with the length of the blackout. Short outages favour utility, keeping the ICU and operating rooms at full power. Long ones need equity, or fuel runs out for everyone.
- Medium generators gave the best balance between fuel autonomy and power for the money.
- Cutting non-critical services early noticeably extends how long life-critical units stay powered.

The full formulation, sensitivity analysis and 100-hour simulations are in [`docs/Project_Final_Report.pdf`](docs/Project_Final_Report.pdf).

## Run it

```bash
git clone https://github.com/liiiaamm/hospital-energy-optimization.git
cd hospital-energy-optimization
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
jupyter notebook src/optimization_model.ipynb
```

The notebook calls **Gurobi** (`po.SolverFactory('gurobi')`), which needs a licence; free academic licences are available. To use an open-source solver instead, install GLPK or CBC and change that line.

Scenario settings live at the top of the notebook: `BLACKOUT_DURATION`, `BUDGET` and `LAMBDA_1` (utility weight; equity gets `1 - LAMBDA_1`).

## Team

- Liam Esgueva González
- Andrés Gil Vicente
- Jorge Carnicero Príncipe
- Jorge González Pérez

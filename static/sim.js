// Hospital blackout simulator. Plays back precomputed optimal plans (docs/scenarios.json).
(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const short = (v) => (v === 0 ? "$0" : "$" + Math.round(v / 1000) + "k");

  const NAMES = {
    UCI: "Intensive care", OperatingRoom: "Operating rooms", ER: "Emergency",
    Lab: "Laboratory", Pharmacy: "Pharmacy", Admin: "Admin",
  };
  // Floor plan: critical departments along the top, support along the bottom, corridor between.
  const ROOMS = {
    UCI: [20, 20, 260, 180], OperatingRoom: [290, 20, 270, 180], ER: [570, 20, 230, 180],
    Lab: [20, 270, 260, 180], Pharmacy: [290, 270, 170, 180], Admin: [470, 270, 170, 180],
  };
  const LAMPS = { UCI: [5, 2], OperatingRoom: [5, 2], ER: [4, 2], Lab: [5, 2], Pharmacy: [3, 2], Admin: [3, 2] };
  const GEN_NAMES = { Large: ["Large", "250 kW"], Medium: ["Medium", "75 kW"], Small: ["Small", "30 kW"] };

  let data, meta;
  const state = { d: 48, b: 55000, lam: 1, hour: 0, playing: false };
  let timer = null;
  const plan = $("plan"), schedule = $("schedule");
  const rooms = {};

  // ------------------------------------------------------------- floor plan

  function buildPlan() {
    const defs = el("defs", {}, plan);
    const f = el("filter", { id: "glow", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
    el("feGaussianBlur", { stdDeviation: 14 }, f);
    el("rect", { x: 6, y: 6, width: 808, height: 458, rx: 6, fill: "#1b242b", stroke: "#6f7d88", "stroke-width": 4 }, plan);
    // corridor and entrance
    el("rect", { x: 20, y: 210, width: 780, height: 50, fill: "#141b21" }, plan);
    el("rect", { x: 650, y: 270, width: 150, height: 180, fill: "#141b21", stroke: "#6f7d88", "stroke-width": 3 }, plan);
    const ent = el("text", { x: 725, y: 365, "text-anchor": "middle", fill: "#5d6b75", "font-size": 15, "font-weight": 700 }, plan);
    ent.textContent = "Entrance";
    // exit sign: always lit, on batteries
    el("rect", { x: 693, y: 400, width: 64, height: 26, rx: 3, fill: "#1d8a5f" }, plan);
    const ex = el("text", { x: 725, y: 418, "text-anchor": "middle", fill: "#e9fff4", "font-size": 13, "font-weight": 700 }, plan);
    ex.textContent = "EXIT";

    for (const s of meta.services) {
      const [x, y, w, h] = ROOMS[s];
      const g = el("g", {}, plan);
      const glow = el("rect", { x: x + 10, y: y + 10, width: w - 20, height: h - 20, fill: "#ffc66b", filter: "url(#glow)", opacity: 0 }, g);
      const floor = el("rect", { x, y, width: w, height: h, fill: "#1c252d", stroke: "#6f7d88", "stroke-width": 3 }, g);
      const light = el("rect", { x: x + 1.5, y: y + 1.5, width: w - 3, height: h - 3, fill: "#ffd48a", opacity: 0 }, g);
      const crit = meta.critical.includes(s);
      if (crit) el("rect", { x, y, width: w, height: 6, fill: "#1d8a5f" }, g);
      // ceiling lamps
      const [cols, rws] = LAMPS[s];
      const lamps = [];
      for (let r = 0; r < rws; r++)
        for (let c = 0; c < cols; c++) {
          const cx = x + ((c + 0.5) / cols) * w, cy = y + 95 + r * 30;
          lamps.push(el("circle", { cx, cy, r: 6, fill: "#2b363f", stroke: "#465460", "stroke-width": 1.5 }, g));
        }
      const name = el("text", { x: x + 14, y: y + 34, "font-size": 19, "font-weight": 700 }, g);
      name.textContent = NAMES[s];
      const sub = el("text", { x: x + 14, y: y + 56, "font-size": 13 }, g);
      sub.textContent = `${meta.demand[s]} kW${crit ? ", critical" : ""}`;
      const pct = el("text", { x: x + w - 14, y: y + 40, "text-anchor": "end", "font-size": 26, "font-weight": 700 }, g);
      const off = el("text", { x: x + w - 14, y: y + 60, "text-anchor": "end", "font-size": 13, "font-weight": 700, fill: "#ff8a7a" }, g);
      rooms[s] = { glow, floor, light, lamps, name, sub, pct, off };
    }
    rooms.clock = el("text", { x: 34, y: 245, "font-size": 24, "font-weight": 700, fill: "#fff0cf" }, plan);
    rooms.clockOf = el("text", { x: 34, y: 245, "font-size": 15, fill: "#a9b6bf" }, plan);
  }

  function drawPlan(sc, t) {
    for (const s of meta.services) {
      const r = rooms[s];
      const v = sc.coverage[s][t];
      const on = v > 0.005;
      r.light.setAttribute("opacity", (on ? 0.14 + 0.81 * v : 0).toFixed(3));
      r.glow.setAttribute("opacity", (on ? 0.25 + 0.55 * v : 0).toFixed(3));
      r.floor.setAttribute("stroke", on ? "#6f7d88" : "#8a3a33");
      const lit = Math.round(v * r.lamps.length);
      r.lamps.forEach((c, i) => {
        c.setAttribute("fill", i < lit ? "#fff0cf" : "#2b363f");
        c.setAttribute("stroke", i < lit ? "#ffc66b" : "#465460");
      });
      const dark = v < 0.45;
      const txt = dark ? "#e7eef2" : "#1f262b";
      r.name.setAttribute("fill", txt);
      r.sub.setAttribute("fill", dark ? "#a9b6bf" : "#3a4650");
      r.pct.setAttribute("fill", on ? txt : "#ff8a7a");
      r.pct.textContent = on ? `${Math.round(v * 100)}%` : "0%";
      r.off.textContent = on ? "" : "No power";
    }
    rooms.clock.textContent = `Hour ${t + 1}`;
    rooms.clockOf.setAttribute("x", 34 + rooms.clock.getComputedTextLength() + 10);
    rooms.clockOf.textContent = `of ${state.d}`;
  }

  // ------------------------------------------------------------- generator yard

  function drawYard(sc, t) {
    const yard = $("yard");
    yard.innerHTML = "";
    for (const g of meta.generators) {
      const nOld = meta.existing[g], nNew = sc.bought[g], running = sc.running[g][t];
      const total = sc.fuel_total[g];
      let used = 0;
      for (let k = 0; k <= t; k++) used += sc.produced[g][k];
      const left = Math.max(0, total - used);
      const units = [];
      for (let i = 0; i < nOld + nNew; i++) {
        const cls = ["unit"];
        if (i >= nOld) cls.push("new");
        if (i < running) cls.push("on");
        units.push(`<span class="${cls.join(" ")}" title="${i >= nOld ? "Bought" : "Already owned"}${i < running ? ", running" : ""}"></span>`);
      }
      const row = document.createElement("div");
      row.className = "gen";
      row.innerHTML = `<div class="gen-name">${GEN_NAMES[g][0]}<small>${GEN_NAMES[g][1]} each</small></div>
        <div><div class="units">${units.join("")}</div>
        <div class="tank" aria-hidden="true"><span style="width:${total ? (100 * left) / total : 0}%"></span></div>
        <div class="tank-label">${Math.round(left)} of ${total} kWh of fuel left${nNew ? `, ${nNew} bought` : ""}</div></div>`;
      yard.appendChild(row);
    }
    const sv = $("statSurvival");
    sv.textContent = `${sc.survival_hours} of ${state.d} h`;
    sv.className = sc.survival_hours === state.d ? "good" : "bad";
    $("statSpent").textContent = money(sc.spent);
    const load = meta.services.reduce((a, s) => a + meta.demand[s] * sc.coverage[s][t], 0);
    $("statLoad").textContent = `${load.toFixed(0)} of 120 kW`;
  }

  // ------------------------------------------------------------- schedule heat strip

  let playhead;
  function buildSchedule(sc) {
    schedule.innerHTML = "";
    const d = state.d, L = 150, W = 1000, rowH = 22, top = 22;
    const cw = (W - L - 6) / d;
    schedule.setAttribute("viewBox", `0 0 ${W} ${top + rowH * meta.services.length + 6}`);
    for (let k = 0; k < d; k += d > 36 ? 6 : 3) {
      const tx = el("text", { x: L + k * cw + 2, y: 14, "font-size": 12, fill: "#a9b6bf" }, schedule);
      tx.textContent = k === 0 ? "hour 1" : k + 1;
    }
    meta.services.forEach((s, i) => {
      const y = top + i * rowH;
      const lab = el("text", { x: 0, y: y + 15, "font-size": 13, fill: "#dfe6ea", "font-weight": meta.critical.includes(s) ? 700 : 400 }, schedule);
      lab.textContent = NAMES[s];
      for (let k = 0; k < d; k++) {
        const v = sc.coverage[s][k];
        el("rect", {
          x: L + k * cw, y, width: Math.max(1, cw - 1), height: rowH - 3, rx: 2,
          fill: v > 0.005 ? "#ffc66b" : "#5a2721", opacity: v > 0.005 ? (0.15 + 0.85 * v).toFixed(3) : 0.9,
        }, schedule);
      }
    });
    playhead = el("rect", { y: top - 4, width: cw + 2, height: rowH * meta.services.length + 6, fill: "none", stroke: "#fff0cf", "stroke-width": 2, rx: 3 }, schedule);
    schedule._geom = { L, cw };
    schedule.onclick = (e) => {
      const r = schedule.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const k = Math.floor((x - L) / cw);
      if (k >= 0 && k < d) { pause(); setHour(k); }
    };
  }

  // ------------------------------------------------------------- state and playback

  // keys were written by Python, which prints whole floats as "1.0"
  const key = () => `${state.d}|${state.b}|${Number.isInteger(state.lam) ? state.lam.toFixed(1) : state.lam}`;
  const current = () => data.scenarios[key()];

  function render() {
    const sc = current();
    const t = state.hour;
    drawPlan(sc, t);
    drawYard(sc, t);
    const { L, cw } = schedule._geom;
    playhead.setAttribute("x", L + t * cw - 1.5);
    const hourEl = $("hour");
    hourEl.max = state.d;
    hourEl.value = t + 1;
  }

  function setHour(t) { state.hour = Math.max(0, Math.min(state.d - 1, t)); render(); }
  function pause() { state.playing = false; clearInterval(timer); $("play").textContent = "Play"; $("play").setAttribute("aria-label", "Play"); }
  function play() {
    if (state.hour >= state.d - 1) state.hour = 0;
    state.playing = true;
    $("play").textContent = "Pause";
    $("play").setAttribute("aria-label", "Pause");
    clearInterval(timer);
    timer = setInterval(() => {
      if (state.hour >= state.d - 1) { pause(); return; }
      setHour(state.hour + 1);
    }, Math.max(110, 11000 / state.d));
  }

  function scenarioChanged({ autoplay = true } = {}) {
    buildSchedule(current());
    state.hour = 0;
    render();
    syncControls();
    if (autoplay && !reduceMotion) play(); else pause();
  }

  function syncControls() {
    document.querySelectorAll("#segDuration button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.d === state.d)));
    $("budget").value = meta.budgets.indexOf(state.b);
    $("budgetValue").textContent = short(state.b);
    $("lambda").value = meta.lambdas.indexOf(state.lam);
    $("lambdaValue").textContent = `Priority weight on utility: ${state.lam}`;
  }

  function bindControls() {
    const seg = $("segDuration");
    meta.durations.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.d = d;
      b.textContent = `${d} h`;
      b.onclick = () => { state.d = d; scenarioChanged(); };
      seg.appendChild(b);
    });
    $("budget").max = meta.budgets.length - 1;
    $("budget").addEventListener("input", (e) => { state.b = meta.budgets[+e.target.value]; scenarioChanged(); });
    $("lambda").max = meta.lambdas.length - 1;
    $("lambda").addEventListener("input", (e) => { state.lam = meta.lambdas[+e.target.value]; scenarioChanged(); });
    $("hour").addEventListener("input", (e) => { pause(); setHour(+e.target.value - 1); });
    $("play").addEventListener("click", () => (state.playing ? pause() : play()));
    document.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
      const [d, b, lam] = btn.dataset.preset.split("|").map(Number);
      Object.assign(state, { d, b, lam });
      scenarioChanged();
      document.querySelector(".console").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }));
  }

  fetch("docs/scenarios.json")
    .then((r) => r.json())
    .then((json) => {
      data = json;
      meta = json.meta;
      buildPlan();
      bindControls();
      scenarioChanged();
    })
    .catch(() => {
      plan.insertAdjacentHTML("afterend", '<p style="color:#ff8a7a">Could not load the scenarios. If you opened the file directly, run a local server: python -m http.server</p>');
    });
})();

const $ = (id) => document.getElementById(id);

// ✅ 너의 Worker 주소로 바꿔!
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev/api/fundamentals?ticker=AAPL";

let peersMap = {};

function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function loadPeers() {
  const r = await fetch("../peers.json", { cache: "no-store" });
  peersMap = r.ok ? await r.json() : {};
}

function renderSingle(d) {
  $("result").classList.remove("hidden");
  $("company").textContent = `${d.name} (${d.ticker})`;
  $("per").textContent = fmt(d.per);
  $("pbr").textContent = fmt(d.pbr);
  $("ev").textContent = fmt(d.ev_ebitda);
  $("eps").textContent = fmt(d.eps);
}

function renderSuggestions(list) {
  const box = $("suggestions");
  if (!list || list.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = list.map(x => `
    <div class="item" data-symbol="${x.symbol}">
      <b>${x.symbol}</b> — ${x.name} <span style="color:#777;font-size:12px">(${x.exchangeShortName || ""})</span>
    </div>
  `).join("");

  box.querySelectorAll(".item").forEach(el => {
    el.addEventListener("click", () => {
      $("q").value = el.dataset.symbol;
      box.classList.add("hidden");
      box.innerHTML = "";
      search();
    });
  });
}

async function apiSearch(q) {
  const url = `${WORKER_BASE}/api/search?q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];
  return r.json();
}

async function fetchFundamentals(ticker) {
  const url = `${WORKER_BASE}/api/fundamentals?ticker=${encodeURIComponent(ticker)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

async function renderPeers(baseTicker, baseRow) {
  const peers = peersMap[baseTicker] || [].slice(0, 3);
  const rows = [baseRow];

  for (const p of peers) {
    try {
      rows.push(await fetchFundamentals(p));
    } catch (_) {}
  }

  if (rows.length <= 1) {
    $("peers").classList.add("hidden");
    $("peerTable").querySelector("tbody").innerHTML = "";
    return;
  }

  $("peers").classList.remove("hidden");
  $("peerTable").querySelector("tbody").innerHTML = rows.map(d => `
    <tr>
      <td>${d.ticker}</td>
      <td>${d.name}</td>
      <td>${fmt(d.per)}</td>
      <td>${fmt(d.pbr)}</td>
      <td>${fmt(d.ev_ebitda)}</td>
      <td>${fmt(d.eps)}</td>
    </tr>
  `).join("");
}

async function search() {
  const raw = $("q").value.trim();
  if (!raw) return;

  // UI 초기화
  $("hint").textContent = "조회 중...";
  $("result").classList.add("hidden");
  $("peers").classList.add("hidden");

  // MVP: 입력이 티커면 그대로, 기업명이면 자동완성에서 선택 유도
  const ticker = raw.toUpperCase();

  try {
    const base = await fetchFundamentals(ticker);
    renderSingle(base);
    await renderPeers(ticker, base);
    $("hint").textContent = `As of: ${base.asof || "-"}`;
  } catch (e) {
    $("hint").textContent = `조회 실패: ${e.message} (티커를 확인하거나 자동완성에서 선택)`;
  }
}

let debounceTimer = null;
function onType() {
  const q = $("q").value.trim();
  if (q.length < 2) {
    renderSuggestions([]);
    return;
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    // 티커처럼 보이면 자동완성 생략
    if (/^[A-Za-z.\-]{1,10}$/.test(q) && q.length <= 6) {
      renderSuggestions([]);
      return;
    }
    const list = await apiSearch(q);
    renderSuggestions(list);
  }, 250);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadPeers();

  $("btn").addEventListener("click", search);
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  $("q").addEventListener("input", onType);
});

const $ = (id) => document.getElementById(id);

// ✅ 네 Worker 주소
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev";

let peersMap = {};
let lastBaseRow = null;
let lastTicker = null;
let isLoading = false;

function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function loadPeers() {
  try {
    const r = await fetch("../peers.json", { cache: "no-store" });
    peersMap = r.ok ? await r.json() : {};
  } catch (_) {
    peersMap = {};
  }
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

  if (!r.ok) {
    let msg = `API error ${r.status}`;
    try {
      const j = await r.json();
      msg = j?.message ? j.message : msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

function resetUIForSearch() {
  $("hint").textContent = "조회 중...";
  $("suggestions").classList.add("hidden");
  $("suggestions").innerHTML = "";

  $("result").classList.add("hidden");
  $("peers").classList.add("hidden");

  $("loadPeersBtn").classList.add("hidden");
  $("loadPeersBtn").disabled = false;
  $("loadPeersBtn").textContent = "경쟁사 비교 보기 (최대 3개)";
  $("peerStatus").textContent = "";

  lastBaseRow = null;
  lastTicker = null;
}

function renderSingle(d) {
  $("result").classList.remove("hidden");
  $("company").textContent = `${d.name} (${d.ticker})`;
  $("asof").textContent = `As of: ${d.asof || "-"}`;

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

  // ✅ button으로 렌더(클릭 안정성↑)
  box.innerHTML = list.map(x => `
    <button type="button" class="item" data-symbol="${x.symbol}">
      <b>${x.symbol}</b> — ${x.name}
      <span class="ex"> ${x.exchange ? `(${x.exchange})` : ""}</span>
    </button>
  `).join("");

  // ❌ 여기 있던 box.querySelectorAll(".item").forEach(...) 블록은 삭제!
}

function isTickerLike(s) {
  return /^[A-Za-z0-9.\-]{1,12}$/.test(s);
}

async function search() {
  const raw = $("q").value.trim();
  if (!raw) return;
  if (isLoading) return;

  isLoading = true;
  resetUIForSearch();

  try {
    // 기업명 입력이면 자동완성 유도
    if (!isTickerLike(raw) || raw.length > 6) {
      $("hint").textContent = "기업명으로 인식됨. 아래 목록에서 선택하세요.";
      const list = await apiSearch(raw);
      renderSuggestions(list);
      return;
    }

    const ticker = raw.toUpperCase();
    const base = await fetchFundamentals(ticker);

    lastBaseRow = base;
    lastTicker = ticker;

    renderSingle(base);
    $("loadPeersBtn").classList.remove("hidden");

    const peers = (peersMap[ticker] || []).slice(0, 3);
    $("peerStatus").textContent = peers.length
      ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
      : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

    $("hint").textContent = "";
  } catch (e) {
    $("hint").textContent = `조회 실패: ${e.message}`;
  } finally {
    isLoading = false;
  }
}

function renderPeersTable(rows) {
  const tbody = $("peerTable").querySelector("tbody");

  tbody.innerHTML = rows.map(d => `
    <tr>
      <td>${d.ticker}</td>
      <td>${d.name}</td>
      <td class="num">${fmt(d.per)}</td>
      <td class="num">${fmt(d.pbr)}</td>
      <td class="num">${fmt(d.ev_ebitda)}</td>
      <td class="num">${fmt(d.eps)}</td>
    </tr>
  `).join("");
}

async function loadPeersBtn() {
  if (!lastTicker || !lastBaseRow) return;

  $("loadPeersBtn").disabled = true;
  $("loadPeersBtn").textContent = "불러오는 중...";
  $("peerStatus").textContent = "";

  const peers = (peersMap[lastTicker] || []).slice(0, 3);
  const rows = [lastBaseRow];

  for (const p of peers) {
    try {
      rows.push(await fetchFundamentals(p));
    } catch (_) {}
  }

  renderPeersTable(rows);
  $("peers").classList.remove("hidden");
  $("loadPeersBtn").textContent = "경쟁사 비교 완료";
  $("peerStatus").textContent = "완료";
}

let debounceTimer = null;
function onType() {
  const q = $("q").value.trim();
  if (q.length < 2) {
    renderSuggestions([]);
    return;
  }
  if (isTickerLike(q) && q.length <= 6) {
    renderSuggestions([]);
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const list = await apiSearch(q);
      renderSuggestions(list);
    } catch (_) {
      renderSuggestions([]);
    }
  }, 250);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadPeers();

  $("btn").addEventListener("click", search);
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  $("q").addEventListener("input", onType);

  $("loadPeersBtn").addEventListener("click", loadPeersBtn);
    // ✅ 자동완성 클릭 이벤트 위임(이게 핵심)
  $("suggestions").addEventListener("click", (e) => {
    const el = e.target.closest(".item[data-symbol]");
    if (!el) return;

    $("q").value = el.dataset.symbol;

    $("suggestions").classList.add("hidden");
    $("suggestions").innerHTML = "";

    search();
  });
});

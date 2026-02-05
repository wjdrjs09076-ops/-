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
    const r = await fetch("./peers.json", { cache: "no-store" });
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

  // ✅ button으로 렌더(클릭/터치 안정성↑)
  box.innerHTML = list.map(x => `
    <button type="button" class="item" data-symbol="${x.symbol}">
      <b>${x.symbol}</b> — ${x.name}
      <span class="ex"> ${x.exchange ? `(${x.exchange})` : ""}</span>
    </button>
  `).join("");
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

/* =========================
   ✅ 이벤트 바인딩은 "즉시" (peers 로딩 기다리지 않음)
   ✅ 자동완성은 click 대신 pointerdown(캡처)로 확실하게
========================= */
document.addEventListener("DOMContentLoaded", () => {
  // 1) 리스너 먼저 붙임 (중요)
  $("btn").addEventListener("click", search);

  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    } else if (e.key === "Escape") {
      $("suggestions").classList.add("hidden");
      $("suggestions").innerHTML = "";
    }
  });

  $("q").addEventListener("input", onType);
  $("loadPeersBtn").addEventListener("click", loadPeersBtn);

  // ✅ 자동완성 클릭/터치가 씹히는 문제 방지: pointerdown + capture
  const sug = $("suggestions");
  sug.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".item[data-symbol]");
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    $("q").value = el.dataset.symbol;

    sug.classList.add("hidden");
    sug.innerHTML = "";

    search();
  }, { capture: true, passive: false });

  // 바깥 클릭하면 닫기
  document.addEventListener("pointerdown", (e) => {
    if (e.target === $("q") || sug.contains(e.target)) return;
    sug.classList.add("hidden");
  }, { capture: true });

  // 2) peers는 “나중에” 로드 (여기서 await 안 함)
  loadPeers();
});

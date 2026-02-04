const $ = (id) => document.getElementById(id);

// ✅ 네 Worker 주소 (이미 이 주소가 맞다고 했음)
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev";

let peersMap = {};
let lastBaseRow = null;
let lastTicker = null;

let sortState = { key: "ticker", dir: "asc" }; // table sort

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
      if (j?.message) msg = j.message;
      if (j?.error) msg = `${j.error}: ${j.message || msg}`;
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
  box.innerHTML = list.map(x => `
    <div class="item" data-symbol="${x.symbol}">
      <b>${x.symbol}</b> — ${x.name}
      <span style="color:#666;font-size:12px"> ${x.exchange ? `(${x.exchange})` : ""}</span>
    </div>
  `).join("");

  box.querySelectorAll(".item").forEach(el => {
    el.addEventListener("click", () => {
      $("q").value = el.dataset.symbol;
      box.classList.add("hidden");
      box.innerHTML = "";
      search(); // 선택 즉시 검색
    });
  });
}

function isTickerLike(s) {
  return /^[A-Za-z0-9.\-]{1,12}$/.test(s);
}

async function search() {
  const raw = $("q").value.trim();
  if (!raw) return;

  resetUIForSearch();

  // MVP: 티커처럼 보이면 티커로, 아니면 자동완성 유도
  const maybeTicker = raw.toUpperCase();

  try {
    if (!isTickerLike(raw) || raw.length > 6) {
      // 기업명 가능성 높음 -> 자동완성 먼저
      $("hint").textContent = "기업명으로 인식됨. 아래 목록에서 선택하세요.";
      const list = await apiSearch(raw);
      renderSuggestions(list);
      return;
    }

    // 티커로 조회 (본 기업만 1회 호출)
    const base = await fetchFundamentals(maybeTicker);

    lastBaseRow = base;
    lastTicker = maybeTicker;

    renderSingle(base);
    $("loadPeersBtn").classList.remove("hidden");

    const peers = (peersMap[maybeTicker] || []).slice(0, 3);
    $("peerStatus").textContent = peers.length
      ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
      : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

    $("hint").textContent = "";
  } catch (e) {
    // 내일 전까지는 제한 때문에 여기로 올 가능성이 높음
    $("hint").textContent = `조회 실패: ${e.message}`;
  }
}

function normalizeRowForTable(d) {
  return {
    ticker: d.ticker,
    name: d.name,
    per: d.per,
    pbr: d.pbr,
    ev_ebitda: d.ev_ebitda,
    eps: d.eps,
  };
}

function compare(a, b, dir) {
  const mul = dir === "asc" ? 1 : -1;

  // null은 항상 아래로
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  // 숫자 우선
  const an = Number(a), bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * mul;

  // 문자열
  return String(a).localeCompare(String(b)) * mul;
}

function percentileBands(values) {
  // 하이라이트용: 상/하 33% 정도를 단순 표시
  const nums = values.filter(v => Number.isFinite(Number(v))).map(Number).sort((x,y)=>x-y);
  if (nums.length < 3) return { low: null, high: null };
  const lowIdx = Math.floor(nums.length * 0.33);
  const highIdx = Math.floor(nums.length * 0.67);
  return { low: nums[lowIdx], high: nums[highIdx] };
}

function renderPeersTable(rows) {
  const tbody = $("peerTable").querySelector("tbody");

  const norm = rows.map(normalizeRowForTable);

  // 정렬 적용
  const key = sortState.key;
  const dir = sortState.dir;
  norm.sort((x, y) => compare(x[key], y[key], dir));

  // 하이라이트 기준 계산(각 지표별)
  const perBand = percentileBands(norm.map(r => r.per));
  const pbrBand = percentileBands(norm.map(r => r.pbr));
  const evBand  = percentileBands(norm.map(r => r.ev_ebitda));
  const epsBand = percentileBands(norm.map(r => r.eps));

  function cellClass(val, band, inverse=false) {
    if (val == null) return "missing num";
    const n = Number(val);
    if (!Number.isFinite(n)) return "missing num";

    // inverse=false: 낮으면 good, 높으면 bad (PER/PBR/EVEBITDA)
    // inverse=true: EPS는 높을수록 good
    if (!band.low && !band.high) return "num";
    if (!inverse) {
      if (band.low != null && n <= band.low) return "good num";
      if (band.high != null && n >= band.high) return "bad num";
    } else {
      if (band.high != null && n >= band.high) return "good num";
      if (band.low != null && n <= band.low) return "bad num";
    }
    return "num";
  }

  tbody.innerHTML = norm.map(r => `
    <tr>
      <td>${r.ticker}</td>
      <td>${r.name}</td>
      <td class="${cellClass(r.per, perBand, false)}">${fmt(r.per)}</td>
      <td class="${cellClass(r.pbr, pbrBand, false)}">${fmt(r.pbr)}</td>
      <td class="${cellClass(r.ev_ebitda, evBand, false)}">${fmt(r.ev_ebitda)}</td>
      <td class="${cellClass(r.eps, epsBand, true)}">${fmt(r.eps)}</td>
    </tr>
  `).join("");
}

async function loadPeers() {
  if (!lastTicker || !lastBaseRow) return;

  $("loadPeersBtn").disabled = true;
  $("loadPeersBtn").textContent = "불러오는 중...";
  $("peerStatus").textContent = "";

  const peers = (peersMap[lastTicker] || []).slice(0, 3);
  const rows = [lastBaseRow];

  for (const p of peers) {
    try {
      rows.push(await fetchFundamentals(p));
    } catch (e) {
      // 일부 실패해도 계속 진행
    }
  }

  renderPeersTable(rows);
  $("peers").classList.remove("hidden");

  $("loadPeersBtn").textContent = "경쟁사 비교 완료";
  $("peerStatus").textContent = peers.length ? `표 정렬은 헤더 클릭` : `경쟁사 없음`;
}

let debounceTimer = null;
function onType() {
  const q = $("q").value.trim();
  if (q.length < 2) {
    renderSuggestions([]);
    return;
  }

  // 티커처럼 보이면 자동완성 호출 안 함 (호출 절약)
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

function initSortHandlers() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (!key) return;

      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.dir = "asc";
      }

      // 이미 표가 열려 있으면 다시 렌더
      const tbody = $("peerTable").querySelector("tbody");
      if (tbody && tbody.children.length > 0 && lastBaseRow) {
        // 현재 테이블 행을 재구성하려면 rows 원본이 필요하니,
        // 간단히: peers 버튼을 다시 누르도록 유도하는 대신, 마지막 결과를 메모해두는 구조가 더 깔끔.
        // 여기서는 UX를 위해 "다시 로드" 없이 정렬만 하고 싶으므로, 현재 DOM에서 값 재파싱은 생략.
        // 대신 마지막으로 계산한 rows를 보존하려면 전역에 rows 저장하면 됨.
        // MVP에서는: 버튼을 다시 눌러서 재정렬하도록 안내.
        $("peerStatus").textContent = `정렬 변경됨 (${sortState.key} · ${sortState.dir}). 필요하면 버튼을 다시 눌러 갱신하세요.`;
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadPeers();

  $("btn").addEventListener("click", search);
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  $("q").addEventListener("input", onType);

  $("loadPeersBtn").addEventListener("click", loadPeers);

  initSortHandlers();
});

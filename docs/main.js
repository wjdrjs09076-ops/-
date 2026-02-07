// ====== Config ======
const API_BASE = ""; // same origin (GitHub Pages + Worker proxy라면 절대경로로 바꿔도 됨)
const COMPARE_KEY = "multiples_compare_list_v1";
const MAX_COMPARE = 4; // 원하는 개수로 변경 가능

// ====== DOM ======
const $q = document.getElementById("q");
const $btn = document.getElementById("btn");
const $hint = document.getElementById("hint");
const $suggestions = document.getElementById("suggestions");

const $companyTitle = document.getElementById("companyTitle");
const $asof = document.getElementById("asof");
const $per = document.getElementById("per");
const $pbr = document.getElementById("pbr");
const $ev = document.getElementById("ev");
const $eps = document.getElementById("eps");
const $resultHint = document.getElementById("resultHint");

const $btnAddCompare = document.getElementById("btnAddCompare");
const $btnClearCompare = document.getElementById("btnClearCompare");
const $btnRefreshCompare = document.getElementById("btnRefreshCompare");

const $peerTableBody = document.querySelector("#peerTable tbody");
const $compareHint = document.getElementById("compareHint");

// ====== State ======
let current = null; // last fetched fundamentals object

// ====== Utils ======
function fmtNum(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "-";
  const v = Number(x);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtEPS(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "-";
  const v = Number(x);
  if (!Number.isFinite(v)) return "-";
  // EPS는 소수 자릿수 과하면 보기 안좋아서 2자리만
  return v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function setHint(el, msg = "") {
  el.textContent = msg;
}

function loadCompare() {
  try {
    const raw = localStorage.getItem(COMPARE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveCompare(arr) {
  localStorage.setItem(COMPARE_KEY, JSON.stringify(arr));
}

function upsertCompare(item) {
  const list = loadCompare();

  // 중복 제거 (ticker 기준)
  const existsIdx = list.findIndex(x => x.ticker === item.ticker);
  if (existsIdx >= 0) {
    list[existsIdx] = item; // 최신값으로 갱신
    saveCompare(list);
    return { list, action: "updated" };
  }

  if (list.length >= MAX_COMPARE) {
    return { list, action: "full" };
  }

  list.push(item);
  saveCompare(list);
  return { list, action: "added" };
}

function removeCompare(ticker) {
  const list = loadCompare().filter(x => x.ticker !== ticker);
  saveCompare(list);
  return list;
}

function clearCompare() {
  saveCompare([]);
  return [];
}

// ====== API ======
async function apiSearch(q) {
  const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return await r.json();
}
async function apiFundamentals(ticker) {
  const r = await fetch(`${API_BASE}/api/fundamentals?ticker=${encodeURIComponent(ticker)}`);
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return await r.json();
}

// ====== UI Render ======
function renderCurrent(data) {
  current = data;

  const name = data?.name || "-";
  const ticker = data?.ticker ? ` (${data.ticker})` : "";
  $companyTitle.textContent = `${name}${ticker}`;

  $asof.textContent = data?.asof ? `As of: ${data.asof}` : "As of: -";

  $per.textContent = fmtNum(data?.per, 2);
  $pbr.textContent = fmtNum(data?.pbr, 2);
  $ev.textContent = fmtNum(data?.ev_ebitda, 2);
  $eps.textContent = fmtEPS(data?.eps);

  // 버튼 활성화
  $btnAddCompare.disabled = !(data && data.ticker);

  // 안내
  const src = data?.source ? `source: ${data.source}` : "";
  setHint($resultHint, src);
}

function renderCompareTable() {
  const list = loadCompare();

  $peerTableBody.innerHTML = "";

  if (list.length === 0) {
    setHint($compareHint, "비교함이 비어있습니다. 위에서 기업을 검색한 뒤 [비교함에 추가]를 누르세요.");
    return;
  }
  setHint($compareHint, `현재 ${list.length}개 저장됨 (최대 ${MAX_COMPARE}개)`);

  for (const x of list) {
    const tr = document.createElement("tr");

    const tdTicker = document.createElement("td");
    tdTicker.textContent = x.ticker || "-";

    const tdName = document.createElement("td");
    tdName.textContent = x.name || "-";

    const tdPer = document.createElement("td");
    tdPer.className = "num";
    tdPer.textContent = fmtNum(x.per, 2);

    const tdPbr = document.createElement("td");
    tdPbr.className = "num";
    tdPbr.textContent = fmtNum(x.pbr, 2);

    const tdEv = document.createElement("td");
    tdEv.className = "num";
    tdEv.textContent = fmtNum(x.ev_ebitda, 2);

    const tdEps = document.createElement("td");
    tdEps.className = "num";
    tdEps.textContent = fmtEPS(x.eps);

    const tdDel = document.createElement("td");
    tdDel.className = "num";
    const btnDel = document.createElement("button");
    btnDel.textContent = "삭제";
    btnDel.className = "btn-ghost";
    btnDel.addEventListener("click", () => {
      removeCompare(x.ticker);
      renderCompareTable();
    });
    tdDel.appendChild(btnDel);

    tr.append(tdTicker, tdName, tdPer, tdPbr, tdEv, tdEps, tdDel);
    $peerTableBody.appendChild(tr);
  }
}

function showSuggestions(items) {
  if (!items || items.length === 0) {
    $suggestions.classList.add("hidden");
    $suggestions.innerHTML = "";
    return;
  }
  $suggestions.classList.remove("hidden");
  $suggestions.innerHTML = items.map((x, idx) => {
    const sym = x.symbol || "";
    const nm = x.name || "";
    const ex = x.exchange ? ` · ${x.exchange}` : "";
    return `
      <div class="sug" data-idx="${idx}" data-symbol="${sym}">
        <div class="sug-main">${nm}</div>
        <div class="sug-sub">${sym}${ex}</div>
      </div>
    `;
  }).join("");

  // click handlers
  Array.from($suggestions.querySelectorAll(".sug")).forEach(el => {
    el.addEventListener("click", async () => {
      const sym = el.getAttribute("data-symbol");
      $q.value = sym;
      $suggestions.classList.add("hidden");
      await doFetch(sym);
    });
  });
}

// ====== Actions ======
async function doFetch(tickerOrQuery) {
  try {
    setHint($hint, "불러오는 중...");
    const t = String(tickerOrQuery || "").trim();
    if (!t) return;

    // 사용자가 "삼성전자"처럼 넣으면 검색 결과 1개를 골라서 fundamentals 호출
    let ticker = t;
    if (!/[A-Za-z0-9]/.test(t) || (!t.includes(".") && !/^[A-Z]{1,5}$/.test(t))) {
      const res = await apiSearch(t);
      if (!res || res.length === 0) {
        setHint($hint, "검색 결과가 없습니다.");
        return;
      }
      ticker = res[0].symbol;
    }

    const data = await apiFundamentals(ticker);
    renderCurrent(data);
    setHint($hint, "");
  } catch (e) {
    setHint($hint, `에러: ${e.message || e}`);
  }
}

// ====== Events ======
$btn.addEventListener("click", async () => {
  await doFetch($q.value);
});

$q.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    await doFetch($q.value);
  }
});

// 자동완성: 입력 멈춘 후 검색
let searchTimer = null;
$q.addEventListener("input", () => {
  const v = $q.value.trim();
  if (searchTimer) clearTimeout(searchTimer);

  if (!v) {
    showSuggestions([]);
    setHint($hint, "");
    return;
  }

  searchTimer = setTimeout(async () => {
    try {
      const res = await apiSearch(v);
      showSuggestions(res.slice(0, 8));
    } catch {
      showSuggestions([]);
    }
  }, 250);
});

// 비교함 추가
$btnAddCompare.addEventListener("click", () => {
  if (!current?.ticker) return;

  const item = {
    ticker: current.ticker,
    name: current.name,
    per: current.per,
    pbr: current.pbr,
    ev_ebitda: current.ev_ebitda,
    eps: current.eps,
    asof: current.asof,
    country: current.country,
  };

  const { action } = upsertCompare(item);

  if (action === "full") {
    setHint($compareHint, `비교함은 최대 ${MAX_COMPARE}개까지입니다. 먼저 일부를 삭제하세요.`);
  } else if (action === "updated") {
    setHint($compareHint, "이미 있는 종목이라 최신 값으로 갱신했습니다.");
  } else {
    setHint($compareHint, "비교함에 추가했습니다.");
  }

  renderCompareTable();
});

// 비교함 비우기
$btnClearCompare.addEventListener("click", () => {
  clearCompare();
  renderCompareTable();
  setHint($compareHint, "비교함을 비웠습니다.");
});

// 비교함 새로고침: 저장된 ticker들 다시 fundamentals 호출해서 값 업데이트
$btnRefreshCompare.addEventListener("click", async () => {
  const list = loadCompare();
  if (list.length === 0) {
    setHint($compareHint, "비교함이 비어있습니다.");
    return;
  }

  setHint($compareHint, "비교함 데이터 업데이트 중...");
  const updated = [];

  for (const x of list) {
    try {
      const data = await apiFundamentals(x.ticker);
      updated.push({
        ticker: data.ticker,
        name: data.name,
        per: data.per,
        pbr: data.pbr,
        ev_ebitda: data.ev_ebitda,
        eps: data.eps,
        asof: data.asof,
        country: data.country,
      });
    } catch {
      // 실패하면 기존 값 유지
      updated.push(x);
    }
  }

  saveCompare(updated);
  renderCompareTable();
  setHint($compareHint, "업데이트 완료");
});

// 초기 렌더
renderCompareTable();
renderCurrent({ name: "-", ticker: "", asof: "-", per: null, pbr: null, ev_ebitda: null, eps: null });

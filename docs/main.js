const $ = (id) => document.getElementById(id);

// ✅ 네 Worker 주소
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev";

// ✅ 비교함(LocalStorage) 키
const COMPARE_KEY = "multiples_compare_v1";

let krMap = null;          // { "005930": {corp_code, name}, ... }
let krList = [];           // [{ code:"005930", name:"삼성전자" }, ...]
let lastBaseRow = null;
let lastTicker = null;
let isLoading = false;

/* =========================
   Format / Utils
========================= */
function fmt(x) {
  if (x === null || x === undefined) return "-";
  if (typeof x === "string") {
    const t = x.trim().toLowerCase();
    if (!t || t === "null" || t === "nan" || t === "undefined") return "-";
  }
  const v = Number(x);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function normName(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/㈜/g, "")
    .trim()
    .toLowerCase();
}

function hasHangul(s) {
  return /[ㄱ-ㅎ가-힣]/.test(String(s || ""));
}

function isTickerLike(s) {
  return /^[A-Za-z0-9.\-]{1,16}$/.test(s);
}

function isKrCode6(s) {
  return /^\d{6}$/.test(String(s || ""));
}
function isKrTicker(s) {
  return /^\d{6}\.(KS|KQ)$/i.test(String(s || ""));
}

/* =========================
   LocalStorage Compare Box
========================= */
function loadCompareList() {
  try {
    const raw = localStorage.getItem(COMPARE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function saveCompareList(arr) {
  localStorage.setItem(COMPARE_KEY, JSON.stringify(arr));
}

function addToCompare(row) {
  if (!row?.ticker) return { ok: false, msg: "ticker 없음" };

  const list = loadCompareList();
  const exists = list.some((x) => String(x?.ticker).toUpperCase() === String(row.ticker).toUpperCase());
  if (exists) return { ok: false, msg: "이미 비교함에 있음" };

  // 너무 커지지 않게(권장 4개, 하지만 제한은 12개 정도)
  if (list.length >= 12) return { ok: false, msg: "비교함이 가득 찼습니다(최대 12개)" };

  list.push({ ticker: row.ticker, name: row.name || row.ticker });
  saveCompareList(list);
  return { ok: true, msg: "추가됨" };
}

function removeFromCompare(ticker) {
  const t = String(ticker || "").toUpperCase();
  const list = loadCompareList().filter((x) => String(x?.ticker).toUpperCase() !== t);
  saveCompareList(list);
}

function clearCompare() {
  saveCompareList([]);
}

/* =========================
   Data Loaders
========================= */
async function loadKrMap() {
  try {
    const r = await fetch("./kr_corp_map.json", { cache: "no-store" });
    if (!r.ok) {
      krMap = null;
      krList = [];
      return;
    }
    krMap = await r.json();
    krList = Object.entries(krMap).map(([code, v]) => ({
      code,
      name: v?.name || code,
      _n: normName(v?.name || ""),
    }));
  } catch (_) {
    krMap = null;
    krList = [];
  }
}

async function apiSearchUS(q) {
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

/* =========================
   KR Suggestions / Resolve
========================= */
function krSuggest(q) {
  if (!krList.length) return [];
  const nq = normName(q);
  if (!nq) return [];

  const hits = krList
    .filter((x) => x._n.includes(nq) || x.code.includes(nq))
    .slice(0, 10)
    .map((x) => ({
      symbol: `${x.code}.KS`, // 기본 KS
      name: x.name,
      exchange: "KRX",
      type: "EQUITY",
      note: "(KRX)",
      _code: x.code,
    }));

  return hits;
}

async function resolveAndFetchKRByCode(code6) {
  // 1) .KS 시도 → 2) 실패 시 .KQ 시도
  try {
    return await fetchFundamentals(`${code6}.KS`);
  } catch (e1) {
    return await fetchFundamentals(`${code6}.KQ`);
  }
}

async function resolveAndFetchKRByName(nameKor) {
  const hits = krSuggest(nameKor);
  if (!hits.length) throw new Error("KR 기업명을 찾지 못했습니다. (kr_corp_map.json 기준)");

  if (hits.length === 1) {
    const code6 = hits[0].symbol.slice(0, 6);
    return await resolveAndFetchKRByCode(code6);
  } else {
    $("hint").textContent = "한국 기업명으로 인식됨. 아래 목록에서 선택하세요.";
    renderSuggestions(hits);
    return null; // 선택 유도
  }
}

/* =========================
   UI Helpers
========================= */
function resetUIForSearch() {
  $("hint").textContent = "조회 중...";
  $("suggestions").classList.add("hidden");
  $("suggestions").innerHTML = "";

  $("result").classList.add("hidden");
  $("peers").classList.add("hidden");

  $("peerStatus").textContent = "";
  $("compareHint").textContent = "";

  lastBaseRow = null;
  lastTicker = null;

  // 버튼 상태 초기화
  const addBtn = $("btnAddCompare");
  if (addBtn) addBtn.disabled = true;
}

function renderSingle(d) {
  $("result").classList.remove("hidden");
  $("company").textContent = `${d.name} (${d.ticker})`;
  $("asof").textContent = `As of: ${d.asof || "-"}`;

  $("per").textContent = fmt(d.per);
  $("pbr").textContent = fmt(d.pbr);
  $("ev").textContent = fmt(d.ev_ebitda);
  $("eps").textContent = fmt(d.eps);

  // ✅ 비교함 추가 버튼 활성화
  const addBtn = $("btnAddCompare");
  if (addBtn) {
    addBtn.disabled = false;
  }
}

function renderSuggestions(list) {
  const box = $("suggestions");
  if (!list || list.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");

  box.innerHTML = list
    .slice(0, 10)
    .map(
      (x) => `
      <button type="button" class="item" data-symbol="${x.symbol}">
        <b>${x.symbol}</b> — ${x.name}
        <span class="ex">${x.note ? x.note : (x.exchange ? `(${x.exchange})` : "")}</span>
      </button>
    `
    )
    .join("");
}

function renderCompareTable(rows) {
  const tbody = $("peerTable").querySelector("tbody");
  tbody.innerHTML = rows
    .map(
      (d) => `
    <tr>
      <td>${d.ticker}</td>
      <td>${d.name}</td>
      <td class="num">${fmt(d.per)}</td>
      <td class="num">${fmt(d.pbr)}</td>
      <td class="num">${fmt(d.ev_ebitda)}</td>
      <td class="num">${fmt(d.eps)}</td>
      <td class="num">
        <button type="button" class="mini-del" data-del="${d.ticker}">삭제</button>
      </td>
    </tr>
  `
    )
    .join("");
}

/* =========================
   Core: Search
========================= */
async function search() {
  let raw = $("q").value.trim();
  if (!raw) return;
  if (isLoading) return;

  isLoading = true;
  resetUIForSearch();

  try {
    // ✅ 6자리 숫자면 KR로 간주
    if (isKrCode6(raw)) {
      const base = await resolveAndFetchKRByCode(raw);
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("hint").textContent = "";
      return;
    }

    // ✅ 6자리.KS / 6자리.KQ면 그대로 KR 조회
    if (isKrTicker(raw)) {
      const base = await fetchFundamentals(raw.toUpperCase());
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("hint").textContent = "";
      return;
    }

    // ✅ 한글 포함이면 KR 회사명으로 먼저 처리(로컬 map)
    if (hasHangul(raw)) {
      const base = await resolveAndFetchKRByName(raw);
      if (!base) return; // 여러 개면 선택 대기
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("hint").textContent = "";
      return;
    }

    // ✅ 그 외: US/글로벌
    if (!isTickerLike(raw) || raw.length > 6) {
      $("hint").textContent = "기업명으로 인식됨. 아래 목록에서 선택하세요.";
      const list = await apiSearchUS(raw);
      renderSuggestions(list);
      return;
    }

    const ticker = raw.toUpperCase();
    const base = await fetchFundamentals(ticker);

    lastBaseRow = base;
    lastTicker = ticker;

    renderSingle(base);
    $("hint").textContent = "";
  } catch (e) {
    $("hint").textContent = `조회 실패: ${e.message}`;
  } finally {
    isLoading = false;
  }
}

/* =========================
   Compare Box: Load / Refresh
========================= */
async function loadCompareBox() {
  const list = loadCompareList(); // [{ticker,name}]
  if (!list.length) {
    $("peers").classList.remove("hidden");
    renderCompareTable([]);
    $("compareHint").textContent = "비교함이 비어 있습니다. 검색 후 '비교함에 추가'를 눌러 담아보세요.";
    return;
  }

  $("peerStatus").textContent = "비교함 불러오는 중...";
  $("compareHint").textContent = "";

  // ✅ 병렬로 fundamentals 로드(실패한 건 건너뜀)
  const rows = [];
  const jobs = list.map(async (x) => {
    try {
      const d = await fetchFundamentals(x.ticker);
      rows.push(d);
    } catch (_) {}
  });
  await Promise.all(jobs);

  // ticker 순서 유지하고 싶으면 재정렬
  const order = new Map(list.map((x, i) => [String(x.ticker).toUpperCase(), i]));
  rows.sort((a, b) => (order.get(String(a.ticker).toUpperCase()) ?? 999) - (order.get(String(b.ticker).toUpperCase()) ?? 999));

  $("peers").classList.remove("hidden");
  renderCompareTable(rows);

  $("peerStatus").textContent = "";
  if (!rows.length) {
    $("compareHint").textContent = "비교함에는 항목이 있지만, 현재 데이터를 불러오지 못했습니다. (API/네트워크 확인)";
  } else {
    $("compareHint").textContent = `총 ${rows.length}개 비교 중 · 삭제 버튼으로 제거 가능`;
  }
}

/* =========================
   Input Suggestions (debounce)
========================= */
let debounceTimer = null;
function onType() {
  const q = $("q").value.trim();

  if (q.length < 2) {
    renderSuggestions([]);
    return;
  }

  // ✅ KR 한글 입력이면 로컬 map 기반 suggestions
  if (hasHangul(q)) {
    const list = krSuggest(q);
    renderSuggestions(list);
    return;
  }

  // ✅ 6자리 숫자면 KR suggestions
  if (/^\d{2,6}$/.test(q)) {
    const list = krSuggest(q);
    renderSuggestions(list);
    return;
  }

  // ✅ 티커처럼 보이면 자동완성 끔(US ticker direct)
  if (isTickerLike(q) && q.length <= 6) {
    renderSuggestions([]);
    return;
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const list = await apiSearchUS(q);
      renderSuggestions(list);
    } catch (_) {
      renderSuggestions([]);
    }
  }, 250);
}

/* =========================
   Event Bindings
========================= */
document.addEventListener("DOMContentLoaded", () => {
  loadKrMap();

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

  // ✅ 비교함 보기
  $("loadPeersBtn").addEventListener("click", () => {
    loadCompareBox();
  });

  // ✅ 비교함에 추가
  const addBtn = $("btnAddCompare");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (!lastBaseRow) return;
      const r = addToCompare(lastBaseRow);
      $("peerStatus").textContent = r.ok ? "비교함에 추가했습니다." : r.msg;
    });
  }

  // ✅ 비교함 비우기
  const clearBtn = $("btnClearCompare");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCompare();
      $("peerStatus").textContent = "비교함을 비웠습니다.";
      // 비교함 탭 열려있으면 즉시 반영
      if (!$("peers").classList.contains("hidden")) loadCompareBox();
    });
  }

  // ✅ 비교함 새로고침
  const refreshBtn = $("btnRefreshCompare");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadCompareBox();
    });
  }

  // ✅ suggestions 선택 (pointerdown으로 안정화)
  const sug = $("suggestions");
  sug.addEventListener(
    "pointerdown",
    async (e) => {
      const el = e.target.closest(".item[data-symbol]");
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      const sym = el.dataset.symbol; // 예: 005930.KS or AAPL
      $("q").value = sym;

      sug.classList.add("hidden");
      sug.innerHTML = "";

      // ✅ KR 제안(005930.KS)인데 KS가 실패할 수 있으니 6자리면 fallback 조회
      if (isKrTicker(sym)) {
        const code6 = sym.slice(0, 6);
        isLoading = true;
        resetUIForSearch();
        try {
          const base = await resolveAndFetchKRByCode(code6);
          lastBaseRow = base;
          lastTicker = base.ticker;

          renderSingle(base);
          $("hint").textContent = "";
        } catch (err) {
          $("hint").textContent = `조회 실패: ${err.message}`;
        } finally {
          isLoading = false;
        }
        return;
      }

      // 그 외는 일반 search로 처리
      search();
    },
    { capture: true, passive: false }
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target === $("q") || sug.contains(e.target)) return;
      sug.classList.add("hidden");
    },
    { capture: true }
  );

  // ✅ 비교함 테이블 내 "삭제" 버튼 위임
  $("peerTable").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-del]");
    if (!btn) return;
    const t = btn.dataset.del;
    removeFromCompare(t);
    loadCompareBox(); // 즉시 재렌더
  });
});

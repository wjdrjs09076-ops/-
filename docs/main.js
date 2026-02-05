const $ = (id) => document.getElementById(id);

// ✅ 네 Worker 주소
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev";

let peersMap = {};
let krMap = null;          // { "005930": {corp_code, name}, ... }
let krList = [];           // [{ code:"005930", name:"삼성전자" }, ...]
let lastBaseRow = null;
let lastTicker = null;
let isLoading = false;

function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
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

async function loadPeers() {
  try {
    const r = await fetch("./peers.json", { cache: "no-store" });
    peersMap = r.ok ? await r.json() : {};
  } catch (_) {
    peersMap = {};
  }
}

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

  // item shape: {symbol, name, exchange, type, note?}
  box.innerHTML = list
    .slice(0, 10)
    .map((x) => `
      <button type="button" class="item" data-symbol="${x.symbol}">
        <b>${x.symbol}</b> — ${x.name}
        <span class="ex">${x.note ? x.note : (x.exchange ? `(${x.exchange})` : "")}</span>
      </button>
    `)
    .join("");
}

function isTickerLike(s) {
  return /^[A-Za-z0-9.\-]{1,12}$/.test(s);
}

function krSuggest(q) {
  if (!krList.length) return [];
  const nq = normName(q);
  if (!nq) return [];

  // 포함 매칭(가벼운)
  const hits = krList
    .filter((x) => x._n.includes(nq) || x.code.includes(nq))
    .slice(0, 10)
    .map((x) => ({
      symbol: `${x.code}.KS`,            // 기본은 KS로 제안 (KQ는 조회 시 fallback)
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

  // 1개면 바로 조회, 여러 개면 suggestions 띄우기
  if (hits.length === 1) {
    const code6 = hits[0].symbol.slice(0, 6);
    return await resolveAndFetchKRByCode(code6);
  } else {
    $("hint").textContent = "한국 기업명으로 인식됨. 아래 목록에서 선택하세요.";
    renderSuggestions(hits);
    return null; // 선택 유도
  }
}

async function search() {
  let raw = $("q").value.trim();
  if (!raw) return;
  if (isLoading) return;

  isLoading = true;
  resetUIForSearch();

  try {
    // ✅ 6자리 숫자면 KR로 간주
    if (/^\d{6}$/.test(raw)) {
      const base = await resolveAndFetchKRByCode(raw);
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("loadPeersBtn").classList.remove("hidden");

      const peers = (peersMap[lastTicker] || []).slice(0, 3);
      $("peerStatus").textContent = peers.length
        ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
        : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

      $("hint").textContent = "";
      return;
    }

    // ✅ 6자리.KS / 6자리.KQ면 그대로 KR 조회
    if (/^\d{6}\.(KS|KQ)$/i.test(raw)) {
      const base = await fetchFundamentals(raw.toUpperCase());
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("loadPeersBtn").classList.remove("hidden");

      const peers = (peersMap[lastTicker] || []).slice(0, 3);
      $("peerStatus").textContent = peers.length
        ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
        : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

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
      $("loadPeersBtn").classList.remove("hidden");

      const peers = (peersMap[lastTicker] || []).slice(0, 3);
      $("peerStatus").textContent = peers.length
        ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
        : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

      $("hint").textContent = "";
      return;
    }

    // ✅ 그 외: US/글로벌 (티커면 fundamentals, 이름이면 search suggestions)
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
    </tr>
  `
    )
    .join("");
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

  // ✅ KR 한글 입력이면 로컬 map 기반 suggestions
  if (hasHangul(q)) {
    const list = krSuggest(q);
    renderSuggestions(list);
    return;
  }

  // ✅ 6자리 숫자면 KR suggestions로 안내
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
   이벤트 바인딩 + suggestions 선택 (pointerdown으로 안정화)
========================= */
document.addEventListener("DOMContentLoaded", () => {
  // 백그라운드 로딩
  loadPeers();
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
  $("loadPeersBtn").addEventListener("click", loadPeersBtn);

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
      if (/^\d{6}\.(KS|KQ)$/i.test(sym)) {
        const code6 = sym.slice(0, 6);
        isLoading = true;
        resetUIForSearch();
        try {
          const base = await resolveAndFetchKRByCode(code6);
          lastBaseRow = base;
          lastTicker = base.ticker;

          renderSingle(base);
          $("loadPeersBtn").classList.remove("hidden");

          const peers = (peersMap[lastTicker] || []).slice(0, 3);
          $("peerStatus").textContent = peers.length
            ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
            : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

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
});

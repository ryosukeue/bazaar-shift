import { rpc, secretToken } from "./cloud.js";
import { ROLES, GROUPS, slots, time, solve } from "./solver.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const encode = (o) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (s) => {
  if (s.length > 300000) throw Error("データが大きすぎます。");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
        c.charCodeAt(0),
      ),
    ),
  );
};
const base = () => location.href.split("#")[0];
const uid = () => crypto.randomUUID();
const dateLabel = (d) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("ja-JP", {
        month: "long",
        day: "numeric",
        weekday: "short",
      })
    : "日付未設定";
let state,
  tab = "people",
  pendingReply = null,
  storageOK = true;
try {
  state = JSON.parse(localStorage.getItem("bazaar-shift-v1") || "null");
} catch {}
if (!state || !state.event || !Array.isArray(state.people))
  state = {
    event: { id: uid(), title: "食品バザー", dates: ["", ""] },
    people: [],
    result: null,
  };
function persist() {
  if (state.cloud) state.cloud.dirty = true;
  saveLocal();
}
function saveLocal() {
  try {
    localStorage.setItem("bazaar-shift-v1", JSON.stringify(state));
    storageOK = true;
  } catch {
    storageOK = false;
    toast("保存できません。バックアップをダウンロードしてください。");
  }
}
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = "none"), 5000);
}
function validEvent(e) {
  return (
    e &&
    typeof e.id === "string" &&
    e.id.length < 100 &&
    typeof e.title === "string" &&
    e.title.length <= 80 &&
    Array.isArray(e.dates) &&
    e.dates.length === 2 &&
    e.dates.every(
      (d) =>
        /^\d{4}-\d{2}-\d{2}$/.test(d) &&
        !isNaN(new Date(d + "T00:00:00").getTime()) &&
        new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d,
    ) &&
    e.dates[0] < e.dates[1]
  );
}
function validPerson(p) {
  return (
    p &&
    typeof p.id === "string" &&
    p.id.length < 100 &&
    typeof p.name === "string" &&
    p.name.trim().length > 0 &&
    p.name.length <= 60 &&
    Number.isInteger(p.grade) &&
    p.grade >= 1 &&
    p.grade <= 5 &&
    Array.isArray(p.available) &&
    p.available.length <= 20 &&
    p.available.every((x) => Number.isInteger(x) && x >= 0 && x < 20) &&
    typeof p.note === "string" &&
    p.note.length <= 500 &&
    Number.isFinite(p.maxHours) &&
    p.maxHours >= 0 &&
    p.maxHours <= 10
  );
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch {
    showText(
      "コピーする内容",
      text,
      "長押し、または全選択してコピーしてください。",
    );
  }
}
function showText(title, text, help = "") {
  openDialog(
    `<h2>${esc(title)}</h2><p class="helper">${esc(help)}</p><textarea class="output" readonly>${esc(text)}</textarea><div class="actions"><button data-close>閉じる</button><button class="primary" id="copyText">コピー</button></div>`,
  );
  $("#copyText").onclick = () => copy(text);
}
function openDialog(html) {
  $("#dialog")?.remove();
  const el = document.createElement("dialog");
  el.id = "dialog";
  el.innerHTML = html;
  document.body.append(el);
  el.querySelectorAll("[data-close]").forEach(
    (b) => (b.onclick = () => el.close()),
  );
  el.addEventListener("click", (e) => {
    if (e.target === el) el.close();
  });
  el.showModal();
}
const shell = (body) =>
  `<header><div class="brand"><span class="brand-icon">▦</span>バザーシフト</div><span class="badge">2日間・10:00–15:00</span></header>${body}`;
async function render() {
  $("#dialog")?.remove();
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("setup")) {
    const token = params.get("setup");
    history.replaceState(null, "", base());
    if (/^[a-f0-9]{64}$/.test(token)) {
      try {
        localStorage.setItem("bazaar-owner-key", token);
        toast(
          "管理者設定を保存しました。開催日を設定して「共有保存を開始」を押してください。",
        );
      } catch {
        toast("ブラウザーの保存を許可してください。");
      }
    }
    renderAdmin();
    return;
  }
  if (params.has("admin")) {
    try {
      const credentials = decode(params.get("admin"));
      history.replaceState(null, "", base());
      if (!credentials.id || !credentials.token)
        throw Error("管理リンクが不正です。");
      const remote = await rpc("read", {
        p_event_id: credentials.id,
        p_admin_token: credentials.token,
      });
      state = {
        event: remote.event,
        people: remote.people,
        result: remote.result,
        cloud: {
          token: credentials.token,
          revision: remote.revision,
          dirty: false,
        },
      };
      saveLocal();
      rememberAdmin();
      renderAdmin();
      return;
    } catch (error) {
      renderAdmin();
      cloudError(error);
      return;
    }
  }
  if (params.has("event")) {
    const id = params.get("event");
    $("#app").innerHTML = shell(
      '<main><div class="card"><h2>入力フォームを読み込んでいます…</h2></div></main>',
    );
    try {
      const event = await rpc("event", { p_event_id: id });
      if (!validEvent(event)) throw Error("開催情報を読み込めません。");
      renderCloudJoin(event);
    } catch (error) {
      $("#app").innerHTML = shell(
        '<main><div class="card"><h1>フォームを開けません</h1><p>' +
          esc(error.message) +
          '</p><button id="retryCloud">もう一度試す</button></div></main>',
      );
      $("#retryCloud").onclick = render;
    }
    return;
  }

  if (params.has("join")) {
    try {
      const e = decode(params.get("join"));
      if (!validEvent(e)) throw Error();
      renderJoin(e);
      return;
    } catch {
      $("#app").innerHTML = shell(
        '<main><div class="card"><h1>入力リンクを読み込めません</h1><p>管理者に新しいリンクを確認してください。</p><a href="' +
          esc(base()) +
          '">管理画面へ</a></div></main>',
      );
      return;
    }
  }
  if (params.has("reply")) {
    try {
      pendingReply = decode(params.get("reply"));
    } catch {
      toast("回答リンクを読み込めません。");
    }
    history.replaceState(null, "", base());
  }
  renderAdmin();
  if (pendingReply) {
    const r = pendingReply;
    pendingReply = null;
    importReply(r);
  }
}
function renderAdmin() {
  if (state.cloud) rememberAdmin();
  const e = state.event,
    result = state.result,
    hours = state.people.reduce((n, p) => n + p.available.length * 0.5, 0);
  $("#app").innerHTML =
    shell(`<main><div class="hero"><div><div class="eyebrow">BAZAAR SHIFT PLANNER</div><h1>2日間のシフトを、すっきり。</h1><p class="muted">参加できる時間を集めて、3つの役割へ自動で割り当て。</p></div><button id="share" class="primary">↗ 希望入力リンクを作る</button></div>
 <div class="stats"><div class="stat"><span>営業時間</span><strong>10–15 <small>時 × 2日</small></strong></div><div class="stat"><span>必要な人数</span><strong>3 <small>人 / 常時</small></strong></div><div class="stat"><span>取り込み済み</span><strong>${state.people.length} <small>人</small></strong></div><div class="stat"><span>割り当て状況</span><strong>${result ? result.assigned : 0}<small> / 60 枠</small></strong></div></div>
 <div class="layout"><aside class="sidebar"><section class="card"><h2>開催情報</h2><form id="eventForm" class="stack"><label class="field">イベント名<input name="title" maxlength="80" value="${esc(e.title)}" required></label><label class="field">1日目<input type="date" name="day1" value="${esc(e.dates[0])}" required></label><label class="field">2日目<input type="date" name="day2" value="${esc(e.dates[1])}" required></label><button type="submit">開催情報を保存</button></form><p class="helper">30分単位で希望を集めます。必要な稼働時間は合計30人時です。</p></section><section class="card"><h2>3つの配置条件</h2><div class="stack"><div><span class="pill">01 責任者枠</span><p class="helper">出店責任者 / 火気取扱責任者<br>どちらも本科3年以上</p></div><div><span class="pill">02 調理枠</span><p class="helper">調理責任者 / 調理従事者<br>責任者は本科2年以上</p></div><div><span class="pill">03 販売枠</span><p class="helper">販売責任者 / 販売従事者<br>責任者は本科2年以上</p></div></div><details><summary>割り当てルール</summary><p>各責任者4役はそれぞれ1人を登録。1人の登録役職は1つとし、同時刻の兼務はしません。従事者は全学年が対象です。</p><p>参加可能時間と上限時間を守り、全枠を埋められるかを探索します。そのうえで合計担当時間の偏りを抑えます。連続勤務・休憩の自動調整は対象外です。休憩が必要な時間は希望から外してください。</p></details></section></aside>
 <section>${cloudBanner()}${!storageOK ? '<div class="notice error">端末内への保存に失敗しています。バックアップを取得してください。</div>' : ""}<div class="tabs"><button class="tab ${tab === "people" ? "active" : ""}" data-tab="people">① 希望を集める</button><button class="tab ${tab === "schedule" ? "active" : ""}" data-tab="schedule">② シフトを組む</button></div><div id="panel">${tab === "people" ? peoplePanel() : schedulePanel()}</div><div class="row"><button class="small" id="backup">バックアップ保存</button><button class="small" id="restore">バックアップを復元</button><button class="small" id="demo">サンプルを試す</button><button class="small" id="newEvent">新しいイベント</button></div><p class="helper">${state.cloud ? "回答はSupabaseに保存されます。役職・上限・シフトの変更後は「変更を保存」を押してください。管理用リンクとバックアップには管理権限が含まれます。参加者には送らないでください。" : "現在のデータはブラウザー内に保存されています。「共有保存を開始」で自動収集に切り替えられます。"}</p></section></div><p class="footer">バザーシフト · 希望収集 → 役職の設定 → 自動作成 → Notionへコピー</p></main>`);
  wireCloud();
  $$("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        renderAdmin();
      }),
  );
  $("#eventForm").onsubmit = (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target),
      next = {
        ...e,
        title: f.get("title").trim(),
        dates: [f.get("day1"), f.get("day2")],
      };
    if (!validEvent(next) || !next.title) {
      toast("日付を早い順に、異なる2日間で指定してください。");
      return;
    }
    if (
      (state.people.length || state.cloud) &&
      next.dates.join() !== e.dates.join()
    ) {
      toast(
        "回答があるため日付を変更できません。新しいイベントを作成してください。",
      );
      return;
    }
    state.event = next;
    state.result = null;
    persist();
    renderAdmin();
    toast("開催情報を保存しました");
  };
  $("#share").onclick = () => {
    if (!validEvent(e)) {
      toast("先に開催日を2日間設定してください。");
      return;
    }
    showText(
      "希望入力リンク",
      state.cloud ? base() + "#event=" + e.id : base() + "#join=" + encode(e),
      state.cloud
        ? "このリンクをLINEで送ってください。参加者が送信すると、回答はSupabaseに保存されます。管理用リンクは送らないでください。"
        : "このリンクは端末内保存用です。自動収集するには先に「共有保存を開始」を押してください。",
    );
  };
  $("#backup").onclick = () =>
    download(
      "bazaar-shift-backup.json",
      JSON.stringify({ ...state, result: null }, null, 2),
      "application/json",
    );
  $("#restore").onclick = restore;
  $("#demo").onclick = demo;
  $("#newEvent").onclick = () =>
    confirmDialog(
      "新しいイベントを作りますか？",
      "表示するイベントを切り替えます。変更がある場合は先に保存してください。クラウド上の以前のイベントは管理用リンクから再び開けます。端末内だけのデータは先にバックアップしてください。",
      () => {
        state = {
          event: { id: uid(), title: "食品バザー", dates: ["", ""] },
          people: [],
          result: null,
        };
        persist();
        tab = "people";
        renderAdmin();
      },
    );
  $("#add")?.addEventListener("click", () => personDialog());
  $("#import")?.addEventListener("click", () => {
    openDialog(
      '<h2>回答リンクを取り込む</h2><p class="helper">参加者からLINEで届いた回答リンクを貼り付けてください。</p><textarea id="replyInput" aria-label="回答リンク" placeholder="https://…/#reply=…"></textarea><div class="actions"><button data-close>キャンセル</button><button class="primary" id="doImport">取り込む</button></div>',
    );
    $("#doImport").onclick = () => {
      try {
        const url = new URL($("#replyInput").value.trim());
        const p = new URLSearchParams(url.hash.slice(1));
        if (!p.has("reply")) throw Error();
        const r = decode(p.get("reply"));
        $("#dialog").close();
        importReply(r);
      } catch {
        toast("有効な回答リンクを貼り付けてください。");
      }
    };
  });
  $$("[data-edit]").forEach(
    (b) =>
      (b.onclick = () =>
        personDialog(state.people.find((p) => p.id === b.dataset.edit))),
  );
  $$("[data-delete]").forEach(
    (b) =>
      (b.onclick = () =>
        confirmDialog(
          "この参加者を削除しますか？",
          "この端末の希望データから削除し、作成済みのシフトも解除します。",
          () => {
            state.people = state.people.filter(
              (p) => p.id !== b.dataset.delete,
            );
            state.result = null;
            persist();
            renderAdmin();
          },
        )),
  );
  $$("[data-role]").forEach(
    (s) =>
      (s.onchange = () => {
        state.people.find((p) => p.id === s.dataset.role).role = s.value;
        state.result = null;
        persist();
        renderAdmin();
      }),
  );
  $$("[data-max]").forEach(
    (s) =>
      (s.onchange = () => {
        const p = state.people.find((p) => p.id === s.dataset.max);
        const n = Number(s.value);
        if (n < 0 || n > 10 || (n * 2) % 1) {
          toast("上限は0〜10時間、0.5時間単位です。");
          s.value = p.maxHours;
          return;
        }
        p.maxHours = n;
        state.result = null;
        persist();
        renderAdmin();
      }),
  );
  $("#generate")?.addEventListener("click", () => {
    if (!validEvent(e)) {
      toast("開催日を設定してください。");
      return;
    }
    const r = solve(e, state.people);
    if (r.errors.length) {
      $("#issues").innerHTML =
        `<div class="notice error"><strong>登録内容を確認してください</strong><ul>${r.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      return;
    }
    state.result = r;
    persist();
    renderAdmin();
    toast(
      r.complete
        ? "全時間帯の3枠を割り当てました"
        : "埋められない枠があります。不足箇所を確認してください。",
    );
  });
  $("#copySchedule")?.addEventListener("click", () => copy(exportSchedule()));
  $("#csv")?.addEventListener("click", () =>
    download("shift.csv", "\uFEFF" + exportCSV(), "text/csv;charset=utf-8"),
  );
  $("#print")?.addEventListener("click", () => window.print());
}
function peoplePanel() {
  return `<div class="card"><div class="row between"><h2>参加者と希望時間</h2><div class="row"><button id="import">回答を取り込む</button><button class="primary" id="add">＋ 手動で追加</button></div></div>${
    state.people.length
      ? state.people
          .map(
            (p) =>
              `<div class="person"><div class="row between"><strong>${esc(p.name)} <span class="pill">本科${p.grade}年</span></strong><div class="row"><button class="small" data-edit="${esc(p.id)}">希望を編集</button><button class="small danger" data-delete="${esc(p.id)}">削除</button></div></div><div class="meta">参加可能：1日目 ${p.available.filter((s) => s < 10).length * 0.5}時間 / 2日目 ${p.available.filter((s) => s >= 10).length * 0.5}時間${p.note ? " · " + esc(p.note) : ""}</div><div class="person-edit"><label class="field">管理者が設定する役職<select data-role="${esc(p.id)}"><option value="">役職を選択</option>${Object.entries(
                ROLES,
              )
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${p.role === k ? "selected" : ""}>${v}</option>`,
                )
                .join(
                  "",
                )}</select></label><label class="field">合計上限（時間）<input type="number" min="0" max="10" step="0.5" data-max="${esc(p.id)}" value="${p.maxHours}"></label></div></div>`,
          )
          .join("")
      : `<div class="empty"><span class="symbol">♧</span><h3>まずは、参加できる時間を集めよう。</h3><p class="muted">開催日を設定して希望入力リンクをLINEへ。<br>${state.cloud ? "送信された回答はここに自動で届きます（約30秒ごとに更新）。" : "端末内モードでは、戻ってきた回答リンクを取り込んでください。"}</p><span class="helper">手元に希望があれば「手動で追加」でも登録できます。</span></div>`
  }</div>`;
}
function schedulePanel() {
  const r = state.result;
  return `<div class="card"><div class="row between"><div><h2>シフトを自動作成</h2><p class="helper">1枠30分。希望時間・役職・合計上限を守って割り当てます。</p></div><button id="generate" class="primary">✦ ${r ? "もう一度作成" : "シフトを作成"}</button></div><div id="issues"></div>${
    r
      ? `<div class="notice ${r.complete ? "success" : "warning"}"><strong>${r.complete ? "全時間帯、3人の配置ができました。" : "未完成：" + r.shortages.length + "枠が不足しています。"}</strong>${r.complete ? "確定前に休憩や担当内容を確認してください。" : "下の「不足」を確認し、その役割で参加できる人を追加するか、合計上限を調整してください。"}</div><div class="row"><button id="copySchedule">Notion用にコピー</button><button id="csv">CSV保存</button><button id="print">印刷</button></div>${[
          0, 1,
        ]
          .map(
            (day) =>
              `<h3 style="margin-top:24px">${day + 1}日目 · ${esc(dateLabel(state.event.dates[day]))}</h3><div class="table-wrap"><table><thead><tr><th>時間帯</th>${GROUPS.map((g) => `<th>${g}</th>`).join("")}</tr></thead><tbody>${r.rows
                .filter((row) => row.day === day)
                .map(
                  (row) =>
                    `<tr><td>${time(row.start)}–${time(row.end)}</td>${row.people.map((id) => `<td>${id ? esc(state.people.find((p) => p.id === id)?.name || "不明") : '<span class="missing">不足</span>'}</td>`).join("")}</tr>`,
                )
                .join("")}</tbody></table></div>`,
          )
          .join(
            "",
          )}<div class="workload">${state.people.map((p) => `<span>${esc(p.name)}：${r.rows.filter((row) => row.people.includes(p.id)).length * 0.5}時間</span>`).join("")}</div>`
      : '<div class="empty"><span class="symbol">▦</span><h3>希望がそろったら、ワンクリック。</h3><p class="muted">参加者の役職を設定して「シフトを作成」を押してください。条件を満たせない場合は、不足する時間帯を表示します。</p></div>'
  }</div>`;
}
function availabilityForm(e, p = { available: [] }) {
  return `<div class="days">${[0, 1]
    .map(
      (day) =>
        `<div class="day"><div class="row between"><h3>${day + 1}日目 · ${esc(dateLabel(e.dates[day]))}</h3><button type="button" class="small" data-all="${day}">全選択 / 解除</button></div><div class="choices">${slots(
          e,
        )
          .filter((s) => s.day === day)
          .map(
            (s) =>
              `<label class="choice"><input type="checkbox" name="slot" value="${s.id}" ${p?.available?.includes(s.id) ? "checked" : ""}><span>${time(s.start)}–${time(s.end)}</span></label>`,
          )
          .join("")}</div></div>`,
    )
    .join("")}</div>`;
}
function personFields(e, p) {
  return `<div class="form-grid"><label class="field">名前<input name="name" required maxlength="60" value="${esc(p?.name || "")}" autocomplete="name"></label><label class="field">学年<select name="grade">${[1, 2, 3, 4, 5].map((g) => `<option value="${g}" ${p?.grade === g ? "selected" : ""}>本科${g}年</option>`).join("")}</select></label></div><p class="helper">参加できる時間をすべて選んでください。選択したすべての時間に配置されるとは限りません。休憩が必要な時間は外してください。</p>${availabilityForm(e, p)}<div class="form-grid" style="margin-top:16px"><label class="field">2日間の合計上限（時間）<input type="number" name="maxHours" value="${p?.maxHours ?? 10}" min="0" max="10" step="0.5" required></label><label class="field">備考（任意）<input name="note" maxlength="500" value="${esc(p?.note || "")}" placeholder="希望・連絡事項など"></label></div>`;
}
function wireAll() {
  $$("[data-all]").forEach(
    (b) =>
      (b.onclick = () => {
        const inputs = $$('input[name="slot"]').filter(
          (i) => Math.floor(Number(i.value) / 10) === Number(b.dataset.all),
        );
        const all = inputs.every((i) => i.checked);
        inputs.forEach((i) => (i.checked = !all));
      }),
  );
}
function readPerson(form, old) {
  const f = new FormData(form);
  return {
    id: old?.id || uid(),
    name: f.get("name").trim(),
    grade: Number(f.get("grade")),
    available: f.getAll("slot").map(Number),
    maxHours: Number(f.get("maxHours")),
    note: f.get("note").trim(),
    role: old?.role || "",
    updatedAt: new Date().toISOString(),
  };
}
function personDialog(p) {
  if (!validEvent(state.event)) {
    toast("先に開催日を設定してください。");
    return;
  }
  openDialog(
    `<div class="dialog-head"><h2>${p ? "希望を編集" : "参加者を追加"}</h2><button data-close type="button" aria-label="閉じる">×</button></div><form id="personForm">${personFields(state.event, p)}<div class="actions"><button type="button" data-close>キャンセル</button><button class="primary" type="submit">保存</button></div></form>`,
  );
  wireAll();
  $("#personForm").onsubmit = (ev) => {
    ev.preventDefault();
    const person = readPerson(ev.target, p);
    if (!validPerson(person)) {
      toast("入力内容を確認してください。");
      return;
    }
    const i = state.people.findIndex((x) => x.id === person.id);
    if (i >= 0) state.people[i] = person;
    else state.people.push(person);
    state.result = null;
    persist();
    $("#dialog").close();
    renderAdmin();
  };
}
function renderJoin(e) {
  let old;
  try {
    old = JSON.parse(localStorage.getItem("bazaar-answer-" + e.id) || "null");
  } catch {}
  if (!validPerson(old)) old = null;
  $("#app").innerHTML = shell(
    `<main class="participant"><div class="eyebrow">SHIFT REQUEST</div><h1>${esc(e.title)}の希望シフト</h1><p class="muted">参加できる時間を教えてください。</p><div class="notice">入力後に作成される<strong>回答リンクを、管理者にLINEで送ってください。</strong>この画面だけでは管理者に届きません。</div><section class="card"><p class="step">01 / 希望を入力</p><form id="joinForm">${personFields(e, old)}<p class="helper">役職は管理者が設定します。備考の内容は自動割り当てには反映されません。</p><button class="primary" type="submit" style="width:100%;margin-top:10px">回答リンクを作成</button></form></section><div id="answerResult"></div><p class="footer">回答を変更するときは、同じブラウザーからこの入力リンクを開き直してください。</p></main>`,
  );
  wireAll();
  $("#joinForm").onsubmit = (ev) => {
    ev.preventDefault();
    const p = readPerson(ev.target, old);
    if (!validPerson(p)) {
      toast("入力内容を確認してください。");
      return;
    }
    old = p;
    try {
      localStorage.setItem("bazaar-answer-" + e.id, JSON.stringify(p));
    } catch {
      toast("端末に保存できません。回答リンクを控えてください。");
    }
    const url =
      base() + "#reply=" + encode({ eventId: e.id, dates: e.dates, person: p });
    $("#answerResult").innerHTML =
      `<section class="card"><p class="step">02 / LINEで返す</p><h2>あと一歩。回答リンクを送ってください。</h2><p class="helper">このリンクには、名前・学年・希望時間・備考が含まれます。管理者との個別トークに送ってください。</p><textarea class="output" readonly aria-label="作成された回答リンク">${esc(url)}</textarea><div class="row" style="margin-top:12px"><button class="primary" id="copyAnswer">回答リンクをコピー</button>${navigator.share ? '<button id="shareAnswer">共有する</button>' : ""}</div></section>`;
    $("#copyAnswer").onclick = () => copy(url);
    $("#shareAnswer")?.addEventListener("click", async () => {
      try {
        await navigator.share({
          title: e.title + " 希望シフト",
          text: "希望シフトの回答です。",
          url,
        });
      } catch {}
    });
    $("#answerResult").scrollIntoView({ behavior: "smooth" });
  };
}
function importReply(r) {
  if (
    !r ||
    r.eventId !== state.event.id ||
    !Array.isArray(r.dates) ||
    r.dates.join() !== state.event.dates.join()
  ) {
    openDialog(
      '<h2>このイベントの回答ではありません</h2><p>希望入力リンクを作った管理者のブラウザーで開いてください。端末を変えた場合は、先に元のバックアップを復元してください。</p><div class="actions"><button data-close>閉じる</button></div>',
    );
    return;
  }
  if (!validPerson(r.person)) {
    toast("回答データが不正です。");
    return;
  }
  const raw = r.person,
    existing = state.people.find((p) => p.id === raw.id);
  const p = {
    id: raw.id,
    name: raw.name.trim(),
    grade: raw.grade,
    available: [...new Set(raw.available)],
    note: raw.note,
    maxHours: raw.maxHours,
    role: existing?.role || "",
    updatedAt: raw.updatedAt,
  };
  const apply = () => {
    const i = state.people.findIndex((x) => x.id === p.id);
    if (i >= 0) state.people[i] = p;
    else state.people.push(p);
    state.result = null;
    persist();
    tab = "people";
    renderAdmin();
    toast(p.name + "さんの回答を取り込みました");
  };
  confirmDialog(
    existing ? "この回答で希望を更新しますか？" : "この回答を取り込みますか？",
    `${p.name}さん / 本科${p.grade}年 / 参加可能 ${p.available.length * 0.5}時間。${existing ? "同じ参加者の回答を上書きします。古い回答でないことを確認してください。役職は維持します。" : "取り込み後に役職を設定してください。"}`,
    apply,
  );
}
function confirmDialog(title, text, fn) {
  openDialog(
    `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button data-close>キャンセル</button><button id="confirm" class="primary">続ける</button></div>`,
  );
  $("#confirm").onclick = () => {
    $("#dialog").close();
    fn();
  };
}
function download(name, text, type) {
  const u = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
function restore() {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = ".json,application/json";
  i.onchange = async () => {
    try {
      if (i.files[0].size > 2000000) throw Error();
      const s = JSON.parse(await i.files[0].text());
      if (
        !validEvent(s.event) ||
        !Array.isArray(s.people) ||
        s.people.length > 300 ||
        !s.people.every(validPerson) ||
        new Set(s.people.map((p) => p.id)).size !== s.people.length
      )
        throw Error();
      confirmDialog(
        "バックアップを復元しますか？",
        "現在の開催情報と参加者データを置き換えます。",
        () => {
          state = {
            event: s.event,
            people: s.people.map((p) => ({
              ...p,
              role: ROLES[p.role] ? p.role : "",
            })),
            result: null,
            cloud:
              s.cloud && /^[a-f0-9]{64}$/.test(s.cloud.token)
                ? { ...s.cloud, dirty: true }
                : undefined,
          };
          persist();
          renderAdmin();
          toast("復元しました");
        },
      );
    } catch {
      toast("有効なバックアップファイルではありません。");
    }
  };
  i.click();
}
function demo() {
  confirmDialog(
    "サンプルデータに切り替えますか？",
    "現在のデータを置き換えます。必要なデータは先にバックアップしてください。",
    () => {
      const d = new Date(),
        d1 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
        d2 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 8),
        fmt = (d) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      state = {
        event: {
          id: uid(),
          title: "食品バザー（サンプル）",
          dates: [fmt(d1), fmt(d2)],
        },
        people: ["chief", "fire", "cooklead", "cook", "selllead", "sell"].map(
          (role, i) => ({
            id: uid(),
            name: [
              "田中（サンプル）",
              "佐藤（サンプル）",
              "鈴木（サンプル）",
              "高橋（サンプル）",
              "伊藤（サンプル）",
              "渡辺（サンプル）",
            ][i],
            grade: i < 2 ? 3 : 2,
            role,
            available: Array.from({ length: 20 }, (_, i) => i),
            maxHours: 5,
            note: "",
          }),
        ),
        result: null,
      };
      persist();
      tab = "people";
      renderAdmin();
    },
  );
}
function exportRows() {
  return state.result.rows.map((r) => [
    r.date,
    `${time(r.start)}–${time(r.end)}`,
    ...r.people.map(
      (id) => state.people.find((p) => p.id === id)?.name || "【不足】",
    ),
  ]);
}
function exportSchedule() {
  const clean = (s) => String(s).replace(/[|\r\n]/g, " ");
  return (
    `${state.event.title} — ${state.result.complete ? "シフト案（要確認）" : "未完成・不足あり"}\n\n| 日付 | 時間 | 責任者枠 | 調理枠 | 販売枠 |\n| --- | --- | --- | --- | --- |\n` +
    exportRows()
      .map((r) => "| " + r.map(clean).join(" | ") + " |")
      .join("\n")
  );
}
function exportCSV() {
  return [["日付", "時間", ...GROUPS], ...exportRows()]
    .map((r) =>
      r
        .map(
          (v) =>
            '"' +
            String(v)
              .replace(/^[=+@\-\t\r]/, "'$&")
              .replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
}

function cloudError(error) {
  openDialog(
    `<h2>接続状況を確認してください</h2><p>${esc(error.message)}</p><p class="helper">入力済みの内容は消していません。管理者の未保存の変更はバックアップできます。</p><div class="actions"><button data-close>閉じる</button></div>`,
  );
}
function cloudBanner() {
  return state.cloud
    ? `<div class="notice ${state.cloud.dirty ? "warning" : "success"}"><strong>${state.cloud.dirty ? "未保存の変更があります" : "共有保存モード · Supabaseに接続済み"}</strong><p style="margin:6px 0">${state.cloud.dirty ? "役職・上限・シフトを編集した後は「変更を保存」を押してください。未保存の間、自動更新は停止します。" : "参加者の回答は自動で保存されます。この画面は約30秒ごとに更新されます。"}</p><div class="row"><button class="small primary" id="cloudSave" ${state.cloud.dirty ? "" : "disabled"}>変更を保存</button><button class="small" id="cloudRefresh">最新回答を取得</button><button class="small" id="adminLink">管理用リンク</button><button class="small" id="closeCollection">${state.event.collecting === false ? "受付を再開" : "受付を終了"}</button></div><div id="cloudStatus" role="status"></div></div>`
    : `<div class="notice"><strong>共有保存を使うと、回答が自動で集まります。</strong><p style="margin:6px 0">現在は端末内保存です。開催日を保存してから共有を開始してください。</p><div class="row"><button class="small primary" id="cloudStart">共有保存を開始</button><button class="small" id="cloudCheck">接続を確認</button><button class="small" id="savedAdmins">管理イベントを開く</button></div></div>`;
}
function rememberAdmin() {
  try {
    const all = JSON.parse(localStorage.getItem("bazaar-admin-events") || "{}");
    all[state.event.id] = {
      id: state.event.id,
      title: state.event.title,
      token: state.cloud.token,
    };
    localStorage.setItem("bazaar-admin-events", JSON.stringify(all));
  } catch {}
}
function wireCloud() {
  $("#cloudCheck")?.addEventListener("click", async () => {
    try {
      const health = await rpc("health");
      if (!health.ready)
        throw Error(
          "管理者の初期設定がまだです。セットアップSQLを実行してください。",
        );
      toast("保存先の準備ができています。");
    } catch (error) {
      cloudError(error);
    }
  });
  $("#cloudStart")?.addEventListener("click", async () => {
    if (!validEvent(state.event)) {
      toast("先に開催日を2日間設定してください。");
      return;
    }
    let creator;
    try {
      creator = localStorage.getItem("bazaar-owner-key");
    } catch {}
    if (!creator) {
      cloudError(
        Error(
          "最初に管理者セットアップ用リンクを開いてください。参加者向けリンクからはイベントを作れません。",
        ),
      );
      return;
    }
    const button = $("#cloudStart");
    button.disabled = true;
    const id = state.event.id;
    let token;
    try {
      const k = "bazaar-pending-" + id;
      token = localStorage.getItem(k) || secretToken();
      localStorage.setItem(k, token);
      const result = await rpc("create", {
        p_creator_token: creator,
        p_admin_token: token,
        p_state: {
          event: state.event,
          people: state.people,
          result: state.result,
        },
      });
      state.cloud = { token, revision: result.revision, dirty: false };
      saveLocal();
      rememberAdmin();
      renderAdmin();
      showText(
        "管理用リンクを保管してください",
        adminURL(),
        "このリンクを知る人は、全回答の閲覧と変更ができます。参加者には共有しないでください。別の端末でもこのリンクから管理できます。",
      );
    } catch (error) {
      if (error.code?.includes("duplicate key")) {
        try {
          const remote = await rpc("read", {
            p_event_id: id,
            p_admin_token: token,
          });
          state = {
            event: remote.event,
            people: remote.people,
            result: remote.result,
            cloud: { token, revision: remote.revision, dirty: false },
          };
          saveLocal();
          renderAdmin();
          return;
        } catch {}
      }
      button.disabled = false;
      cloudError(error);
    }
  });
  $("#cloudSave")?.addEventListener("click", saveCloud);
  $("#cloudRefresh")?.addEventListener("click", () => {
    if (state.cloud.dirty) {
      confirmDialog(
        "未保存の変更を破棄して最新回答を取得しますか？",
        "手元の役職・上限・シフトの変更は失われます。必要なら先にバックアップしてください。",
        () => refreshCloud(false, true),
      );
    } else refreshCloud();
  });
  $("#adminLink")?.addEventListener("click", () =>
    showText(
      "管理用リンク",
      adminURL(),
      "管理者だけで保管してください。このリンクを知る人は全回答の閲覧・変更ができます。",
    ),
  );
  $("#closeCollection")?.addEventListener("click", () => {
    state.event.collecting = state.event.collecting === false;
    persist();
    renderAdmin();
    toast("受付状態を変更しました。「変更を保存」で反映されます。");
  });
  $("#savedAdmins")?.addEventListener("click", () => {
    let all = {};
    try {
      all = JSON.parse(localStorage.getItem("bazaar-admin-events") || "{}");
    } catch {}
    openDialog(
      `<h2>管理イベント</h2><p class="helper">未保存の変更がある場合は先に保存してください。</p><div class="stack">${
        Object.values(all)
          .map(
            (a) =>
              `<button data-admin-id="${esc(a.id)}">${esc(a.title)}</button>`,
          )
          .join("") ||
        "<p>このブラウザーに保存された管理イベントはありません。管理用リンクから開いてください。</p>"
      }</div><div class="actions"><button data-close>閉じる</button></div>`,
    );
    $$("[data-admin-id]").forEach(
      (b) =>
        (b.onclick = () => {
          location.hash = "admin=" + encode(all[b.dataset.adminId]);
        }),
    );
  });
}
function adminURL() {
  return (
    base() +
    "#admin=" +
    encode({ id: state.event.id, token: state.cloud.token })
  );
}
let saving = false,
  refreshing = false;
async function saveCloud() {
  if (saving || !state.cloud) return;
  saving = true;
  const id = state.event.id,
    token = state.cloud.token,
    snapshot = JSON.stringify({
      event: state.event,
      people: state.people,
      result: state.result,
    });
  $("#cloudSave").disabled = true;
  try {
    const r = await rpc("save", {
      p_event_id: id,
      p_admin_token: token,
      p_revision: state.cloud.revision,
      p_state: JSON.parse(snapshot),
    });
    if (state.event.id !== id || !state.cloud) return;
    state.cloud.revision = r.revision;
    state.cloud.dirty =
      snapshot !==
      JSON.stringify({
        event: state.event,
        people: state.people,
        result: state.result,
      });
    saveLocal();
    renderAdmin();
    toast(
      state.cloud.dirty
        ? "保存中に追加の変更がありました。もう一度保存してください。"
        : "Supabaseに保存しました",
    );
  } catch (error) {
    if (state.event.id === id) {
      renderAdmin();
      cloudError(error);
    }
  } finally {
    saving = false;
  }
}
async function refreshCloud(silent = false, discard = false) {
  if (refreshing || saving || !state.cloud || (state.cloud.dirty && !discard))
    return;
  refreshing = true;
  const id = state.event.id,
    token = state.cloud.token;
  try {
    const r = await rpc("read", { p_event_id: id, p_admin_token: token });
    if (state.event.id !== id || (!discard && state.cloud.dirty)) return;
    if (r.revision !== state.cloud.revision || discard) {
      state = {
        event: r.event,
        people: r.people,
        result: r.result,
        cloud: { token, revision: r.revision, dirty: false },
      };
      saveLocal();
      renderAdmin();
      if (!silent) toast("最新の回答を取得しました");
    } else if (!silent) toast("最新の状態です");
  } catch (error) {
    if (!silent) cloudError(error);
    else if ($("#cloudStatus"))
      $("#cloudStatus").textContent =
        "自動更新できませんでした。「最新回答を取得」で再試行できます。";
  } finally {
    refreshing = false;
  }
}
function renderCloudJoin(e) {
  let saved;
  try {
    saved = JSON.parse(
      localStorage.getItem("bazaar-cloud-answer-" + e.id) || "null",
    );
  } catch {}
  if (!validPerson(saved?.person) || !/^[a-f0-9]{64}$/.test(saved?.token || ""))
    saved = null;
  let person = saved?.person || null,
    token = saved?.token || secretToken();
  $("#app").innerHTML = shell(
    `<main class="participant"><div class="eyebrow">SHIFT REQUEST</div><h1>${esc(e.title)}の希望シフト</h1><p class="muted">参加できる時間を教えてください。</p><div class="notice ${e.collecting === false ? "warning" : "success"}">${e.collecting === false ? "受付は終了しました。変更が必要な場合は管理者に連絡してください。" : "送信すると管理者に回答が届きます。回答リンクをLINEで返す必要はありません。"}</div><section class="card"><form id="cloudJoinForm">${personFields(e, person)}<p class="helper">役職は管理者が設定します。備考の内容は自動割り当てには反映されません。同じブラウザーから開くと回答を更新できます。</p><button id="sendCloudAnswer" class="primary" type="submit" style="width:100%;margin-top:10px" ${e.collecting === false ? "disabled" : ""}>${person ? "回答を更新して送信" : "希望を送信"}</button><p id="sendStatus" role="status" aria-live="polite"></p></form></section><p class="footer">名前・学年・希望時間・備考は管理者だけが閲覧できます。別の端末から回答すると別の回答として登録されます。</p></main>`,
  );
  wireAll();
  $("#cloudJoinForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const p = readPerson(ev.target, person);
    if (!validPerson(p)) {
      toast("入力内容を確認してください。");
      return;
    }
    person = p;
    try {
      localStorage.setItem(
        "bazaar-cloud-answer-" + e.id,
        JSON.stringify({ person: p, token }),
      );
    } catch {}
    const button = $("#sendCloudAnswer");
    button.disabled = true;
    $("#sendStatus").textContent = "送信しています…";
    try {
      await rpc("submit", {
        p_event_id: e.id,
        p_edit_token: token,
        p_person: p,
      });
      $("#sendStatus").textContent =
        "送信できました。管理者に回答が届いています。変更する場合は、入力を直して再送信してください。";
      button.textContent = "回答を更新して送信";
    } catch (error) {
      $("#sendStatus").textContent =
        error.message + " 入力内容は残っています。";
    } finally {
      button.disabled = e.collecting === false;
    }
  };
}
window.addEventListener("beforeunload", (event) => {
  if (state.cloud?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", render);
render();
setInterval(() => {
  if (
    !location.hash &&
    state.cloud &&
    !state.cloud.dirty &&
    !$("#dialog")?.open &&
    document.visibilityState === "visible" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  )
    refreshCloud(true);
}, 30000);

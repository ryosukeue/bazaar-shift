// Publishable key is intentionally public. Access is enforced by server RPCs.
export const SUPABASE_URL = "https://rahwlqkrncefpdrhflhl.supabase.co";
export const SUPABASE_KEY = "sb_publishable_Lw9rTvfb5M5nEvAymSZtpQ_LsRxWs1z";
export function secretToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
const messages = {
  ACCESS_DENIED: "管理用リンクまたは回答の編集キーを確認してください。",
  REVISION_CONFLICT:
    "別の回答や変更が届きました。手元の変更をバックアップしてから「最新回答を取得」で更新し、変更をやり直してください。",
  COLLECTION_CLOSED: "回答の受付は終了しています。",
  DATES_LOCKED:
    "共有を開始した後は開催日を変更できません。新しいイベントを作成してください。",
  EVENT_NOT_FOUND: "イベントが見つかりません。入力リンクを確認してください。",
  EVENT_FULL: "参加者の上限（300人）に達しました。",
};
export async function rpc(name, args = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${SUPABASE_URL}/rest/v1/rpc/bazaar_${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "通信できませんでした。インターネット接続とSupabaseの稼働状態を確認してください。",
    );
  }
  const body = await response.json();
  if (!response.ok) {
    let error = new Error(
      messages[body.message] ||
        (body.code === "PGRST202"
          ? "保存先の初期設定がまだです。SupabaseでセットアップSQLを実行してください。"
          : "保存できませんでした。設定または入力内容を確認してください。"),
    );
    error.code = body.message || body.code;
    throw error;
  }
  return body;
}

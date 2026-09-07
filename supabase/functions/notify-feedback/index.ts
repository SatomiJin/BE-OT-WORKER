// Supabase Edge Function: emails the feedback owner when a new row lands in
// public.otworker_feedback. Wired up by a Database Webhook (see
// supabase/otworker_feedback_webhook.sql).
//
// Deploy:
//   supabase functions deploy notify-feedback
//   supabase secrets set RESEND_API_KEY=... FEEDBACK_ALERT_TO=... FEEDBACK_ALERT_FROM=...
//   supabase secrets set FEEDBACK_WEBHOOK_SECRET=...

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "🐞 Báo lỗi",
  idea: "💡 Đề xuất",
  other: "💬 Khác",
};

const CONTEXT_LABELS: Record<string, string> = {
  username: "Username",
  email: "Email",
  displayName: "Tên hiển thị",
  role: "Role",
  page: "Trang",
  userAgent: "User agent",
  appVersion: "Phiên bản",
  language: "Ngôn ngữ",
  platform: "Nền tảng",
  screen: "Màn hình",
  timezone: "Múi giờ",
  selectedMonth: "Tháng đang chọn",
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value: unknown): string {
  const parsed = new Date(String(value ?? ""));

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: Deno.env.get("APP_TIME_ZONE") || "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function renderContextRows(context: unknown): string {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return "";
  }

  const rows = Object.entries(context as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(
          CONTEXT_LABELS[key] ?? key,
        )}</td><td style="padding:4px 0;color:#111827">${escapeHtml(value)}</td></tr>`,
    );

  if (rows.length === 0) {
    return "";
  }

  return `<h3 style="margin:24px 0 8px;font-size:14px;color:#374151">Thông tin kỹ thuật</h3>
    <table style="border-collapse:collapse;font-size:13px">${rows.join("")}</table>`;
}

function buildEmail(record: Record<string, unknown>) {
  const category = String(record.category ?? "other");
  const categoryLabel = CATEGORY_LABELS[category] ?? category;
  const username = String(record.username ?? "").trim() || "(chưa có username)";
  const submittedAt = formatTimestamp(record.created_at);
  const appUrl = Deno.env.get("FEEDBACK_APP_URL") || "";

  const subject = `[OT Worker] ${categoryLabel} từ ${username}`;

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px;font-size:18px;color:#111827">Góp ý mới từ ${escapeHtml(username)}</h2>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
      ${escapeHtml(categoryLabel)}${submittedAt ? ` · ${escapeHtml(submittedAt)}` : ""}
    </p>
    <div style="white-space:pre-wrap;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;color:#111827;line-height:1.6">${escapeHtml(
      record.message,
    )}</div>
    ${renderContextRows(record.context)}
    ${
      appUrl
        ? `<p style="margin:24px 0 0"><a href="${escapeHtml(
            appUrl,
          )}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px">Mở tab Góp ý</a></p>`
        : ""
    }
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">ID: ${escapeHtml(record.id)}</p>
  </div>`;

  return { subject, html };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ message: "Method not allowed." }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  // The webhook sends this header; without it anyone knowing the URL could
  // trigger mail. Skipped only when no secret is configured.
  const expectedSecret = Deno.env.get("FEEDBACK_WEBHOOK_SECRET");
  if (
    expectedSecret &&
    request.headers.get("x-feedback-webhook-secret") !== expectedSecret
  ) {
    return new Response(JSON.stringify({ message: "Forbidden." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const alertTo = Deno.env.get("FEEDBACK_ALERT_TO");
  const alertFrom =
    Deno.env.get("FEEDBACK_ALERT_FROM") || "OT Worker <onboarding@resend.dev>";

  if (!resendApiKey || !alertTo) {
    console.error("RESEND_API_KEY and FEEDBACK_ALERT_TO must both be set.");
    return new Response(
      JSON.stringify({ message: "Mail transport is not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ message: "Body must be JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = (payload.record ?? payload) as Record<string, unknown>;

  if (!record?.message) {
    return new Response(
      JSON.stringify({ message: "Payload has no feedback record." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { subject, html } = buildEmail(record);

  const mailResponse = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: alertFrom,
      // Comma-separated FEEDBACK_ALERT_TO lets you add a second recipient later.
      to: alertTo.split(",").map((address) => address.trim()).filter(Boolean),
      subject,
      html,
    }),
  });

  if (!mailResponse.ok) {
    const detail = await mailResponse.text();
    console.error("Resend rejected the message", mailResponse.status, detail);
    return new Response(
      JSON.stringify({ message: "Could not send the alert email." }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ status: "sent" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

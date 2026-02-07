export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Only POST allowed", { status: 405 });
    }

    // --- Verify GitHub Signature ---
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) {
      return new Response("Missing signature", { status: 401 });
    }

    const payloadArrayBuffer = await request.arrayBuffer();
    const expected = await hmacSign(
      env.GITHUB_WEBHOOK_SECRET,
      payloadArrayBuffer,
    );

    if (signature !== `sha256=${expected}`) {
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(new TextDecoder().decode(payloadArrayBuffer));
    const githubEvent = request.headers.get("x-github-event");

    // --- Filters ---
    const allowedOwners = (env.ALLOWED_OWNERS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    const repoOwner = payload.repository?.owner?.login;
    if (allowedOwners.length && !allowedOwners.includes(repoOwner)) {
      return new Response("Ignored (owner not allowed)", { status: 200 });
    }

    const visibilityFilter = env.VISIBILITY_FILTER || "all";
    const isPrivate = payload.repository?.private === true;

    if (visibilityFilter === "public" && isPrivate)
      return new Response("Ignored (private repo)", { status: 200 });

    if (visibilityFilter === "private" && !isPrivate)
      return new Response("Ignored (public repo)", { status: 200 });

    const allowedRepos = (env.ALLOWED_REPOS || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const currentRepo = payload.repository?.name;
    if (allowedRepos.length && !allowedRepos.includes(currentRepo)) {
      return new Response("Ignored (repo not allowed)", { status: 200 });
    }

    // --- Build message ---
    const text = buildTelegramMessage(githubEvent, payload, env);
    if (!text) return new Response("Ignored event", { status: 200 });

    const body = {
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    if (env.TELEGRAM_THREAD_ID) {
      body.message_thread_id = Number(env.TELEGRAM_THREAD_ID);
    }

    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      return new Response("Failed to send Telegram", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  },
};

/* ===============================
   Helper: Escape HTML
================================ */
const e = (v) =>
  String(v ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* ===============================
   Helper: Environment Badge
================================ */
function envBadge(env) {
  const name = (env.APP_ENV || "DEV").toUpperCase();
  const icon = name === "PROD" ? "🔴" : "🟢";
  return `${icon} <b>${name}</b>`;
}

/* ===============================
   Reusable Message Builder
================================ */
function buildTelegramMessage(event, payload, env) {
  const repo = payload.repository || {};
  const repoName = e(repo.full_name);
  const badge = envBadge(env);

  switch (event) {
    case "push": {
      const c = payload.head_commit || {};
      const message = e(c.message || "-");

      return (
        `📦 <b>New Commit Pushed</b> ${badge}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `👤 <b>Author:</b> ${e(payload.pusher?.name)}\n` +
        `📁 <b>Repo:</b> <code>${repoName}</code>\n\n` +
        `💬 <b>Commit Message:</b>\n` +
        `<blockquote expandable>\n${message}\n</blockquote>\n` +
        `🔗 <a href="${e(c.url || repo.html_url)}">View Commit</a>`
      );
    }

    case "pull_request": {
      const pr = payload.pull_request || {};
      const action = pr.merged ? "Merged" : payload.action;

      return (
        `🔀 <b>Pull Request ${e(action)}</b> ${badge}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📁 <b>Repo:</b> <code>${repoName}</code>\n` +
        `📌 <b>#${pr.number}</b> by ${e(pr.user?.login)}\n\n` +
        `<blockquote expandable>\n${e(pr.title)}\n</blockquote>\n` +
        `🔗 <a href="${e(pr.html_url)}">Open PR</a>`
      );
    }

    case "issue_comment": {
      const c = payload.comment || {};

      return (
        `💬 <b>New Comment</b> ${badge}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📁 <b>Repo:</b> <code>${repoName}</code>\n` +
        `👤 <b>By:</b> ${e(c.user?.login)}\n\n` +
        `<blockquote expandable>\n${e(c.body)}\n</blockquote>\n` +
        `🔗 <a href="${e(c.html_url)}">View Comment</a>`
      );
    }

    case "workflow_run": {
      const wr = payload.workflow_run || {};
      if (wr.conclusion !== "failure") return null;

      return (
        `🚨 <b>Workflow Failed</b> ${badge}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📁 <b>Repo:</b> <code>${repoName}</code>\n` +
        `⚙️ <b>Workflow:</b> ${e(wr.name)}\n` +
        `👤 <b>By:</b> ${e(wr.actor?.login)}\n\n` +
        `🔗 <a href="${e(wr.html_url)}">View Run</a>`
      );
    }

    case "release": {
      const r = payload.release || {};

      return (
        `🏷️ <b>New Release</b> ${badge}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📁 <b>Repo:</b> <code>${repoName}</code>\n` +
        `🏷️ <b>Tag:</b> ${e(r.tag_name)}\n` +
        `👤 <b>By:</b> ${e(r.author?.login)}\n\n` +
        `🔗 <a href="${e(r.html_url)}">View Release</a>`
      );
    }

    case "repository": {
      if (payload.action === "created") {
        return (
          `📂 <b>Repository Created</b> ${badge}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `👤 <b>Owner:</b> ${e(repo.owner?.login)}\n` +
          `📁 <b>Repo:</b> <code>${repoName}</code>\n` +
          `🔒 <b>Visibility:</b> ${repo.private ? "Private" : "Public"}\n\n` +
          `🔗 <a href="${e(repo.html_url)}">Open Repo</a>`
        );
      }

      if (payload.action === "deleted") {
        return (
          `🗑️ <b>Repository Deleted</b> ${badge}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `👤 <b>Owner:</b> ${e(repo.owner?.login)}\n` +
          `📁 <b>Repo:</b> <code>${repoName}</code>`
        );
      }
    }
  }

  return null;
}

/* ===============================
   HMAC Helper
================================ */
async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

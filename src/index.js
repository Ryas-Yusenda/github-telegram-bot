export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // 1. Verifikasi Signature
      const payloadBuffer = await request.arrayBuffer();
      const signature = request.headers.get("x-hub-signature-256");

      if (
        !(await verifySignature(
          env.GITHUB_WEBHOOK_SECRET,
          payloadBuffer,
          signature,
        ))
      ) {
        return new Response("Invalid signature", { status: 401 });
      }

      // 2. Parsing Payload
      const payload = JSON.parse(new TextDecoder().decode(payloadBuffer));
      const githubEvent = request.headers.get("x-github-event");

      // 3. Jalankan Filter (Cek apakah event perlu diproses)
      const ignoreReason = checkFilters(payload, env);
      if (ignoreReason) {
        return new Response(`Ignored: ${ignoreReason}`, { status: 200 });
      }

      // 4. Bangun Pesan Berdasarkan Event
      const message = buildTelegramMessage(githubEvent, payload);
      if (!message) {
        return new Response("Event not supported or ignored", { status: 200 });
      }

      // 5. Kirim ke Telegram
      const ok = await sendTelegram(message, env);
      if (!ok) throw new Error("Failed to send to Telegram");

      return new Response("OK", { status: 200 });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  },
};

function checkFilters(payload, env) {
  const repo = payload.repository || {};

  // Filter Owner
  const allowedOwners =
    env.ALLOWED_OWNERS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) || [];
  if (allowedOwners.length && !allowedOwners.includes(repo.owner?.login)) {
    return "Owner not allowed";
  }

  // Filter Visibility
  const visibility = env.VISIBILITY_FILTER || "all";
  if (visibility === "public" && repo.private) return "Private repo ignored";
  if (visibility === "private" && !repo.private) return "Public repo ignored";

  // Filter Repo Name
  const allowedRepos =
    env.ALLOWED_REPOS?.split(",")
      .map((r) => r.trim())
      .filter(Boolean) || [];
  if (allowedRepos.length && !allowedRepos.includes(repo.name)) {
    return "Repo not allowed";
  }

  return null;
}

const buildTelegramMessage = (event, payload) => {
  const repoName = escapeHtml(payload.repository?.full_name);
  const repoUrl = payload.repository?.html_url;

  const handlers = {
    push: (p) => {
      const commit = p.head_commit || {};
      return [
        `📦 <b>New Commit Pushed</b>`,
        `━━━━━━━━━━━━━━━`,
        `👤 <b>Author:</b> ${escapeHtml(p.pusher?.name)}`,
        `📁 <b>Repo:</b> <code>${repoName}</code>\n`,
        `💬 <b>Commit Message:</b>`,
        `<blockquote expandable>${escapeHtml(commit.message)}</blockquote>\n`,
        `🔗 <a href="${commit.url || repoUrl}">View Commit</a>`,
      ].join("\n");
    },

    pull_request: (p) => {
      const pr = p.pull_request;
      const action = pr.merged ? "Merged" : p.action;
      return [
        `🔀 <b>Pull Request ${escapeHtml(action)}</b>`,
        `━━━━━━━━━━━━━━━`,
        `📁 <b>Repo:</b> <code>${repoName}</code>`,
        `📌 <b>#${pr.number}</b> by ${escapeHtml(pr.user?.login)}\n`,
        `<blockquote expandable>${escapeHtml(pr.title)}</blockquote>\n`,
        `🔗 <a href="${pr.html_url}">Open PR</a>`,
      ].join("\n");
    },

    issue_comment: (p) => {
      return [
        `💬 <b>New Comment</b>`,
        `━━━━━━━━━━━━━━━`,
        `📁 <b>Repo:</b> <code>${repoName}</code>`,
        `👤 <b>By:</b> ${escapeHtml(p.comment?.user?.login)}\n`,
        `<blockquote expandable>${escapeHtml(p.comment?.body)}</blockquote>\n`,
        `🔗 <a href="${p.comment?.html_url}">View Comment</a>`,
      ].join("\n");
    },

    workflow_run: (p) => {
      if (p.workflow_run?.conclusion !== "failure") return null;
      return [
        `🚨 <b>Workflow Failed</b>`,
        `━━━━━━━━━━━━━━━`,
        `📁 <b>Repo:</b> <code>${repoName}</code>`,
        `⚙️ <b>Workflow:</b> ${escapeHtml(p.workflow_run?.name)}`,
        `👤 <b>By:</b> ${escapeHtml(p.workflow_run?.actor?.login)}\n`,
        `🔗 <a href="${p.workflow_run?.html_url}">View Run</a>`,
      ].join("\n");
    },

    release: (p) => {
      return [
        `🏷️ <b>New Release</b>`,
        `━━━━━━━━━━━━━━━`,
        `📁 <b>Repo:</b> <code>${repoName}</code>`,
        `🏷️ <b>Tag:</b> ${escapeHtml(p.release?.tag_name)}`,
        `👤 <b>By:</b> ${escapeHtml(p.release?.author?.login)}\n`,
        `🔗 <a href="${p.release?.html_url}">View Release</a>`,
      ].join("\n");
    },

    repository: (p) => {
      if (!["created", "deleted"].includes(p.action)) return null;
      const emoji = p.action === "created" ? "📂" : "🗑️";
      const actionText = p.action === "created" ? "Created" : "Deleted";

      let msg = [
        `${emoji} <b>Repository ${actionText}</b>`,
        `━━━━━━━━━━━━━━━`,
        `👤 <b>Owner:</b> ${escapeHtml(p.repository?.owner?.login)}`,
        `📁 <b>Repo:</b> <code>${repoName}</code>`,
      ];

      if (p.action === "created") {
        msg.push(
          `🔒 <b>Visibility:</b> ${p.repository?.private ? "Private" : "Public"}\n`,
        );
        msg.push(`🔗 <a href="${repoUrl}">Open Repo</a>`);
      }
      return msg.join("\n");
    },
  };

  return handlers[event] ? handlers[event](payload) : null;
};

async function sendTelegram(text, env) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(env.TELEGRAM_THREAD_ID && {
      message_thread_id: Number(env.TELEGRAM_THREAD_ID),
    }),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return resp.ok;
}

async function verifySignature(secret, payloadBuffer, signature) {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign("HMAC", key, payloadBuffer);
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signature === `sha256=${expected}`;
}

function escapeHtml(str) {
  const tags = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(str ?? "-").replace(/[&<>"']/g, (m) => tags[m]);
}

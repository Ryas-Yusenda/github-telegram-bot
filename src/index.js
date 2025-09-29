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
      payloadArrayBuffer
    );
    if (signature !== `sha256=${expected}`) {
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(new TextDecoder().decode(payloadArrayBuffer));
    const githubEvent = request.headers.get("x-github-event");

    // --- Filter: Multiple allowed owners ---
    const allowedOwners = (env.ALLOWED_OWNERS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    const repoOwner = payload.repository?.owner?.login;
    if (allowedOwners.length > 0 && !allowedOwners.includes(repoOwner)) {
      return new Response(`Ignored (owner ${repoOwner} not allowed)`, {
        status: 200,
      });
    }

    // --- Filter: By visibility ---
    const visibilityFilter = env.VISIBILITY_FILTER || "all"; // public, private, all
    const isPrivate = payload.repository?.private === true;
    if (visibilityFilter === "public" && isPrivate) {
      return new Response("Ignored (private repo)", { status: 200 });
    }
    if (visibilityFilter === "private" && !isPrivate) {
      return new Response("Ignored (public repo)", { status: 200 });
    }

    // --- Filter: By repo list (multi) ---
    const allowedRepos = (env.ALLOWED_REPOS || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const currentRepo = payload.repository?.name;
    if (allowedRepos.length > 0 && !allowedRepos.includes(currentRepo)) {
      return new Response(`Ignored (repo ${currentRepo} not in list)`, {
        status: 200,
      });
    }

    // --- Build Telegram message ---
    let text = null;
    switch (githubEvent) {
      case "push": {
        const p = payload.head_commit || {};
        text = `📦 *Push* by ${payload.pusher.name}\nRepo: ${payload.repository.full_name}\nMessage: ${p.message}\n[View Commit](${p.url})`;
        break;
      }
      case "pull_request": {
        const pr = payload.pull_request;
        text = `🔀 *PR ${payload.action}* #${pr.number}\nTitle: ${pr.title}\nBy: ${pr.user.login}\n[Open PR](${pr.html_url})`;
        break;
      }
      case "issue_comment": {
        const c = payload.comment;
        text = `💬 *New Comment* by ${c.user.login}\nOn: ${payload.issue.title}\n\"${c.body}\"\n[View Comment](${c.html_url})`;
        break;
      }
      case "workflow_run": {
        const wr = payload.workflow_run;
        if (wr.conclusion !== "failure") {
          return new Response("Ignored (workflow not failed)", { status: 200 });
        }
        text = `🚨 *Workflow Failed*\nRepo: ${payload.repository.full_name}\nWorkflow: ${wr.name}\nBy: ${wr.actor.login}\n[View Run](${wr.html_url})`;
        break;
      }
      default:
        return new Response("Ignored event " + githubEvent, { status: 200 });
    }

    if (text) {
      const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        return new Response("Failed to send Telegram", { status: 500 });
      }
    }

    return new Response("OK", { status: 200 });
  },
};

// --- HMAC Sign Helper ---
async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

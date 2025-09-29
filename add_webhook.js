import fetch from "node-fetch";

// ============================== CONFIG ==============================
const GITHUB_TOKEN = "ghp_example1234567890";
const OWNER = "example-user";
const REPO = "example-repo";
const WEBHOOK_URL = "https://example-webhook.site/github";
const WEBHOOK_SECRET = "super-secret-key-123";
const EVENTS = [
  "push",
  "pull_request",
  "issue_comment",
  "workflow_run",
  "repository",
];
// ====================================================================

const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/hooks`;

const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

const payload = {
  name: "web",
  active: true,
  events: EVENTS,
  config: {
    url: WEBHOOK_URL,
    content_type: "json",
    secret: WEBHOOK_SECRET,
    insecure_ssl: "0",
  },
};

async function createWebhook() {
  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (resp.status === 201) {
      const data = await resp.json();
      console.log(`✅ Webhook created successfully (id: ${data.id})`);
    } else if (resp.status === 422) {
      const data = await resp.json();
      console.log("ℹ️ Webhook may already exist with that URL. Response:");
      console.log(data);
    } else {
      const text = await resp.text();
      console.log(`❌ Failed to create webhook: ${resp.status}`);
      console.log(text);
    }
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

createWebhook();

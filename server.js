import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const {
  MODEL_ACCESS_KEY,
  INFERENCE_ENDPOINT = "https://inference.do-ai.run/v1/async-invoke",
  MODEL_ID = "fal-ai/fast-sdxl",
  SPACES_ACCESS_KEY,
  SPACES_SECRET_KEY,
  SPACES_BUCKET = "photosnap-bucket",
  SPACES_REGION = "sgp1",
  SPACES_FOLDER = "generated_images",
  ALLOW_ORIGIN = "*"
} = process.env;

app.use(cors({ origin: ALLOW_ORIGIN === "*" ? true : ALLOW_ORIGIN }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const spacesEndpoint = `https://${SPACES_REGION}.digitaloceanspaces.com`;
const spacesClient = SPACES_ACCESS_KEY && SPACES_SECRET_KEY
  ? new S3Client({
      region: SPACES_REGION,
      endpoint: spacesEndpoint,
      credentials: {
        accessKeyId: SPACES_ACCESS_KEY,
        secretAccessKey: SPACES_SECRET_KEY
      }
    })
  : null;

function ensureConfig() {
  if (!MODEL_ACCESS_KEY) {
    throw new Error("Missing MODEL_ACCESS_KEY in environment.");
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50) || "image";
}

function findImageUrls(payload) {
  const urls = [];

  function walk(value) {
    if (!value) {
      return;
    }
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      const imageLike = /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(value);
      const cdnLike = /digitaloceanspaces|fal\.media|cloudfront|img/i.test(value);
      if (imageLike || cdnLike) {
        urls.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  }

  walk(payload);
  return Array.from(new Set(urls));
}

function inferPollingUrl(startResponse) {
  if (!startResponse || typeof startResponse !== "object") {
    return null;
  }

  const directUrlCandidates = [
    startResponse.status_url,
    startResponse.response_url,
    startResponse.url,
    startResponse.links?.status,
    startResponse.links?.self
  ].filter(Boolean);

  if (directUrlCandidates.length > 0) {
    return directUrlCandidates[0];
  }

  const requestId =
    startResponse.request_id ||
    startResponse.id ||
    startResponse.job_id ||
    startResponse.inference_id;

  if (!requestId) {
    return null;
  }

  const root = INFERENCE_ENDPOINT.replace(/\/+$/, "");
  return `${root}/${requestId}`;
}

async function pollForImage(statusUrl, timeoutMs = 90000, intervalMs = 2000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${MODEL_ACCESS_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Status check failed (${response.status}).`);
    }

    const urls = findImageUrls(payload);
    const status = String(payload.status || payload.state || "").toLowerCase();

    if (urls.length > 0) {
      return { urls, raw: payload };
    }

    if (["failed", "error", "cancelled"].includes(status)) {
      throw new Error(payload.error || payload.message || "Image generation failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for generated image.");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/generate", async (req, res) => {
  try {
    ensureConfig();

    const {
      prompt,
      negative_prompt = "",
      image_size = "landscape_4_3",
      num_inference_steps = 28,
      guidance_scale = 6
    } = req.body || {};

    if (!prompt || String(prompt).trim().length < 3) {
      return res.status(400).json({ error: "Prompt must be at least 3 characters long." });
    }

    const body = {
      model: MODEL_ID,
      input: {
        prompt,
        negative_prompt,
        image_size,
        num_inference_steps,
        guidance_scale
      }
    };

    const startResponse = await fetch(INFERENCE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_ACCESS_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const startPayload = await startResponse.json().catch(() => ({}));

    if (!startResponse.ok) {
      return res.status(startResponse.status).json({
        error: startPayload.error || startPayload.message || "Inference request failed.",
        details: startPayload
      });
    }

    const immediateUrls = findImageUrls(startPayload);
    if (immediateUrls.length > 0) {
      return res.json({
        imageUrl: immediateUrls[0],
        allImageUrls: immediateUrls,
        providerResponse: startPayload,
        polled: false
      });
    }

    const pollingUrl = inferPollingUrl(startPayload);
    if (!pollingUrl) {
      return res.status(502).json({
        error: "Could not determine polling URL from inference provider response.",
        details: startPayload
      });
    }

    const pollResult = await pollForImage(pollingUrl);

    return res.json({
      imageUrl: pollResult.urls[0],
      allImageUrls: pollResult.urls,
      providerResponse: pollResult.raw,
      polled: true,
      pollingUrl
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error." });
  }
});

app.post("/api/save-to-spaces", async (req, res) => {
  try {
    if (!spacesClient) {
      return res.status(500).json({
        error: "Spaces credentials are not configured. Set SPACES_ACCESS_KEY and SPACES_SECRET_KEY."
      });
    }

    const { imageUrl, prompt = "" } = req.body || {};
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
      return res.status(400).json({ error: "A valid imageUrl is required." });
    }

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return res.status(502).json({ error: `Could not fetch generated image (${imageResponse.status}).` });
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const key = `${SPACES_FOLDER}/${timestamp}-${slugify(prompt)}.${ext}`;

    await spacesClient.send(
      new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        Body: Buffer.from(arrayBuffer),
        ACL: "public-read",
        ContentType: contentType,
        Metadata: {
          source: "do-serverless-inference",
          model: MODEL_ID
        }
      })
    );

    const spacesObjectUrl = `https://${SPACES_BUCKET}.${SPACES_REGION}.digitaloceanspaces.com/${key}`;

    return res.json({
      success: true,
      bucket: SPACES_BUCKET,
      key,
      spacesObjectUrl
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save image to Spaces." });
  }
});

app.listen(port, () => {
  console.log(`Text-to-image app running on http://localhost:${port}`);
});

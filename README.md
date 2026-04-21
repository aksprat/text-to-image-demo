# PhotoSnap AI - Text to Image

Minimalist web application for text-to-image generation using DigitalOcean Serverless Inference endpoint with Fal.ai model `fal-ai/fast-sdxl`, plus save-to-Spaces support.

## Features

- Generate image from text prompt
- Uses DigitalOcean Serverless Inference async endpoint
- Model: `fal-ai/fast-sdxl`
- Download generated image locally
- Save generated image to DigitalOcean Spaces bucket `photosnap-bucket/generated_images`

## Tech Stack

- Node.js + Express backend
- Vanilla HTML/CSS/JS frontend
- AWS SDK v3 (S3 client) for DigitalOcean Spaces

## 1. Install

```bash
npm install
```

## 2. Configure env

```bash
cp .env.example .env
```

Update `.env` values:

- `MODEL_ACCESS_KEY`: Model access key from DigitalOcean Serverless Inference
- `SPACES_ACCESS_KEY` and `SPACES_SECRET_KEY`: Spaces key pair with write access
- `SPACES_BUCKET=photosnap-bucket`
- `SPACES_REGION=sgp1`
- `SPACES_FOLDER=generated_images`

## 3. Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## API Endpoints

- `POST /api/generate`
  - Body example:
    ```json
    {
      "prompt": "a futuristic city at sunrise",
      "negative_prompt": "blurry",
      "image_size": "landscape_4_3"
    }
    ```

- `POST /api/save-to-spaces`
  - Body example:
    ```json
    {
      "imageUrl": "https://...",
      "prompt": "a futuristic city at sunrise"
    }
    ```

## Notes

- The app sends inference requests from backend only so credentials stay server-side.
- Save-to-Spaces stores objects as `public-read` so the returned Spaces URL can be opened directly.
- If your endpoint payload format changes, adjust `server.js` request body and poll parsing.

## App Platform Deployment

1. Push this project to GitHub.
2. Update repo value in `.do/app.yaml`.
3. Create an app:

```bash
doctl apps create --spec .do/app.yaml
```

4. In your CI/CD or App settings, ensure these secrets exist:
  - `MODEL_ACCESS_KEY`
  - `SPACES_ACCESS_KEY`
  - `SPACES_SECRET_KEY`

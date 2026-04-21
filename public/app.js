const form = document.getElementById("generate-form");
const generateBtn = document.getElementById("generate-btn");
const saveBtn = document.getElementById("save-btn");
const downloadBtn = document.getElementById("download-btn");
const statusEl = document.getElementById("status");
const saveResultEl = document.getElementById("save-result");
const imageFrame = document.getElementById("image-frame");
const imageEl = document.getElementById("result-image");
const actions = document.getElementById("actions");

let currentImageUrl = "";
let currentPrompt = "";

function setStatus(message) {
  statusEl.textContent = message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  currentPrompt = payload.prompt || "";

  generateBtn.disabled = true;
  saveBtn.disabled = true;
  downloadBtn.disabled = true;
  setStatus("Generating your image. This can take a few seconds...");
  saveResultEl.textContent = "";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Generation failed.");
    }

    currentImageUrl = data.imageUrl;
    imageEl.src = currentImageUrl;
    imageFrame.hidden = false;
    actions.hidden = false;
    saveBtn.disabled = false;
    downloadBtn.disabled = false;
    setStatus("Image generated successfully.");
  } catch (error) {
    currentImageUrl = "";
    imageFrame.hidden = true;
    actions.hidden = true;
    setStatus(error.message || "Something went wrong.");
  } finally {
    generateBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", async () => {
  if (!currentImageUrl) {
    return;
  }

  saveBtn.disabled = true;
  saveResultEl.textContent = "Saving image to Spaces...";

  try {
    const response = await fetch("/api/save-to-spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: currentImageUrl,
        prompt: currentPrompt
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to save image.");
    }

    saveResultEl.innerHTML = `Saved to Spaces: <a href="${data.spacesObjectUrl}" target="_blank" rel="noopener noreferrer">${data.key}</a>`;
  } catch (error) {
    saveResultEl.textContent = error.message || "Could not save to Spaces.";
  } finally {
    saveBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!currentImageUrl) {
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = currentImageUrl;
  anchor.download = "generated-image.png";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
});

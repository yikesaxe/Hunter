const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const importBtn = document.getElementById("importBtn");
const apiUrlInput = document.getElementById("apiUrl");

let currentTab = null;

// Check if we're on a StreetEasy page
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentTab = tabs[0];
  const url = currentTab?.url || "";

  if (url.includes("streeteasy.com")) {
    statusEl.className = "status info";
    statusEl.textContent = `Ready to import: ${url.split("?")[0].split("/").slice(-2).join("/")}`;
    importBtn.disabled = false;
  } else {
    statusEl.className = "status warning";
    statusEl.textContent = "Navigate to a StreetEasy listing page first.";
    importBtn.disabled = true;
  }
});

// Load saved API URL
chrome.storage?.local?.get("apiUrl", (data) => {
  if (data?.apiUrl) apiUrlInput.value = data.apiUrl;
});

// Save API URL on change
apiUrlInput.addEventListener("change", () => {
  chrome.storage?.local?.set({ apiUrl: apiUrlInput.value });
});

// Import button handler
importBtn.addEventListener("click", async () => {
  if (!currentTab) return;

  importBtn.disabled = true;
  importBtn.textContent = "Capturing page...";
  statusEl.className = "status info";
  statusEl.textContent = "Grabbing page HTML...";

  try {
    // Inject script to grab the full page HTML
    const [{ result: pageHtml }] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => document.documentElement.outerHTML,
    });

    if (!pageHtml || pageHtml.length < 100) {
      throw new Error("Failed to capture page HTML (too small)");
    }

    statusEl.textContent = `Captured ${(pageHtml.length / 1024).toFixed(0)} KB — sending to Hunter...`;
    importBtn.textContent = "Importing...";

    // Send to Hunter API
    const apiBase = apiUrlInput.value.replace(/\/$/, "");
    const response = await fetch(`${apiBase}/api/import/streeteasy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentTab.url.split("?")[0], // strip tracking params
        html: pageHtml,
      }),
    });

    const data = await response.json();

    if (data.success) {
      statusEl.className = "status success";
      statusEl.textContent = "Listing imported successfully!";

      const p = data.parsed;
      resultEl.style.display = "block";
      resultEl.innerHTML = [
        p.title && p.title !== "Unknown" ? `<div><strong>Address:</strong> ${p.address}</div>` : "",
        p.rentGross ? `<div><strong>Rent:</strong> $${p.rentGross.toLocaleString()}/mo</div>` : "",
        p.bedrooms != null ? `<div><strong>Layout:</strong> ${p.bedrooms === 0 ? "Studio" : p.bedrooms + " bed"}${p.bathrooms ? " / " + p.bathrooms + " bath" : ""}</div>` : "",
        p.neighborhood ? `<div><strong>Area:</strong> ${p.neighborhood}${p.borough ? ", " + p.borough : ""}</div>` : "",
        p.brokerFee === false ? `<div><strong>Fee:</strong> No fee</div>` : p.brokerFee === true ? `<div><strong>Fee:</strong> Broker fee</div>` : "",
      ].join("");

      importBtn.textContent = "Imported!";
      importBtn.disabled = false;
    } else {
      throw new Error(data.error || "Import failed");
    }
  } catch (err) {
    statusEl.className = "status error";
    statusEl.textContent = `Error: ${err.message}`;
    importBtn.textContent = "Retry Import";
    importBtn.disabled = false;
  }
});

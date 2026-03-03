import { useState } from "react";

const API_URL = "https://api.anthropic.com/v1/messages";

const STATIONS = {
  outbound: { from: "Ebbsfleet International", to: "St Pancras International" },
  inbound: { from: "St Pancras International", to: "Ebbsfleet International" },
};

const SYSTEM_PROMPT = `You are a UK train timetable assistant for Southeastern High Speed trains. 
When asked for train times, respond ONLY with a JSON array (no markdown, no explanation) of train objects.
Each object must have:
- departure: string (HH:MM format)
- arrival: string (HH:MM format)
- duration: string (e.g. "29 mins")
- platform: string (e.g. "Platform 2")
- operator: string (always "Southeastern")
- status: string (one of: "On time", "On time", "On time", "Delayed 3 mins", "On time") - mostly on time
- trainType: string (one of: "High Speed", "High Speed 1")
- stops: string (either "Direct" or "1 stop")

Ebbsfleet to St Pancras is ~29-34 minutes direct. St Pancras to Ebbsfleet is ~29-34 minutes direct.
Generate realistic times spaced roughly 20-30 mins apart. If a specific date/time is given, start trains from that time.`;

function buildPrompt(direction, dateTime) {
  const { from, to } = STATIONS[direction];
  if (dateTime) {
    return `Give me 4 trains from ${from} to ${to} starting from ${dateTime}. Return JSON array only.`;
  }
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `Give me the next 4 trains from ${from} to ${to} starting from ${timeStr} on ${dateStr}. Return JSON array only.`;
}

async function fetchTrains(direction, dateTime, attempt = 1) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(direction, dateTime) }],
      }),
    });
  } catch (networkErr) {
    throw new Error("Network error — check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned unexpected response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const msg = data?.error?.message || `API error (HTTP ${response.status})`;
    if (attempt < 3 && (response.status === 529 || response.status >= 500)) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return fetchTrains(direction, dateTime, attempt + 1);
    }
    throw new Error(msg);
  }

  if (data.error) throw new Error(data.error.message || "Unknown API error");

  const text = (data.content || []).map(b => b.text || "").join("").trim();

  // Try multiple extraction strategies for robustness
  let parsed = null;

  // 1. Direct parse
  try { parsed = JSON.parse(text); } catch {}

  // 2. Strip markdown fences then parse
  if (!Array.isArray(parsed)) {
    try { parsed = JSON.parse(text.replace(/```json|```/gi, "").trim()); } catch {}
  }

  // 3. Find first [...] array block anywhere in the text
  if (!Array.isArray(parsed)) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Received unexpected response — please retry.");
  }

  return parsed;
}

function StatusBadge({ status }) {
  const delayed = status.toLowerCase().includes("delayed");
  return (
    <span style={{
      fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em",
      padding: "2px 8px", borderRadius: "20px",
      background: delayed ? "#ff4d4d22" : "#00e67622",
      color: delayed ? "#ff6b6b" : "#00c853",
      border: `1px solid ${delayed ? "#ff6b6b44" : "#00c85344"}`,
    }}>
      {status}
    </span>
  );
}

function TrainCard({ train, index }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "12px", padding: "16px 20px", marginBottom: "10px",
      animation: `slideIn 0.3s ease ${index * 0.07}s both`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#f0e6d3", fontFamily: "'Playfair Display', serif" }}>
            {train.departure}
          </span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "1rem" }}>→</span>
          <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "rgba(240,230,211,0.7)" }}>
            {train.arrival}
          </span>
        </div>
        <StatusBadge status={train.status} />
      </div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {[
          { icon: "⏱", label: train.duration },
          { icon: "🚉", label: train.platform },
          { icon: "🚄", label: train.trainType },
          { icon: "📍", label: train.stops },
        ].map(({ icon, label }) => (
          <span key={label} style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: "4px" }}>
            <span>{icon}</span>{label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TabPanel({ direction }) {
  const { from, to } = STATIONS[direction];
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [searchDate, setSearchDate] = useState("");
  const [searchTime, setSearchTime] = useState("");
  const [lastFetched, setLastFetched] = useState(null);
  const [mode, setMode] = useState("next");
  const [lastCustomDT, setLastCustomDT] = useState(null);

  const load = async (customDateTime) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTrains(direction, customDateTime);
      setTrains(result);
      setLastFetched(new Date());
      setRetryCount(0);
    } catch (e) {
      setError(e.message || "Failed to fetch trains.");
      setRetryCount(c => c + 1);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (!searchDate || !searchTime) return;
    const dt = new Date(`${searchDate}T${searchTime}`);
    const formatted = dt.toLocaleString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    setMode("search");
    setLastCustomDT(formatted);
    load(formatted);
  };

  const handleNext = () => {
    setMode("next");
    setSearchDate("");
    setSearchTime("");
    setLastCustomDT(null);
    load(null);
  };

  const handleRetry = () => {
    if (mode === "search" && lastCustomDT) load(lastCustomDT);
    else handleNext();
  };

  return (
    <div>
      <div style={{
        background: "linear-gradient(135deg, rgba(201,160,100,0.15), rgba(201,160,100,0.05))",
        border: "1px solid rgba(201,160,100,0.2)", borderRadius: "12px",
        padding: "14px 18px", marginBottom: "20px",
      }}>
        <div style={{ fontSize: "0.7rem", color: "rgba(201,160,100,0.7)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>Route</div>
        <div style={{ fontSize: "0.95rem", color: "#f0e6d3", fontWeight: 600 }}>
          {from} <span style={{ color: "rgba(201,160,100,0.8)" }}>→</span> {to}
        </div>
      </div>

      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "12px", padding: "16px", marginBottom: "16px",
      }}>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Search by date & time</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)}
            style={{ flex: 1, minWidth: "130px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", color: "#f0e6d3", fontSize: "0.85rem", outline: "none" }}
          />
          <input type="time" value={searchTime} onChange={e => setSearchTime(e.target.value)}
            style={{ flex: 1, minWidth: "100px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", color: "#f0e6d3", fontSize: "0.85rem", outline: "none" }}
          />
          <button onClick={handleSearch} disabled={!searchDate || !searchTime || loading}
            style={{ background: "rgba(201,160,100,0.2)", border: "1px solid rgba(201,160,100,0.4)", borderRadius: "8px", padding: "9px 16px", color: "#c9a064", fontSize: "0.85rem", fontWeight: 600, cursor: searchDate && searchTime && !loading ? "pointer" : "not-allowed", opacity: searchDate && searchTime ? 1 : 0.5 }}>
            Search
          </button>
        </div>
      </div>

      <button onClick={handleNext} disabled={loading}
        style={{ width: "100%", background: loading ? "rgba(201,160,100,0.08)" : "linear-gradient(135deg, rgba(201,160,100,0.25), rgba(201,160,100,0.1))", border: "1px solid rgba(201,160,100,0.35)", borderRadius: "10px", padding: "12px", color: "#c9a064", fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.06em", cursor: loading ? "not-allowed" : "pointer", marginBottom: "20px", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
        {loading
          ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading trains…</>
          : <><span>⟳</span> Show Next 4 Trains</>}
      </button>

      {error && (
        <div style={{ background: "#ff4d4d15", border: "1px solid #ff4d4d33", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px" }}>
          <div style={{ color: "#ff8080", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
            ⚠ Could not load trains {retryCount > 1 ? `(attempt ${retryCount})` : ""}
          </div>
          <div style={{ color: "rgba(255,140,140,0.7)", fontSize: "0.78rem", marginBottom: "10px", wordBreak: "break-word" }}>{error}</div>
          <button onClick={handleRetry}
            style={{ background: "rgba(255,100,100,0.15)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "6px", padding: "6px 14px", color: "#ff8080", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
            Retry
          </button>
        </div>
      )}

      {trains.length > 0 && (
        <div>
          <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px", display: "flex", justifyContent: "space-between" }}>
            <span>{mode === "search" ? "Search results" : "Next departures"}</span>
            {lastFetched && <span>Updated {lastFetched.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
          {trains.map((train, i) => <TrainCard key={i} train={train} index={i} />)}
        </div>
      )}

      {trains.length === 0 && !loading && !error && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "40px 20px", fontSize: "0.9rem" }}>
          Press the button above to load train times
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("outbound");
  const tabs = [
    { id: "outbound", short: "Outbound" },
    { id: "inbound", short: "Inbound" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0f", backgroundImage: "radial-gradient(ellipse at 20% 0%, rgba(201,160,100,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(100,140,201,0.06) 0%, transparent 60%)", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ padding: "24px 20px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: "480px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
            <span style={{ fontSize: "1.4rem" }}>🚄</span>
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f0e6d3", fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>HS1 Trains</div>
              <div style={{ fontSize: "0.68rem", color: "rgba(201,160,100,0.6)", letterSpacing: "0.1em", textTransform: "uppercase" }}>High Speed Service</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flex: 1, background: activeTab === tab.id ? "rgba(201,160,100,0.15)" : "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab.id ? "#c9a064" : "transparent"}`, padding: "10px 8px", color: activeTab === tab.id ? "#c9a064" : "rgba(255,255,255,0.35)", fontSize: "0.78rem", fontWeight: activeTab === tab.id ? 700 : 500, letterSpacing: "0.04em", cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif" }}>
                {tab.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px 40px" }}>
        {activeTab === "outbound" && <TabPanel key="outbound" direction="outbound" />}
        {activeTab === "inbound" && <TabPanel key="inbound" direction="inbound" />}
      </div>
    </div>
  );
}

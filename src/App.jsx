import { useState, useRef, useEffect } from "react";

const API_URL = "/api/proxy";

const STATIONS = {
  outbound: { from: "Ebbsfleet International", to: "St Pancras International" },
  inbound: { from: "St Pancras International", to: "Ebbsfleet International" },
};

const HS1_SYSTEM_PROMPT = `You are a UK train timetable assistant for Southeastern High Speed trains. 
When asked for train times, respond ONLY with a JSON array (no markdown, no explanation) of train objects.
Each object must have:
- departure: string (HH:MM format)
- arrival: string (HH:MM format)
- duration: string (e.g. "29 mins")
- platform: string (e.g. "Platform 2")
- operator: string (always "Southeastern")
- status: string - mostly "On time", occasionally "Delayed 3 mins"
- trainType: string (one of: "High Speed", "High Speed 1")
- stops: string (either "Direct" or "1 stop")

Ebbsfleet to St Pancras is ~29-34 minutes direct. St Pancras to Ebbsfleet is ~29-34 minutes direct.
Generate realistic times spaced roughly 20-30 mins apart. If a specific date/time is given, start trains from that time.`;

const UK_SEARCH_SYSTEM_PROMPT = `You are a UK national rail timetable assistant with knowledge of all UK train routes and operators.
When asked for train times between two stations, respond ONLY with a JSON array (no markdown, no explanation) of train objects.
Each object must have:
- departure: string (HH:MM format)
- arrival: string (HH:MM format)  
- duration: string (e.g. "1h 23 mins")
- platform: string (e.g. "Platform 3" or "TBC")
- operator: string (the real UK train operator for that route, e.g. "Avanti West Coast", "LNER", "Great Western Railway", "Southern", etc.)
- status: string - mostly "On time", occasionally "Delayed 5 mins" or "Delayed 10 mins"
- callingPoints: string (comma-separated list of intermediate stops, or "Direct" if no stops)
- stops: string (e.g. "Direct", "2 stops", "3 stops")

Generate 4 realistic trains spaced roughly 20-60 mins apart based on typical UK rail frequencies for that route.
Use accurate journey times and operators for UK routes. If a specific date/time is given, start trains from that time, otherwise use the current time provided.`;

// Large list of UK stations for autocomplete
const UK_STATIONS = [
  "Aberdeen","Aberdour","Abergavenny","Aberystwyth","Accrington","Acton","Adlington","Aldershot","Alton","Altrincham",
  "Andover","Angmering","Arbroath","Ardrossan","Arundel","Ascot","Ashford International","Ashtead","Ashton-under-Lyne",
  "Aviemore","Axminster","Aylesbury","Ayr","Bagshot","Banbury","Bangor","Barnsley","Barnstaple","Barrow-in-Furness",
  "Barry","Basingstoke","Bath Spa","Battersea Power Station","Bedford","Belfast","Berwick-upon-Tweed","Beverley",
  "Bexhill","Bickley","Birkenhead","Birmingham International","Birmingham Moor Street","Birmingham New Street",
  "Birmingham Snow Hill","Bishops Stortford","Blackburn","Blackpool North","Blackpool South","Blaenrhondda",
  "Bognor Regis","Bolton","Boston","Bournemouth","Bradford Forster Square","Bradford Interchange","Braintree",
  "Brentwood","Bridgend","Bridgwater","Brighton","Bristol Parkway","Bristol Temple Meads","Bromley South",
  "Bromsgrove","Burgess Hill","Bury St Edmunds","Buxton","Cambridge","Canterbury East","Canterbury West",
  "Cardiff Central","Cardiff Queen Street","Carlisle","Carmarthen","Caterham","Chatham","Chelmsford",
  "Cheltenham Spa","Chester","Chesterfield","Chichester","Chippenham","Chorley","Clacton-on-Sea","Clapham Junction",
  "Colchester","Coleraine","Coventry","Crawley","Crewe","Croydon","Darlington","Dartford","Derby","Doncaster",
  "Dover Priory","Droitwich Spa","Dundee","Durham","Eastbourne","Edinburgh Waverley","Ebbsfleet International",
  "Ely","Epsom","Euston","Exeter Central","Exeter St Davids","Exmouth","Falmouth","Fareham","Farnborough",
  "Farnham","Felixstowe","Fishguard","Folkestone Central","Gatwick Airport","Glasgow Central","Glasgow Queen Street",
  "Gloucester","Grantham","Gravesend","Great Malvern","Grimsby","Guildford","Halifax","Harlow","Harrogate",
  "Hastings","Hatfield","Havant","Haywards Heath","Hereford","Hertford","High Wycombe","Hitchin","Horsham",
  "Huddersfield","Hull","Inverness","Ipswich","Kettering","Kings Lynn","Lancaster","Leeds","Leicester",
  "Lewes","Lichfield","Lincoln","Liverpool Central","Liverpool James Street","Liverpool Lime Street",
  "Liverpool Street","Llandudno","London Bridge","London Cannon Street","London Charing Cross",
  "London Euston","London Fenchurch Street","London Kings Cross","London Marylebone","London Paddington",
  "London St Pancras International","London Victoria","London Waterloo","Luton","Luton Airport Parkway",
  "Macclesfield","Maidenhead","Maidstone East","Maidstone West","Manchester Airport","Manchester Piccadilly",
  "Manchester Victoria","Mansfield","Margate","Milton Keynes Central","Motherwell","Newark","Newbury",
  "Newcastle","Newport","Northampton","Norwich","Nottingham","Nuneaton","Oxford","Penrith","Perth",
  "Peterborough","Plymouth","Poole","Portsmouth","Preston","Ramsgate","Reading","Redhill","Reigate",
  "Richmond","Romford","Rugby","Ryde","Salisbury","Scarborough","Sevenoaks","Sheffield","Shrewsbury",
  "Slough","Southampton Airport Parkway","Southampton Central","Southend Airport","Southend Central",
  "Southend Victoria","St Albans","St Pancras International","Stafford","Stansted Airport","Stevenage",
  "Stirling","Stockport","Stoke-on-Trent","Stratford","Stratford-upon-Avon","Sunderland","Surbiton",
  "Sutton","Swansea","Swindon","Taunton","Tonbridge","Torquay","Totnes","Truro","Tunbridge Wells",
  "Wakefield","Warrington","Watford Junction","Welwyn Garden City","Weston-super-Mare","Weymouth",
  "Wigan","Winchester","Windsor","Woking","Wolverhampton","Worcester","Worthing","Wrexham","Yeovil","York"
];

async function callAPI(systemPrompt, userPrompt, attempt = 1) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }

  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Unexpected server response (HTTP ${response.status})`); }

  if (!response.ok) {
    const msg = data?.error?.message || `API error (HTTP ${response.status})`;
    if (attempt < 3 && (response.status === 529 || response.status >= 500)) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return callAPI(systemPrompt, userPrompt, attempt + 1);
    }
    throw new Error(msg);
  }

  if (data.error) throw new Error(data.error.message || "Unknown API error");

  const text = (data.content || []).map(b => b.text || "").join("").trim();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!Array.isArray(parsed)) {
    try { parsed = JSON.parse(text.replace(/```json|```/gi, "").trim()); } catch {}
  }
  if (!Array.isArray(parsed)) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Could not parse response — please retry.");
  }
  return parsed;
}

function buildHS1Prompt(direction, dateTime) {
  const { from, to } = STATIONS[direction];
  if (dateTime) return `Give me 4 trains from ${from} to ${to} starting from ${dateTime}. Return JSON array only.`;
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `Give me the next 4 trains from ${from} to ${to} starting from ${timeStr} on ${dateStr}. Return JSON array only.`;
}

function buildUKSearchPrompt(from, to, dateTime) {
  if (dateTime) return `Give me 4 trains from ${from} to ${to} starting from ${dateTime}. Return JSON array only.`;
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `Give me the next 4 trains from ${from} to ${to} starting from ${timeStr} on ${dateStr}. Return JSON array only.`;
}

// Shared styles
const inputStyle = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", color: "#f0e6d3", fontSize: "0.85rem", outline: "none", width: "100%" };

function StatusBadge({ status }) {
  const delayed = status?.toLowerCase().includes("delayed");
  return (
    <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", padding: "2px 8px", borderRadius: "20px", background: delayed ? "#ff4d4d22" : "#00e67622", color: delayed ? "#ff6b6b" : "#00c853", border: `1px solid ${delayed ? "#ff6b6b44" : "#00c85344"}` }}>
      {status}
    </span>
  );
}

function TrainCard({ train, index, showCallingPoints = false }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", marginBottom: "10px", animation: `slideIn 0.3s ease ${index * 0.07}s both` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#f0e6d3", fontFamily: "'Playfair Display', serif" }}>{train.departure}</span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "1rem" }}>→</span>
          <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "rgba(240,230,211,0.7)" }}>{train.arrival}</span>
        </div>
        <StatusBadge status={train.status} />
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: showCallingPoints && train.callingPoints && train.callingPoints !== "Direct" ? "10px" : "0" }}>
        {[
          { icon: "⏱", label: train.duration },
          { icon: "🚉", label: train.platform },
          { icon: "🚆", label: train.operator },
          { icon: "📍", label: train.stops || train.trainType },
        ].filter(x => x.label).map(({ icon, label }) => (
          <span key={label} style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: "4px" }}>
            <span>{icon}</span>{label}
          </span>
        ))}
      </div>
      {showCallingPoints && train.callingPoints && train.callingPoints !== "Direct" && (
        <div>
          <button onClick={() => setExpanded(e => !e)}
            style={{ background: "none", border: "none", color: "rgba(201,160,100,0.6)", fontSize: "0.75rem", cursor: "pointer", padding: "0", letterSpacing: "0.05em" }}>
            {expanded ? "▲ Hide stops" : "▼ Calling points"}
          </button>
          {expanded && (
            <div style={{ marginTop: "8px", fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", lineHeight: 1.8 }}>
              {train.callingPoints.split(",").map(s => s.trim()).map((stop, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(201,160,100,0.4)", display: "inline-block", flexShrink: 0 }}></span>
                  {stop}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ error, retryCount, onRetry }) {
  return (
    <div style={{ background: "#ff4d4d15", border: "1px solid #ff4d4d33", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px" }}>
      <div style={{ color: "#ff8080", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>
        ⚠ Could not load trains {retryCount > 1 ? `(attempt ${retryCount})` : ""}
      </div>
      <div style={{ color: "rgba(255,140,140,0.7)", fontSize: "0.78rem", marginBottom: "10px", wordBreak: "break-word" }}>{error}</div>
      <button onClick={onRetry} style={{ background: "rgba(255,100,100,0.15)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "6px", padding: "6px 14px", color: "#ff8080", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
        Retry
      </button>
    </div>
  );
}

function LoadButton({ loading, onClick, label = "Show Next 4 Trains" }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ width: "100%", background: loading ? "rgba(201,160,100,0.08)" : "linear-gradient(135deg, rgba(201,160,100,0.25), rgba(201,160,100,0.1))", border: "1px solid rgba(201,160,100,0.35)", borderRadius: "10px", padding: "12px", color: "#c9a064", fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.06em", cursor: loading ? "not-allowed" : "pointer", marginBottom: "20px", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
      {loading ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading trains…</> : <><span>⟳</span> {label}</>}
    </button>
  );
}

// Autocomplete station input
function StationInput({ value, onChange, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowSuggestions(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    if (val.length >= 2) {
      const filtered = UK_STATIONS.filter(s => s.toLowerCase().includes(val.toLowerCase())).slice(0, 6);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSelect = (station) => {
    onChange(station);
    setShowSuggestions(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input value={value} onChange={handleChange} placeholder={placeholder}
        onFocus={() => value.length >= 2 && setShowSuggestions(suggestions.length > 0)}
        style={{ ...inputStyle }} />
      {showSuggestions && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", zIndex: 50, marginTop: "4px", overflow: "hidden" }}>
          {suggestions.map(s => (
            <div key={s} onClick={() => handleSelect(s)}
              style={{ padding: "10px 14px", fontSize: "0.85rem", color: "#f0e6d3", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              onMouseEnter={e => e.target.style.background = "rgba(201,160,100,0.1)"}
              onMouseLeave={e => e.target.style.background = "transparent"}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// HS1 fixed route tab
function HS1TabPanel({ direction }) {
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
    setLoading(true); setError(null);
    try {
      const result = await callAPI(HS1_SYSTEM_PROMPT, buildHS1Prompt(direction, customDateTime));
      setTrains(result); setLastFetched(new Date()); setRetryCount(0);
    } catch (e) {
      setError(e.message); setRetryCount(c => c + 1);
    } finally { setLoading(false); }
  };

  const handleSearch = () => {
    if (!searchDate || !searchTime) return;
    const dt = new Date(`${searchDate}T${searchTime}`);
    const formatted = dt.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    setMode("search"); setLastCustomDT(formatted); load(formatted);
  };

  const handleNext = () => { setMode("next"); setSearchDate(""); setSearchTime(""); setLastCustomDT(null); load(null); };
  const handleRetry = () => mode === "search" && lastCustomDT ? load(lastCustomDT) : handleNext();

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, rgba(201,160,100,0.15), rgba(201,160,100,0.05))", border: "1px solid rgba(201,160,100,0.2)", borderRadius: "12px", padding: "14px 18px", marginBottom: "20px" }}>
        <div style={{ fontSize: "0.7rem", color: "rgba(201,160,100,0.7)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>Route</div>
        <div style={{ fontSize: "0.95rem", color: "#f0e6d3", fontWeight: 600 }}>{from} <span style={{ color: "rgba(201,160,100,0.8)" }}>→</span> {to}</div>
      </div>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Search by date & time</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)} style={{ flex: 1, minWidth: "130px", ...inputStyle }} />
          <input type="time" value={searchTime} onChange={e => setSearchTime(e.target.value)} style={{ flex: 1, minWidth: "100px", ...inputStyle }} />
          <button onClick={handleSearch} disabled={!searchDate || !searchTime || loading}
            style={{ background: "rgba(201,160,100,0.2)", border: "1px solid rgba(201,160,100,0.4)", borderRadius: "8px", padding: "9px 16px", color: "#c9a064", fontSize: "0.85rem", fontWeight: 600, cursor: searchDate && searchTime && !loading ? "pointer" : "not-allowed", opacity: searchDate && searchTime ? 1 : 0.5 }}>
            Search
          </button>
        </div>
      </div>
      <LoadButton loading={loading} onClick={handleNext} />
      {error && <ErrorBox error={error} retryCount={retryCount} onRetry={handleRetry} />}
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
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "40px 20px", fontSize: "0.9rem" }}>Press the button above to load train times</div>
      )}
    </div>
  );
}

// UK Search tab
function UKSearchPanel() {
  const [fromStation, setFromStation] = useState("");
  const [toStation, setToStation] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [searchTime, setSearchTime] = useState("");
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastFetched, setLastFetched] = useState(null);
  const [lastSearch, setLastSearch] = useState(null);

  const canSearch = fromStation.length >= 2 && toStation.length >= 2;

  const load = async (from, to, customDateTime) => {
    setLoading(true); setError(null);
    try {
      const result = await callAPI(UK_SEARCH_SYSTEM_PROMPT, buildUKSearchPrompt(from, to, customDateTime));
      setTrains(result); setLastFetched(new Date()); setRetryCount(0);
    } catch (e) {
      setError(e.message); setRetryCount(c => c + 1);
    } finally { setLoading(false); }
  };

  const handleSearch = () => {
    if (!canSearch) return;
    let customDT = null;
    if (searchDate && searchTime) {
      const dt = new Date(`${searchDate}T${searchTime}`);
      customDT = dt.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    setLastSearch({ from: fromStation, to: toStation, customDT });
    load(fromStation, toStation, customDT);
  };

  const handleSwap = () => { setFromStation(toStation); setToStation(fromStation); setTrains([]); };
  const handleRetry = () => lastSearch ? load(lastSearch.from, lastSearch.to, lastSearch.customDT) : null;

  return (
    <div>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>From / To</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
          <StationInput value={fromStation} onChange={setFromStation} placeholder="Departure station" />
          <button onClick={handleSwap} title="Swap stations"
            style={{ background: "rgba(201,160,100,0.1)", border: "1px solid rgba(201,160,100,0.25)", borderRadius: "8px", padding: "9px 10px", color: "#c9a064", cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}>
            ⇅
          </button>
          <StationInput value={toStation} onChange={setToStation} placeholder="Arrival station" />
        </div>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px", marginTop: "4px" }}>Date & time (optional)</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)} style={{ flex: 1, minWidth: "130px", ...inputStyle }} />
          <input type="time" value={searchTime} onChange={e => setSearchTime(e.target.value)} style={{ flex: 1, minWidth: "100px", ...inputStyle }} />
        </div>
      </div>

      <button onClick={handleSearch} disabled={!canSearch || loading}
        style={{ width: "100%", background: !canSearch || loading ? "rgba(201,160,100,0.08)" : "linear-gradient(135deg, rgba(201,160,100,0.25), rgba(201,160,100,0.1))", border: "1px solid rgba(201,160,100,0.35)", borderRadius: "10px", padding: "12px", color: "#c9a064", fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.06em", cursor: canSearch && !loading ? "pointer" : "not-allowed", marginBottom: "20px", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: canSearch ? 1 : 0.5 }}>
        {loading ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Searching…</> : <><span>🔍</span> Search Trains</>}
      </button>

      {error && <ErrorBox error={error} retryCount={retryCount} onRetry={handleRetry} />}

      {trains.length > 0 && lastSearch && (
        <div>
          <div style={{ background: "linear-gradient(135deg, rgba(100,140,201,0.15), rgba(100,140,201,0.05))", border: "1px solid rgba(100,140,201,0.2)", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.85rem", color: "#a0b8e0", fontWeight: 600 }}>
              {lastSearch.from} <span style={{ opacity: 0.6 }}>→</span> {lastSearch.to}
            </div>
            {lastFetched && <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.3)" }}>Updated {lastFetched.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>}
          </div>
          {trains.map((train, i) => <TrainCard key={i} train={train} index={i} showCallingPoints={true} />)}
        </div>
      )}

      {trains.length === 0 && !loading && !error && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "40px 20px", fontSize: "0.9rem" }}>
          Enter stations above to search UK trains
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
    { id: "search", short: "🔍 UK Search" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0f", backgroundImage: "radial-gradient(ellipse at 20% 0%, rgba(201,160,100,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(100,140,201,0.06) 0%, transparent 60%)", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        input::placeholder { color: rgba(255,255,255,0.25); }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ padding: "24px 20px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: "480px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
            <span style={{ fontSize: "1.4rem" }}>🚄</span>
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f0e6d3", fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>UK Trains</div>
              <div style={{ fontSize: "0.68rem", color: "rgba(201,160,100,0.6)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Rail Timetable</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "2px" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flex: 1, background: activeTab === tab.id ? "rgba(201,160,100,0.15)" : "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab.id ? "#c9a064" : "transparent"}`, padding: "10px 4px", color: activeTab === tab.id ? "#c9a064" : "rgba(255,255,255,0.35)", fontSize: "0.72rem", fontWeight: activeTab === tab.id ? 700 : 500, letterSpacing: "0.03em", cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif" }}>
                {tab.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px 40px" }}>
        {activeTab === "outbound" && <HS1TabPanel key="outbound" direction="outbound" />}
        {activeTab === "inbound" && <HS1TabPanel key="inbound" direction="inbound" />}
        {activeTab === "search" && <UKSearchPanel key="search" />}
      </div>
    </div>
  );
}

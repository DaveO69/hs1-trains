import { useState, useRef, useEffect } from "react";
import TVGuide from "./TVGuide";

const API_URL = "/api/proxy";

const STATIONS = {
  outbound: { from: "Ebbsfleet International", to: "St Pancras International" },
  inbound: { from: "St Pancras International", to: "Ebbsfleet International" },
};

// Fixed coords for HS1 stations
const STATION_COORDS = {
  "Ebbsfleet International": { lat: 51.4429, lon: 0.3198 },
  "St Pancras International": { lat: 51.5322, lon: -0.1234 },
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
- operator: string (the real UK train operator for that route)
- status: string - mostly "On time", occasionally "Delayed 5 mins"
- callingPoints: array of objects with { station: string, arrival: string (HH:MM) }, or empty array if direct
- stops: string (e.g. "Direct", "2 stops", "3 stops")
Generate 4 realistic trains spaced roughly 20-60 mins apart based on typical UK rail frequencies.
Use accurate journey times and operators for UK routes.`;

const GEOCODE_SYSTEM_PROMPT = `You are a geocoding assistant. When given a UK train station name, respond ONLY with a JSON object (no markdown) with:
- lat: number (latitude to 4 decimal places)
- lon: number (longitude to 4 decimal places)
- city: string (the nearest city or town name)
Be accurate for UK train stations.`;

const UK_STATIONS = [
  "Aberdeen","Aberdour","Abergavenny","Aberystwyth","Accrington","Acton","Adlington","Aldershot","Alton","Altrincham",
  "Andover","Angmering","Arbroath","Ardrossan","Arundel","Ascot","Ashford International","Ashtead","Ashton-under-Lyne",
  "Aviemore","Axminster","Aylesbury","Ayr","Bagshot","Banbury","Bangor","Barnsley","Barnstaple","Barrow-in-Furness",
  "Barry","Basingstoke","Bath Spa","Bedford","Belfast","Berwick-upon-Tweed","Beverley","Bexhill","Birmingham International",
  "Birmingham Moor Street","Birmingham New Street","Birmingham Snow Hill","Bishops Stortford","Blackburn","Blackpool North",
  "Bognor Regis","Bolton","Boston","Bournemouth","Bradford Forster Square","Bradford Interchange","Braintree","Brentwood",
  "Bridgend","Bridgwater","Brighton","Bristol Parkway","Bristol Temple Meads","Bromley South","Bromsgrove","Burgess Hill",
  "Bury St Edmunds","Buxton","Cambridge","Canterbury East","Canterbury West","Cardiff Central","Cardiff Queen Street",
  "Carlisle","Carmarthen","Caterham","Chatham","Chelmsford","Cheltenham Spa","Chester","Chesterfield","Chichester",
  "Chippenham","Chorley","Clacton-on-Sea","Clapham Junction","Colchester","Coventry","Crawley","Crewe","Darlington",
  "Dartford","Derby","Doncaster","Dover Priory","Dundee","Durham","Eastbourne","Ebbsfleet International",
  "Edinburgh Waverley","Ely","Epsom","Exeter Central","Exeter St Davids","Exmouth","Fareham","Farnborough","Farnham",
  "Felixstowe","Folkestone Central","Gatwick Airport","Glasgow Central","Glasgow Queen Street","Gloucester","Grantham",
  "Gravesend","Great Malvern","Grimsby","Guildford","Halifax","Harlow","Harrogate","Hastings","Hatfield","Havant",
  "Haywards Heath","Hereford","Hertford","High Wycombe","Hitchin","Horsham","Huddersfield","Hull","Inverness","Ipswich",
  "Kettering","Kings Lynn","Lancaster","Leeds","Leicester","Lewes","Lichfield","Lincoln","Liverpool Central",
  "Liverpool James Street","Liverpool Lime Street","Liverpool Street","Llandudno","London Bridge","London Cannon Street",
  "London Charing Cross","London Euston","London Fenchurch Street","London Kings Cross","London Marylebone",
  "London Paddington","London St Pancras International","London Victoria","London Waterloo","Luton",
  "Luton Airport Parkway","Macclesfield","Maidenhead","Maidstone East","Maidstone West","Manchester Airport",
  "Manchester Piccadilly","Manchester Victoria","Mansfield","Margate","Milton Keynes Central","Motherwell","Newark",
  "Newbury","Newcastle","Newport","Northampton","Norwich","Nottingham","Nuneaton","Oxford","Penrith","Perth",
  "Peterborough","Plymouth","Poole","Portsmouth","Preston","Ramsgate","Reading","Redhill","Reigate","Richmond",
  "Romford","Rugby","Salisbury","Scarborough","Sevenoaks","Sheffield","Shrewsbury","Slough",
  "Southampton Airport Parkway","Southampton Central","Southend Airport","Southend Central","Southend Victoria",
  "St Albans","St Pancras International","Stafford","Stansted Airport","Stevenage","Stirling","Stockport",
  "Stoke-on-Trent","Stratford","Stratford-upon-Avon","Sunderland","Surbiton","Sutton","Swansea","Swindon",
  "Taunton","Tonbridge","Torquay","Totnes","Truro","Tunbridge Wells","Wakefield","Warrington","Watford Junction",
  "Welwyn Garden City","Weston-super-Mare","Weymouth","Wigan","Winchester","Windsor","Woking","Wolverhampton",
  "Worcester","Worthing","Wrexham","Yeovil","York"
];

// ── API helpers ──────────────────────────────────────────────────────────────

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
  if (!parsed) { try { parsed = JSON.parse(text.replace(/```json|```/gi, "").trim()); } catch {} }
  if (!parsed) { const m = text.match(/[\[{][\s\S]*[\]}]/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  if (!parsed) throw new Error("Could not parse response — please retry.");
  return parsed;
}

async function geocodeStation(stationName) {
  if (STATION_COORDS[stationName]) return { ...STATION_COORDS[stationName], city: stationName.replace(" International", "").replace(" Station", "") };
  const result = await callAPI(GEOCODE_SYSTEM_PROMPT, `What are the coordinates of "${stationName}" train station in the UK? Return JSON only.`);
  return result;
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,uv_index,weather_code&daily=sunrise,sunset,precipitation_sum,uv_index_max&timezone=Europe%2FLondon&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather data unavailable");
  return res.json();
}

// ── Shared UI components ─────────────────────────────────────────────────────

const inputStyle = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px", padding: "9px 12px", color: "#f0e6d3", fontSize: "0.85rem", outline: "none", width: "100%"
};

function StatusBadge({ status }) {
  const delayed = status?.toLowerCase().includes("delayed");
  return (
    <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", padding: "2px 8px", borderRadius: "20px", background: delayed ? "#ff4d4d22" : "#00e67622", color: delayed ? "#ff6b6b" : "#00c853", border: `1px solid ${delayed ? "#ff6b6b44" : "#00c85344"}` }}>
      {status}
    </span>
  );
}

function ErrorBox({ error, retryCount, onRetry }) {
  return (
    <div style={{ background: "#ff4d4d15", border: "1px solid #ff4d4d33", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px" }}>
      <div style={{ color: "#ff8080", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>⚠ Error {retryCount > 1 ? `(attempt ${retryCount})` : ""}</div>
      <div style={{ color: "rgba(255,140,140,0.7)", fontSize: "0.78rem", marginBottom: "10px", wordBreak: "break-word" }}>{error}</div>
      {onRetry && <button onClick={onRetry} style={{ background: "rgba(255,100,100,0.15)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "6px", padding: "6px 14px", color: "#ff8080", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>Retry</button>}
    </div>
  );
}

function LoadButton({ loading, onClick, label = "Show Next 4 Trains", disabled = false }) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      style={{ width: "100%", background: loading || disabled ? "rgba(201,160,100,0.08)" : "linear-gradient(135deg, rgba(201,160,100,0.25), rgba(201,160,100,0.1))", border: "1px solid rgba(201,160,100,0.35)", borderRadius: "10px", padding: "12px", color: "#c9a064", fontSize: "0.9rem", fontWeight: 700, letterSpacing: "0.06em", cursor: loading || disabled ? "not-allowed" : "pointer", marginBottom: "20px", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: disabled ? 0.5 : 1 }}>
      {loading ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading…</> : <><span>⟳</span> {label}</>}
    </button>
  );
}

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
    const val = e.target.value; onChange(val);
    if (val.length >= 2) {
      const filtered = UK_STATIONS.filter(s => s.toLowerCase().includes(val.toLowerCase())).slice(0, 6);
      setSuggestions(filtered); setShowSuggestions(filtered.length > 0);
    } else { setShowSuggestions(false); }
  };
  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input value={value} onChange={handleChange} placeholder={placeholder}
        onFocus={() => value.length >= 2 && setShowSuggestions(suggestions.length > 0)}
        style={inputStyle} />
      {showSuggestions && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", zIndex: 50, marginTop: "4px", overflow: "hidden" }}>
          {suggestions.map(s => (
            <div key={s} onClick={() => { onChange(s); setShowSuggestions(false); }}
              style={{ padding: "10px 14px", fontSize: "0.85rem", color: "#f0e6d3", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(201,160,100,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrainCard({ train, index, showCallingPoints = false }) {
  const [expanded, setExpanded] = useState(false);
  const hasStops = showCallingPoints && Array.isArray(train.callingPoints) && train.callingPoints.length > 0;
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
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: hasStops ? "10px" : 0 }}>
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
      {hasStops && (
        <div>
          <button onClick={() => setExpanded(e => !e)}
            style={{ background: "none", border: "none", color: "rgba(201,160,100,0.6)", fontSize: "0.75rem", cursor: "pointer", padding: 0, letterSpacing: "0.05em" }}>
            {expanded ? "▲ Hide stops" : "▼ Calling points"}
          </button>
          {expanded && (
            <div style={{ marginTop: "8px", fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", lineHeight: 1.8 }}>
              {train.callingPoints.map((stop, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", paddingRight: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(201,160,100,0.4)", display: "inline-block", flexShrink: 0 }}></span>
                    {typeof stop === "object" ? stop.station : stop}
                  </div>
                  {typeof stop === "object" && stop.arrival && (
                    <span style={{ color: "rgba(201,160,100,0.7)", fontWeight: 600, flexShrink: 0 }}>{stop.arrival}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Weather helpers ──────────────────────────────────────────────────────────

const WMO_CODES = {
  0: { label: "Clear sky", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤️" }, 2: { label: "Partly cloudy", icon: "⛅" }, 3: { label: "Overcast", icon: "☁️" },
  45: { label: "Foggy", icon: "🌫️" }, 48: { label: "Icy fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" }, 53: { label: "Drizzle", icon: "🌦️" }, 55: { label: "Heavy drizzle", icon: "🌧️" },
  61: { label: "Light rain", icon: "🌧️" }, 63: { label: "Rain", icon: "🌧️" }, 65: { label: "Heavy rain", icon: "🌧️" },
  71: { label: "Light snow", icon: "🌨️" }, 73: { label: "Snow", icon: "❄️" }, 75: { label: "Heavy snow", icon: "❄️" },
  80: { label: "Light showers", icon: "🌦️" }, 81: { label: "Showers", icon: "🌧️" }, 82: { label: "Heavy showers", icon: "⛈️" },
  95: { label: "Thunderstorm", icon: "⛈️" }, 96: { label: "Thunderstorm", icon: "⛈️" }, 99: { label: "Thunderstorm", icon: "⛈️" },
};

function uvLabel(uv) {
  if (uv <= 2) return { label: "Low", color: "#00c853" };
  if (uv <= 5) return { label: "Moderate", color: "#ffd600" };
  if (uv <= 7) return { label: "High", color: "#ff6d00" };
  if (uv <= 10) return { label: "Very High", color: "#d50000" };
  return { label: "Extreme", color: "#aa00ff" };
}

function formatTime(iso) {
  if (!iso) return "—";
  return iso.slice(11, 16);
}

function WeatherCard({ stationName, coords, accentColor = "rgba(201,160,100" }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      let lat, lon, city;
      if (coords) { lat = coords.lat; lon = coords.lon; city = stationName; }
      else {
        const geo = await geocodeStation(stationName);
        lat = geo.lat; lon = geo.lon; city = geo.city || stationName;
      }
      const data = await fetchWeather(lat, lon);
      const c = data.current;
      const d = data.daily;
      setWeather({
        city,
        temp: Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        precip: c.precipitation,
        wind: Math.round(c.wind_speed_10m),
        uv: c.uv_index,
        code: c.weather_code,
        sunrise: formatTime(d.sunrise?.[0]),
        sunset: formatTime(d.sunset?.[0]),
        dailyPrecip: d.precipitation_sum?.[0],
        dailyUvMax: d.uv_index_max?.[0],
      });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [stationName]);

  const wmo = weather ? (WMO_CODES[weather.code] || { label: "Unknown", icon: "🌡️" }) : null;
  const uv = weather ? uvLabel(weather.dailyUvMax ?? weather.uv) : null;

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${accentColor},0.2)`, borderRadius: "14px", padding: "18px 20px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
        <div>
          <div style={{ fontSize: "0.68rem", color: `${accentColor},0.6)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>📍 {stationName}</div>
          {weather && <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)" }}>{wmo.icon} {wmo.label}</div>}
        </div>
        {weather && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#f0e6d3", fontFamily: "'Playfair Display', serif", lineHeight: 1 }}>{weather.temp}°</div>
            <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>Feels {weather.feelsLike}°</div>
          </div>
        )}
        {loading && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.85rem", animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</div>}
      </div>

      {error && <div style={{ color: "#ff8080", fontSize: "0.8rem", marginBottom: "10px" }}>⚠ {error}</div>}

      {weather && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
            {[
              { icon: "🌧", label: "Rain today", value: `${weather.dailyPrecip ?? weather.precip}mm` },
              { icon: "💨", label: "Wind", value: `${weather.wind} km/h` },
              { icon: "☀", label: `UV (${uv.label})`, value: `${weather.dailyUvMax ?? weather.uv}`, valueColor: uv.color },
            ].map(({ icon, label, value, valueColor }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontSize: "1rem", marginBottom: "4px" }}>{icon}</div>
                <div style={{ fontSize: "1rem", fontWeight: 700, color: valueColor || "#f0e6d3" }}>{value}</div>
                <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {[
              { icon: "🌅", label: "Sunrise", value: weather.sunrise },
              { icon: "🌇", label: "Sunset", value: weather.sunset },
            ].map(({ icon, label, value }) => (
              <div key={label} style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)" }}>{icon} {label}</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0e6d3" }}>{value}</span>
              </div>
            ))}
          </div>
          <button onClick={load} style={{ marginTop: "12px", background: "none", border: "none", color: `${accentColor},0.5)`, fontSize: "0.75rem", cursor: "pointer", padding: 0, letterSpacing: "0.05em" }}>
            ⟳ Refresh
          </button>
        </>
      )}
    </div>
  );
}

// ── Tab panels ───────────────────────────────────────────────────────────────

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

  const buildPrompt = (dt) => {
    if (dt) return `Give me 4 trains from ${from} to ${to} starting from ${dt}. Return JSON array only.`;
    const now = new Date();
    const t = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const d = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `Give me the next 4 trains from ${from} to ${to} starting from ${t} on ${d}. Return JSON array only.`;
  };

  const load = async (dt) => {
    setLoading(true); setError(null);
    try {
      const result = await callAPI(HS1_SYSTEM_PROMPT, buildPrompt(dt));
      setTrains(Array.isArray(result) ? result : []); setLastFetched(new Date()); setRetryCount(0);
    } catch (e) { setError(e.message); setRetryCount(c => c + 1); }
    finally { setLoading(false); }
  };

  const handleSearch = () => {
    if (!searchDate || !searchTime) return;
    const dt = new Date(`${searchDate}T${searchTime}`).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    setMode("search"); setLastCustomDT(dt); load(dt);
  };

  const handleNext = () => { setMode("next"); setSearchDate(""); setSearchTime(""); setLastCustomDT(null); load(null); };

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
            style={{ background: "rgba(201,160,100,0.2)", border: "1px solid rgba(201,160,100,0.4)", borderRadius: "8px", padding: "9px 16px", color: "#c9a064", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", opacity: searchDate && searchTime ? 1 : 0.5 }}>
            Search
          </button>
        </div>
      </div>
      <LoadButton loading={loading} onClick={handleNext} />
      {error && <ErrorBox error={error} retryCount={retryCount} onRetry={() => mode === "search" && lastCustomDT ? load(lastCustomDT) : handleNext()} />}
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

function EbbsStPPanel() {
  return (
    <div>
      {/* Outbound */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(201,160,100,0.15)" }} />
          <span style={{ fontSize: "0.68rem", color: "rgba(201,160,100,0.5)", letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Outbound</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(201,160,100,0.15)" }} />
        </div>
        <HS1TabPanel direction="outbound" />
      </div>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <div style={{ flex: 1, height: "1px", background: "rgba(100,140,201,0.15)" }} />
        <span style={{ fontSize: "0.68rem", color: "rgba(100,140,201,0.5)", letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Inbound</span>
        <div style={{ flex: 1, height: "1px", background: "rgba(100,140,201,0.15)" }} />
      </div>

      {/* Inbound */}
      <HS1TabPanel direction="inbound" />
    </div>
  );
}

function UKSearchPanel({ onStationsChange }) {
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

  const buildPrompt = (from, to, dt) => {
    if (dt) return `Give me 4 trains from ${from} to ${to} starting from ${dt}. Return JSON array only.`;
    const now = new Date();
    const t = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const d = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `Give me the next 4 trains from ${from} to ${to} starting from ${t} on ${d}. Return JSON array only.`;
  };

  const load = async (from, to, dt) => {
    setLoading(true); setError(null);
    try {
      const result = await callAPI(UK_SEARCH_SYSTEM_PROMPT, buildPrompt(from, to, dt));
      setTrains(Array.isArray(result) ? result : []); setLastFetched(new Date()); setRetryCount(0);
      if (onStationsChange) onStationsChange(from, to);
    } catch (e) { setError(e.message); setRetryCount(c => c + 1); }
    finally { setLoading(false); }
  };

  const handleSearch = () => {
    if (!canSearch) return;
    let dt = null;
    if (searchDate && searchTime) {
      dt = new Date(`${searchDate}T${searchTime}`).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    setLastSearch({ from: fromStation, to: toStation, dt });
    load(fromStation, toStation, dt);
  };

  return (
    <div>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>From / To</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
          <StationInput value={fromStation} onChange={setFromStation} placeholder="Departure station" />
          <button onClick={() => { setFromStation(toStation); setToStation(fromStation); setTrains([]); }}
            style={{ background: "rgba(201,160,100,0.1)", border: "1px solid rgba(201,160,100,0.25)", borderRadius: "8px", padding: "9px 10px", color: "#c9a064", cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}>⇅</button>
          <StationInput value={toStation} onChange={setToStation} placeholder="Arrival station" />
        </div>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>Date & time (optional)</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)} style={{ flex: 1, minWidth: "130px", ...inputStyle }} />
          <input type="time" value={searchTime} onChange={e => setSearchTime(e.target.value)} style={{ flex: 1, minWidth: "100px", ...inputStyle }} />
        </div>
      </div>
      <button onClick={handleSearch} disabled={!canSearch || loading}
        style={{ width: "100%", background: !canSearch || loading ? "rgba(201,160,100,0.08)" : "linear-gradient(135deg, rgba(201,160,100,0.25), rgba(201,160,100,0.1))", border: "1px solid rgba(201,160,100,0.35)", borderRadius: "10px", padding: "12px", color: "#c9a064", fontSize: "0.9rem", fontWeight: 700, cursor: canSearch && !loading ? "pointer" : "not-allowed", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: canSearch ? 1 : 0.5 }}>
        {loading ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Searching…</> : <><span>🔍</span> Search Trains</>}
      </button>
      {error && <ErrorBox error={error} retryCount={retryCount} onRetry={() => lastSearch ? load(lastSearch.from, lastSearch.to, lastSearch.dt) : null} />}
      {trains.length > 0 && lastSearch && (
        <div>
          <div style={{ background: "linear-gradient(135deg, rgba(100,140,201,0.15), rgba(100,140,201,0.05))", border: "1px solid rgba(100,140,201,0.2)", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.85rem", color: "#a0b8e0", fontWeight: 600 }}>{lastSearch.from} <span style={{ opacity: 0.6 }}>→</span> {lastSearch.to}</div>
            {lastFetched && <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.3)" }}>Updated {lastFetched.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>}
          </div>
          {trains.map((train, i) => <TrainCard key={i} train={train} index={i} showCallingPoints={true} />)}
        </div>
      )}
      {trains.length === 0 && !loading && !error && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "40px 20px", fontSize: "0.9rem" }}>Enter stations above to search UK trains</div>
      )}
    </div>
  );
}

function WeatherPanel({ ukSearchStations }) {
  const hs1Stations = [
    { name: "Ebbsfleet International", coords: STATION_COORDS["Ebbsfleet International"] },
    { name: "St Pancras International", coords: STATION_COORDS["St Pancras International"] },
  ];

  const hasUKSearch = ukSearchStations.from && ukSearchStations.to &&
    ukSearchStations.from !== "Ebbsfleet International" && ukSearchStations.from !== "St Pancras International" &&
    ukSearchStations.to !== "Ebbsfleet International" && ukSearchStations.to !== "St Pancras International";

  return (
    <div>
      <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "14px" }}>HS1 Route</div>
      {hs1Stations.map(s => (
        <WeatherCard key={s.name} stationName={s.name} coords={s.coords} accentColor="rgba(201,160,100" />
      ))}

      {hasUKSearch && (
        <>
          <div style={{ fontSize: "0.72rem", color: "rgba(160,184,224,0.6)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "14px", marginTop: "8px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>UK Search Route</div>
          {[ukSearchStations.from, ukSearchStations.to].map(name => (
            <WeatherCard key={name} stationName={name} coords={null} accentColor="rgba(100,140,201" />
          ))}
        </>
      )}

      {!hasUKSearch && (
        <div style={{ background: "rgba(100,140,201,0.05)", border: "1px solid rgba(100,140,201,0.15)", borderRadius: "12px", padding: "16px", marginTop: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "0.85rem", color: "rgba(160,184,224,0.5)", marginBottom: "4px" }}>🔍 UK Search weather</div>
          <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.25)" }}>Search a UK route in the Search tab to see weather at those stations here</div>
        </div>
      )}
    </div>
  );
}


// ── Traffic Panel ────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { label: "Blackwall Tunnel", icon: "🚇", desc: "TfL live tunnel status", url: "https://tfl.gov.uk/traffic/status/", color: "rgba(0,188,212" },
  { label: "Silvertown Tunnel", icon: "🚇", desc: "TfL live tunnel status", url: "https://tfl.gov.uk/traffic/status/", color: "rgba(0,188,212" },
  { label: "A2 / A102 Traffic", icon: "🛣", desc: "National Highways live map", url: "https://one.network/?gb=true&tm=true&type=area&bbox=-0.15,51.40,0.40,51.55", color: "rgba(255,152,0" },
  { label: "National Highways South East", icon: "🗺", desc: "Live incidents & roadworks", url: "https://nationalhighways.co.uk/travel-updates/south-east/", color: "rgba(255,152,0" },
  { label: "Google Maps Traffic", icon: "📍", desc: "Live traffic layer", url: "https://www.google.com/maps/@51.4877,-0.0174,12z/data=!5m1!1e1", color: "rgba(66,133,244" },
];

const MAP_EMBED_URL = "https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d24000!2d0.05!3d51.5!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2suk!4v1&layer=t";

function TrafficPanel() {
  const [mapLoaded, setMapLoaded] = useState(false);
  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, rgba(255,152,0,0.12), rgba(255,152,0,0.04))", border: "1px solid rgba(255,152,0,0.2)", borderRadius: "12px", padding: "14px 18px", marginBottom: "20px" }}>
        <div style={{ fontSize: "0.7rem", color: "rgba(255,152,0,0.7)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>Live Traffic</div>
        <div style={{ fontSize: "0.9rem", color: "#f0e6d3", fontWeight: 600 }}>Blackwall · Silvertown · A2 Corridor</div>
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.35)", marginTop: "4px" }}>Ebbsfleet ↔ Central London</div>
      </div>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>Live Traffic Map</div>
        <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", position: "relative", background: "#1a1a1f" }}>
          {!mapLoaded && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "0.85rem", zIndex: 1, height: "320px" }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: "8px" }}>⟳</span> Loading map…
            </div>
          )}
          <iframe
            src={MAP_EMBED_URL}
            width="100%" height="320"
            style={{ border: 0, display: "block", filter: "invert(0.9) hue-rotate(180deg) saturate(0.8)" }}
            allowFullScreen="" loading="lazy"
            onLoad={() => setMapLoaded(true)}
            title="Live traffic map"
          />
        </div>
        <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.2)", marginTop: "6px", textAlign: "center" }}>
          Traffic layer active · Blackwall / Silvertown / A2 corridor
        </div>
      </div>
      <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>Official Status Pages</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {QUICK_LINKS.map(link => (
          <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
            style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", background: link.color + ",0.06)", border: "1px solid " + link.color + ",0.2)", borderRadius: "10px", padding: "12px 16px" }}
            onMouseEnter={e => e.currentTarget.style.background = link.color + ",0.14)"}
            onMouseLeave={e => e.currentTarget.style.background = link.color + ",0.06)"}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "1.3rem" }}>{link.icon}</span>
              <div>
                <div style={{ fontSize: "0.88rem", color: "#f0e6d3", fontWeight: 600 }}>{link.label}</div>
                <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", marginTop: "1px" }}>{link.desc}</div>
              </div>
            </div>
            <span style={{ color: link.color + ",0.6)", fontSize: "1rem" }}>↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState("outbound");
  const [ukSearchStations, setUkSearchStations] = useState({ from: "", to: "" });

  const tabs = [
    { id: "ebbsstp", short: "Ebbs/StP" },
    { id: "search", short: "🔍 Search" },
    { id: "weather", short: "🌤 Weather" },
    { id: "traffic", short: "🚦 Traffic" },
    { id: "tv", short: "📺 TV" },
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
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f0e6d3", fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>Dave's Useful Shit</div>
              <div style={{ fontSize: "0.68rem", color: "rgba(201,160,100,0.6)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Rail · Weather · TV</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "2px" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flex: 1, background: activeTab === tab.id ? "rgba(201,160,100,0.15)" : "transparent", border: "none", borderBottom: `2px solid ${activeTab === tab.id ? "#c9a064" : "transparent"}`, padding: "10px 2px", color: activeTab === tab.id ? "#c9a064" : "rgba(255,255,255,0.35)", fontSize: "0.68rem", fontWeight: activeTab === tab.id ? 700 : 500, letterSpacing: "0.02em", cursor: "pointer", transition: "all 0.2s", fontFamily: "'DM Sans', sans-serif" }}>
                {tab.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "480px", margin: "0 auto", padding: "24px 16px 40px" }}>
        {activeTab === "ebbsstp" && <EbbsStPPanel key="ebbsstp" />}
        {activeTab === "search" && <UKSearchPanel onStationsChange={(from, to) => setUkSearchStations({ from, to })} />}
        {activeTab === "weather" && <WeatherPanel ukSearchStations={ukSearchStations} />}
        {activeTab === "traffic" && <TrafficPanel key="traffic" />}
        {activeTab === "tv" && <TVGuide key="tv" />}
      </div>
    </div>
  );
}

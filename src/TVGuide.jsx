import { useState, useRef, useEffect } from "react";

const API_URL = "/api/proxy";

const CHANNEL_CATEGORIES = {
  "Entertainment": [
    "Sky One", "Sky Two", "Sky Atlantic", "Sky Comedy", "Sky Crime",
    "Sky Showcase", "Sky Max", "BBC One", "BBC Two", "BBC Three",
    "ITV1", "ITV2", "ITV3", "ITV4", "Channel 4", "Channel 5",
    "E4", "More4", "Film4", "Dave", "Gold", "W", "Really", "Alibi",
    "Drama", "5Star", "5USA", "Challenge", "Yesterday"
  ],
  "Documentaries & Factual": [
    "Sky Documentaries", "Sky Nature", "Sky History", "Discovery",
    "National Geographic", "Nat Geo Wild", "Animal Planet",
    "HGTV", "Food Network", "TLC", "Investigation Discovery"
  ],
  "Movies": [
    "Sky Cinema Premiere", "Sky Cinema Select", "Sky Cinema Action",
    "Sky Cinema Comedy", "Sky Cinema Family", "Sky Cinema Thriller",
    "Sky Cinema Drama", "Sky Cinema Sci-Fi", "TCM"
  ],
  "Sports": [
    "Sky Sports Main Event", "Sky Sports Football", "Sky Sports Premier League",
    "Sky Sports Cricket", "Sky Sports Golf", "Sky Sports F1",
    "Sky Sports Arena", "Sky Sports Mix", "BT Sport 1", "BT Sport 2",
    "Eurosport 1", "Eurosport 2"
  ],
  "News": [
    "Sky News", "BBC News", "CNN International", "Fox News", "GB News", "TalkTV"
  ],
  "Kids": [
    "Sky Kids", "Cartoon Network", "Nickelodeon", "Nick Jr",
    "Disney Channel", "Disney Junior", "Disney XD", "CBBC", "CBeebies"
  ],
  "Music & Lifestyle": [
    "MTV", "MTV Music", "VH1", "Absolute Radio TV", "Magic TV",
    "Lifestyle", "Living"
  ],
};

const ALL_CHANNELS = Object.values(CHANNEL_CATEGORIES).flat();

const SYSTEM_PROMPT = `You are a UK TV listings assistant with knowledge of Sky UK programming.
When asked for TV listings, respond ONLY with a JSON array (no markdown, no explanation).
Each item in the array represents one channel and has:
- channel: string (channel name)
- shows: array of show objects, each with:
  - title: string
  - start: string (HH:MM)
  - end: string (HH:MM)  
  - genre: string (e.g. "Drama", "Sport", "News", "Film", "Comedy", "Documentary", "Reality", "Entertainment")
  - description: string (1 sentence)
  - rating: string (e.g. "PG", "12", "15", "18", "U", "")
  - isNew: boolean (true if new episode/premiere)

Generate realistic, plausible UK TV listings for the requested channels and time window.
Shows should be appropriate for each channel's typical content.
Time slots should be realistic (news at typical news times, films in evenings, etc).
Make sure shows fill the entire requested time window with no gaps.`;

const GENRE_COLORS = {
  "Drama": "rgba(147,112,219",
  "Sport": "rgba(0,188,212",
  "News": "rgba(244,67,54",
  "Film": "rgba(255,152,0",
  "Comedy": "rgba(76,175,80",
  "Documentary": "rgba(33,150,243",
  "Reality": "rgba(233,30,99",
  "Entertainment": "rgba(255,193,7",
  "Kids": "rgba(139,195,74",
  "Music": "rgba(171,71,188",
  "default": "rgba(120,120,140",
};

function genreColor(genre) {
  return GENRE_COLORS[genre] || GENRE_COLORS.default;
}

function timeToMins(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minsToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function nowMins() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function buildPrompt(channels, startMins, endMins) {
  const startTime = minsToTime(startMins);
  const endTime = minsToTime(endMins);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `Give me UK TV listings for these channels: ${channels.join(", ")}.
Date: ${dateStr}. Time window: ${startTime} to ${endTime}.
Return JSON array only — one object per channel with shows filling the entire window.`;
}

async function fetchListings(channels, startMins, endMins, attempt = 1) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(channels, startMins, endMins) }],
      }),
    });
  } catch { throw new Error("Network error — check your connection."); }

  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Unexpected response (HTTP ${response.status})`); }

  if (!response.ok) {
    const msg = data?.error?.message || `API error (HTTP ${response.status})`;
    if (attempt < 3 && (response.status === 529 || response.status >= 500)) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return fetchListings(channels, startMins, endMins, attempt + 1);
    }
    throw new Error(msg);
  }
  if (data.error) throw new Error(data.error.message || "Unknown API error");

  const text = (data.content || []).map(b => b.text || "").join("").trim();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!parsed) { try { parsed = JSON.parse(text.replace(/```json|```/gi, "").trim()); } catch {} }
  if (!parsed) { const m = text.match(/\[[\s\S]*\]/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  if (!Array.isArray(parsed)) throw new Error("Could not parse listings — please retry.");
  return parsed;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ShowCard({ show, startMins, endMins, totalMins, isCurrentlyOn }) {
  const [expanded, setExpanded] = useState(false);
  const showStart = Math.max(timeToMins(show.start), startMins);
  const showEnd = Math.min(timeToMins(show.end), endMins);
  const widthPct = ((showEnd - showStart) / totalMins) * 100;
  const leftPct = ((showStart - startMins) / totalMins) * 100;
  const color = genreColor(show.genre);
  const durationMins = showEnd - showStart;
  const isShort = durationMins < 30;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        position: "absolute",
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 3px)`,
        top: "3px", bottom: "3px",
        background: isCurrentlyOn ? `${color},0.3)` : `${color},0.12)`,
        border: `1px solid ${color},${isCurrentlyOn ? "0.6" : "0.25"})`,
        borderRadius: "6px",
        padding: isShort ? "4px 6px" : "6px 8px",
        cursor: "pointer",
        overflow: "hidden",
        transition: "all 0.15s",
        zIndex: expanded ? 10 : 1,
        minWidth: "2px",
        boxSizing: "border-box",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color},0.3)`; e.currentTarget.style.zIndex = "5"; }}
      onMouseLeave={e => { e.currentTarget.style.background = isCurrentlyOn ? `${color},0.3)` : `${color},0.12)`; e.currentTarget.style.zIndex = expanded ? "10" : "1"; }}
    >
      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0e6d3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.3 }}>
        {show.title}
        {show.isNew && <span style={{ marginLeft: "4px", fontSize: "0.6rem", background: `${color},0.4)`, color: "#f0e6d3", padding: "1px 4px", borderRadius: "3px" }}>NEW</span>}
      </div>
      {!isShort && (
        <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.4)", marginTop: "1px" }}>
          {show.start}–{show.end} · {show.genre}
        </div>
      )}
      {expanded && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: "4px",
          background: "#1a1a1f", border: `1px solid ${color},0.4)`,
          borderRadius: "8px", padding: "10px 12px", minWidth: "200px", maxWidth: "280px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#f0e6d3", marginBottom: "4px" }}>{show.title}</div>
          <div style={{ fontSize: "0.72rem", color: `${color},0.8)`, marginBottom: "6px" }}>{show.start}–{show.end} · {show.genre} {show.rating ? `· ${show.rating}` : ""}</div>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{show.description}</div>
        </div>
      )}
    </div>
  );
}

function TimelineHeader({ startMins, totalMins, pixelsPerMin }) {
  const slots = [];
  const slot = 30;
  const firstSlot = Math.ceil(startMins / slot) * slot;
  for (let t = firstSlot; t <= startMins + totalMins; t += slot) {
    slots.push(t);
  }
  return (
    <div style={{ position: "relative", height: "28px", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
      {slots.map(t => {
        const leftPct = ((t - startMins) / totalMins) * 100;
        if (leftPct < 0 || leftPct > 100) return null;
        return (
          <div key={t} style={{ position: "absolute", left: `${leftPct}%`, top: 0, bottom: 0, display: "flex", alignItems: "center", paddingLeft: "4px" }}>
            <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>{minsToTime(t)}</span>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "1px", background: "rgba(255,255,255,0.06)" }} />
          </div>
        );
      })}
    </div>
  );
}

function NowLine({ startMins, totalMins }) {
  const now = nowMins();
  if (now < startMins || now > startMins + totalMins) return null;
  const leftPct = ((now - startMins) / totalMins) * 100;
  return (
    <div style={{ position: "absolute", left: `${leftPct}%`, top: 0, bottom: 0, width: "2px", background: "rgba(201,160,100,0.8)", zIndex: 15, pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 0, left: "-4px", width: "10px", height: "10px", background: "rgba(201,160,100,0.9)", borderRadius: "50%" }} />
    </div>
  );
}

// ── Main TV Guide ─────────────────────────────────────────────────────────────

export default function TVGuide() {
  const startMins = Math.floor(nowMins() / 30) * 30;
  const totalMins = 240; // 4 hours
  const endMins = startMins + totalMins;

  const [activeCategory, setActiveCategory] = useState("All");
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadedCategories, setLoadedCategories] = useState({});
  const gridRef = useRef(null);

  const categories = ["All", ...Object.keys(CHANNEL_CATEGORIES)];

  const channelsToLoad = activeCategory === "All"
    ? ALL_CHANNELS
    : CHANNEL_CATEGORIES[activeCategory];

  // Load in batches of 8 to avoid token limits
  const BATCH_SIZE = 8;

  const load = async () => {
    const cacheKey = activeCategory;
    if (loadedCategories[cacheKey]) {
      setListings(loadedCategories[cacheKey]);
      return;
    }

    setLoading(true); setError(null); setListings([]);
    const batches = [];
    for (let i = 0; i < channelsToLoad.length; i += BATCH_SIZE) {
      batches.push(channelsToLoad.slice(i, i + BATCH_SIZE));
    }

    const allListings = [];
    try {
      for (const batch of batches) {
        const result = await fetchListings(batch, startMins, endMins);
        allListings.push(...result);
        setListings([...allListings]); // Progressive render
      }
      setLoadedCategories(prev => ({ ...prev, [cacheKey]: allListings }));
      setRetryCount(0);
    } catch (e) {
      setError(e.message); setRetryCount(c => c + 1);
    } finally { setLoading(false); }
  };

  // Search across loaded listings
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    const q = searchQuery.toLowerCase();
    const results = [];
    listings.forEach(ch => {
      ch.shows?.forEach(show => {
        if (show.title.toLowerCase().includes(q) || show.genre?.toLowerCase().includes(q) || show.description?.toLowerCase().includes(q)) {
          results.push({ channel: ch.channel, show });
        }
      });
    });
    setSearchResults(results);
  }, [searchQuery, listings]);

  const currentListings = listings.filter(ch =>
    channelsToLoad.includes(ch.channel)
  );

  const CHAN_WIDTH = 90; // px for channel name column
  const ROW_HEIGHT = 52; // px per channel row

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, rgba(171,71,188,0.15), rgba(171,71,188,0.05))", border: "1px solid rgba(171,71,188,0.25)", borderRadius: "12px", padding: "14px 18px", marginBottom: "16px" }}>
        <div style={{ fontSize: "0.7rem", color: "rgba(171,71,188,0.8)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px" }}>Sky UK</div>
        <div style={{ fontSize: "0.9rem", color: "#f0e6d3", fontWeight: 600 }}>TV Guide — {minsToTime(startMins)} to {minsToTime(endMins)}</div>
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.3)", marginTop: "3px" }}>
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: "14px" }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="🔍  Search shows, genres, channels..."
          style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 14px", color: "#f0e6d3", fontSize: "0.85rem", outline: "none", boxSizing: "border-box" }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")}
            style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1rem" }}>✕</button>
        )}
      </div>

      {/* Search results */}
      {isSearching && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
            {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
          </div>
          {searchResults.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: "0.85rem", padding: "12px 0" }}>No matches found</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {searchResults.map((r, i) => {
                const color = genreColor(r.show.genre);
                const nowM = nowMins();
                const on = timeToMins(r.show.start) <= nowM && timeToMins(r.show.end) > nowM;
                return (
                  <div key={i} style={{ background: `${color},0.08)`, border: `1px solid ${color},0.2)`, borderRadius: "10px", padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f0e6d3" }}>{r.show.title} {r.show.isNew && <span style={{ fontSize: "0.65rem", background: `${color},0.3)`, padding: "1px 5px", borderRadius: "3px" }}>NEW</span>}</div>
                        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>{r.channel} · {r.show.start}–{r.show.end} · {r.show.genre}</div>
                        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.35)", marginTop: "4px" }}>{r.show.description}</div>
                      </div>
                      {on && <span style={{ fontSize: "0.65rem", background: "rgba(0,200,83,0.2)", color: "#00c853", border: "1px solid rgba(0,200,83,0.3)", borderRadius: "10px", padding: "2px 7px", flexShrink: 0, marginLeft: "8px" }}>ON NOW</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Category filters */}
      {!isSearching && (
        <>
          <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "10px", marginBottom: "14px", scrollbarWidth: "none" }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => { setActiveCategory(cat); }}
                style={{ flexShrink: 0, background: activeCategory === cat ? "rgba(171,71,188,0.25)" : "rgba(255,255,255,0.05)", border: `1px solid ${activeCategory === cat ? "rgba(171,71,188,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: "20px", padding: "5px 12px", color: activeCategory === cat ? "#ce93d8" : "rgba(255,255,255,0.45)", fontSize: "0.75rem", fontWeight: activeCategory === cat ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
                {cat}
              </button>
            ))}
          </div>

          {/* Load button */}
          <button onClick={load} disabled={loading}
            style={{ width: "100%", background: loading ? "rgba(171,71,188,0.08)" : "linear-gradient(135deg, rgba(171,71,188,0.25), rgba(171,71,188,0.1))", border: "1px solid rgba(171,71,188,0.35)", borderRadius: "10px", padding: "11px", color: "#ce93d8", fontSize: "0.88rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            {loading
              ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading listings…</>
              : <><span>⟳</span> {listings.length ? "Refresh" : `Load ${activeCategory} Listings`}</>}
          </button>

          {error && (
            <div style={{ background: "#ff4d4d15", border: "1px solid #ff4d4d33", borderRadius: "10px", padding: "12px 16px", marginBottom: "14px" }}>
              <div style={{ color: "#ff8080", fontSize: "0.85rem", fontWeight: 600, marginBottom: "4px" }}>⚠ Could not load listings {retryCount > 1 ? `(attempt ${retryCount})` : ""}</div>
              <div style={{ color: "rgba(255,140,140,0.7)", fontSize: "0.78rem", marginBottom: "8px" }}>{error}</div>
              <button onClick={load} style={{ background: "rgba(255,100,100,0.15)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "6px", padding: "5px 12px", color: "#ff8080", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>Retry</button>
            </div>
          )}

          {/* TV Grid */}
          {currentListings.length > 0 && (
            <div>
              <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.25)", marginBottom: "8px" }}>
                Tap a show for details · Scroll right for later times · Scroll down for more channels
              </div>
              <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" }}>
                {/* Sticky header row */}
                <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: "#0d0d0f" }}>
                  <div style={{ width: `${CHAN_WIDTH}px`, flexShrink: 0, background: "rgba(0,0,0,0.5)", borderRight: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "6px 8px", display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Channel</span>
                  </div>
                  <div style={{ flex: 1, overflow: "hidden", position: "relative", minWidth: 0 }}>
                    <TimelineHeader startMins={startMins} totalMins={totalMins} />
                  </div>
                </div>

                {/* Scrollable grid body */}
                <div ref={gridRef} style={{ maxHeight: "55vh", overflowY: "auto", overflowX: "auto" }}>
                  <div style={{ display: "flex", minWidth: `${CHAN_WIDTH + 600}px` }}>
                    {/* Channel names column */}
                    <div style={{ width: `${CHAN_WIDTH}px`, flexShrink: 0 }}>
                      {currentListings.map((ch, i) => (
                        <div key={ch.channel} style={{ height: `${ROW_HEIGHT}px`, borderBottom: "1px solid rgba(255,255,255,0.04)", borderRight: "1px solid rgba(255,255,255,0.06)", background: i % 2 === 0 ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.1)", display: "flex", alignItems: "center", padding: "0 8px" }}>
                          <span style={{ fontSize: "0.68rem", color: "#f0e6d3", fontWeight: 600, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{ch.channel}</span>
                        </div>
                      ))}
                    </div>

                    {/* Shows grid */}
                    <div style={{ flex: 1, position: "relative" }}>
                      {currentListings.map((ch, i) => {
                        const nowM = nowMins();
                        return (
                          <div key={ch.channel} style={{ height: `${ROW_HEIGHT}px`, position: "relative", borderBottom: "1px solid rgba(255,255,255,0.04)", background: i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                            <NowLine startMins={startMins} totalMins={totalMins} />
                            {(ch.shows || []).map((show, j) => {
                              const showStart = timeToMins(show.start);
                              const showEnd = timeToMins(show.end);
                              if (showEnd <= startMins || showStart >= endMins) return null;
                              const isOn = showStart <= nowM && showEnd > nowM;
                              return (
                                <ShowCard key={j} show={show} startMins={startMins} endMins={endMins} totalMins={totalMins} isCurrentlyOn={isOn} />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {loading && (
                <div style={{ textAlign: "center", color: "rgba(171,71,188,0.6)", fontSize: "0.78rem", marginTop: "10px" }}>
                  ⟳ Loading more channels…
                </div>
              )}

              {/* Legend */}
              <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {Object.entries(GENRE_COLORS).filter(([k]) => k !== "default").map(([genre, color]) => (
                  <span key={genre} style={{ fontSize: "0.65rem", background: `${color},0.12)`, border: `1px solid ${color},0.25)`, color: `${color},0.9)`, padding: "2px 8px", borderRadius: "10px" }}>
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          )}

          {currentListings.length === 0 && !loading && !error && (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "40px 20px", fontSize: "0.9rem" }}>
              Press the button above to load TV listings
            </div>
          )}
        </>
      )}
    </div>
  );
}

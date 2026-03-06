import { useState, useEffect, useCallback } from "react";

const TESLA_API = "/api/tesla";

async function teslaCall(action, vehicleId = null, params = null) {
  const res = await fetch(TESLA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, vehicleId, params }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function psi(bar) { return bar ? Math.round(bar * 14.5038) : "—"; }
function km(m) { return m ? Math.round(m / 1.609) : "—"; }

function StatCard({ icon, label, value, unit, accent = "rgba(201,160,100", alert = false }) {
  return (
    <div style={{
      background: alert ? "rgba(255,77,77,0.08)" : `${accent},0.07)`,
      border: `1px solid ${alert ? "rgba(255,77,77,0.3)" : `${accent},0.2)`}`,
      borderRadius: "12px", padding: "14px 16px",
    }}>
      <div style={{ fontSize: "1.2rem", marginBottom: "6px" }}>{icon}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: alert ? "#ff6b6b" : "#f0e6d3", fontFamily: "'Playfair Display', serif" }}>
        {value}<span style={{ fontSize: "0.7rem", fontWeight: 400, color: "rgba(255,255,255,0.4)", marginLeft: "3px" }}>{unit}</span>
      </div>
      <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.35)", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, loading, success, color = "rgba(201,160,100" }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{
        flex: 1, background: success ? "rgba(0,200,83,0.15)" : `${color},0.1)`,
        border: `1px solid ${success ? "rgba(0,200,83,0.4)" : `${color},0.25)`}`,
        borderRadius: "10px", padding: "12px 8px", cursor: loading ? "not-allowed" : "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", transition: "all 0.2s",
      }}
      onMouseEnter={e => !loading && (e.currentTarget.style.background = `${color},0.18)`)}
      onMouseLeave={e => !loading && (e.currentTarget.style.background = success ? "rgba(0,200,83,0.15)" : `${color},0.1)`)}>
      <span style={{ fontSize: "1.4rem" }}>{loading ? "⟳" : success ? "✓" : icon}</span>
      <span style={{ fontSize: "0.68rem", color: success ? "#00c853" : `${color},0.8)`, fontWeight: 600, textAlign: "center", letterSpacing: "0.04em" }}>{label}</span>
    </button>
  );
}

function BatteryBar({ level, charging }) {
  const color = level > 50 ? "#00c853" : level > 20 ? "#ffd600" : "#ff5252";
  return (
    <div style={{ marginBottom: "4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Battery</span>
        <span style={{ fontSize: "0.72rem", color, fontWeight: 700 }}>{level}% {charging ? "⚡ Charging" : ""}</span>
      </div>
      <div style={{ height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${level}%`, background: charging ? "linear-gradient(90deg, #00c853, #69f0ae)" : color, borderRadius: "4px", transition: "width 0.5s ease", position: "relative" }}>
          {charging && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)", animation: "shimmer 1.5s infinite" }} />}
        </div>
      </div>
    </div>
  );
}

export default function TeslaTab() {
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [vehicleData, setVehicleData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [actionSuccess, setActionSuccess] = useState({});
  const [error, setError] = useState(null);
  const [waking, setWaking] = useState(false);
  const [targetTemp, setTargetTemp] = useState(20);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Load vehicles on mount
  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    setLoading(true); setError(null);
    try {
      const data = await teslaCall("vehicles");
      const list = data.response || [];
      setVehicles(list);
      if (list.length > 0) setSelectedVehicle(list[0]);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const loadVehicleData = useCallback(async (vid) => {
    setLoading(true); setError(null);
    try {
      const data = await teslaCall("vehicle_data", vid);
      setVehicleData(data.response);
      setLastRefreshed(new Date());
    } catch (e) {
      if (e.message?.includes("408") || e.message?.toLowerCase().includes("sleep")) {
        setError("Car is asleep — press Wake Up first");
      } else {
        setError(e.message);
      }
    } finally { setLoading(false); }
  }, []);

  const wakeVehicle = async () => {
    if (!selectedVehicle) return;
    setWaking(true); setError(null);
    try {
      await teslaCall("wake", selectedVehicle.id);
      // Poll for awake state
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          await loadVehicleData(selectedVehicle.id);
          clearInterval(poll);
          setWaking(false);
        } catch {
          if (attempts > 15) { clearInterval(poll); setWaking(false); setError("Car took too long to wake"); }
        }
      }, 3000);
    } catch (e) { setError(e.message); setWaking(false); }
  };

  const runAction = async (action, params = null, label = action) => {
    if (!selectedVehicle) return;
    setActionLoading(p => ({ ...p, [label]: true }));
    setActionSuccess(p => ({ ...p, [label]: false }));
    try {
      await teslaCall(action, selectedVehicle.id, params);
      setActionSuccess(p => ({ ...p, [label]: true }));
      setTimeout(() => setActionSuccess(p => ({ ...p, [label]: false })), 3000);
    } catch (e) { setError(e.message); }
    finally { setActionLoading(p => ({ ...p, [label]: false })); }
  };

  const v = vehicleData;
  const charge = v?.charge_state;
  const climate = v?.climate_state;
  const drive = v?.drive_state;
  const state = v?.vehicle_state;
  const isAsleep = selectedVehicle?.state === "asleep" || selectedVehicle?.state === "offline";

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }`}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, rgba(229,57,53,0.15), rgba(229,57,53,0.05))", border: "1px solid rgba(229,57,53,0.25)", borderRadius: "12px", padding: "14px 18px", marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "0.7rem", color: "rgba(229,57,53,0.7)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Tesla</div>
            <div style={{ fontSize: "0.95rem", color: "#f0e6d3", fontWeight: 700 }}>
              {selectedVehicle ? selectedVehicle.display_name || selectedVehicle.vin : "No vehicle"}
            </div>
            {selectedVehicle && (
              <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>
                {selectedVehicle.vin} · {selectedVehicle.state}
              </div>
            )}
          </div>
          <div style={{ fontSize: "2.5rem" }}>🚗</div>
        </div>
      </div>

      {/* Vehicle selector if multiple */}
      {vehicles.length > 1 && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          {vehicles.map(v => (
            <button key={v.id} onClick={() => { setSelectedVehicle(v); setVehicleData(null); }}
              style={{ background: selectedVehicle?.id === v.id ? "rgba(229,57,53,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${selectedVehicle?.id === v.id ? "rgba(229,57,53,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: "8px", padding: "7px 14px", color: selectedVehicle?.id === v.id ? "#ef9a9a" : "rgba(255,255,255,0.5)", fontSize: "0.8rem", cursor: "pointer" }}>
              {v.display_name || v.vin}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: "#ff4d4d15", border: "1px solid #ff4d4d33", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px" }}>
          <div style={{ color: "#ff8080", fontSize: "0.85rem", fontWeight: 600, marginBottom: "6px" }}>⚠ {error}</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => selectedVehicle && loadVehicleData(selectedVehicle.id)}
              style={{ background: "rgba(255,100,100,0.15)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "6px", padding: "5px 12px", color: "#ff8080", fontSize: "0.78rem", cursor: "pointer" }}>Retry</button>
            <button onClick={() => setError(null)}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "5px 12px", color: "rgba(255,255,255,0.4)", fontSize: "0.78rem", cursor: "pointer" }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Wake / Refresh buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <button onClick={() => selectedVehicle && loadVehicleData(selectedVehicle.id)} disabled={loading || waking}
          style={{ flex: 1, background: loading ? "rgba(229,57,53,0.08)" : "linear-gradient(135deg, rgba(229,57,53,0.2), rgba(229,57,53,0.08))", border: "1px solid rgba(229,57,53,0.3)", borderRadius: "10px", padding: "11px", color: "#ef9a9a", fontSize: "0.85rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          {loading ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading…</> : <><span>⟳</span> Refresh Status</>}
        </button>
        <button onClick={wakeVehicle} disabled={waking || loading}
          style={{ flex: 1, background: waking ? "rgba(255,193,7,0.08)" : "rgba(255,193,7,0.1)", border: "1px solid rgba(255,193,7,0.25)", borderRadius: "10px", padding: "11px", color: "#ffd54f", fontSize: "0.85rem", fontWeight: 700, cursor: waking ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          {waking ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Waking…</> : <><span>☀️</span> Wake Up</>}
        </button>
      </div>

      {lastRefreshed && (
        <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.25)", marginBottom: "16px", textAlign: "right" }}>
          Updated {lastRefreshed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      )}

      {v && (
        <>
          {/* Battery */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
            <BatteryBar level={charge?.battery_level || 0} charging={charge?.charging_state === "Charging"} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginTop: "14px" }}>
              <StatCard icon="🔋" label="Charge" value={charge?.battery_level || "—"} unit="%" accent="rgba(0,200,83" />
              <StatCard icon="🛣" label="Est. Range" value={charge?.est_battery_range ? km(charge.est_battery_range) : "—"} unit="mi" accent="rgba(0,200,83" />
              <StatCard icon="⚡" label="Charge State" value={charge?.charging_state || "—"} unit="" accent="rgba(255,193,7" />
            </div>
            {charge?.charging_state === "Charging" && (
              <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(0,200,83,0.08)", borderRadius: "8px", border: "1px solid rgba(0,200,83,0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>⚡ {charge.charger_power || 0} kW</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Full in ~{charge.time_to_full_charge?.toFixed(1) || "?"} hrs</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>Limit: {charge.charge_limit_soc}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Climate */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Climate</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              <StatCard icon="🌡" label="Inside" value={climate?.inside_temp?.toFixed(1) || "—"} unit="°C" accent="rgba(33,150,243" />
              <StatCard icon="🌤" label="Outside" value={climate?.outside_temp?.toFixed(1) || "—"} unit="°C" accent="rgba(33,150,243" />
              <StatCard icon="❄️" label="A/C" value={climate?.is_climate_on ? "On" : "Off"} unit="" accent="rgba(33,150,243" />
            </div>
          </div>

          {/* Security & State */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Security & Status</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <StatCard icon={state?.locked ? "🔒" : "🔓"} label="Doors" value={state?.locked ? "Locked" : "Unlocked"} unit="" accent={state?.locked ? "rgba(0,200,83" : "rgba(255,77,77"} alert={!state?.locked} />
              <StatCard icon="🚗" label="Odometer" value={state?.odometer ? Math.round(state.odometer).toLocaleString() : "—"} unit="mi" accent="rgba(201,160,100" />
            </div>
          </div>

          {/* Tyre Pressures */}
          {state?.tpms_pressure_fl !== undefined && (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
              <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Tyre Pressures (PSI)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {[
                  { label: "Front Left", val: state?.tpms_pressure_fl },
                  { label: "Front Right", val: state?.tpms_pressure_fr },
                  { label: "Rear Left", val: state?.tpms_pressure_rl },
                  { label: "Rear Right", val: state?.tpms_pressure_rr },
                ].map(({ label, val }) => {
                  const p = psi(val);
                  const low = typeof p === "number" && p < 38;
                  return <StatCard key={label} icon="🔵" label={label} value={p} unit="PSI" accent={low ? "rgba(255,77,77" : "rgba(100,181,246"} alert={low} />;
                })}
              </div>
            </div>
          )}

          {/* Location */}
          {drive?.latitude && (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
              <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>Location</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "0.82rem", color: "#f0e6d3" }}>{drive.latitude.toFixed(4)}, {drive.longitude.toFixed(4)}</div>
                  {drive.speed > 0 && <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", marginTop: "3px" }}>Speed: {Math.round(drive.speed)} mph · Heading: {drive.heading}°</div>}
                </div>
                <a href={`https://www.google.com/maps?q=${drive.latitude},${drive.longitude}`} target="_blank" rel="noopener noreferrer"
                  style={{ background: "rgba(66,133,244,0.15)", border: "1px solid rgba(66,133,244,0.3)", borderRadius: "8px", padding: "7px 12px", color: "#90caf9", fontSize: "0.75rem", fontWeight: 600, textDecoration: "none" }}>
                  📍 Maps
                </a>
              </div>
            </div>
          )}

          {/* Climate Controls */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "14px" }}>Climate Control</div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <ActionButton icon="🌡" label="A/C On" onClick={() => runAction("climate_on", null, "climate_on")} loading={actionLoading["climate_on"]} success={actionSuccess["climate_on"]} color="rgba(33,150,243" />
              <ActionButton icon="❄️" label="A/C Off" onClick={() => runAction("climate_off", null, "climate_off")} loading={actionLoading["climate_off"]} success={actionSuccess["climate_off"]} color="rgba(100,181,246" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>Set Temp:</span>
              <input type="range" min="16" max="28" value={targetTemp} onChange={e => setTargetTemp(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#ef9a9a" }} />
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0e6d3", minWidth: "40px", textAlign: "right" }}>{targetTemp}°C</span>
              <button onClick={() => runAction("set_temp", { temp: targetTemp }, "set_temp")}
                style={{ background: actionSuccess["set_temp"] ? "rgba(0,200,83,0.2)" : "rgba(229,57,53,0.15)", border: `1px solid ${actionSuccess["set_temp"] ? "rgba(0,200,83,0.4)" : "rgba(229,57,53,0.3)"}`, borderRadius: "8px", padding: "6px 12px", color: actionSuccess["set_temp"] ? "#00c853" : "#ef9a9a", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
                {actionSuccess["set_temp"] ? "✓ Set" : "Set"}
              </button>
            </div>
          </div>

          {/* Fun controls */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "14px" }}>Controls</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <ActionButton icon="💡" label="Flash Lights" onClick={() => runAction("flash_lights", null, "flash")} loading={actionLoading["flash"]} success={actionSuccess["flash"]} color="rgba(255,193,7" />
              <ActionButton icon="📯" label="Honk Horn" onClick={() => runAction("honk_horn", null, "honk")} loading={actionLoading["honk"]} success={actionSuccess["honk"]} color="rgba(255,152,0" />
            </div>
          </div>
        </>
      )}

      {!v && !loading && !error && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", padding: "40px 20px", fontSize: "0.9rem" }}>
          Press Refresh Status to load your Tesla's data
        </div>
      )}
    </div>
  );
}

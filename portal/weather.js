/* Topbar weather chip — real current conditions from Open-Meteo (no API key,
   CORS-enabled), refreshed every 15 minutes. Defaults to Islamabad; if the
   user has used Locate, switches to their real coordinates. */

const $ = (id) => document.getElementById(id);

const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Severe thunderstorm',
};

let coords = { lat: 33.6844, lon: 73.0479, city: 'Islamabad' };

async function refresh() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true&temperature_unit=celsius`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const cw = data.current_weather;
    $('wx-temp').textContent = Math.round(cw.temperature) + '°C';
    $('wx-city').textContent = coords.city;
    $('wx-desc').textContent = WMO[cw.weathercode] || '—';
  } catch (err) {
    $('wx-desc').textContent = 'unavailable';
    console.warn('[weather]', err.message);
  }
}

window.setWeatherLocation = (lat, lon, city) => {
  coords = { lat, lon, city: city || `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
  refresh();
};

refresh();
setInterval(refresh, 15 * 60 * 1000);

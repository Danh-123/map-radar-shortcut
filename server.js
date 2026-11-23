require('dotenv').config();
const express = require('express');
const app = express();

// Tính khoảng cách (km) giữa 2 tọa độ (Haversine)
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Quy đổi bán kính (km) sang mức zoom Google Maps
function radiusToZoom(radiusKm) {
    if (radiusKm <= 5) return 14;
    if (radiusKm <= 15) return 12;
    if (radiusKm <= 40) return 11;
    return 10;
}

app.get('/scan', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const q = req.query.q || 'quán ăn ngon';
    const radius = parseFloat(req.query.radius) || 20; // mặc định 20km
    const minRating = parseFloat(req.query.minRating) || 4.3;
    const minReviews = parseInt(req.query.minReviews) || 20;

    if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).send('Thiếu tọa độ lat hoặc lng.');
    }

    try {
        const zoom = radiusToZoom(radius);
        const response = await fetch('https://google.serper.dev/maps', {
            method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                q,
                ll: `@${lat},${lng},${zoom}z`,
                gl: 'vn',
                hl: 'vi',
            }),
        });

        const data = await response.json();
        const rawPlaces = data.places || [];

        // Lọc theo sao, số lượt đánh giá và bán kính
        const places = rawPlaces
            .map((p) => ({
                title: p.title,
                address: p.address || '',
                lat: p.latitude,
                lng: p.longitude,
                rating: p.rating || 0,
                reviews: p.ratingCount || 0,
                distance: getDistanceKm(lat, lng, p.latitude, p.longitude),
            }))
            .filter(
                (p) =>
                    p.lat &&
                    p.lng &&
                    p.rating >= minRating &&
                    p.reviews >= minReviews &&
                    p.distance <= radius
            )
            .sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);

        res.send(renderHTML({ lat, lng, q, radius, places }));
    } catch (err) {
        console.error(err);
        res.status(500).send('Lỗi khi lấy dữ liệu từ Serper API.');
    }
});

function renderHTML({ lat, lng, q, radius, places }) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Radar: ${q}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    body { background: #0f0f11; color: #f4f4f5; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    #map { height: 45vh; width: 100%; border-bottom: 1px solid #27272a; }
    .header { padding: 12px 16px; background: #18181b; border-bottom: 1px solid #27272a; display: flex; justify-content: space-between; align-items: center; }
    .header h2 { font-size: 15px; font-weight: 600; }
    .header span { font-size: 12px; color: #a1a1aa; }
    .list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; cursor: pointer; }
    .card:active { background: #27272a; }
    .info { flex: 1; min-width: 0; }
    .title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #a1a1aa; display: flex; gap: 10px; align-items: center; }
    .star { color: #facc15; font-weight: 600; }
    .btn { background: #f4f4f5; color: #09090b; text-decoration: none; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .empty { text-align: center; color: #71717a; margin-top: 40px; font-size: 14px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="header">
    <h2>${q} (${places.length} điểm)</h2>
    <span>Bán kính ${radius} km</span>
  </div>
  <div class="list" id="list"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const userLat = ${lat};
    const userLng = ${lng};
    const places = ${JSON.stringify(places)};

    const map = L.map('map').setView([userLat, userLng], 12);
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
  maxZoom: 20,
  attribution: '&copy; Google Maps'
}).addTo(map);

    // Đánh dấu vị trí của bạn
    L.circleMarker([userLat, userLng], {
      radius: 7, fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1
    }).addTo(map).bindPopup('Vị trí của bạn');

    const listEl = document.getElementById('list');
    const markers = [];

    if (places.length === 0) {
      listEl.innerHTML = '<div class="empty">Không tìm thấy địa điểm nào đạt tiêu chí trong bán kính này.</div>';
    } else {
      places.forEach((p, idx) => {
        const marker = L.marker([p.lat, p.lng]).addTo(map)
          .bindPopup(\`<b>\${p.title}</b><br>★ \${p.rating} (\${p.reviews} đánh giá)\`);
        markers.push(marker);

        const navUrl = \`https://www.google.com/maps/dir/?api=1&destination=\${p.lat},\${p.lng}\`;
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="info">
            <div class="title">\${p.title}</div>
            <div class="meta">
              <span class="star">★ \${p.rating}</span>
              <span>(\${p.reviews})</span>
              <span>• \${p.distance.toFixed(1)} km</span>
            </div>
          </div>
          <a class="btn" href="\${navUrl}" target="_blank" onclick="event.stopPropagation()">Chỉ đường</a>
        \`;
        card.onclick = () => {
          map.flyTo([p.lat, p.lng], 15);
          marker.openPopup();
        };
        listEl.appendChild(card);
      });

      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }
  </script>
</body>
</html>`;
}

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}
module.exports = app;
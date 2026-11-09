// All Mapbox style tweaks live here. Loaded before map.js.
// Goal: muted, text-light basemap so item stickers carry the page. Brand: cream #F5F3EE, ink #1E3A2B, orange #FF4F00.
window.LENDO_MAP_STYLE = {
  // Layer ids (or id prefixes) to hide. Checked against layer.id and layer['source-layer'].
  hideLayers: [
    'poi-label',            // all points of interest
    'transit-label',
    'airport-label',
    'road-label-simple',    // minor road names (light-v11 uses 'road-label' family)
    'road-number-shield',
    'road-exit-shield',
    'path-pedestrian-label',
    'ferry-aerialway-label',
    'natural-point-label',
    'water-point-label',
    'building-number-label',
    'housenum-label',
  ],
  // Keep these even if a prefix above would match.
  keepLayers: ['road-label', 'settlement-label', 'settlement-subdivision-label', 'place-label'],
  // Paint overrides applied where the layer exists.
  paint: {
    'water': { 'fill-color': '#DCE6E8' },
    'land': { 'background-color': '#F3F0E8' },
    'landuse': { 'fill-opacity': 0.5 },
    'building': { 'fill-color': '#E9E4D8', 'fill-opacity': 0.6 },
    'road-label': { 'text-color': '#8A857B', 'text-halo-color': '#F5F3EE' },
    'settlement-subdivision-label': { 'text-color': '#1E3A2B', 'text-halo-color': '#F5F3EE' },
  },
  // Lendo layers
  cluster: { fill: '#1E3A2B', stroke: '#F5F3EE', text: '#FFFFFF' },
  hoods: { line: '#1E3A2B', lineOpacity: 0.35, fill: '#1E3A2B', fillOpacity: 0.04, emptyFillOpacity: 0.12, emptyColor: '#8A857B' },
  sticker: { size: 56, border: 3, tagBg: '#FF4F00', tagInk: '#1E3A2B', tagText: '#FFFFFF' },
};

// Apply hides + paint to a loaded style.
window.applyLendoStyle = function (map) {
  var S = window.LENDO_MAP_STYLE;
  var layers = (map.getStyle() && map.getStyle().layers) || [];
  layers.forEach(function (l) {
    var id = l.id, sl = l['source-layer'] || '';
    var keep = S.keepLayers.some(function (k) { return id === k; });
    var hide = !keep && S.hideLayers.some(function (h) { return id === h || id.indexOf(h) === 0 || sl === h; });
    if (hide) { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
    var p = S.paint[id];
    if (p) Object.keys(p).forEach(function (k) { try { map.setPaintProperty(id, k, p[k]); } catch (e) {} });
  });
};

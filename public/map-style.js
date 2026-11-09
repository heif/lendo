// All Mapbox style tweaks live here (loaded before map.js). Target: the prototype's minimal map —
// warm grey ground, pure-white streets, pale green parks, pale blue water, tiny uppercase mono labels, no buildings, no POIs.
window.LENDO_MAP_STYLE = {
  colors: {
    ground: '#EEEDE9', road: '#FFFFFF', park: '#DCE6D3', water: '#DCE4E6',
    label: '#A3ABAF', parkLabel: '#8FA58A', waterLabel: '#A3B4B8', hoodLabel: '#8FA58A',
  },
  fonts: { mono: ['Roboto Mono Bold', 'DIN Pro Bold', 'Arial Unicode MS Bold'] },
  // Hide anything matching these (layer id or source-layer), unless kept below.
  hide: ['poi', 'transit', 'airport', 'housenum', 'building', 'road-number-shield', 'road-exit-shield', 'natural-', 'contour', 'hillshade',
    'admin-', 'aeroway', 'ferry', 'golf', 'path-pedestrian-label', 'road-label-simple', 'place-label-sm', 'settlement-minor-label', 'state-label', 'country-label', 'continent', 'landuse-overlay', 'wetland', 'pitch-outline'],
  keep: ['road-label', 'settlement-subdivision-label', 'settlement-major-label', 'water-line-label', 'water-point-label', 'waterway-label', 'park-label', 'national-park', 'landuse'],
  // Lendo layers
  cluster: { fill: '#FF4F00', stroke: '#1E3A2B', text: '#FFFFFF' },
  hoods: { line: '#1E3A2B', lineOpacity: 0.3, fill: '#1E3A2B', fillOpacity: 0.03, emptyFillOpacity: 0.1, emptyColor: '#8A857B' },
  sticker: { size: 56, border: 3, tagBg: '#FF4F00', tagInk: '#1E3A2B', tagText: '#FFFFFF' },
};

window.applyLendoStyle = function (map) {
  var S = window.LENDO_MAP_STYLE, C = S.colors;
  var set = function (id, kind, prop, val) { try { if (kind === 'paint') map.setPaintProperty(id, prop, val); else map.setLayoutProperty(id, prop, val); } catch (e) {} };
  var layers = (map.getStyle() && map.getStyle().layers) || [];
  var roadW = ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.6, 13, 1.5, 15, 4, 17, 10, 19, 24];       // major streets
  var minorW = ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.3, 14, 0.9, 16, 2.5, 18, 7, 19, 12];     // side streets, service
  layers.forEach(function (l) {
    var id = l.id, sl = l['source-layer'] || '', type = l.type;
    var kept = S.keep.some(function (k) { return id === k || id.indexOf(k) === 0; });
    if (!kept && S.hide.some(function (h) { return id.indexOf(h) === 0 || id.indexOf(h) > -1 || sl === h; })) { set(id, 'layout', 'visibility', 'none'); return; }
    if (type === 'background') { set(id, 'paint', 'background-color', C.ground); return; }
    if (type === 'fill') {
      if (/water/.test(id) || sl === 'water') { set(id, 'paint', 'fill-color', C.water); set(id, 'paint', 'fill-opacity', 1); return; }
      if (/park|national-park|landuse|landcover|pitch|grass|cemetery|golf/.test(id) || sl === 'landuse' || sl === 'landcover') {
        // parks green; everything else (industrial, hospital, school, …) fades into the ground
        var isPark = /park|pitch|grass|golf|cemetery/.test(id) || sl === 'landcover';
        set(id, 'paint', 'fill-color', isPark ? C.park : ['match', ['get', 'class'], ['park', 'pitch', 'grass', 'wood', 'scrub', 'cemetery', 'glacier', 'agriculture'], C.park, C.ground]);
        set(id, 'paint', 'fill-opacity', 1); set(id, 'paint', 'fill-outline-color', 'rgba(0,0,0,0)');
        return;
      }
      if (/land|building/.test(id)) { set(id, 'layout', 'visibility', 'none'); return; }
    }
    if (type === 'line') {
      if (sl === 'road' || /road|bridge|tunnel|street|motorway|primary|secondary|minor|service|path|track|link/.test(id)) {
        if (/case|shadow|polygon|oneway|pedestrian|path|track|steps|turning/.test(id)) { set(id, 'layout', 'visibility', 'none'); return; }
        set(id, 'paint', 'line-color', C.road); set(id, 'paint', 'line-opacity', 1);
        set(id, 'paint', 'line-width', /minor|service|street-low|link/.test(id) ? minorW : roadW);
        try { map.setPaintProperty(id, 'line-dasharray', null); } catch (e) {}
        return;
      }
      if (/water|river|canal|stream/.test(id) || sl === 'waterway') { set(id, 'paint', 'line-color', C.water); return; }
      if (/admin|boundary|rail|aerial/.test(id)) { set(id, 'layout', 'visibility', 'none'); return; }
    }
    if (type === 'symbol') {
      var mono = { 'text-font': S.fonts.mono, 'text-transform': 'uppercase', 'text-letter-spacing': 0.14 };
      if (/^road-label/.test(id)) { Object.keys(mono).forEach(function (k) { set(id, 'layout', k, mono[k]); }); set(id, 'layout', 'text-size', ['interpolate', ['linear'], ['zoom'], 13, 8, 16, 10, 18, 12]); set(id, 'paint', 'text-color', C.label); set(id, 'paint', 'text-halo-color', C.road); set(id, 'paint', 'text-halo-width', 1.2); return; }
      if (/park|national-park|landuse/.test(id)) { Object.keys(mono).forEach(function (k) { set(id, 'layout', k, mono[k]); }); set(id, 'layout', 'text-size', 9); set(id, 'layout', 'icon-image', ''); set(id, 'paint', 'text-color', C.parkLabel); set(id, 'paint', 'text-halo-color', C.park); return; }
      if (/water/.test(id)) { Object.keys(mono).forEach(function (k) { set(id, 'layout', k, mono[k]); }); set(id, 'layout', 'text-size', 9.5); set(id, 'paint', 'text-color', C.waterLabel); set(id, 'paint', 'text-halo-color', C.water); return; }
      if (/settlement-subdivision/.test(id)) { Object.keys(mono).forEach(function (k) { set(id, 'layout', k, mono[k]); }); set(id, 'layout', 'text-size', ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 11]); set(id, 'paint', 'text-color', C.hoodLabel); set(id, 'paint', 'text-halo-color', C.ground); set(id, 'paint', 'text-halo-width', 1.5); return; }
      if (/settlement-major/.test(id)) { set(id, 'layout', 'text-font', S.fonts.mono); set(id, 'paint', 'text-color', C.label); set(id, 'paint', 'text-halo-color', C.ground); return; }
      // anything else with an icon or text we didn't account for → off (keeps it text-light)
      set(id, 'layout', 'visibility', 'none');
    }
  });
};

// ---- terrain shaping --------------------------------------------------
  function smoothstep(a, b, x) {
    var t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function shapeTerrain(t) {
    var seg = t.segments + 1;
    for (var i = 0; i < seg * seg; i++) {
      var x = t.vertices[i * 3];
      var z = t.vertices[i * 3 + 2];
      var h = t.heightMap[i];
      var ds = Math.sqrt((x - SPAWN[0]) * (x - SPAWN[0]) + (z - SPAWN[1]) * (z - SPAWN[1]));
      var spawnBlend = 1 - smoothstep(7.5, 20.0, ds);
      h = h * (1 - spawnBlend) + 0.0 * spawnBlend;
      var dl = Math.sqrt((x - LAKE[0]) * (x - LAKE[0]) + (z - LAKE[1]) * (z - LAKE[1]));
      var lakeBlend = 1 - smoothstep(13.0, 26.0, dl);
      h = h * (1 - lakeBlend) + (-9.5) * lakeBlend;
      var ridge = smoothstep(58.0, 96.0, -z);
      h += ridge * (10.0 + 8.0 * Math.sin(x * 0.12 + 1.2));
      t.heightMap[i] = h;
      t.vertices[i * 3 + 1] = h;
    }
    t._computeNormals();
    for (var j = 0; j < seg * seg; j++) {
      var hh = t.heightMap[j];
      var ny = t.normals[j * 3 + 1];
      var c0 = 0.16, c1 = 0.22, c2 = 0.10;
      if (hh < WATER_LEVEL - 0.5) { c0 = 0.04; c1 = 0.07; c2 = 0.07; }
      else if (hh < WATER_LEVEL + 0.80) { c0 = 0.32; c1 = 0.28; c2 = 0.18; }
      else if (hh < 6.0) { c0 = 0.16; c1 = 0.22; c2 = 0.10; }
      else if (hh < 13.0) { c0 = 0.22; c1 = 0.21; c2 = 0.17; }
      else { c0 = 0.40; c1 = 0.43; c2 = 0.47; }
      if (ny < 0.56) {
        c0 = c0 * 0.68 + 0.20;
        c1 = c1 * 0.68 + 0.19;
        c2 = c2 * 0.68 + 0.17;
      }
      var patch = 0.5 + 0.5 * Math.sin(x * 0.23 + Math.cos(z * 0.17) * 1.8);
      var patch2 = 0.5 + 0.5 * Math.sin(x * 0.07 - z * 0.11);
      if (hh >= WATER_LEVEL + 0.8 && hh < 6.0) {
        c0 = c0 * (0.76 + 0.26 * patch) + 0.035 * patch2;
        c1 = c1 * (0.86 + 0.18 * patch);
        c2 = c2 * (0.74 + 0.14 * patch) + 0.012 * patch2;
      }
      t.colors[j * 3] = c0;
      t.colors[j * 3 + 1] = c1;
      t.colors[j * 3 + 2] = c2;
    }
    t.built = true;
  }

  
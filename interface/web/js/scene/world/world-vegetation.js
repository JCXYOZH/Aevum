// ---- tree / grass meshes ---------------------------------------------
  function pushCone(out, cx, cy, cz, radius, height, color, segments) {
    var base = out.pos.length / 3;
    for (var i = 0; i < segments; i++) {
      var a0 = i / segments * Math.PI * 2;
      var a1 = (i + 1) / segments * Math.PI * 2;
      var p0 = [cx + Math.cos(a0) * radius, cy, cz + Math.sin(a0) * radius];
      var p1 = [cx + Math.cos(a1) * radius, cy, cz + Math.sin(a1) * radius];
      var tip = [cx, cy + height, cz];
      var n0 = normalize3([Math.cos(a0), 0.45, Math.sin(a0)]);
      var n1 = normalize3([Math.cos(a1), 0.45, Math.sin(a1)]);
      var nTip = [0, 1, 0];
      out.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], tip[0], tip[1], tip[2]);
      out.nor.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], nTip[0], nTip[1], nTip[2]);
      for (var k = 0; k < 3; k++) out.col.push(color[0], color[1], color[2]);
      out.idx.push(base + i * 3, base + i * 3 + 1, base + i * 3 + 2);
    }
  }
  function pushEllipsoid(out, cx, cy, cz, rx, ry, rz, color, segments, rings) {
    var base = out.pos.length / 3;
    for (var y = 0; y <= rings; y++) {
      var phi = y / rings * Math.PI;
      for (var x = 0; x <= segments; x++) {
        var theta = x / segments * Math.PI * 2;
        var px = Math.sin(phi) * Math.cos(theta);
        var py = Math.cos(phi);
        var pz = Math.sin(phi) * Math.sin(theta);
        out.pos.push(cx + px * rx, cy + py * ry, cz + pz * rz);
        var n = normalize3([px / rx, py / ry, pz / rz]);
        out.nor.push(n[0], n[1], n[2]);
        out.col.push(color[0], color[1], color[2]);
      }
    }
    for (var y2 = 0; y2 < rings; y2++) {
      for (var x2 = 0; x2 < segments; x2++) {
        var a = base + y2 * (segments + 1) + x2;
        var b = a + segments + 1;
        out.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  function pushCylinder(out, cx, cy, cz, radius, height, color, segments) {
    var base = out.pos.length / 3;
    for (var i = 0; i < segments; i++) {
      var a0 = i / segments * Math.PI * 2;
      var a1 = (i + 1) / segments * Math.PI * 2;
      var p0 = [cx + Math.cos(a0) * radius, cy, cz + Math.sin(a0) * radius];
      var p1 = [cx + Math.cos(a1) * radius, cy, cz + Math.sin(a1) * radius];
      var p2 = [p1[0], cy + height, p1[2]];
      var p3 = [p0[0], cy + height, p0[2]];
      var n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
      out.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
      out.nor.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], n1[0], n1[1], n1[2], n0[0], n0[1], n0[2]);
      for (var k = 0; k < 4; k++) out.col.push(color[0], color[1], color[2]);
      out.idx.push(base + i * 4, base + i * 4 + 1, base + i * 4 + 2, base + i * 4, base + i * 4 + 2, base + i * 4 + 3);
    }
  }
  function normalize3(v) {
    if (!window.OrbMath || !window.OrbMath.Vec3) {
      throw new Error('OrbMath.Vec3 is required; inline normalize3 is removed');
    }
    var ov = new window.OrbMath.Vec3(v[0], v[1], v[2]).normalize();
    if (window.AEVUM_GRAPHICS_USAGE) window.AEVUM_GRAPHICS_USAGE.OrbMath = (window.AEVUM_GRAPHICS_USAGE.OrbMath || 0) + 1;
    return [ov.x, ov.y, ov.z];
  }
  function makeTreeMesh(trees) {
    var out = { pos: [], nor: [], col: [], idx: [] };
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i];
      var s = t.scale || 1;
      var kind = t.type || 'pine';
      var bark = kind === 'birch' ? [0.46, 0.42, 0.34] : [0.20, 0.15, 0.10];
      var leaf = t.color || [0.18, 0.34, 0.12];
      var crown = [leaf[0] * 0.38, leaf[1] * 0.52, leaf[2] * 0.28];
      var light = [leaf[0] * 0.52, leaf[1] * 0.68, leaf[2] * 0.38];
      if (kind === 'pine') {
        pushCylinder(out, t.x, t.y, t.z, 0.10 * s, 1.55 * s, bark, 6);
        pushCone(out, t.x, t.y + 0.95 * s, t.z, 1.05 * s, 1.65 * s, crown, 9);
        pushCone(out, t.x, t.y + 1.72 * s, t.z, 0.82 * s, 1.45 * s, light, 9);
        pushCone(out, t.x, t.y + 2.42 * s, t.z, 0.55 * s, 1.18 * s, light, 9);
      } else {
        pushCylinder(out, t.x, t.y, t.z, kind === 'birch' ? 0.065 * s : 0.11 * s, 2.05 * s, bark, 6);
        pushEllipsoid(out, t.x, t.y + 1.86 * s, t.z, 0.92 * s, 0.76 * s, 0.88 * s, crown, 8, 5);
        pushEllipsoid(out, t.x - 0.48 * s, t.y + 1.55 * s, t.z + 0.18 * s, 0.58 * s, 0.52 * s, 0.58 * s, light, 7, 4);
        pushEllipsoid(out, t.x + 0.42 * s, t.y + 1.52 * s, t.z - 0.16 * s, 0.54 * s, 0.48 * s, 0.56 * s, crown, 7, 4);
      }
    }
    programRef = terrainProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx));
  }
  function makeFlowerMesh(flowers) {
    var out = { pos: [], nor: [], col: [], idx: [] };
    var base = 0;
    for (var i = 0; i < flowers.length; i++) {
      var f = flowers[i];
      var c = i % 5 === 0 ? [0.92, 0.88, 0.70] : (i % 3 === 0 ? [0.82, 0.72, 0.32] : [0.88, 0.82, 0.52]);
      var h = 0.14 + (i % 3) * 0.03, w = 0.045;
      for (var a = 0; a < 3; a++) {
        var ang = a * 1.047;
        var dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
        out.pos.push(f.x - dx, f.y, f.z - dz, f.x + dx, f.y, f.z + dz, f.x + dx, f.y + h, f.z + dz, f.x - dx, f.y + h, f.z - dz);
        for (var n = 0; n < 4; n++) { out.nor.push(0, 1, 0); out.col.push(c[0], c[1], c[2]); }
        out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    return out.pos.length ? createMesh(out.pos, out.nor, out.col, out.idx, null) : null;
  }

  function makeGrassMesh(grass) {
    var out = { pos: [], nor: [], col: [], flex: [], idx: [] };
    for (var i = 0; i < grass.length; i++) {
      var g = grass[i];
      var y0 = g.y + 0.01;
      var h = Math.max(0.09, g.height * 0.62);
      var w = Math.max(0.008, g.width * 0.48);
      var c = g.color || [0.18, 0.38, 0.10];
      c = [0.07 + (c[0] - 0.20) * 0.08, 0.17 + (c[1] - 0.45) * 0.10, 0.035 + (c[2] - 0.10) * 0.05];
      for (var q = 0; q < 4; q++) {
        var ang = g.rotation + q * 0.62 + 0.3;
        var ox = Math.cos(g.rotation + q * 1.8) * 0.075;
        var oz = Math.sin(g.rotation + q * 1.8) * 0.075;
        var hq = h * (0.66 + ((q * 17) % 9) * 0.045);
        var dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
        var base = out.pos.length / 3;
        out.pos.push(g.x - dx + ox, y0, g.z - dz + oz, g.x + dx + ox, y0, g.z + dz + oz, g.x + dx + ox, y0 + hq, g.z + dz + oz, g.x - dx + ox, y0 + hq, g.z - dz + oz);
        out.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        out.col.push(c[0]*0.88, c[1]*0.92, c[2]*0.88, c[0]*0.88, c[1]*0.92, c[2]*0.88, c[0]*1.18, c[1]*1.22, c[2]*1.08, c[0]*1.18, c[1]*1.22, c[2]*1.08);
        out.flex.push(0, 0, 1, 1);
        out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    programRef = grassProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx), new Float32Array(out.flex));
  }

  function makeBirdMesh() {
    // A distant bird needs a readable silhouette, not four large polygons.
    // Wings sweep back from the shoulders; the tail closes the body.
    var verts = [
      [0, 0.00, -0.56],       // 0 head / front
      [0, 0.05, 0.48],        // 1 tail
      [-0.20, 0.04, -0.06],   // 2 left shoulder
      [-1.16, 0.12, 0.30],    // 3 left wing tip
      [-0.54, 0.06, 0.52],    // 4 left trailing edge
      [0.20, 0.04, -0.06],    // 5 right shoulder
      [1.16, 0.12, 0.30],     // 6 right wing tip
      [0.54, 0.06, 0.52]      // 7 right trailing edge
    ];
    var tris = [
      [0, 2, 3], [0, 3, 4], [0, 4, 1],
      [0, 5, 6], [0, 6, 7], [0, 7, 1]
    ];
    var out = { pos: [], nor: [], col: [], idx: [] };
    var base = 0;
    for (var t = 0; t < tris.length; t++) {
      for (var v = 0; v < 3; v++) {
        var p = verts[tris[t][v]];
        out.pos.push(p[0], p[1], p[2]);
        var n = normalize3([p[0] * 0.12, 1, p[2] * 0.12]);
        out.nor.push(n[0], n[1], n[2]);
        out.col.push(0.12, 0.15, 0.19);
      }
      out.idx.push(base, base + 1, base + 2);
      base += 3;
    }
    programRef = objectProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx));
  }

  function makeFireflyMesh() {
    var points = [
      [0, 0.5, 0], [0, -0.5, 0],
      [0.45, 0, 0], [-0.45, 0, 0],
      [0, 0, 0.45], [0, 0, -0.45]
    ];
    var faces = [
      [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
      [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]
    ];
    var out = { pos: [], nor: [], col: [], idx: [] };
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      out.pos.push(p[0], p[1], p[2]);
      var n = normalize3(p);
      out.nor.push(n[0], n[1], n[2]);
      out.col.push(0.9, 0.85, 0.45);
    }
    for (var f = 0; f < faces.length; f++) {
      out.idx.push(faces[f][0], faces[f][1], faces[f][2]);
    }
    programRef = objectProgram;
    return createMesh(new Float32Array(out.pos), new Float32Array(out.nor), new Float32Array(out.col), new Uint32Array(out.idx));
  }

  